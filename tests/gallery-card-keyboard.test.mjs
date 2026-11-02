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


const cardOpening = html => {
  const m = html.match(/<div[^>]*data-gallery-media-id="a"[^>]*>/);
  assert.ok(m, 'gallery card for image a was not rendered');
  return m[0];
};

// The card's only mouse action is onClick -> open the detail viewer. A keyboard or screen-reader user needs a focusable, named control for it.
test('Gallery image card can be opened from the keyboard (role=button or tabindex, or a button inside)', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, gp));
  const tag = cardOpening(html);
  const start = html.indexOf(tag), end = html.indexOf('data-gallery-media-id="b"');
  const cardHtml = html.slice(start, end);
  const hasFocusableOpener = /role="button"|tabindex="0"/.test(tag) || /<button[^>]*>[^<]*(<[^b/][^>]*>[^<]*)*(a cat a)/.test(cardHtml);
  assert.ok(hasFocusableOpener, 'card renders as a plain div with no role, tabindex or opener button: ' + tag.slice(0, 140));
});

test('control: Favorites filter is a real button', () => {
  assert.match(renderToStaticMarkup(React.createElement(Gallery, gp)), /<button[^>]*aria-pressed=/);
});
