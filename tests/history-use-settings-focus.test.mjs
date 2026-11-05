import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
async function load(entry) {
  const out = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports;
}
globalThis.window = globalThis;
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { HistoryPanel } = await load('./src/components/HistoryPanel.tsx');

const image = { id: 'a', url: 'https://example.com/a.png', prompt: 'a cat', aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', createdAt: Date.now(), referenceImages: [] };
const html = renderToStaticMarkup(React.createElement(HistoryPanel, { images: [image], isOpen: true, onSelect() {}, onClose() {} }));
const tag = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*Use Settings<\/button>/)?.[0].match(/<button\b[^>]*>/)?.[0] || '';

test('the History row renders a Use Settings button', () => {
  assert.match(tag, /<button/);
});

test('Use Settings shows when the row has keyboard focus, not only on hover', () => {
  assert.match(tag, /\bopacity-0\b/);
  assert.match(tag, /group-focus-within:opacity-100/);
  const row = html.slice(0, html.indexOf(tag)).match(/<[a-z]+\b[^>]*\bclass="[^"]*"[^>]*>/g).filter(t => /\bgroup\b/.test(t.match(/class="([^"]*)"/)[1]));
  assert.ok(row.length, 'an ancestor of the button carries the group class, so the focus selector can match');
});
