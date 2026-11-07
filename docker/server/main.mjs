// Banana Studio web workspace for Docker: the same frontend, `api/` functions and
// Supabase schema as the hosted deployment, on one origin. This process replaces
// Vercel (static files, functions, queue and cron) and the Supabase API gateway
// (`/auth/v1`, `/rest/v1`, `/storage/v1` are forwarded to the internal services).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { applyMigrations, ensureDockerSchema, promoteOwner } from './database.mjs';
import { createMcpServer } from './mcp.mjs';
import { drainImageJobs } from './queue.mjs';

// Node runs as PID 1, which ignores SIGTERM without a handler, so one is
// registered before the slow startup steps. Until the server is ready there is
// nothing to finish.
let shutdown = () => process.exit(0);
process.on('SIGTERM', () => shutdown()); process.on('SIGINT', () => shutdown());
const here = path.dirname(fileURLToPath(import.meta.url));
/** Print a configuration error and stop the process. */
const fatal = message => { console.error(message); process.exit(1); };
/** Read a required environment variable or stop with a clear message. */
const env = name => process.env[name] || fatal(`Set ${name}.`);

let publicOrigin;
try { publicOrigin = new URL(env('BANANA_PUBLIC_URL')).origin; } catch { fatal('BANANA_PUBLIC_URL must be an absolute URL.'); }
const publicUrl = new URL(publicOrigin);
const upstreams = {
  '/auth/v1': env('BANANA_AUTH_URL'),
  '/rest/v1': env('BANANA_REST_URL'),
  '/storage/v1': env('BANANA_STORAGE_URL'),
};
// The functions build their Supabase clients from these, exactly as on Vercel.
process.env.SUPABASE_URL = publicOrigin;
env('SUPABASE_PUBLISHABLE_KEY'); env('SUPABASE_SERVICE_ROLE_KEY');
// Stored H3 usage signatures are verified with it, so it must not change on restart.
env('CRON_SECRET');
const webRoot = process.env.BANANA_WEB_ROOT || path.join(here, 'web');
const migrationsDirectory = process.env.BANANA_MIGRATIONS || path.join(here, 'migrations');
const pagesRoot = process.env.BANANA_PAGES_ROOT || path.join(here, 'pages');

/** The internal service (`auth`, `rest`, `storage`) that serves a public path, if any. */
const upstreamFor = pathname => {
  for (const [prefix, target] of Object.entries(upstreams)) if (pathname === prefix || pathname.startsWith(prefix + '/')) return { prefix, target };
  return null;
};
/** Headers that make a service build public URLs for the address people open. */
const forwardedHeaders = prefix => ({
  'x-forwarded-host': publicUrl.host, 'x-forwarded-proto': publicUrl.protocol.slice(0, -1), 'x-forwarded-prefix': prefix,
});

// Server-side Supabase calls address the public origin like hosted clients do.
// Send them straight to the service instead of out through the reverse proxy.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  const route = url.origin === publicOrigin && upstreamFor(url.pathname);
  if (!route) return nativeFetch(input, init);
  const target = new URL(route.target.replace(/\/$/, '') + url.pathname.slice(route.prefix.length) + url.search);
  const headers = new Headers(init?.headers ?? request?.headers);
  for (const [name, value] of Object.entries(forwardedHeaders(route.prefix))) headers.set(name, value);
  return nativeFetch(request ? new Request(target, request) : target, { ...init, headers });
};

const handlers = Object.fromEntries(Object.entries({
  'evolink-generate': await import('../../api/evolink-generate.ts'),
  'evolink-status': await import('../../api/evolink-status.ts'),
  'fal-debug': await import('../../api/fal-debug.ts'),
  'fal-h3-video': await import('../../api/fal-h3-video.ts'),
  'fal-image-generate': await import('../../api/fal-image-generate.ts'),
  'fal-status': await import('../../api/fal-status.ts'),
  'fal-video-scale': await import('../../api/fal-video-scale.ts'),
  'folder-share': await import('../../api/folder-share.ts'),
  'gemini-generate': await import('../../api/gemini-generate.ts'),
  'gemini-status': await import('../../api/gemini-status.ts'),
  'image-job-sweep': await import('../../api/image-job-sweep.ts'),
  'openai-image-enqueue': await import('../../api/openai-image-enqueue.ts'),
  'openai-image-generate': await import('../../api/openai-image-generate.ts'),
  'openai-image-recover': await import('../../api/openai-image-recover.ts'),
  'openai-text-generate': await import('../../api/openai-text-generate.ts'),
  'openrouter-text-generate': await import('../../api/openrouter-text-generate.ts'),
  'provider-usage': await import('../../api/provider-usage.ts'),
  'seedance-video': await import('../../api/seedance-video.ts'),
  'shared-folder': await import('../../api/shared-folder.ts'),
  'workspace-config': await import('../../api/workspace-config.ts'),
  'youtube-status': await import('../../api/youtube-status.ts'),
  'youtube': await import('../../api/youtube.ts'),
}).map(([name, module]) => [name, module.default]));

