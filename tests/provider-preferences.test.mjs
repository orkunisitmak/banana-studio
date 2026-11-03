import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const state = { userId: 'user-1', local: false, rpc: [] };
globalThis.__providerPreferences = state;
const bundle = await build({ stdin: { contents: "export { saveProviderPreference, getProviderPreferences } from './src/services/providerRouting';",
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'preferences', setup(b) {
    b.onResolve({ filter: /\/authService$|\/config\/runtimeConfig$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('authService')
      ? `const f = globalThis.__providerPreferences; export const supabase = {
        auth: { getSession: async () => ({ data: { session: f.userId ? { user: { id: f.userId } } : null } }) },
        rpc: async (name, args) => { f.rpc.push({ name, args }); return { data: true, error: null }; }
      };` : 'export const isLocalWorkspace = () => globalThis.__providerPreferences.local;' }));
  } }] });
const { saveProviderPreference, getProviderPreferences } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function setup(t) {
  Object.assign(state, { userId: 'user-1', local: false, rpc: [] });
  const entries = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  return entries;
}

test('overlapping saves preserve every model choice and previously stored preferences', async t => {
  const entries = setup(t);
  entries.set('banana-provider-routes-v1:user-1', JSON.stringify({ 'gemini-3.8-flash': 'auto' }));
  await Promise.all([
    saveProviderPreference('gpt-image-2.5-sunburst', 'openai'),
    saveProviderPreference('gemini-nano-banana-2.1', 'fal'),
  ]);
  assert.deepEqual(await getProviderPreferences(), {
    'gemini-3.8-flash': 'auto', 'gpt-image-2.5-sunburst': 'openai', 'gemini-nano-banana-2.1': 'fal',
  });
});

test('malformed stored JSON recovers without changing another account', async t => {
  const entries = setup(t);
  entries.set('banana-provider-routes-v1:user-1', '{invalid');
  entries.set('banana-provider-routes-v1:user-2', '{"other":"auto"}');
  await saveProviderPreference('gpt-image-2.5-sunburst', 'auto');
  assert.deepEqual(await getProviderPreferences(), { 'gpt-image-2.5-sunburst': 'auto' });
  assert.equal(entries.get('banana-provider-routes-v1:user-2'), '{"other":"auto"}');
});

test('failed persistence and missing sessions still reject saves', async t => {
  const entries = setup(t);
  const error = new DOMException('Storage full', 'QuotaExceededError');
  t.mock.method(globalThis.localStorage, 'setItem', () => { throw error; });
  await assert.rejects(saveProviderPreference('gpt-image-2.5-sunburst', 'openai'), value => value === error);
  state.userId = null;
  await assert.rejects(saveProviderPreference('gpt-image-2.5-sunburst', 'openai'), /Sign in/);
  assert.equal(entries.size, 0);
});

test('desktop saves continue to use the workspace RPC without browser storage', async t => {
  const entries = setup(t);
  state.local = true;
  await saveProviderPreference('gpt-image-2.5-sunburst', 'codex');
  assert.deepEqual(state.rpc, [{ name: 'save_provider_preference', args: { p_model: 'gpt-image-2.5-sunburst', p_provider: 'codex' } }]);
  assert.equal(entries.size, 0);
});
