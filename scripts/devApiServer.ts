import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

// Deliberately opt in browser endpoints. Queue/cron callbacks depend on the
// deployment platform's access controls and must never become Vite routes.
const routes = [
  'workspace-config', 'shared-folder', 'folder-share', 'provider-usage',
  'anthropic-text-generate', 'openai-text-generate', 'openrouter-text-generate',
  'gemini-generate', 'gemini-status', 'youtube', 'youtube-status',
  'evolink-generate', 'evolink-status', 'seedance-video', 'fal-h3-video',
  'fal-image-generate', 'fal-status', 'fal-video-scale', 'fal-debug',
  'openai-image-generate', 'openai-image-enqueue', 'openai-image-recover',
];
const serverSettings = [
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'FAL_KEY', 'FAL_ADMIN_KEY', 'OPENAI_ADMIN_KEY', 'OPENAI_PROJECT_ID', 'YOUTUBE_API_KEY',
  'PROVIDER_USAGE_START_DATE', 'VERCEL_ENV',
  ...['OPENAI', 'OPENROUTER', 'GEMINI', 'EVOLINK', 'ANTHROPIC'].map(provider => `${provider}_API_KEY`),
  ...['OPENAI', 'OPENROUTER', 'GEMINI', 'EVOLINK', 'ANTHROPIC', 'FAL'].map(provider => `${provider}_ENABLED`),
];
const bodyLimit = 4.5 * 1024 * 1024;
class BodyError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function queryFields(params: URLSearchParams): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of params) {
    const existing = fields[key];
    if (existing === undefined) fields[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else fields[key] = [existing, value];
  }
  return fields;
}

function parseBody(bytes: Buffer, contentType?: string) {
  switch (contentType?.split(';')[0].trim().toLowerCase()) {
    case 'application/json':
      try { return bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; }
      catch { throw new BodyError(400, 'Invalid JSON'); }
    case 'application/x-www-form-urlencoded': return queryFields(new URLSearchParams(bytes.toString('utf8')));
    case 'application/octet-stream': return bytes;
    case 'text/plain': return bytes.toString('utf8');
    default: return undefined;
  }
}

async function handle(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  const response = Object.assign(res, {
    status(code: number) { res.statusCode = code; return response; },
    json(value: unknown) {
      if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(value));
      return response;
    },
  });
  const [pathname, search = ''] = (req.url || '/').split(/\?(.*)/s);
  const route = /^\/api\/([a-z0-9-]+)\/?$/.exec(pathname)?.[1];
  if (!route || !routes.includes(route)) return response.status(404).json({ error: 'Not found' });
  try {
    // Drain oversize requests without retaining them. Node can then finish a
    // normal 413 response rather than destroying the connection mid-read.
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= bodyLimit) chunks.push(chunk);
    }
    if (size > bodyLimit) throw new BodyError(413, 'Request body too large');
    // Vercel exposes body lazily: bad JSON must not bypass/precede the real
    // handler's method, authorization or access-list checks.
    let parsed: { value: unknown } | undefined;
    const request = Object.defineProperty(Object.assign(req, { query: queryFields(new URLSearchParams(search)) }), 'body', {
      get: () => (parsed ??= { value: parseBody(Buffer.concat(chunks, size), req.headers['content-type']) }).value,
    });
    const { default: handler } = await server.ssrLoadModule(`/api/${route}.ts`);
    await handler(request, response);
  } catch (error) {
    if (!(error instanceof BodyError)) server.config.logger.error(`[dev-api] ${route} failed`);
    if (!res.headersSent) response.status(error instanceof BodyError ? error.status : 500).json({ error: error instanceof BodyError ? error.message : 'Internal server error' });
    else if (!res.writableEnded) res.end();
  }
}

/** Serve the same cloud handlers as deployment, never the desktop key vault,
 * a substitute session, or queue triggers. An unconfigured checkout stays on
 * the normal workspace setup screen. Environment is from this checkout only. */
export function devApiServer(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'hosted-dev-api', apply: 'serve',
    configureServer(server) {
      for (const name of serverSettings) {
        if (env[name] !== undefined) process.env[name] ??= env[name];
      }
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        void handle(server, req, res);
      });
    },
  };
}