const BODY_LIMIT = 16 * 1024 * 1024;
/** Buffer a function request body, refusing bodies above BODY_LIMIT. */
const readBody = async req => {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw Object.assign(new Error('Request body too large.'), { status: 413 }); parts.push(chunk); }
  return Buffer.concat(parts);
};
// Same parsing as the Vercel Node runtime: JSON, form and text bodies become values.
const parseBody = (bytes, type = '') => {
  if (!bytes.length) return undefined;
  if (type.includes('application/json')) { try { return JSON.parse(bytes.toString()); } catch { throw Object.assign(new Error('Invalid JSON body.'), { status: 400 }); } }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(bytes.toString()));
  if (type.startsWith('text/')) return bytes.toString();
  return bytes;
};
/** Add the Vercel response helpers (`status`, `json`, `send`) the functions expect. */
const withResponseHelpers = res => Object.assign(res, {
  status(code) { this.statusCode = code; return this; },
  json(value) { if (!this.getHeader('content-type')) this.setHeader('Content-Type', 'application/json; charset=utf-8'); this.end(JSON.stringify(value)); return this; },
  send(value) { if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) return this.json(value); this.end(value); return this; },
});
/** Run an `api/` function; an uncaught error becomes a generic 500 response. */
const invoke = async (handler, req, res) => {
  withResponseHelpers(res);
  try { await handler(req, res); }
  catch (error) {
    console.error('Function failed:', error?.message || error);
    if (!res.headersSent) res.status(500).json({ error: 'The server could not complete the request.' }); else res.end();
  }
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.gif': 'image/gif' };
// Mirrors vercel.json `headers`.
const SHARE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** Serve a file from the built frontend with the hosted deployment's cache headers. */
const serveStatic = (req, res, pathname) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; return res.end(); }
  let relative;
  try { relative = decodeURIComponent(pathname); } catch { res.statusCode = 400; return res.end(); }
  if (relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(webRoot, '.' + relative);
  if (!file.startsWith(path.resolve(webRoot) + path.sep) || relative.split('/').some(part => part.startsWith('.'))) { res.statusCode = 404; return res.end('Not found'); }
  let stat; try { stat = fs.statSync(file); } catch { stat = null; }
  if (!stat?.isFile()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('Not found'); }
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', relative.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (relative === '/share.html') { res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); res.setHeader('Content-Security-Policy', SHARE_CSP); }
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
};

// Auth rate-limits by X-Banana-Client-Ip (GOTRUE_RATE_LIMIT_HEADER); it is
// always rebuilt here, never passed through. X-Forwarded-For is trusted only
// when the published port is loopback-only (the default `BANANA_BIND`), so
// just the local reverse proxy can reach it, or when BANANA_TRUST_PROXY=true
// says a firewall gives the same guarantee. The proxy appends the real client
// as the last entry; anything before it is client-supplied and ignored.
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const trustProxy = process.env.BANANA_TRUST_PROXY ? process.env.BANANA_TRUST_PROXY === 'true' : LOOPBACK.includes(process.env.BANANA_BIND || '127.0.0.1');
/** The address Auth rate-limits by: the proxy's last X-Forwarded-For entry when trusted, else the socket peer. */
const clientIp = req => {
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').map(part => part.trim()).filter(Boolean) : [];
  return forwarded.at(-1) || req.socket.remoteAddress || 'unknown';
};

