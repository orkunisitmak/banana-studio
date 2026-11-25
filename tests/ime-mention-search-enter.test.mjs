import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
const bundle = async (entry, plugins = []) => {
  const out = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, plugins,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports;
};
const captureProps = (render, pred) => {
  const found = [];
  const rts = ['react/jsx-runtime', 'react/jsx-dev-runtime'].map(n => req(n));
  const origs = rts.map(rt => ({ jsx: rt.jsx, jsxs: rt.jsxs, jsxDEV: rt.jsxDEV }));
  const spy = f => (type, props, ...r) => { if (pred(type, props)) found.push(props); return f(type, props, ...r); };
  rts.forEach((rt, i) => { for (const k of ['jsx', 'jsxs', 'jsxDEV']) if (rt[k]) rt[k] = spy(origs[i][k]); });
  try { render(); } finally { rts.forEach((rt, i) => Object.assign(rt, origs[i])); }
  return found;
};
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
const ls = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = ls; globalThis.sessionStorage = ls;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
const React = req('react'); const { renderToStaticMarkup } = req('react-dom/server');
req('react-dom').createPortal = n => n;
const listeners = [];
globalThis.document.addEventListener = (type, fn) => { if (type === 'keydown') listeners.push(fn); };
// Safari: the Enter that confirms an input-method candidate arrives after compositionend,
// so isComposing is already false, but keyCode is still 229.
const safariConfirmEnter = (extra = {}) => ({ key: 'Enter', keyCode: 229, isComposing: false, nativeEvent: { isComposing: false }, repeat: false, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, preventDefault() {}, stopPropagation() {}, ...extra });
const patch = (file, edits) => ({ name: 'patch', setup(b) { b.onLoad({ filter: new RegExp(file.replace('.', '\\.') + '$') }, a => {
  let s = fs.readFileSync(a.path, 'utf8'); for (const [from, to] of edits) { assert.ok(s.includes(from), 'anchor: ' + from); s = s.replace(from, to); } return { contents: s, loader: 'tsx' }; }); } });

test('gallery search dialog does not open a result on the Enter that confirms an input-method candidate', async () => {
  const exp = await bundle('src/components/GallerySearchDialog.tsx', [patch('GallerySearchDialog.tsx', [])]);
  const selected = [];
  const realReact = req('react'); const origEffect = realReact.useEffect;
  realReact.useEffect = (fn, deps) => { if (/keydown/.test(String(fn))) fn(); };
  try {
    renderToStaticMarkup(React.createElement(exp.GallerySearchDialog, { images: [], folders: [{ id: 'f1', name: 'Holiday', created_at: 1 }], onClose() {}, onSelect: e => selected.push(e) }));
  } finally { realReact.useEffect = origEffect; }
  assert.ok(listeners.length, 'keydown listener registered');
  listeners.at(-1)(safariConfirmEnter());
  assert.deepEqual(selected, [], 'composing Enter must not choose a result');
  listeners.at(-1)(safariConfirmEnter({ keyCode: 13 }));
  assert.equal(selected.length, 1, 'a normal Enter still chooses the result');
});

test('gallery edit prompt @ mention list does not insert a reference on the Enter that confirms an input-method candidate', async () => {
  const changed = [];
  globalThis.__changed = changed;
  const exp = await bundle('src/components/GalleryImageEditor.tsx', [patch('GalleryImageEditor.tsx', [
    ['useState<{ start: number; end: number; query: string }>()', 'useState<{ start: number; end: number; query: string } | undefined>({ start: 0, end: 1, query: "" })'],
    ['useState<ImageEditRegion>()', 'useState<ImageEditRegion | undefined>({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })'],
    ['useState<{ width: number; height: number }>()', 'useState<{ width: number; height: number } | undefined>({ width: 1024, height: 1024 })'],
    ['const changePrompt = (value: string) => {', 'const changePrompt = (value: string) => { globalThis.__changed.push(value);'],
  ])]);
  const image = { id: 'img1', type: 'image', url: 'https://x.example/a.png', prompt: 'p', timestamp: 1, aspectRatio: '1:1', model: 'm' };
  const tas = captureProps(() => renderToStaticMarkup(React.createElement(exp.GalleryImageEditor, { image, isEditing: true, onStart() {}, onGenerate: async () => [], onClose() {} })), (t, p) => t === 'textarea' && p?.['aria-label'] === 'Edit prompt');
  assert.ok(tas.length, 'prompt rendered');
  tas.at(-1).onKeyDown(safariConfirmEnter());
  assert.deepEqual(changed, [], 'composing Enter must not insert a mention');
  tas.at(-1).onKeyDown(safariConfirmEnter({ keyCode: 13 }));
  assert.equal(changed.length, 1, 'a normal Enter still inserts the mention');
});

test('main prompt @ mention list does not insert a reference on the Enter that confirms an input-method candidate', async () => {
  const exp = await bundle('src/components/Controls.tsx', [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /services[\\/]storageService$/ }, a => /Controls\.tsx$/.test(a.importer) ? { path: 'sm', namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ loader: 'js', contents: `export const compressImage=async d=>d,refreshMediaAccessUrl=async u=>u,estimateBase64Size=()=>1,saveReferenceImage=async i=>i,getReferenceGallery=async()=>[],deleteReferenceImage=async()=>{},uploadVideoBlobToPublicUrl=async()=>'';` }));
  } }, patch('Controls.tsx', [['const [mentionState, setMentionState] = useState<{', 'const [mentionState, setMentionState] = useState<any>({ active: true, query: "", position: { top: 0, left: 0 }, startIndex: 0, endIndex: 1 }); const __unused = useState<{']])]);
  const config = { prompt: '@', count: 1, aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', referenceImages: [{ id: 'r1', data: 'data:image/png;base64,eA==', mimeType: 'image/png' }], referenceVideos: [], referenceAudios: [], mode: 'image', videoModel: 'seedance-2.0', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: 'standard', videoDuration: 5, audioEnabled: false, videoPromptExpansionMode: 'off' };
  const updates = [];
  const props = { config, onChange: u => updates.push(u), onGenerate() {}, activeRequests: 0, templates: [], onSaveTemplate() {}, onUpdateTemplate() {}, onDeleteTemplate() {}, onSelectTemplate() {} };
  const tas = captureProps(() => renderToStaticMarkup(React.createElement(exp.Controls, props)), (t, p) => t === 'textarea' && p?.onKeyDown);
  assert.ok(tas.length, 'prompt rendered');
  tas.at(-1).onKeyDown(safariConfirmEnter());
  assert.deepEqual(updates, [], 'composing Enter must not insert a mention');
  tas.at(-1).onKeyDown(safariConfirmEnter({ keyCode: 13 }));
  assert.equal(updates.length, 1, 'a normal Enter still inserts the mention');
});
