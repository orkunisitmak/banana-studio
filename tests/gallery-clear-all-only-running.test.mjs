import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Since #247, Clear All (useToast().dismissAll) keeps running generations. The notification
// panel still shows "Clear All" whenever toasts.length > 0, so with only running generations
// listed the button is shown and clicking it changes nothing.
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + 'package.json');
const { build } = req('esbuild');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');

const run = text => { const m = { exports: {} }; new Function('module', 'exports', 'require', text)(m, m.exports, req); return m.exports; };

// Real useToast with a one-slot useState host.
const reactStub = `let slot, set = false;
export const useState = init => { if (!set) { slot = typeof init === 'function' ? init() : init; set = true; }
  return [slot, next => { slot = typeof next === 'function' ? next(slot) : next; }]; };
export const useEffect = () => {}; export default { useState, useEffect, createElement() {} };`;
const toastOut = await build({ entryPoints: ['./src/components/Toast.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'host', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
    b.onResolve({ filter: /^react\/jsx-runtime$|^lucide-react$/ }, a => ({ path: a.path, namespace: 'noop' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: reactStub, loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'noop' }, () => ({ contents: 'module.exports = new Proxy({}, { get: () => () => null });', loader: 'js' }));
  } }] });

// Real Gallery with the notification panel opened.
globalThis.window = globalThis; globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; globalThis.sessionStorage = globalThis.localStorage;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
req('react-dom').createPortal = node => node;
const galleryOut = await build({ entryPoints: ['./src/components/Gallery.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [deps + 'node_modules'], logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  plugins: [{ name: 'open-panel', setup(b) { b.onLoad({ filter: /[\\/]Gallery\.tsx$/ }, a => {
    const s = fs.readFileSync(a.path, 'utf8').replace('[isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false)', '[isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(true)');
    return { contents: s, loader: 'tsx' }; }); } }] });
const { Gallery } = run(galleryOut.outputFiles[0].text);
const img = { id: 'a', url: 'https://example.com/a.png', thumbnailUrl: 'https://example.com/a.png', prompt: 'cat', aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: 1, createdAt: 1, referenceImages: [] };
const panel = toasts => renderToStaticMarkup(React.createElement(Gallery, { images: [img], currentFolderId: null, onFolderSelect() {}, selectedImageId: null, onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {}, toasts, onDismissToast() {}, onDismissAllToasts() {} }));

test('control: Clear All is offered when a finished notice is listed', () => {
  assert.match(panel([{ id: 't1', type: 'success', title: 'Image ready' }, { id: 't2', type: 'loading', title: 'Generating 4 images...', progress: 40 }]), />Clear All</);
});

test('Clear All is not offered when it would remove nothing (only running generations)', () => {
  let toast = run(toastOut.outputFiles[0].text).useToast;
  const hook = toast; toast = hook();
  toast.loading('Generating 4 images...', 'Please wait while your images are being created.');
  toast = hook();
  const before = toast.toasts.map(t => t.id);
  toast.dismissAll(); toast = hook();
  assert.ok(before.length > 0, 'a running generation is listed');
  assert.deepEqual(toast.toasts.map(t => t.id), before, 'Clear All keeps the running generation');
  assert.ok(!/>Clear All</.test(panel(toast.toasts)), 'Clear All is not offered when only running generations are listed');
});
