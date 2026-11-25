import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Render the real Gallery with a selected image (selectedImageId is a prop) and the real Compare dialog as control.
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + '/package.json');
const { build } = req('esbuild');
async function load(entry, selectionMode = false) {
  const out = await build({
    entryPoints: ['.' + entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [deps + '/node_modules'], logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    // Start the Gallery in selection mode with image a selected, which a static render cannot reach by a click.
    plugins: selectionMode ? [{ name: 'selection-mode', setup(b) { b.onLoad({ filter: /Gallery\.tsx$/ }, async a => {
      const fs = await import('node:fs'); const src = fs.readFileSync(a.path, 'utf8')
        .replace('[isSelectionMode, setIsSelectionMode] = useState(false)', '[isSelectionMode, setIsSelectionMode] = useState(true)')
        .replace('[selectedIds, setSelectedIds] = useState<Set<string>>(new Set())', "[selectedIds, setSelectedIds] = useState<Set<string>>(new Set(['a']))");
      return { contents: src, loader: 'tsx' }; }); } }] : [],
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

// The card's key handling and label come from a small module, so the real code runs here.
const keyboard = await load('/src/lib/gallery/cardKeyboard.ts');

test('Enter and Space on the card activate it; other keys, keys inside its buttons and held-key repeats do not', () => {
  assert.equal(keyboard.isCardActivationKey('Enter', true), true);
  assert.equal(keyboard.isCardActivationKey(' ', true), true);
  for (const key of ['Tab', 'a', 'Escape', 'ArrowRight']) assert.equal(keyboard.isCardActivationKey(key, true), false, key);
  assert.equal(keyboard.isCardActivationKey('Enter', false), false);
  assert.equal(keyboard.isCardActivationKey(' ', false), false);
  assert.equal(keyboard.isCardActivationKey('Enter', true, true), false);
  assert.equal(keyboard.isCardActivationKey(' ', true, true), false);
});

test('the card label names its action and position: open normally, select or deselect in selection mode', () => {
  assert.equal(keyboard.galleryCardLabel('image', 'a cat', false, false, 1, 2), 'Open image 1 of 2: a cat');
  assert.equal(keyboard.galleryCardLabel('video', 'a cat', false, true, 2, 2), 'Open video 2 of 2: a cat');
  assert.equal(keyboard.galleryCardLabel('image', 'a cat', true, false, 1, 2), 'Select image 1 of 2: a cat');
  assert.equal(keyboard.galleryCardLabel('video', 'a cat', true, true, 2, 2), 'Deselect video 2 of 2: a cat');
  assert.notEqual(keyboard.galleryCardLabel('image', 'same', false, false, 1, 3), keyboard.galleryCardLabel('image', 'same', false, false, 2, 3));
});

test('the rendered cards get different names even with the same prompt, and no aria-pressed outside selection mode', () => {
  const same = [{ ...images[0], prompt: 'same idea' }, { ...images[1], prompt: 'same idea' }];
  const html = renderToStaticMarkup(React.createElement(Gallery, { ...gp, images: same }));
  const labels = [...html.matchAll(/<div[^>]*data-gallery-media-id="[^"]*"[^>]*aria-label="([^"]*)"/g)].map(m => m[1]);
  assert.equal(labels.length, 2);
  assert.notEqual(labels[0], labels[1]);
  assert.doesNotMatch(cardOpening(html), /aria-pressed/);
});

const { Gallery: SelectionGallery } = await load('/src/components/Gallery.tsx', true);
test('in selection mode the selected card is pressed and the other is not', () => {
  const html = renderToStaticMarkup(React.createElement(SelectionGallery, gp));
  const tags = [...html.matchAll(/<div[^>]*data-gallery-media-id="([^"]*)"[^>]*>/g)].map(m => [m[1], m[0]]);
  const byId = Object.fromEntries(tags);
  assert.match(byId.a, /aria-pressed="true"/);
  assert.match(byId.a, /aria-label="Deselect image 1 of 2: a cat a"/);
  assert.match(byId.b, /aria-pressed="false"/);
  assert.match(byId.b, /aria-label="Select image 2 of 2: a cat b"/);
});
