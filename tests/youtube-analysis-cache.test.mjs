import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({
  entryPoints: ['src/services/youtubeAnalysisCache.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'session-fixture', setup(builder) {
    builder.onResolve({ filter: /\/authService$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      loader: 'js', contents: 'export const supabase = { auth: { getSession: () => globalThis.__cacheSession() } };',
    }));
  } }],
});
const { openYouTubeAnalysisCache } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const session = owner => ({ data: { session: owner ? { user: { id: owner } } : null } });
const setup = t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } });
  globalThis.__cacheSession = async () => session('owner-a');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
    delete globalThis.__cacheSession;
  });
  return entries;
};

test('an optional cache session read failure does not reject video analysis setup', async t => {
  const entries = setup(t);
  globalThis.__cacheSession = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await openYouTubeAnalysisCache('video research', new AbortController().signal), undefined);
  assert.equal(entries.size, 0);
});

test('cache entries stay bound to their verified owner', async t => {
  const entries = setup(t);
  const signal = new AbortController().signal;
  const first = await openYouTubeAnalysisCache('video research', signal);
  assert.equal(first.read(), undefined);
  await first.write('verified research');
  assert.equal(first.read(), 'verified research');
  const stored = [...entries.values()];
  globalThis.__cacheSession = async () => session('owner-b');
  assert.equal((await openYouTubeAnalysisCache('video research', signal)).read(), undefined);
  await first.write('must not be stored for another owner');
  assert.deepEqual([...entries.values()], stored);
});

test('a cache owner lookup failure does not swallow explicit cancellation', async t => {
  setup(t);
  const controller = new AbortController();
  const reason = new DOMException('Cancelled', 'AbortError');
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  globalThis.__cacheSession = () => { started(); return new Promise(() => {}); };
  const pending = openYouTubeAnalysisCache('video research', controller.signal);
  await reading;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test('an absent owner disables caching without writing entries', async t => {
  const entries = setup(t);
  globalThis.__cacheSession = async () => session(null);
  assert.equal(await openYouTubeAnalysisCache('video research', new AbortController().signal), undefined);
  assert.equal(entries.size, 0);
});
