import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Render the real Gallery with a selected image (selectedImageId is a prop) and the real Compare dialog as control.
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + '/package.json');
const { build } = req('esbuild');
async function load(entry, panelOpen = true) {
  const out = await build({
    entryPoints: ['.' + entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [deps + '/node_modules'], logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'open-panel', setup(b) { b.onLoad({ filter: /Gallery\.tsx$/ }, async a => {
      const fs = await import('node:fs'); let s = fs.readFileSync(a.path, 'utf8');
      s = s.replace('[isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false)', '[isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(' + panelOpen + ')');
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
const { Gallery: ClosedGallery } = await load('/src/components/Gallery.tsx', false);
const toasts = [{ id: 't1', type: 'success', title: 'Image ready' }, { id: 't2', type: 'loading', title: 'Generating image', progress: 40 }];
const img = { id: 'a', url: 'https://example.com/a.png', thumbnailUrl: 'https://example.com/a.png', prompt: 'cat', aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(), referenceImages: [] };
const gp = { images: [img], currentFolderId: null, onFolderSelect() {}, selectedImageId: null, onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {}, toasts, onDismissToast() {}, onDismissAllToasts() {} };
const loadingCard = { ...img, id: 'L', isLoading: true, url: '', thumbnailUrl: '', imageProgress: 0.4 };
const html = renderToStaticMarkup(React.createElement(Gallery, { ...gp, images: [img, loadingCard] }));
const bell = html.match(/<button\b[^>]*aria-label="Notifications"[^>]*>/)?.[0] ?? '';
const panel = html.slice(html.indexOf('Notifications</span>'), html.indexOf('generation(s) in progress'));

test('sanity: bell, badge count and panel rendered', () => {
  assert.ok(bell, 'no bell'); assert.match(panel, /Image ready/); assert.match(panel, /Generating image/);
});

test('notification count and updates reach screen readers', () => {
  const nameHasCount = /aria-label="[^"]*\d/.test(bell);
  const listIsLive = /data-notification-announcer/.test(html);
  assert.ok(nameHasCount || listIsLive, 'bell is always just "Notifications" (badge "2" is a bare span) and the notification list is not a live region, so finished or failed generations are never announced; bell=' + bell.slice(0, 80));
});

test('control: a loading card announces its progress with role=status and aria-live', () => {
  assert.match(html, /role="status"\s+aria-live="polite"\s+aria-label="Generating image 40%"|aria-label="Generating image 40%"/);
  assert.match(html, /role="status"/);
});

test('the bell is described with the number of updates', () => {
  assert.match(bell, /aria-describedby="notification-count"/);
  assert.match(html, /<span id="notification-count" class="sr-only">2 updates<\/span>/);
});

test('finished updates are announced from an always-mounted live region while the panel is closed, and progress is not', () => {
  const closed = renderToStaticMarkup(React.createElement(ClosedGallery, { ...gp, toasts: [...toasts, { id: 't3', type: 'error', title: 'Generation failed', message: 'Try again' }] }));
  const region = closed.match(/<div[^>]*data-notification-announcer[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(region, /role="status"/);
  assert.match(region, /aria-live="polite"/);
  assert.match(region, /Image ready/);
  assert.match(region, /Generation failed\. Try again/);
  assert.doesNotMatch(region, /Generating image/);
  const empty = renderToStaticMarkup(React.createElement(ClosedGallery, { ...gp, toasts: [] }));
  assert.match(empty, /data-notification-announcer/);
});

test('only added updates are announced, not the whole list again', () => {
  const closed = renderToStaticMarkup(React.createElement(ClosedGallery, { ...gp, toasts }));
  const region = closed.match(/<div[^>]*data-notification-announcer[^>]*>/)?.[0] ?? '';
  assert.match(region, /aria-atomic="false"/);
  assert.match(region, /aria-relevant="additions"/);
});

test('the announcer stays mounted with the panel open, including when empty, and the panel list is not a live region', () => {
  const emptyOpen = renderToStaticMarkup(React.createElement(Gallery, { ...gp, toasts: [] }));
  assert.match(emptyOpen, /data-notification-announcer[^>]*role="status"|role="status"[^>]*data-notification-announcer/);
  const emptyPanel = emptyOpen.slice(emptyOpen.indexOf('Notifications</span>'));
  assert.doesNotMatch(emptyPanel.slice(0, emptyPanel.indexOf('No notifications')), /aria-live|role="(status|alert|log|marquee|timer)"|<output\b/);
  const open = renderToStaticMarkup(React.createElement(Gallery, { ...gp, toasts }));
  const region = open.match(/<div[^>]*data-notification-announcer[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(region, /Image ready/);
  assert.doesNotMatch(region, /Generating image/);
  const list = open.slice(open.indexOf('Notifications</span>'), open.indexOf('generation(s) in progress'));
  assert.doesNotMatch(list, /aria-live|role="(status|alert|log|marquee|timer)"|<output\b/);
});
