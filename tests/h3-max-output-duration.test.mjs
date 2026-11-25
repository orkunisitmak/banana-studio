import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Runs the real pollVideoTask with fetch, the Supabase session and the media element mocked.
const stubs = {
  authService: "export const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 't' } } }) } }; export const logUsage = () => {};",
  storageService: 'const f = async () => null; export const uploadBase64ToPublicUrl = f, uploadBlobToPublicUrl = f, uploadVideoBlobToPublicUrl = f, refreshMediaAccessUrl = f;',
};
const compiled = await build({
  entryPoints: ['src/services/runwayService.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /[\\/](authService|storageService)$/ }, args => ({ path: args.path.match(/(authService|storageService)$/)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
const { pollVideoTask } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

let metadata;
globalThis.window = globalThis;
globalThis.document = { createElement: () => {
  const el = { removeAttribute() {}, load() {} };
  Object.defineProperty(el, 'src', { set() { queueMicrotask(() => metadata(el)); } });
  return el;
} };
const succeed = body => { globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'SUCCEEDED', output: ['https://example.invalid/v.mp4'], ...body }) }); };
const poll = (endpoint = 'minimax/h3-max/text-to-video') => pollVideoTask('req1', undefined, 'minimax-h3', endpoint);
const measured = seconds => { metadata = el => { el.duration = seconds; el.onloadedmetadata(); }; };

test('an H3 Max result without a provider duration gets the measured output length', async () => {
  succeed({}); measured(7.5);
  assert.equal((await poll()).duration, 7.5);
});

test('an invalid provider duration falls back to the measured length', async () => {
  measured(6);
  for (const duration of [0, -3, NaN, '5']) { succeed({ duration }); assert.equal((await poll()).duration, 6); }
});

test('a provider duration wins over the measured length', async () => {
  succeed({ duration: 4 }); measured(9);
  assert.equal((await poll()).duration, 4);
});

test('a metadata error leaves the duration unset', async () => {
  succeed({}); metadata = el => el.onerror();
  assert.equal((await poll()).duration, undefined);
});

test('a metadata timeout leaves the duration unset', async () => {
  succeed({}); metadata = () => {};
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms === 3000 ? 0 : ms, ...rest);
  try { assert.equal((await poll()).duration, undefined); } finally { globalThis.setTimeout = realSetTimeout; }
});

test('a non-Max H3 result is not measured', async () => {
  succeed({}); measured(9);
  assert.equal((await poll('minimax/h3/text-to-video')).duration, undefined);
});
