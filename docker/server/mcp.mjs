// Remote MCP server for AI assistants (Claude, ChatGPT, Cursor…), Streamable
// HTTP transport without server-side sessions. Sign-in is OAuth 2.1 from
// Supabase Auth: the assistant registers itself, the person signs in with
// Google and approves at /oauth/consent, and every call carries that person's
// Supabase access token. Tools call the same `api/` functions as the web app, so
// invitation checks, provider routing, the durable image queue, usage logging
// and row-level security apply unchanged.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../api/_lib/auth.ts';
import { providerAvailability } from '../../api/_lib/providerConfiguration.ts';
import { MODEL_ROUTES, PROVIDER_LABELS } from '../../src/lib/providers.ts';
import { estimateVideoCost } from '../../src/types.ts';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const IMAGE_MODELS = { 'gpt-image-2.5-sunburst': 'GPT Image 2.5', 'gemini-3-pro-image-preview': 'Nano Banana Pro', 'gemini-nano-banana-2.1': 'Nano Banana 2.1' };
const VIDEO_MODELS = { 'seedance-2.0': 'Seedance 2.0', 'seedance-2.5': 'Seedance 2.5' };
// The task-status route these tools poll serves these two Seedance providers.
const VIDEO_PROVIDERS = ['fal', 'openrouter'];
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

/** Wrap a tool result as MCP text content. */
const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
/** An error whose message is safe to show to the assistant. */
class ToolError extends Error {}
/** Validate a non-empty text argument of at most `max` characters. */
const string = (value, name, max = 32000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ToolError(`${name} must be text of up to ${max} characters.`); return value; };
/** Validate an enum argument, using `fallback` when it is omitted. */
const choice = (value, allowed, fallback, name) => { const result = value ?? fallback; if (!allowed.includes(result)) throw new ToolError(`${name} must be one of: ${allowed.join(', ')}.`); return result; };
/** Validate a list of credential-free HTTPS URLs. */
const httpsUrls = (value, name, max) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new ToolError(`${name} accepts up to ${max} URLs.`);
  return value.map(url => { let parsed; try { parsed = new URL(url); } catch { throw new ToolError(`${name} must contain HTTPS URLs.`); } if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new ToolError(`${name} must contain HTTPS URLs without credentials.`); return parsed.href; });
};
/** Guess an image MIME type from the URL's file extension. */
const mimeFromUrl = url => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[new URL(url).pathname.split('.').pop()?.toLowerCase()] || 'image/png';
/** Wait `ms` milliseconds. */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const TOOLS = [
  { name: 'list_models', description: 'List the image and video models of this Banana Studio workspace and whether the server has a provider key for each.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'generate_image', description: 'Queue an image generation in the user\'s Banana Studio gallery. Returns a generation_id; call get_generation to wait for the result. Provider usage is billed to the workspace.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['prompt'], properties: {
      prompt: { type: 'string', description: 'What to create. Up to 32,000 characters.' },
      model: { type: 'string', enum: Object.keys(IMAGE_MODELS), default: 'gpt-image-2.5-sunburst' },
      aspect_ratio: { type: 'string', enum: ['1:1', '4:3', '3:4', '16:9', '9:16'], default: '1:1' },
      resolution: { type: 'string', enum: ['1K', '2K', '4K'], default: '1K' },
      reference_image_urls: { type: 'array', items: { type: 'string', format: 'uri' }, maxItems: 14, description: 'HTTPS image URLs used as references, including URLs returned by this server.' },
      folder_id: { type: 'string', description: 'Gallery folder from list_folders.' },
    } }, annotations: { destructiveHint: false, openWorldHint: true } },
  { name: 'get_generation', description: 'Status and result of an image or video from the gallery. Completed results include a download URL valid for one hour. A video started with generate_video is saved to the gallery here when it finishes.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['generation_id'], properties: {
      generation_id: { type: 'string' },
      wait_seconds: { type: 'integer', minimum: 0, maximum: 50, default: 0, description: 'Keep checking for up to this many seconds until it finishes.' },
    } }, annotations: { readOnlyHint: false, idempotentHint: true } },
  { name: 'list_generations', description: 'Newest images and videos in the user\'s gallery, with download URLs for completed items.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      type: { type: 'string', enum: ['image', 'video'] },
      folder_id: { type: 'string' },
    } }, annotations: { readOnlyHint: true } },
  { name: 'list_folders', description: 'Folders of the user\'s gallery.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'generate_video', description: 'Start a Seedance video (text to video, or first/last frame to video). Returns a generation_id; call get_generation until it completes, which also saves it to the gallery. Provider usage is billed to the workspace.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['prompt'], properties: {
      prompt: { type: 'string', description: 'Scene, motion and timing. Up to 20,000 characters.' },
      model: { type: 'string', enum: Object.keys(VIDEO_MODELS), default: 'seedance-2.5' },
      duration_seconds: { type: 'integer', minimum: 4, maximum: 30, default: 5, description: 'Seedance 2.0 allows up to 15.' },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], default: '16:9' },
      resolution: { type: 'string', enum: ['480p', '720p', '1080p'], default: '720p' },
      first_frame_url: { type: 'string', format: 'uri', description: 'HTTPS image for the opening frame.' },
      last_frame_url: { type: 'string', format: 'uri', description: 'HTTPS image for the closing frame; needs first_frame_url.' },
      generate_audio: { type: 'boolean', default: true },
      folder_id: { type: 'string' },
    } }, annotations: { destructiveHint: false, openWorldHint: true } },
];

