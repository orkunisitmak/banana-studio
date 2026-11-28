import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const state = { userId: 'user-1', local: false, rpc: [] };
globalThis.__providerPreferences = state;
const bundle = await build({ stdin: { contents: "export { saveProviderPreference, getProviderPreferences, saveWorkspaceProviderPolicy, readProviderSettings } from './src/services/providerRouting'; export { admitProvider } from './api/_lib/providerConfiguration';",
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'preferences', setup(b) {
    b.onResolve({ filter: /\/authService$|\/config\/runtimeConfig$|\/auth\.js$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('runtimeConfig')
      ? 'export const isLocalWorkspace = () => globalThis.__providerPreferences.local;'
      : `const f = globalThis.__providerPreferences; export const supabase = {
        auth: { getSession: async () => ({ data: { session: f.userId ? { user: { id: f.userId } } : null } }) },
        rpc: (name, args) => ({abortSignal: async () => f.query(name, args)})
      }; export const createUserScopedClient = () => supabase;` }));
  } }] });
const { saveProviderPreference, getProviderPreferences, saveWorkspaceProviderPolicy, readProviderSettings, admitProvider } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function setup(t) {
  Object.assign(state, { userId: 'user-1', local: false, rpc: [] });
  state.accounts = { 'user-1': {}, 'user-2': {} };
  state.policy = {};
  state.query = (name, args) => {
    state.rpc.push({ name, args });
    if (args?.p_expected_user_id && args.p_expected_user_id !== state.userId) return { error: { code:'42501' } };
    const rows = state.accounts[state.userId];
    if (name === 'get_provider_preferences') {
      const effective = {...rows,...state.policy,...Object.fromEntries(Object.entries(rows).filter(([,value]) => value === 'off'))};
      return { data:args?.p_include_policy ? {preferences:effective,personal:{...rows},policy:{...state.policy},canManage:state.userId === 'user-1'} : effective };
    }
    if (name === 'save_workspace_provider_policy') {
      if (state.userId !== 'user-1') return {error:{code:'42501'}};
      if (args.p_provider === null) delete state.policy[args.p_model]; else state.policy[args.p_model] = args.p_provider;
      return {data:true};
    }
    assert.equal(name,'save_provider_preference');
    if (!args.p_if_missing || !Object.hasOwn(rows,args.p_model)) rows[args.p_model] = args.p_provider;
    return { data:true };
  };
  const entries = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  return entries;
}

test('overlapping saves preserve every model choice and previously stored preferences', async t => {
  const entries = setup(t);
  entries.set('banana-provider-routes-v1:user-1', JSON.stringify({ 'gemini-3.8-flash':'auto', 'gpt-image-2.5-sunburst':'openrouter' }));
  await Promise.all([
    saveProviderPreference('gpt-image-2.5-sunburst', 'openai'),
    saveProviderPreference('gemini-nano-banana-2.1', 'fal'),
  ]);
  assert.deepEqual(await getProviderPreferences(), {
    'gemini-4-hydrogen': 'auto', 'gpt-image-2.5-sunburst': 'openai', 'gemini-nano-banana-2.1': 'fal',
  });
  assert.equal(entries.size, 0, 'legacy device preferences retired only after import succeeds');
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
  state.query = () => ({ error: { code:'503' } });
  await assert.rejects(saveProviderPreference('gpt-image-2.5-sunburst', 'openai'), /could not be saved/);
  await assert.rejects(getProviderPreferences(), /could not be loaded/);
  state.userId = null;
  await assert.rejects(saveProviderPreference('gpt-image-2.5-sunburst', 'openai'), /Sign in/);
  assert.equal(entries.size, 0);
});

test('desktop saves continue to use the workspace RPC without browser storage', async t => {
  const entries = setup(t);
  state.local = true;
  await saveProviderPreference('gpt-image-2.5-sunburst', 'codex');
  assert.deepEqual(state.rpc, [{ name: 'save_provider_preference', args: { p_expected_user_id:'user-1', p_model:'gpt-image-2.5-sunburst', p_provider:'codex' } }]);
  assert.equal(entries.size, 0);
});

