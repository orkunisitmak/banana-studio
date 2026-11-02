import test from 'node:test';
import assert from 'node:assert/strict';
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
const stale = 'https://p.example/storage/v1/object/sign/media/u/a.png?token=expired';
const fresh = 'https://p.example/storage/v1/object/sign/media/u/a.png?token=renewed';
const fetched = [];
globalThis.fetch = async url => { fetched.push(String(url)); return String(url) === fresh ? new Response(new Blob(['png'], { type: 'image/png' })) : new Response('expired', { status: 400 }); };
globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,eA=='; setTimeout(() => { this.onload?.(); this.onloadend?.(); }, 0); } };
globalThis.__saved = [];
const exp = await bundle('src/components/Controls.tsx', [{ name: 'probe', setup(b) {
  b.onResolve({ filter: /services[\\/]storageService$/ }, a => /Controls\.tsx$/.test(a.importer) ? { path: 'storage-mock', namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ loader: 'js', contents: `
    export const refreshMediaAccessUrl = async url => url.replace('token=expired', 'token=renewed');
    export const compressImage = async d => d; export const estimateBase64Size = () => 1;
    export const saveReferenceImage = async i => { globalThis.__saved.push(i); return i; };
    export const getReferenceGallery = async () => []; export const deleteReferenceImage = async () => {};
    export const uploadVideoBlobToPublicUrl = async () => '';` }));
} }]);
const React = req('react'); const { renderToStaticMarkup } = req('react-dom/server');
const config = { prompt: '', count: 1, aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', referenceImages: [], referenceVideos: [], referenceAudios: [], mode: 'image', videoModel: 'seedance-2.0', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: 'standard', videoDuration: 5, audioEnabled: false, videoPromptExpansionMode: 'off' };
const updates = [];
const props = { config, onChange: u => updates.push(typeof u === 'function' ? u(config) : u), onGenerate() {}, activeRequests: 0, templates: [], onSaveTemplate() {}, onUpdateTemplate() {}, onDeleteTemplate() {}, onSelectTemplate() {} };
const handlers = captureProps(() => renderToStaticMarkup(React.createElement(exp.Controls, props)), (t, p) => t === 'div' && p?.onDrop || t === 'button' && p?.onDrop);
const dt = { getData: k => k === 'application/nanogen-media' ? JSON.stringify({ id: 'a', mediaType: 'image', url: stale }) : '', files: [] };
const drop = { preventDefault() {}, stopPropagation() {}, target: {}, dataTransfer: dt };
const settle = () => new Promise(r => setTimeout(r, 50));

test('dropping a gallery image onto the prompt box renews an expired signed link first', async () => {
  const bar = handlers.find(p => typeof p.className === 'string' && p.className.includes('fixed bottom-0'));
  assert.ok(bar, 'prompt bar rendered');
  fetched.length = 0; updates.length = 0;
  await bar.onDrop(drop); await settle();
  assert.deepEqual(fetched, [fresh], 'fetch must use the renewed link');
  assert.equal(updates.length, 1, 'reference added');
});
test('dropping a gallery image onto the saved-references button renews an expired signed link first', async () => {
  const btn = handlers.find(p => typeof p.className === 'string' && p.className.includes('w-12 h-12'));
  assert.ok(btn, 'saved references button rendered');
  fetched.length = 0; globalThis.__saved.length = 0;
  await btn.onDrop(drop); await settle();
  assert.deepEqual(fetched, [fresh], 'fetch must use the renewed link');
  assert.equal(globalThis.__saved.length, 1, 'reference saved');
});
