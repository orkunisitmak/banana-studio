import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const f = globalThis.__authFixture = {};

// A minimal hook runtime: enough to drive AuthBoundary's real state machine in Node.
const reactStub = `const f=globalThis.__authFixture;
export const useState=init=>{const h=f.hooks,i=f.hook++;if(!(i in h))h[i]=typeof init==='function'?init():init;
  return [h[i],v=>{const next=typeof v==='function'?v(h[i]):v;if(next!==h[i]){h[i]=next;f.dirty=true;}}];};
export const useRef=init=>{const h=f.hooks,i=f.hook++;if(!(i in h))h[i]={current:init};return h[i];};
export const useCallback=fn=>{const h=f.hooks,i=f.hook++;if(!(i in h))h[i]=fn;return h[i];};
export const useEffect=fn=>{const h=f.hooks,i=f.hook++;if(!(i in h)){h[i]=true;f.effects.push(fn);}};
export default {};`;
const stubs = {
  react: reactStub,
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";',
  authService: `const f=globalThis.__authFixture;
    export const getSession=async()=>{if(f.sessionError)throw f.sessionError;return f.session;};
    export const checkUserAuthorization=async id=>{f.checks.push(id);return f.authorization.shift();};
    export const getProfile=async()=>({id:f.session.user.id,role:'admin'});
    export const onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});
    export const signOut=async()=>{if(f.signOutError)throw f.signOutError;};`,
  storageService: 'export const clearLocalMediaCache=async id=>{globalThis.__authFixture.cleared.push(id);};',
  LoginScreen: 'export const LoginScreen=props=>({type:"login",props});',
};
const stubbed = /^(react|react\/jsx-runtime)$|\/(authService|storageService|LoginScreen)$/;
const bundle = await build({ entryPoints: [`${root}/src/components/AuthBoundary.tsx`], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
  plugins: [{ name: 'auth-boundary', setup(b) {
    b.onResolve({ filter: stubbed }, args => ({ path: args.path.match(stubbed).slice(1).find(Boolean), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }] });
const { AuthBoundary } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const settle = () => new Promise(resolve => setTimeout(resolve, 5));
function mount(t, authorization, fixture = {}) {
  const listeners = {};
  const on = (name, fn) => { (listeners[name] ||= []).push(fn); };
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { setInterval: () => 1, clearInterval() {}, setTimeout: fn => setTimeout(fn, 0), addEventListener: on, removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener: on, removeEventListener() {} };
  t.after(() => Object.assign(globalThis, previous));
  Object.assign(f, { hooks: {}, hook: 0, effects: [], dirty: false, checks: [], cleared: [], authorization, signOutError: null, sessionError: null,
    session: { user: { id: 'user-1' } } }, fixture);
  let output;
  let signOut;
  const render = () => {
    f.hook = 0;
    output = AuthBoundary({ children: (access, onSignOut) => { signOut = onSignOut; return { type: 'workspace', access }; } });
    f.effects.splice(0).forEach(effect => effect());
  };
  render();
  return {
    get view() {
      if (output.type === 'fragment') return output.props.children;
      return typeof output.type === 'function' ? output.type(output.props) : output;
    },
    async flush() { await settle(); while (f.dirty) { f.dirty = false; render(); await settle(); } },
    fire: name => listeners[name].forEach(fn => fn()),
    signOut: () => signOut(),
  };
}

test('a network blip during a re-check keeps an already verified workspace open', async t => {
  const app = mount(t, ['authorized', 'unavailable']);
  await app.flush();
  assert.equal(app.view.type, 'workspace');
  app.fire('focus');
  await app.flush();
  assert.deepEqual(f.checks, ['user-1', 'user-1']);
  assert.equal(app.view.type, 'workspace');
  assert.deepEqual(f.cleared.filter(Boolean), [], 'the local media cache is not cleared');
  // Coming back online retries right away.
  f.authorization = ['authorized'];
  app.fire('online');
  await app.flush();
  assert.equal(f.checks.length, 3);
  assert.equal(app.view.type, 'workspace');
});

test('a session read blip keeps a verified workspace open but first entry fails closed', async t => {
  const app = mount(t, ['authorized']);
  await app.flush();
  f.sessionError = new TypeError('Failed to fetch');
  app.fire('focus');
  await app.flush();
  assert.equal(app.view.type, 'workspace');
  assert.deepEqual(f.cleared.filter(Boolean), [], 'the local media cache is not cleared');
  f.sessionError = null;
  f.authorization = ['authorized'];
  app.fire('online');
  await app.flush();
  assert.equal(f.checks.length, 2);
  assert.equal(app.view.type, 'workspace');
});

test('a session read blip before first verification never grants access', async t => {
  const app = mount(t, ['authorized'], { sessionError: new TypeError('Failed to fetch') });
  await app.flush();
  assert.equal(app.view.type, 'login');
  assert.equal(app.view.props.notice, 'unavailable');
  assert.deepEqual(f.checks, []);
});

test('an unexpected session read error before first verification says not authorized', async t => {
  const app = mount(t, ['authorized'], { sessionError: new Error('Invalid session') });
  await app.flush();
  assert.equal(app.view.type, 'login');
  assert.equal(app.view.props.notice, 'unauthorized');
  assert.deepEqual(f.checks, []);
});

test('a definite allowlist answer still closes the workspace', async t => {
  const app = mount(t, ['authorized', 'unauthorized']);
  await app.flush();
  app.fire('visibilitychange');
  await app.flush();
  assert.equal(app.view.type, 'login');
  assert.equal(app.view.props.notice, 'unauthorized');
  assert.deepEqual(f.cleared.filter(Boolean), ['user-1']);
});

test('first entry during an outage shows a retryable message and never grants access', async t => {
  const app = mount(t, ['unavailable']);
  await app.flush();
  assert.equal(app.view.type, 'login');
  assert.equal(app.view.props.notice, 'unavailable');
  f.authorization = ['authorized'];
  app.view.props.onRetry();
  await app.flush();
  assert.equal(app.view.type, 'workspace');
  assert.equal(app.view.access.userId, 'user-1');
});

test('a failed sign-out keeps the workspace closed and says how to continue', async t => {
  const app = mount(t, ['authorized']);
  await app.flush();
  f.signOutError = new Error('offline');
  await app.signOut();
  await app.flush();
  assert.equal(app.view.type, 'login');
  assert.equal(app.view.props.notice, 'signout-failed');
  app.fire('focus');
  await app.flush();
  assert.equal(f.checks.length, 1, 'no re-check reopens the workspace');
});

const authBundle = await build({ stdin: { contents: "export { checkUserAuthorization } from './src/services/authService';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'auth-service', setup(b) {
    b.onResolve({ filter: /^@supabase\/supabase-js$|\/runtimeConfig$|\/browserClient$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path === '@supabase/supabase-js'
      ? 'export const createClient=()=>globalThis.__authFixture.client;'
      : args.path.endsWith('runtimeConfig')
        ? 'export const getWorkspaceConfig=()=>({mode:"cloud"}),getCloudPublicConfig=()=>({supabaseUrl:"https://example.invalid",supabasePublishableKey:"k"});'
        : 'export const createLocalWorkspaceClient=()=>null;' }));
    b.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }));
  } }] });
