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

const { HelpCenter } = await load('src/components/HelpCenter.tsx');
const html = renderToStaticMarkup(React.createElement(HelpCenter, { open: true, onClose() {} }));
const details = html.match(/<details\b[^>]*>/g) || [];

test('the first two Help Center FAQ rows start open and the rest closed', () => {
  assert.ok(details.length > 2, 'found ' + details.length);
  assert.deepEqual(details.map(d => /\sopen(=|\s|>)/.test(d)), details.map((_, i) => i < 2));
});