/**
 * Create the `/mcp` endpoint and OAuth discovery routes.
 * @param {{ publicOrigin: string, handlers: Record<string, Function>, invoke: Function, sql: import('postgres').Sql, anonKey: string }} options
 */
export function createMcpServer({ publicOrigin, handlers, invoke, sql, anonKey }) {
  const resource = `${publicOrigin}/mcp`, resourceMetadata = `${publicOrigin}/.well-known/oauth-protected-resource/mcp`;
  const metadata = { resource, authorization_servers: [`${publicOrigin}/auth/v1`], bearer_methods_supported: ['header'], resource_name: 'Banana Studio' };

  /** Run an `api/` function in-process as the signed-in person. */
  const call = async (name, token, { method = 'POST', body, query = {} } = {}) => {
    const headers = {}; let payload = '';
    const req = { method, query, body, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
    const res = { statusCode: 200, headersSent: false, setHeader: (key, value) => { headers[key.toLowerCase()] = value; }, getHeader: key => headers[key.toLowerCase()],
      write(chunk) { payload += chunk; return true; }, end(chunk) { if (chunk != null) payload += chunk; this.headersSent = true; } };
    await invoke(handlers[name], req, res);
    let data; try { data = JSON.parse(payload); } catch { data = payload; }
    return { status: res.statusCode, data };
  };
  const userClient = token => createClient(publicOrigin, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const signed = async (db, path) => { if (!path) return null; const { data } = await db.storage.from('media').createSignedUrl(path, 3600); return data?.signedUrl || null; };
  const describe = async (db, row) => ({
    generation_id: row.id, type: row.type, status: row.status, model: row.image_model, prompt: row.prompt,
    aspect_ratio: row.aspect_ratio, resolution: row.resolution, folder_id: row.folder_id, created_at: new Date(Number(row.created_at)).toISOString(),
    ...(row.metadata?.error ? { error: row.metadata.error } : {}),
    ...(row.status === 'completed' ? { url: await signed(db, row.storage_path) } : {}),
  });
  const COLUMNS = 'id,type,status,image_model,prompt,aspect_ratio,resolution,folder_id,created_at,storage_path,metadata';

  /** Read a response body, stopping as soon as it exceeds the video limit instead of buffering it first. */
  const readLimited = async response => {
    const parts = []; let size = 0;
    for await (const part of response.body) {
      size += part.length;
      if (size > MAX_VIDEO_BYTES) { await response.body.cancel().catch(() => {}); throw new ToolError('The finished video exceeds the 512 MB limit.'); }
      parts.push(part);
    }
    return Buffer.concat(parts);
  };

  // One poll per video at a time: parallel get_generation calls (a batch, or a
  // retrying client) share it instead of each downloading the same file.
  const advancing = new Map();
  const advanceVideo = (token, user, db, job) => {
    let pending = advancing.get(job.generation_id);
    if (!pending) {
      pending = pollVideo(token, user, db, job).finally(() => advancing.delete(job.generation_id));
      advancing.set(job.generation_id, pending);
    }
    return pending;
  };

  /** Poll a Seedance task once; when it finished, save the file and gallery row like the web app. */
  const pollVideo = async (token, user, db, job) => {
    const { status, data } = await call('seedance-video', token, { method: 'GET', query: { taskId: job.task_id } });
    // The task outcome is unknown, so it stays processing and can be polled again; the reason is passed on.
    if (status !== 200) return { status: 'processing', status_error: data?.error || 'The video status is temporarily unavailable.' };
    if (data?.status === 'RUNNING') return { status: 'processing', progress: data?.progress };
    const request = job.request;
    if (data?.status === 'FAILED') {
      await sql`UPDATE banana_docker.mcp_videos SET state='failed', error=${data.error || 'The provider could not generate this video.'}, finished_at=now() WHERE generation_id=${job.generation_id}`;
      return { status: 'failed', error: data.error };
    }
    const source = data?.output?.[0];
    if (!source) return { status: 'processing' };
    const download = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
    if (!download.ok || !download.body || Number(download.headers.get('content-length')) > MAX_VIDEO_BYTES) throw new ToolError('The finished video could not be downloaded yet. Try get_generation again.');
    const bytes = await readLimited(download);
    const path = `${user.id}/video_${job.generation_id}.mp4`;
    const saved = await db.storage.from('media').upload(path, bytes, { contentType: 'video/mp4', upsert: true });
    if (saved.error) throw new ToolError('The finished video could not be saved. Try get_generation again.');
    const row = { id: job.generation_id, user_id: user.id, prompt: request.prompt, type: 'video', status: 'completed',
      url: `${publicOrigin}/storage/v1/object/authenticated/media/${path.split('/').map(encodeURIComponent).join('/')}`, storage_path: path,
      image_model: request.videoModel, aspect_ratio: request.aspectRatio, resolution: request.quality, created_at: new Date(job.created_at).getTime(),
      folder_id: request.folderId || null, is_favorite: false, task_id: job.task_id,
      reference_images: (request.imageUrls || []).map((data, index) => ({ id: `frame-${index + 1}`, data, mimeType: mimeFromUrl(data), ...(index ? { isLastFrame: true } : { isFirstFrame: true }) })),
      metadata: { generationProvider: job.provider, videoDuration: request.duration, videoMode: request.mode, generateAudio: request.generateAudio, createdBy: 'mcp',
        ...(typeof data.actualCostUsd === 'number' ? { actualCostUsd: data.actualCostUsd } : {}) } };
    const { error } = await db.from('generations').upsert(row, { onConflict: 'id' });
    if (error) throw new ToolError('The video was saved, but its gallery entry could not be created. Try get_generation again.');
    await sql`UPDATE banana_docker.mcp_videos SET state='completed', finished_at=now() WHERE generation_id=${job.generation_id}`;
    return { status: 'completed' };
  };

  const tools = {
    async list_models() {
      const available = providerAvailability();
      const entry = (id, name, routes) => ({ id, name, providers: routes.map(provider => ({ provider: PROVIDER_LABELS[provider], configured: Boolean(available[provider]) })), available: routes.some(provider => available[provider]) });
      // Codex uses a desktop ChatGPT sign-in and is never available on a server.
      return { image_models: Object.entries(IMAGE_MODELS).map(([id, name]) => entry(id, name, MODEL_ROUTES[id].filter(provider => provider !== 'codex'))),
        video_models: Object.entries(VIDEO_MODELS).map(([id, name]) => entry(id, name, MODEL_ROUTES[id].filter(provider => VIDEO_PROVIDERS.includes(provider)))) };
    },
    async generate_image(args, token, user, db) {
      const model = choice(args.model, Object.keys(IMAGE_MODELS), 'gpt-image-2.5-sunburst', 'model');
      const references = httpsUrls(args.reference_image_urls, 'reference_image_urls', model === 'gpt-image-2.5-sunburst' ? 16 : 14);
      const { data: preferences } = await db.rpc('get_provider_preferences');
      const id = `mcp_${randomUUID()}`;
      const { status, data } = await call('openai-image-enqueue', token, { body: {
        id, model, prompt: string(args.prompt, 'prompt'),
        aspectRatio: choice(args.aspect_ratio, ['1:1', '4:3', '3:4', '16:9', '9:16'], '1:1', 'aspect_ratio'),
        resolution: choice(args.resolution, ['1K', '2K', '4K'], '1K', 'resolution'),
        referenceImages: references.map((url, index) => ({ id: `ref-${index + 1}`, data: url, mimeType: mimeFromUrl(url) })),
        ...(preferences?.[model] && preferences[model] !== 'auto' ? { provider: preferences[model] } : {}),
        ...(args.folder_id ? { folderId: string(args.folder_id, 'folder_id', 200) } : {}),
      } });
      if (status !== 202) throw new ToolError(data?.error || 'The image could not be queued.');
      return { generation_id: id, status: 'queued', next: 'Call get_generation with wait_seconds to receive the image.' };
    },
    async generate_video(args, token, user, db) {
      const model = choice(args.model, Object.keys(VIDEO_MODELS), 'seedance-2.5', 'model');
      const available = providerAvailability(), provider = VIDEO_PROVIDERS.find(name => MODEL_ROUTES[model].includes(name) && available[name]);
      if (!provider) throw new ToolError('Video generation through MCP needs a fal.ai (FAL_KEY) or OpenRouter (OPENROUTER_API_KEY) key on the server.');
      const frames = httpsUrls([args.first_frame_url, args.last_frame_url].filter(Boolean), 'frame URLs', 2);
      if (args.last_frame_url && !args.first_frame_url) throw new ToolError('last_frame_url needs first_frame_url.');
      const request = { videoModel: model, mode: frames.length ? 'image_to_video' : 'text_only', prompt: string(args.prompt, 'prompt', 20000),
        duration: args.duration_seconds ?? 5, quality: choice(args.resolution, ['480p', '720p', '1080p'], '720p', 'resolution'),
        aspectRatio: choice(args.aspect_ratio, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], '16:9', 'aspect_ratio'),
        generateAudio: args.generate_audio !== false, imageUrls: frames, provider, ...(args.folder_id ? { folderId: string(args.folder_id, 'folder_id', 200) } : {}) };
      const { status, data } = await call('seedance-video', token, { body: request });
      if (status !== 200 || !data?.taskId) throw new ToolError(data?.error || 'The video could not be started.');
      const id = `mcp_${randomUUID()}`;
      // The provider has accepted a paid task: record usage first, then keep
      // retrying the tracking row so a brief database error cannot lose it.
      const cost = estimateVideoCost(model, request.quality, request.duration, false, 0, 'generate', 0, 0);
      const { error: usageError } = await db.from('usage_logs').insert({ user_id: user.id, action: 'video_generate', model: `${model}-${request.mode.replace(/_/g, '-')}`,
        prompt: request.prompt.slice(0, 500), image_count: 1, estimated_cost: cost?.usd ?? null });
      if (usageError) console.error(`MCP video usage could not be recorded for task ${data.taskId}:`, usageError.message);
      for (let attempt = 1; ; attempt++) {
        try { await sql`INSERT INTO banana_docker.mcp_videos (generation_id, user_id, task_id, provider, request) VALUES (${id}, ${user.id}, ${data.taskId}, ${data.provider || provider}, ${sql.json(request)})`; break; }
        catch (error) {
          if (attempt < 3) { await sleep(1000 * attempt); continue; }
          console.error(`MCP video task ${data.taskId} was accepted but could not be tracked:`, error.message);
          throw new ToolError(`The provider accepted the video (task ${data.taskId}), but the workspace could not record it. Do not start it again: that would be billed a second time. Ask the administrator to recover this task.`);
        }
      }
      return { generation_id: id, status: 'processing', next: 'Call get_generation with wait_seconds; the video usually takes a few minutes.' };
    },
    async get_generation(args, token, user, db) {
      const id = string(args.generation_id, 'generation_id', 200), deadline = Date.now() + Math.min(Math.max(Number(args.wait_seconds) || 0, 0), 50) * 1000;
      for (;;) {
        const [job] = await sql`SELECT * FROM banana_docker.mcp_videos WHERE generation_id=${id} AND user_id=${user.id}`;
        if (job?.state === 'processing') {
          const progress = await advanceVideo(token, user, db, job);
          if (progress.status === 'failed') return { generation_id: id, type: 'video', status: 'failed', error: progress.error };
          if (progress.status === 'processing') { if (Date.now() + 5000 > deadline) return { generation_id: id, type: 'video', status: 'processing', ...(progress.progress != null ? { progress: progress.progress } : {}), ...(progress.status_error ? { status_error: progress.status_error } : {}) }; await sleep(5000); continue; }
        } else if (job?.state === 'failed') return { generation_id: id, type: 'video', status: 'failed', error: job.error };
        // RLS lets administrators read every row; an assistant only ever sees its own person's gallery.
        const { data: row, error } = await db.from('generations').select(COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle();
        if (error) throw new ToolError('The gallery is temporarily unavailable.');
        if (!row) throw new ToolError('No generation with this ID exists in your gallery.');
        if (['completed', 'failed'].includes(row.status) || Date.now() + 2000 > deadline) return describe(db, row);
        await sleep(2000);
      }
    },
    async list_generations(args, token, user, db) {
      let query = db.from('generations').select(COLUMNS).eq('user_id', user.id).order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(args.limit) || 20, 1), 50));
      if (args.type) query = query.eq('type', choice(args.type, ['image', 'video'], undefined, 'type'));
      if (args.folder_id) query = query.eq('folder_id', string(args.folder_id, 'folder_id', 200));
      const { data, error } = await query;
      if (error) throw new ToolError('The gallery is temporarily unavailable.');
      const pending = await sql`SELECT generation_id FROM banana_docker.mcp_videos WHERE user_id=${user.id} AND state='processing' ORDER BY created_at DESC LIMIT 20`;
      return { generations: await Promise.all(data.map(row => describe(db, row))), processing_videos: pending.map(row => row.generation_id) };
    },
    async list_folders(args, token, user, db) {
      const { data, error } = await db.from('folders').select('id,name,parent_id').eq('user_id', user.id).order('name');
      if (error) throw new ToolError('The gallery is temporarily unavailable.');
      return { folders: data };
    },
  };

  const rpc = async (message, token, user) => {
    const { id, method, params = {} } = message;
    const result = value => ({ jsonrpc: '2.0', id, result: value });
    const failure = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    switch (method) {
      case 'initialize': {
        const version = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
        return result({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'banana-studio', title: 'Banana Studio', version: '1.0.0' },
          instructions: 'Generate images and videos into the user\'s Banana Studio gallery. generate_image and generate_video return a generation_id; poll get_generation with wait_seconds until status is completed, then share the URL.' });
      }
      case 'ping': return result({});
      case 'tools/list': return result({ tools: TOOLS });
      case 'tools/call': {
        const tool = tools[params.name];
        if (!tool) return failure(-32602, `Unknown tool: ${params.name}`);
        try { return result(text(await tool(params.arguments || {}, token, user, userClient(token)))); }
        catch (error) {
          if (!(error instanceof ToolError)) console.error('MCP tool failed:', params.name, error?.message || error);
          return result({ ...text(error instanceof ToolError ? error.message : 'The tool could not complete. Try again.'), isError: true });
        }
      }
      default: return failure(-32601, `Method not found: ${method}`);
    }
  };

  const json = (res, status, value, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(value)); };

  /** Handle `/mcp` and OAuth discovery. Returns false for other paths. */
  return async function handle(req, res, url, readBody) {
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') { json(res, 200, metadata, { 'Access-Control-Allow-Origin': '*' }); return true; }
    if (url.pathname !== '/mcp') return false;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }); res.end(); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'This MCP server does not open a server-to-client stream. Use POST.' }, { Allow: 'POST, OPTIONS' }); return true; }
    const header = String(req.headers.authorization || '');
    const challenge = { 'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadata}"` };
    if (!header.startsWith('Bearer ')) { json(res, 401, { error: 'Sign in to Banana Studio.' }, challenge); return true; }
    const token = header.slice(7).trim();
    let messages;
    try { messages = JSON.parse((await readBody(req)).toString()); } catch { json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return true; }
    const batch = Array.isArray(messages); messages = batch ? messages : [messages];
    if (!messages.length || messages.some(message => !message || message.jsonrpc !== '2.0')) { json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }); return true; }
    // The same membership check as every web request: valid session AND an active invitation.
    const probe = { statusCode: 200, headersSent: false, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; this.headersSent = true; return this; } };
    const user = await requireUser({ headers: { authorization: header } }, probe);
    if (!user) { json(res, probe.statusCode, { error: probe.body?.error || 'Sign in to Banana Studio.' }, probe.statusCode === 401 ? { 'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${resourceMetadata}"` } : {}); return true; }
    const requests = messages.filter(message => message.id !== undefined && message.method);
    if (!requests.length) { res.writeHead(202); res.end(); return true; }
    const replies = await Promise.all(requests.map(message => rpc(message, token, user)));
    json(res, 200, batch ? replies : replies[0]);
    return true;
  };
}
