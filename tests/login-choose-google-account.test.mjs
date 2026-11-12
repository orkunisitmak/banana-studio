import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Bundles the real LoginScreen (src/components/LoginScreen.tsx) with the real authService.signInWithGoogle.
// Only React (one-component hook host), lucide-react and @supabase/supabase-js are stubbed.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');

const calls = globalThis.__oauthCalls = [];
const stubs = {
  react: `const slots = globalThis.__loginSlots = globalThis.__loginSlots || { values: [], index: 0 };
    export const useState = init => { const i = slots.index++; if (!(i in slots.values)) slots.values[i] = typeof init === 'function' ? init() : init;
      return [slots.values[i], next => { slots.values[i] = typeof next === 'function' ? next(slots.values[i]) : next; }]; };
    export default { useState };`,
  'react/jsx-runtime': 'export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = "fragment";',
  'lucide-react': 'export const Loader2 = () => null, ShieldAlert = () => null, WifiOff = () => null;',
  '@supabase/supabase-js': `export const createClient = () => ({ auth: {
      signInWithOAuth: async args => { globalThis.__oauthCalls.push(args); return { error: null }; },
      getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } });`,
};
const stubbed = /^(react|react\/jsx-runtime|lucide-react|@supabase\/supabase-js)$/;
const out = await build({
  entryPoints: ['./src/components/LoginScreen.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  define: { 'import.meta.env': '{}' }, // Vite provides import.meta.env in the app
  plugins: [{ name: 'login', setup(b) {
    b.onResolve({ filter: stubbed }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
  } }],
});
globalThis.window = globalThis;
globalThis.location = { origin: 'https://studio.example', hostname: 'studio.example', href: 'https://studio.example/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'cloud', supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'sb_publishable_test' };
const { LoginScreen } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

const render = props => { globalThis.__loginSlots = { values: [], index: 0 }; return LoginScreen(props); };
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(child => walk(child, visit));
  visit(node);
  walk(node.props?.children, visit);
};
const text = node => !node ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);

test('control: the Access Denied screen renders with Continue with Google', () => {
  const view = render({ notice: 'unauthorized', onRetry() {} });
  const all = text(view);
  assert.match(all, /Access Denied/);
  assert.match(all, /Continue with Google/);
});

test('from Access Denied, the user can reach Google\'s account chooser to sign in with an authorized account', async () => {
  const view = render({ notice: 'unauthorized', onRetry() {} });
  const buttons = [];
  walk(view, node => { if (node.type === 'button' && typeof node.props?.onClick === 'function') buttons.push(node); });
  assert.ok(buttons.length >= 1, 'a sign-in button is rendered');
  for (const button of buttons) {
    globalThis.__loginSlots.index = 0;
    await button.props.onClick({ preventDefault() {}, stopPropagation() {} });
  }
  const offered = calls.map(call => ({ provider: call.provider, prompt: call.options?.queryParams?.prompt ?? null }));
  assert.ok(calls.length >= 1, 'Continue with Google starts the Google sign-in');
  assert.ok(offered.some(call => call.provider === 'google' && (call.prompt || '').split(/\s+/).includes('select_account')),
    `every Google sign-in from Access Denied is sent without prompt=select_account, so Google silently picks the same unauthorized account: ${JSON.stringify(offered)}`);
});
