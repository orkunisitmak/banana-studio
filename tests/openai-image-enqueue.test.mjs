import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Auth, routing, storage and reference uploads are stubbed; the saved job is already completed.
const stubs = {
  providerRouting: 'export const selectProvider=async()=>"openai";',
  authService: 'const s={access_token:"t",user:{id:"u1"}};export const supabase={};export const getSession=async()=>s;',
  storageService: 'export const getImageById=async id=>{globalThis.__imageIds.push(id);return {id,status:"completed",url:"https://done"}};export const uploadBase64ToPublicUrl=async()=>"p";export const refreshMediaAccessUrl=async v=>v;',
  referenceUploadCache: 'export const createReferenceUploader=()=>async()=>"path";',
  imagePrompting: 'export const validateImageGenerationReferences=()=>{};',
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})$`);
// A relative entry with absWorkingDir: an absolute Windows entry (D:\\...) would match the package filter below.
const out = await build({ entryPoints: ['src/services/openaiImageService.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, args => ({ path: args.path.match(stubbed)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true });
  } }] });
const { generateOpenAIImage } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

let count = 0;
// Every enqueue sends the card's own id once; a reconnect reads that same id back.
const generate = async fetch => {
  const id = `img-${count++}`, sent = [];
  globalThis.__imageIds = [];
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body).id); return fetch(url, init); };
  try { return { id, sent, read: globalThis.__imageIds, result: await generateOpenAIImage({ prompt: 'p', imageModel: 'nano', aspectRatio: '1:1', resolution: '1K', referenceImages: [] }, 'p', { id }) }; }
  catch (error) { return { id, sent, read: globalThis.__imageIds, error }; }
};
const respond = (status, body) => async () => ({ status, ok: status < 300,
  json: () => body === undefined ? Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')) : Promise.resolve(body) });

test('an accepted enqueue whose body times out reconnects to the saved job', async () => {
  const run = await generate(respond(202));
  assert.equal(run.result.url, 'https://done');
  assert.deepEqual(run.sent, [run.id]);
  assert.deepEqual([...new Set(run.read)], [run.id]);
});

test('an unreadable or rejected non-202 enqueue still fails', async () => {
  for (const [status, body] of [[400, undefined], [202, { durable: false }]]) {
    const run = await generate(respond(status, body));
    assert.match(run.error?.message || '', new RegExp(`Image queue request failed \\(${status}\\)`));
    assert.equal(run.sent.length, 1);
  }
});

test('a stalled enqueue is aborted by its timeout and reconnects without a second request', { timeout: 5000 }, async () => {
  const timeout = AbortSignal.timeout; let ms;
  // The request never answers; the timeout signal is fired by the test instead of waiting 75 s.
  const fired = new AbortController();
  AbortSignal.timeout = value => { ms = value; return fired.signal; };
  try {
    const pending = generate((_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
    for (let i = 0; i < 50 && ms === undefined; i++) await new Promise(r => setImmediate(r));
    assert.ok(ms > 60_000);
    fired.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    const run = await pending;
    assert.equal(run.result?.url, 'https://done');
    assert.deepEqual(run.sent, [run.id]);
    assert.deepEqual([...new Set(run.read)], [run.id]);
  } finally { AbortSignal.timeout = timeout; }
});
