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
    plugins: [{ name: 'open-panel', setup(b) { b.onLoad({ filter: /Gallery\.tsx$/ }, async a => {
      const fs = await import('node:fs'); let s = fs.readFileSync(a.path, 'utf8');
      s = s.replace('[isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false)', '[isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(true)');
      return { contents: s, loader: 'tsx' }; }); } }],
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
const toasts = [{ id: 't1', type: 'success', title: 'Image ready' }, { id: 't2', type: 'loading', title: 'Generating image', progress: 40 }];
const img = { id: 'a', url: 'https://example.com/a.png', thumbnailUrl: 'https://example.com/a.png', prompt: 'cat', aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(), referenceImages: [] };
const gp = { images: [img], currentFolderId: null, onFolderSelect() {}, selectedImageId: null, onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {}, toasts, onDismissToast() {}, onDismissAllToasts() {} };
const html = renderToStaticMarkup(React.createElement(Gallery, gp));
const dismiss = html.match(/<button\b[^>]*opacity-0 group-hover:opacity-100[^>]*>/g) || [];

test('notification panel rendered with the toasts (sanity)', () => {
  assert.match(html, /Image ready/); assert.match(html, /Generating image/);
});

test('notification dismiss (X) button is reachable and named for keyboard users', () => {
  const x = dismiss.filter(b => !/group-focus-within:opacity-100|focus-visible:opacity-100|focus:opacity-100/.test(b) || !/aria-label=|title=/.test(b));
  assert.equal(dismiss.length, 1, 'expected 1 dismiss button, found ' + dismiss.length);
  assert.deepEqual(x, [], 'dismiss button stays opacity-0 until mouse hover (no focus reveal) and has no aria-label/title: ' + x.join(' | '));
});

test('control: gallery card overlay is revealed on focus-within as well as hover', () => {
  assert.match(html, /opacity-0 group-hover:opacity-100 group-focus-within:opacity-100/);
});
