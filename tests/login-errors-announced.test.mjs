import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
async function load(entry, plugins = []) {
  const out = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, plugins,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports;
}
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
const { renderToStaticMarkup } = req('react-dom/server');
const React = req('react');

const forceError = {
  name: 'force-error',
  setup(b) {
    b.onLoad({ filter: /components[\\/]LoginScreen\.tsx$/ }, async a => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(a.path, 'utf8');
      const anchor = 'useState<string | null>(null)';
      assert.ok(src.includes(anchor), 'anchor missing');
      return { contents: src.replace(anchor, "useState<string | null>('Sign-in failed. Please try again.')"), loader: 'tsx' };
    });
  },
};
const { LoginScreen } = await load('src/components/LoginScreen.tsx');
const { LoginScreen: LoginWithError } = await load('src/components/LoginScreen.tsx', [forceError]);

const alertText = (html, text) => {
  const i = html.indexOf(text);
  assert.ok(i >= 0, text + ' not rendered');
  const tags = [...html.slice(0, i).matchAll(/<div\b[^>]*>|<\/div>/g)];
  const open = [];
  for (const t of tags) t[0].startsWith('</') ? open.pop() : open.push(t[0]);
  return open.some(t => /\srole="alert"/.test(t));
};

test('each login notice is announced with role=alert', () => {
  for (const [notice, text] of [['unauthorized', 'Access Denied'], ['unavailable', 'Can&#x27;t verify access'], ['signout-failed', 'Sign-out failed']]) {
    assert.ok(alertText(renderToStaticMarkup(React.createElement(LoginScreen, { notice, onRetry() {} })), text), notice);
  }
});

test('the sign-in error is announced with role=alert', () => {
  assert.ok(alertText(renderToStaticMarkup(React.createElement(LoginWithError, {})), 'Sign-in failed. Please try again.'));
});