// Streams both directions, so large TUS/media uploads are never buffered here.
const proxy = (req, res, { prefix, target }, url) => {
  const destination = new URL(target.replace(/\/$/, '') + url.pathname.slice(prefix.length) + url.search);
  const client = clientIp(req);
  // Services also log X-Forwarded-For; they get only the trusted entry.
  const headers = { ...req.headers, ...forwardedHeaders(prefix), 'x-forwarded-for': client, 'x-banana-client-ip': client, host: destination.host };
  const upstream = http.request(destination, { method: req.method, headers }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"Service unavailable"}'); } else res.destroy(); });
  req.pipe(upstream);
};

const sql = postgres(env('BANANA_DATABASE_URL'), { max: 4, onnotice: () => {} });
const mcp = createMcpServer({ publicOrigin, handlers, invoke, sql, anonKey: process.env.SUPABASE_PUBLISHABLE_KEY });
// RFC 8414 places the issuer path after the well-known segment; Auth serves them at its root.
const authDiscovery = {
  '/.well-known/oauth-authorization-server/auth/v1': '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration/auth/v1': '/.well-known/openid-configuration',
};
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
/** Serve one of the OAuth pages with a strict, no-store policy. */
const servePage = (res, file, type) => {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': PAGE_CSP });
  fs.createReadStream(path.join(pagesRoot, file)).on('error', () => res.destroy()).pipe(res);
};

let ready = false;
const server = http.createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  let url;
  try { url = new URL(req.url, publicOrigin); } catch { res.statusCode = 400; return res.end(); }
  if (url.pathname === '/healthz') { res.statusCode = ready ? 200 : 503; return res.end(ready ? 'ok' : 'starting'); }
  const route = upstreamFor(url.pathname);
  if (route) return proxy(req, res, route, url);
  if (authDiscovery[url.pathname]) return proxy(req, res, { prefix: url.pathname, target: upstreams['/auth/v1'] + authDiscovery[url.pathname] }, url);
  if (['/oauth/consent', '/oauth/connections'].includes(url.pathname) && req.method === 'GET') return servePage(res, 'oauth.html', 'text/html; charset=utf-8');
  if (url.pathname === '/oauth/oauth.js' && req.method === 'GET') return servePage(res, 'oauth.js', 'text/javascript; charset=utf-8');
  try { if (await mcp(req, res, url, readBody)) return; }
  catch (error) { console.error('MCP request failed:', error?.message || error); if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"The MCP request failed."}'); } return; }
  if (url.pathname.startsWith('/api/')) {
    const handler = handlers[url.pathname.slice(5).replace(/\/$/, '')];
    if (!handler) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"Not found"}'); }
    try {
      req.query = Object.fromEntries(url.searchParams);
      req.body = ['GET', 'HEAD'].includes(req.method) ? undefined : parseBody(await readBody(req), String(req.headers['content-type'] || ''));
    } catch (error) { res.statusCode = error.status || 400; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: error.message })); }
    return invoke(handler, req, res);
  }
  return serveStatic(req, res, url.pathname);
});
server.requestTimeout = 0; server.headersTimeout = 60_000;

// Vercel Cron equivalent: publish unfinished image jobs every minute.
const sweep = async () => {
  const req = { method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} };
  const headers = {};
  const res = { statusCode: 200, headersSent: false, setHeader: (name, value) => { headers[name.toLowerCase()] = value; }, getHeader: name => headers[name.toLowerCase()], end() { this.headersSent = true; } };
  await invoke(handlers['image-job-sweep'], req, res);
};

const owner = process.env.BANANA_OWNER_EMAIL?.trim().toLowerCase();
await applyMigrations(env('BANANA_DATABASE_URL'), migrationsDirectory);
await ensureDockerSchema(sql);
if (owner) await promoteOwner(sql, owner);
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PORT) || 8080, '0.0.0.0', resolve); });
ready = true;
console.log(`Banana Studio is ready at ${publicOrigin}`);
setInterval(() => { void sweep().catch(() => {}); if (owner) void promoteOwner(sql, owner).catch(() => {}); }, 60_000).unref();
void sweep().catch(() => {});
// Stop accepting requests and starting image jobs, then exit once running jobs have saved their results.
shutdown = () => { server.close(); void drainImageJobs().then(() => process.exit(0)); };
