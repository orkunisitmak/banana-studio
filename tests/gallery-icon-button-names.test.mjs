import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Render the real Gallery with a selected image (selectedImageId is a prop) and the real Compare dialog as control.
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + '/package.json');
const { build } = req('esbuild');
async function load(entry) {
  const out = await build({
    entryPoints: ['.' + entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [deps + '/node_modules'], logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports;
}
globalThis.window = globalThis; globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; globalThis.sessionStorage = globalThis.localStorage;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const { renderToStaticMarkup } = req('react-dom/server');
const React = req('react');
req('react-dom').createPortal = node => node;
const { Gallery } = await load('/src/components/Gallery.tsx');
const { HistoryPanel } = await load('/src/components/HistoryPanel.tsx');

const item = (id, o = {}) => ({ id, url: 'https://example.com/' + id + '.png', thumbnailUrl: 'https://example.com/' + id + '.png', prompt: 'a cat ' + id,
  aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(), referenceImages: [], ...o });
const images = [item('a'), item('b', { isFavorite: true })];
const gp = { images, currentFolderId: null, onFolderSelect() {}, selectedImageId: null, onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {} };

// Buttons whose only content is an icon (svg) and that have no aria-label, aria-labelledby or title.
function unnamedIconButtons(html) {
  const out = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
    if (!text && !/aria-label=|aria-labelledby=|title=/.test(m[1])) out.push(m[1].trim().slice(0, 100));
  }
  return out;
}

test('Gallery card Favorite button has an accessible name', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, gp));
  const bad = unnamedIconButtons(html).filter(a => /top-2 right-2 z-20/.test(a));
  assert.deepEqual(bad, [], 'icon-only card Favorite buttons with no name: ' + bad.length);
});

test('Gallery detail panel close (X) button has an accessible name', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, { ...gp, selectedImageId: 'a' }));
  const bad = unnamedIconButtons(html).filter(a => /text-gray-400 hover:text-white/.test(a) && !/p-/.test(a));
  assert.deepEqual(bad, [], 'icon-only detail close button with no name');
});

test('History panel close (X) button has an accessible name', () => {
  const html = renderToStaticMarkup(React.createElement(HistoryPanel, { images, onSelect() {}, isOpen: true, onClose() {} }));
  assert.deepEqual(unnamedIconButtons(html), [], 'icon-only History close button with no name');
});

test('control: detail Favorite and Delete buttons are named by title', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, { ...gp, selectedImageId: 'a' }));
  assert.match(html, /<button[^>]*title="Favorite"/);
  assert.match(html, /<button[^>]*title="Delete"/);
});

// Favorite is a toggle: the filled heart is the only signal. A button must expose it with aria-pressed (as the Gallery filters, sort and selection buttons do).
test('control: Gallery Favorites filter exposes aria-pressed', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, gp));
  assert.match(html, /<button[^>]*aria-label="Toggle favorites"[^>]*aria-pressed="(true|false)"/);
});

test('Gallery card Favorite buttons expose their state with aria-pressed', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, gp));
  const cards = [...html.matchAll(/<button\b([^>]*top-2 right-2 z-20[^>]*)>/g)].map(m => m[1]);
  assert.equal(cards.length, 2, 'expected 2 card favorite buttons');
  const bad = cards.filter(a => !/aria-pressed="(true|false)"/.test(a));
  assert.deepEqual(bad, [], 'card Favorite buttons without aria-pressed: ' + bad.length);
});

test('Gallery detail Favorite button exposes its state with aria-pressed', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, { ...gp, selectedImageId: 'b' }));
  const tag = html.match(/<button\b[^>]*title="Favorite"[^>]*>/)[0];
  assert.match(tag, /aria-pressed="true"/, tag);
});
