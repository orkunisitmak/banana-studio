import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import sharp from 'sharp';

const project = fileURLToPath(new URL('..', import.meta.url));
const imageModel = 'synthetic/arbitrary-image-model';
const textModel = 'synthetic/arbitrary-text-model';
const apiKey = 'synthetic-local-provider-test-key';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function until(read, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(25);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

async function fakeProvider(png) {
  const calls = [], held = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      calls.push({ path: req.url, method: req.method, headers: req.headers, body });
      const send = value => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'synthetic-upstream-request' });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/v1/chat/completions') {
        send({ id: 'synthetic-chat-request', choices: [{ finish_reason: 'stop',
          message: { role: 'assistant', content: 'A synthetic finished scene.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 8 } });
      } else if (['/v1/images/generations', '/v1/images/edits'].includes(req.url)) {
        if (body.prompt.includes('[hold-')) await new Promise(resolve => held.add(resolve));
        send({ data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], output_format: 'png' });
      } else {
        res.writeHead(404); res.end();
      }
    } catch {
      res.writeHead(500); res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const release = () => { for (const resolve of held) resolve(); held.clear(); };
  return { origin: `http://127.0.0.1:${server.address().port}`, calls, held, release,
    async close() { release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function bundleServer(root) {
  // Match build:desktop's native boundaries, but always compile current source:
  // npm test must neither depend on nor overwrite a developer's .build output.
  const replacements = { auth: 'auth.mjs', openaiGuard: 'guard.mjs', imageJobQueue: 'queue.mjs',
    providerMedia: 'providerMedia.mjs', rasterCodec: 'rasterCodec.mjs' };
  const outfile = path.join(root, 'Resources/workspace/server.mjs');
  await build({ entryPoints: [path.join(project, 'desktop/server/main.mjs')], outfile,
    platform: 'node', target: 'node24', format: 'esm', bundle: true, packages: 'bundle', logLevel: 'silent',
    banner: { js: "import { createRequire as __bananaCreateRequire } from 'node:module'; const require = __bananaCreateRequire(import.meta.url);" },
    plugins: [{ name: 'native-workspace-boundaries', setup(builder) {
      builder.onResolve({ filter: /^sharp$/ }, () => ({ path: fileURLToPath(import.meta.resolve('sharp')), external: true }));
      builder.onResolve({ filter: /(auth|openaiGuard|imageJobQueue|providerMedia|rasterCodec)\.(js|ts)$/ }, args => {
        const resolved = path.resolve(args.resolveDir, args.path);
        if (path.dirname(resolved) !== path.join(project, 'api/_lib')) return;
        return { path: path.join(project, 'desktop/server', replacements[path.basename(resolved).replace(/\.(js|ts)$/, '')]) };
      });
    } }],
  });
  if (process.platform !== 'win32') {
    // The native adapter resolves ../../MacOS/BananaStudio relative to the
    // bundle. Implement its actual stdin/stdout codec protocol with Sharp;
    // no packaged app or developer machine's executable is needed.
    const codec = path.join(root, 'codec.mjs');
    fs.writeFileSync(codec, `import sharp from ${JSON.stringify(import.meta.resolve('sharp'))};
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw), bytes = Buffer.from(input.data, 'base64');
if (input.operation === 'decode') {
  const {data, info} = await sharp(bytes).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  process.stdout.write(JSON.stringify({data:data.toString('base64'), width:info.width, height:info.height}));
} else {
  const data = await sharp(bytes, {raw:{width:input.width,height:input.height,channels:4}}).png().toBuffer();
  process.stdout.write(JSON.stringify({data:data.toString('base64')}));
}
`);
    const executable = path.join(root, 'MacOS/BananaStudio');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    fs.writeFileSync(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(codec)} "$@"\n`, { mode: 0o700 });
  }
  return outfile;
}

test('native workspace routes local text and durable image jobs through an isolated HTTP provider', { timeout: 90_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-local-provider-'));
  const providers = [], children = [], networkEvents = [];
  t.after(async () => {
    for (const provider of providers) provider.release();
    for (const child of children) await child.stop();
    for (const provider of providers) await provider.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const width = 64, height = 64;
  const sourcePixels = Buffer.alloc(width * height * 4), outputPixels = Buffer.alloc(sourcePixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    sourcePixels.set([x * 3, y * 3, 127, 255], i); outputPixels.set([17, 83, 191, 255], i);
  }
  const png = pixels => sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const sourcePNG = await png(sourcePixels), providerPNG = await png(outputPixels);
  const primary = await fakeProvider(providerPNG); providers.push(primary);
  const secondary = await fakeProvider(providerPNG); providers.push(secondary);
  assert.ok(providers.every(provider => new URL(provider.origin).port !== '20128'));
  const serverFile = await bundleServer(root);
  const preload = path.join(root, 'loopback-only.mjs');
  fs.writeFileSync(preload, `const originalFetch = globalThis.fetch;
const providers = new Set(${JSON.stringify(providers.map(provider => provider.origin))});
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.port === '20128' || (!providers.has(url.origin) && url.origin !== process.env.SUPABASE_URL)) {
    process.stdout.write(JSON.stringify({event:'blocked-network', origin:url.origin}) + '\\n');
    throw new Error('Integration test blocked an unexpected network destination.');
  }
  return originalFetch(input, options);
};
`);
  const keys = (provider = primary, extra = {}) => ({ LOCAL_API_BASE_URL: provider.origin + '/v1/',
    LOCAL_TEXT_MODEL: textModel, LOCAL_IMAGE_MODEL: imageModel, ...extra });
  const dataDirectory = path.join(root, 'data');

  async function launch(settings) {
    // Never inherit provider keys, NODE_OPTIONS, proxy settings or Codex login
    // configuration from the user's shell.
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
    env.CODEX_ENABLED = 'false';
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, serverFile],
      { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', spawnError, closed = false;
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    child.on('error', error => { spawnError = error; });
    child.stdin.on('error', () => {});
    const exited = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
    const session = { async stop() {
      if (closed) return;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(timer); }
    } };
    children.push(session);
    const events = () => stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    networkEvents.push(events);
    const bootstrap = randomBytes(32).toString('hex');
    child.stdin.write(JSON.stringify({ dataDirectory, webRoot: path.join(root, 'web'), bootstrap, keys: settings }) + '\n');
    const ready = await until(() => {
      if (spawnError) throw spawnError;
      assert.equal(closed, false, `Native server exited before ready: ${stderr}`);
      return events().find(event => event.event === 'ready');
    }, 'native server ready event');
    const origin = ready.origin;
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    assert.notEqual(new URL(origin).port, '20128');
    const request = (route, options = {}) => fetch(origin + route, { ...options, signal: AbortSignal.timeout(5000) });
    assert.equal((await request('/api/gemini-status')).status, 401);
    assert.equal((await request('/local/bootstrap', { redirect: 'manual', headers: { 'X-Banana-Bootstrap': '0'.repeat(64) } })).status, 401);
    const initialized = await request('/local/bootstrap', { redirect: 'manual', headers: { 'X-Banana-Bootstrap': bootstrap } });
    assert.equal(initialized.status, 303);
    assert.match(initialized.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const cookie = initialized.headers.get('set-cookie').split(';')[0];
    const get = async route => {
      const res = await request(route, { headers: { Cookie: cookie } });
      assert.equal(res.status, 200, route); return res.json();
    };
    const post = async (route, value) => {
      const res = await request(route, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      return { status: res.status, body: await res.json() };
    };
    const query = async plan => {
      const res = await post('/local/query', plan);
      assert.equal(res.status, 200); assert.equal(res.body.error, null, JSON.stringify(res.body)); return res.body.data;
    };
    const row = id => query({ table: 'generations', columns: '*', filters: [{ column: 'id', operator: 'eq', value: id }], single: true });
    return Object.assign(session, { origin, cookie, request, get, post, query, row,
      done: id => until(async () => { const value = await row(id); return ['completed', 'failed'].includes(value.status) && value.metadata.imageJobState === value.status && value; }, `terminal gallery row ${id}`),
      refresh: async settings => {
        child.stdin.write(JSON.stringify({ action: 'keys', keys: settings }) + '\n');
        return until(async () => {
          const status = await get('/api/gemini-status');
          const expected = settings.LOCAL_API_BASE_URL ? { baseUrl: settings.LOCAL_API_BASE_URL.replace(/\/+$/, ''),
            textModel: settings.LOCAL_TEXT_MODEL || '', imageModel: settings.LOCAL_IMAGE_MODEL || '' } : null;
          return JSON.stringify(status.local) === JSON.stringify(expected) && status;
        }, 'provider settings refresh over stdin');
      },
    });
  }

  let app = await launch({});
  const enqueue = async (id, extra = {}) => {
    const result = await app.post('/api/openai-image-enqueue', { id, model: 'gpt-image-2.5-sunburst', provider: 'local',
      prompt: 'Create a completely new synthetic scene.', aspectRatio: '1:1', resolution: '1K', ...extra });
    assert.equal(result.status, 202, JSON.stringify(result.body));
    assert.deepEqual(result.body, { id, queued: true, durable: true });
  };
  const savedBytes = async row => {
    assert.equal(row.status, 'completed', row.metadata.error);
    assert.equal(row.metadata.generationProvider, 'local');
    const file = await app.request('/storage/v1/object/authenticated/media/' + row.storage_path, { headers: { Cookie: app.cookie } });
    assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(row.metadata.imageOutputSha256, sha256(bytes));
    assert.deepEqual(fs.readFileSync(path.join(dataDirectory, 'media', row.storage_path)), bytes);
    return bytes;
  };

  await t.test('bootstrap authenticates status; stdin enables keyless arbitrary models and real text accounting', async () => {
    const disabled = await app.get('/api/gemini-status');
    assert.equal(disabled.configured, false); assert.equal(disabled.providers.local, false); assert.equal(disabled.local, null);
    const status = await app.refresh(keys());
    assert.equal(status.configured, true); assert.equal(status.providers.local, true);
    assert.ok(Object.entries(status.providers).every(([provider, available]) => provider === 'local' || !available));
    assert.deepEqual(status.local, { baseUrl: primary.origin + '/v1', textModel, imageModel });
    const result = await app.post('/api/local-text-generate', { model: 'anthropic/claude-opus-5.5',
      contents: { parts: [{ text: 'Write a synthetic scene.' }] }, usageContext: { action: 'enhance', prompt: 'Synthetic brief' },
      baseUrl: 'https://untrusted.invalid', apiKey: 'client-key-must-be-ignored' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.text, 'A synthetic finished scene.'); assert.equal(result.body.providerModel, textModel);
    assert.equal(result.body.provider, 'local'); assert.equal(result.body.usageMetadata.usageLogged, true);
    const call = primary.calls.at(-1);
    assert.equal(call.path, '/v1/chat/completions'); assert.equal(call.body.model, textModel);
    assert.equal(call.headers.authorization, undefined); assert.equal(call.body.stream, false);
    assert.deepEqual(call.body.messages[1], { role: 'user', content: [{ type: 'text', text: 'Write a synthetic scene.' }] });
    const usage = await app.query({ table: 'usage_logs', columns: '*' });
    assert.equal(usage.length, 1); assert.equal(usage[0].action, 'enhance'); assert.equal(usage[0].estimated_cost, null);
  });

  await t.test('keyless queued generation saves exact provider bytes and duplicate enqueue does not resubmit', async () => {
    await enqueue('local-new');
    const row = await app.done('local-new');
    assert.deepEqual(await savedBytes(row), providerPNG); assert.equal(row.metadata.providerModel, imageModel);
    assert.equal(row.metadata.imageEditProtection, undefined);
    const call = primary.calls.at(-1);
    assert.equal(call.path, '/v1/images/generations'); assert.equal(call.body.model, imageModel);
    assert.equal(call.headers.authorization, undefined); assert.equal(call.body.n, 1);
    assert.equal(call.body.images, undefined); assert.ok(call.headers['x-client-request-id']);
    const count = primary.calls.length;
    await enqueue('local-new');
    assert.equal(primary.calls.length, count); assert.deepEqual(await app.row('local-new'), row);
  });

  await t.test('uploaded references become inline bytes; protected edits preserve every outside pixel', async () => {
    const config = await app.get('/api/workspace-config');
    const sourcePath = config.userId + '/refs/synthetic.png';
    const upload = await app.request('/local/upload', { method: 'POST', headers: { Cookie: app.cookie, Origin: app.origin,
      'Content-Type': 'image/png', 'X-Media-Path': encodeURIComponent(sourcePath) }, body: sourcePNG });
    assert.equal(upload.status, 200); assert.equal((await upload.json()).error, null);
    const reference = { id: 'gallery-synthetic-source', data: app.origin + '/storage/v1/object/authenticated/media/' + sourcePath, mimeType: 'image/png' };
    await enqueue('local-reference', { referenceImages: [reference] });
    const unprotected = await app.done('local-reference');
    assert.deepEqual(await savedBytes(unprotected), providerPNG); assert.equal(unprotected.metadata.imageEditProtection, undefined);
    const call = primary.calls.at(-1);
    assert.equal(call.path, '/v1/images/edits');
    assert.deepEqual(call.body.images, [{ image_url: 'data:image/png;base64,' + sourcePNG.toString('base64') }]);
    const region = { x: .25, y: .25, width: .5, height: .5 };
    await enqueue('local-protected', { prompt: 'Change the selected object to blue.', referenceImages: [{ ...reference, isEditSource: true, editRegion: region }] });
    const protectedRow = await app.done('local-protected');
    const pixels = await sharp(await savedBytes(protectedRow)).ensureAlpha().raw().toBuffer();
    const protection = protectedRow.metadata.imageEditProtection;
    assert.equal(protection.preservedOutsideRegion, true); assert.equal(protection.sourceSha256, sha256(sourcePNG));
    assert.equal(protection.providerOutputSha256, sha256(providerPNG)); assert.deepEqual(protection.region, region);
    assert.deepEqual(protection.pixelRegion, { left: 16, top: 16, width: 32, height: 32 });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x >= 16 && x < 48 && y >= 16 && y < 48) continue;
      const i = (y * width + x) * 4;
      assert.deepEqual(pixels.subarray(i, i + 4), sourcePixels.subarray(i, i + 4), `outside pixel ${x},${y}`);
    }
    const center = (32 * width + 32) * 4;
    assert.deepEqual(pixels.subarray(center, center + 4), outputPixels.subarray(center, center + 4));
    assert.equal(primary.calls.at(-1).body.size, '64x64');
  });

  await t.test('pipe refresh changes destination, models and optional bearer auth without exposing the key', async () => {
    const settings = keys(secondary, { LOCAL_API_KEY: apiKey, LOCAL_TEXT_MODEL: 'synthetic/refreshed-text', LOCAL_IMAGE_MODEL: 'synthetic/refreshed-image' });
    const status = await app.refresh(settings);
    assert.ok(!JSON.stringify(status).includes(apiKey)); assert.ok(!Object.hasOwn(status.local, 'apiKey'));
    const result = await app.post('/api/local-text-generate', { model: 'gpt-6.1-sol', contents: { parts: [{ text: 'Synthetic refresh' }] }, usageContext: { action: 'variation', prompt: 'Synthetic refresh' } });
    assert.equal(result.status, 200); assert.equal(result.body.providerModel, settings.LOCAL_TEXT_MODEL);
    await enqueue('local-refreshed');
    const row = await app.done('local-refreshed');
    assert.deepEqual(await savedBytes(row), providerPNG); assert.equal(row.metadata.providerModel, settings.LOCAL_IMAGE_MODEL);
    assert.deepEqual(secondary.calls.map(call => [call.path, call.body.model, call.headers.authorization]), [
      ['/v1/chat/completions', settings.LOCAL_TEXT_MODEL, 'Bearer ' + apiKey],
      ['/v1/images/generations', settings.LOCAL_IMAGE_MODEL, 'Bearer ' + apiKey],
    ]);
    assert.ok(!JSON.stringify([result.body, row]).includes(apiKey));
  });

  for (const changed of ['model', 'address']) await t.test(`a waiting job refuses a changed ${changed} before dispatch`, async () => {
    await app.refresh(keys());
    const ids = [0, 1].map(index => `local-hold-${changed}-${index}`);
    for (const id of ids) await enqueue(id, { prompt: `[hold-${id}] Create a synthetic scene.` });
    await until(() => primary.held.size === 2, 'both native worker slots to be occupied');
    const waitingId = `local-waiting-${changed}`;
    await enqueue(waitingId);
    const waiting = await app.row(waitingId);
    assert.equal(waiting.metadata.imageJobState, 'queued');
    await app.refresh(changed === 'model' ? keys(primary, { LOCAL_IMAGE_MODEL: 'synthetic/changed-while-queued' }) : keys(secondary));
    const count = primary.calls.length + secondary.calls.length;
    primary.release();
    for (const id of ids) assert.equal((await app.done(id)).status, 'completed');
    // API requests wake the queue, so there is no need to wait for its 5s timer.
    await app.get('/api/gemini-status');
    const failed = await app.done(waitingId);
    assert.equal(failed.status, 'failed'); assert.match(failed.metadata.error, /settings changed after this image was queued/);
    assert.equal(failed.storage_path, undefined); assert.equal(failed.metadata.providerModel, imageModel);
    assert.equal(primary.calls.length + secondary.calls.length, count);
  });

  await t.test('gallery bytes survive native server restart; clearing settings disables local routing', async () => {
    const before = await app.row('local-new');
    const identity = await app.get('/api/workspace-config');
    await app.stop(); app = await launch(keys());
    assert.deepEqual(await app.get('/api/workspace-config'), identity);
    assert.deepEqual(await savedBytes(await app.row('local-new')), providerPNG);
    assert.equal((await app.row('local-new')).metadata.imageOutputSha256, before.metadata.imageOutputSha256);
    const count = primary.calls.length + secondary.calls.length;
    await enqueue('local-new');
    const status = await app.refresh({});
    assert.equal(status.local, null); assert.equal(status.configured, false); assert.equal(status.providers.local, false);
    const denied = await app.post('/api/local-text-generate', { model: 'gpt-6.1-sol' });
    assert.equal(denied.status, 503);
    assert.equal(primary.calls.length + secondary.calls.length, count);
  });

  assert.ok(fs.existsSync(path.join(dataDirectory, 'workspace.sqlite')));
  for (const call of providers.flatMap(provider => provider.calls)) {
    assert.equal(call.method, 'POST'); assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers.origin, undefined); assert.equal(call.headers['x-banana-bootstrap'], undefined);
  }
  assert.deepEqual(networkEvents.flatMap(events => events()).filter(event => event.event === 'blocked-network'), []);
});