f.client = { auth: { getUser: () => f.getUser() }, from: () => ({ select: () => ({ eq: () => ({ ilike: () => ({ maybeSingle: () => f.allowlist() }) }) }) }) };
const { checkUserAuthorization } = await import(`data:text/javascript;base64,${Buffer.from(authBundle.outputFiles[0].text).toString('base64')}`);
const user = { id: 'user-1', email: 'a@example.com', email_confirmed_at: '2026-01-01' };

test('allowlist reads tell an outage apart from a denial', async () => {
  f.getUser = async () => ({ data: { user }, error: null });
  f.allowlist = async () => ({ data: { email: 'a@example.com' }, error: null });
  assert.equal(await checkUserAuthorization('user-1'), 'authorized');
  f.allowlist = async () => ({ data: null, error: null });
  assert.equal(await checkUserAuthorization('user-1'), 'unauthorized');
  assert.equal(await checkUserAuthorization('user-2'), 'unauthorized');
  f.allowlist = async () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
  assert.equal(await checkUserAuthorization('user-1'), 'unavailable');
  // PostgREST puts the HTTP status beside the error, not on it.
  f.allowlist = async () => ({ data: null, error: { message: 'Bad gateway' }, status: 503 });
  assert.equal(await checkUserAuthorization('user-1'), 'unavailable');
  f.allowlist = async () => ({ data: null, error: { message: 'JWT expired' }, status: 401 });
  assert.equal(await checkUserAuthorization('user-1'), 'unauthorized');
  f.getUser = async () => { throw new TypeError('fetch failed'); };
  assert.equal(await checkUserAuthorization('user-1'), 'unavailable');
  // A revoked or expired identity and unexpected errors stay definite denials.
  f.getUser = async () => ({ data: { user: null }, error: { name: 'AuthApiError', status: 401, message: 'invalid JWT' } });
  assert.equal(await checkUserAuthorization('user-1'), 'unauthorized');
  f.getUser = async () => ({ data: { user }, error: null });
  f.allowlist = async () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
  assert.equal(await checkUserAuthorization('user-1'), 'unauthorized');
});
