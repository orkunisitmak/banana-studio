import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: "export * from './api/_lib/localImage.ts'; export * from './api/_lib/localProvider.ts'; export {providerAvailability,chooseProvider} from './api/_lib/providerConfiguration.ts';",
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { requestLocalImage, readLocalImageResponse, getLocalProviderConfig, localProviderSettings, providerAvailability, chooseProvider } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const input = { model: 'preset-not-upstream', prompt: 'A synthetic scene.', n: 1, size: '1024x1024', quality: 'auto', background: 'auto', output_format: 'png' };
const config = { LOCAL_API_BASE_URL: 'http://localhost:20128/v1', LOCAL_TEXT_MODEL: 'custom/text-model', LOCAL_IMAGE_MODEL: 'custom/image-model', LOCAL_API_KEY: 'synthetic-only-key' };

beforeEach(t => {
  const names = [...Object.keys(config), 'LOCAL_ENABLED', 'SUPABASE_URL', 'CODEX_ENABLED'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, config, { SUPABASE_URL: 'https://workspace.invalid', CODEX_ENABLED: 'false' });
  delete process.env.LOCAL_ENABLED;
  t.after(() => { for (const [name, value] of Object.entries(saved)) value == null ? delete process.env[name] : process.env[name] = value; });
});

test('configuration normalizes owner settings and excludes credentials from public settings', () => {
  assert.equal(getLocalProviderConfig({}), null);
  assert.equal(getLocalProviderConfig({ ...config, LOCAL_ENABLED: 'false' }), null);
  assert.deepEqual(getLocalProviderConfig({ ...config, LOCAL_API_BASE_URL: ' http://localhost:20128/v1/// ', LOCAL_API_KEY: '' }), {
    baseUrl: 'http://localhost:20128/v1', apiKey: '', textModel: 'custom/text-model', imageModel: 'custom/image-model',
  });
  assert.deepEqual(localProviderSettings(), { baseUrl: config.LOCAL_API_BASE_URL, textModel: config.LOCAL_TEXT_MODEL, imageModel: config.LOCAL_IMAGE_MODEL });
  for (const value of ['ftp://localhost/v1', 'localhost:20128/v1', 'http://user:pass@localhost/v1', 'http://@localhost/v1', 'http://localhost/v1?', 'http://localhost/v1#', 'http://localhost:0/v1', 'http://localhost\\v1', 'http://localhost/v1\npath']) {
    assert.throws(() => getLocalProviderConfig({ ...config, LOCAL_API_BASE_URL: value }));
  }
  for (const value of ['bad model', 'bad\tmodel', 'x'.repeat(201), 'bad\u0085model']) assert.throws(() => getLocalProviderConfig({ ...config, LOCAL_IMAGE_MODEL: value }));
});

test('availability requires the configured model for the requested type and never enables video', () => {
  assert.equal(providerAvailability('gpt-image-2.5-sunburst').local, true);
  assert.equal(providerAvailability('gpt-6.1-sol').local, true);
  assert.equal(providerAvailability('seedance-2.5').local, false);
  delete process.env.LOCAL_IMAGE_MODEL;
  assert.equal(providerAvailability('gpt-image-2.5-sunburst').local, false);
  assert.equal(providerAvailability('gpt-6.1-sol').local, true);
  assert.throws(() => chooseProvider('gpt-image-2.5-sunburst', 'local'));
  delete process.env.LOCAL_TEXT_MODEL;
  assert.equal(providerAvailability().local, false);
});

test('generation uses only captured owner model/address and optional bearer authentication', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); return Response.json({ data: [{ b64_json: PNG }], usage: { cost: .01 } }); });
  const captured = getLocalProviderConfig();
  process.env.LOCAL_API_BASE_URL = 'http://localhost:9999/v1';
  process.env.LOCAL_API_KEY = 'replacement';
  const result = await requestLocalImage(input, {}, AbortSignal.timeout(1000), 'audit-test', captured);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], config.LOCAL_API_BASE_URL + '/images/generations');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-only-key');
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(JSON.parse(calls[0][1].body).model, config.LOCAL_IMAGE_MODEL);
  assert.equal((await result.json()).data[0].b64_json, PNG);
  await requestLocalImage(input, {}, AbortSignal.timeout(1000), 'audit-test', { ...captured, apiKey: '' });
  assert.equal(calls[1][1].headers.Authorization, undefined);
});

test('references are read from authorized workspace storage and sent as inline OpenAI JSON edits', async t => {
  const calls = [], downloads = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); return Response.json({ data: [{ b64_json: PNG }] }); });
  const db = { storage: { from: bucket => ({ download: async path => {
    downloads.push([bucket, path]); return { data: new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' }), error: null };
  } }) } };
  await requestLocalImage({ ...input, images: [{ image_url: 'https://workspace.invalid/storage/v1/object/authenticated/media/user/ref.png' }] }, db, AbortSignal.timeout(1000), 'audit-test');
  assert.deepEqual(downloads, [['media', 'user/ref.png']]);
  assert.equal(calls[0][0], config.LOCAL_API_BASE_URL + '/images/edits');
  assert.deepEqual(JSON.parse(calls[0][1].body).images, [{ image_url: 'data:image/png;base64,' + PNG }]);
  await assert.rejects(requestLocalImage({ ...input, images: [{ image_url: 'http://private.invalid/source.png' }] }, db, AbortSignal.timeout(1000), 'audit-test'));
  assert.equal(calls.length, 1);
});

test('SSE accepts completed images across chunk boundaries and skips partial frames', async () => {
  const text = `: heartbeat\r\n\r\nevent: image_generation.partial_image\r\ndata: {"b64_json":"partial"}\r\n\r\nevent: image_generation.completed\r\ndata: {"b64_json":"${PNG}","usage":{"cost":0.02}}\r\n\r\ndata: [DONE]\r\n\r\n`;
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 11) controller.enqueue(bytes.slice(i, i + 11)); controller.close(); } });
  const result = await readLocalImageResponse(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  assert.equal(result.data[0].b64_json, PNG);
  assert.equal(result.usage.cost, .02);
  for (const body of ['event: image_generation.partial_image\ndata: {"b64_json":"partial"}\n\n', 'event: error\ndata: {"error":"private-upstream-key"}\n\n']) {
    await assert.rejects(readLocalImageResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } })), error => !error.message.includes('private-upstream-key'));
  }
});

test('same-origin image downloads retain auth while foreign origins are rejected before fetching', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args);
    return calls.length === 1 ? Response.json({ data: [{ url: '/generated/image.png' }] }) : new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png' } });
  });
  const result = await requestLocalImage(input, {}, AbortSignal.timeout(1000), 'audit-test');
  assert.equal((await result.json()).data[0].b64_json, PNG);
  assert.equal(String(calls[1][0]), 'http://localhost:20128/generated/image.png');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer synthetic-only-key');
  const foreign = t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ url: 'http://127.0.0.1:1234/private.png' }] }));
  await assert.rejects(requestLocalImage(input, {}, AbortSignal.timeout(1000), 'audit-test'), /own origin/);
  assert.equal(foreign.mock.callCount(), 1);
});

test('upstream errors are fixed and never retried or reflected', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'private-key-reflected-here' } }, { status: 401 }));
  const result = await requestLocalImage(input, {}, AbortSignal.timeout(1000), 'audit-test');
  assert.equal(result.status, 401);
  assert.match((await result.json()).error.message, /authentication failed/);
  assert.equal(mock.mock.callCount(), 1);
  await assert.rejects(readLocalImageResponse(new Response('{}', { headers: { 'content-length': String(73 * 1024 * 1024) } })), /size/);
});