test('a stale user cannot change the new account or import over an existing Off choice', async t => {
  const entries = setup(t);
  entries.set('banana-provider-routes-v1:user-1', '{"minimax-h3":"fal"}');
  await saveProviderPreference('minimax-h3','off');
  assert.deepEqual(await getProviderPreferences(), {'minimax-h3':'off'});
  state.userId = 'user-2';
  await assert.rejects(saveProviderPreference('minimax-h3','fal','user-1'), /could not be saved/);
  assert.deepEqual(await getProviderPreferences(), {});
  await assert.rejects(saveProviderPreference('gpt-image-2.5-sunburst','codex'), /Unsupported/);
});

test('hosted settings preserve personal routes underneath workspace pins and restrict changes to admins', async t => {
  setup(t);
  await saveWorkspaceProviderPolicy('minimax-h3','fal','user-1');
  state.userId = 'user-2';
  await saveProviderPreference('minimax-h3','evolink');
  const settings = await readProviderSettings();
  assert.equal(settings.canManage,false); assert.deepEqual(settings.policy,{'minimax-h3':'fal'});
  assert.deepEqual(settings.preferences,{'minimax-h3':'fal'}); assert.deepEqual(settings.personal,{'minimax-h3':'evolink'});
  await assert.rejects(saveWorkspaceProviderPolicy('minimax-h3',null,'user-2'),/administrator/);
  state.userId = 'user-1'; await saveWorkspaceProviderPolicy('minimax-h3',null,'user-1');
  state.userId = 'user-2'; assert.deepEqual(await getProviderPreferences(),{'minimax-h3':'evolink'});
  state.local = true; await assert.rejects(saveWorkspaceProviderPolicy('minimax-h3','off','user-2'),/Unsupported/);
});

test('paid admission fails closed on Off, changed routes or unreadable account settings', async t => {
  setup(t);
  const oldKey = process.env.FAL_KEY, oldEnabled = process.env.FAL_ENABLED;
  t.after(() => {
    if (oldKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldKey;
    if (oldEnabled === undefined) delete process.env.FAL_ENABLED; else process.env.FAL_ENABLED = oldEnabled;
  });
  process.env.FAL_KEY = 'synthetic'; process.env.FAL_ENABLED = 'true';
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  assert.equal(await admitProvider({},res,'seedance-2.5'),'fal');
  assert.equal(await admitProvider({},res,'seedance-2.5','evolink'),null); assert.equal(res.code,409);
  assert.equal(res.body.code,'PROVIDER_ADMISSION_REJECTED'); assert.equal(res.body.providerRequestSent,false);
  state.accounts['user-1']['gemini-4-hydrogen'] = 'off';
  assert.equal(await admitProvider({},res,'gemini-4-hydrogen','fal'),null); assert.equal(res.code,403);
  assert.equal(res.body.code,'PROVIDER_ADMISSION_REJECTED'); assert.equal(res.body.providerRequestSent,false);
  assert.equal(await admitProvider({},res,'gemini-4-hydrogen','gemini','youtube'),null); assert.equal(res.code,403);
  state.accounts['user-1']['gemini-4-hydrogen'] = 'gemini';
  state.policy['gemini-4-hydrogen'] = 'fal';
  assert.equal(await admitProvider({},res,'gemini-4-hydrogen','gemini','youtube'),null); assert.equal(res.code,409);
  process.env.FAL_ENABLED = 'false';
  assert.equal(await admitProvider({},res,'seedance-2.5','fal'),null); assert.equal(res.code,503);
  assert.equal(res.body.code,'PROVIDER_ADMISSION_REJECTED'); assert.equal(res.body.providerRequestSent,false);
  process.env.FAL_ENABLED = 'true';
  for (const failed of [{data:null,error:null},{data:{'seedance-2.5':'arbitrary'}},{error:'unavailable'}]) {
    state.query = () => failed;
    assert.equal(await admitProvider({},res,'seedance-2.5','fal'),null); assert.equal(res.code,503);
    assert.equal(res.body.code,'PROVIDER_ADMISSION_REJECTED'); assert.equal(res.body.providerRequestSent,false);
  }
});
