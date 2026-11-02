import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
const { ImageCompareDialog } = await load('/src/components/ImageCompareDialog.tsx');

const item = id => ({ id, url: 'https://example.com/' + id + '.png', thumbnailUrl: 'https://example.com/' + id + '.png', prompt: 'a cat ' + id,
  aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(), referenceImages: [] });
const images = [item('a'), item('b')];

test('Gallery detail viewer overlay is a labelled modal dialog', () => {
  const html = renderToStaticMarkup(React.createElement(Gallery, { images, currentFolderId: null, onFolderSelect() {}, selectedImageId: 'a',
    onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {} }));
  assert.match(html, /fixed inset-0 z-\[150\]/, 'detail viewer overlay was not rendered');
  const tag = html.match(/<div[^>]*fixed inset-0 z-\[150\][^>]*>/)[0];
  assert.match(tag, /role="dialog"/, tag);
  assert.match(tag, /aria-modal="true"/, tag);
  assert.match(tag, /aria-label(ledby)?="/, tag);
  assert.match(tag, /data-gallery-detail-dialog="true"/, tag);
});

test('control: Compare dialog is a labelled modal dialog', () => {
  const html = renderToStaticMarkup(React.createElement(ImageCompareDialog, { images, onClose() {}, loadDetails: async () => null, refreshSource: async () => null }));
  const tag = html.match(/<div[^>]*class="cmp"[^>]*>/)[0];
  assert.match(tag, /role="dialog"/);
  assert.match(tag, /aria-modal="true"/);
  assert.match(tag, /aria-labelledby="compare-title"/);
});

test('the viewer Tab trap steps aside while a dialog opened from the viewer is on top', () => {
  const src = readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
  const trap = src.slice(src.indexOf('const trapTab ='), src.indexOf("window.addEventListener('keydown', trapTab)"));
  assert.match(trap, /dialogOverViewerRef\.current\) return/);
  assert.match(src, /dialogOverViewerRef\.current = isYouTubePreviewOpen \|\| isHelpCenterOpen \|\| Boolean\(previewRefImage\)/);
});
