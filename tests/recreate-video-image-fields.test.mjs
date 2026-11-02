import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

globalThis.window = globalThis; globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '11111111-1111-1111-1111-111111111111', sessionId: '22222222-2222-2222-2222-222222222222' }; globalThis.location = { hostname: 'localhost' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { body: {}, documentElement: { style: { setProperty() {}, removeProperty() {} } }, addEventListener() {}, removeEventListener() {} };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
const nodeRoot = fileURLToPath(new URL('..', import.meta.url));
const root = nodeRoot;
const req = createRequire(nodeRoot + '/package.json');
const { build } = req('esbuild');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');


// Re-create on a saved video: createRecreateConfig copies the video row's resolution/aspect_ratio ('1080p', '21:9')
// into the IMAGE fields. Clicking the Image tab then shows an impossible Resolution/Aspect Ratio and generates with them.
const bundle = async (entry, extra = []) => {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', define: { 'import.meta.url': '"file:///x/"', 'import.meta.env': '{"VITE_X":""}' }, plugins: extra });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, p => req(p));
  return mod.exports;
};

test('Re-create on a video leaves a valid image Resolution after switching to Image', async () => {
  const { createRecreateConfig } = await bundle(root + '/src/lib/gallery/recreateDraft.ts');
  // storageService maps a saved video row: resolution = videoQuality, aspectRatio = videoAspectRatio
  const video = { id: 'v1', mediaType: 'video', url: 'u', prompt: 'a clip', createdAt: 1, videoModel: 'seedance-2.5', videoQuality: '1080p', videoAspectRatio: '21:9', aspectRatio: '21:9', resolution: '1080p', videoDuration: 5 };
  const draft = createRecreateConfig(video, 'gemini-nano-banana-2.1');
  const imageDraft = { ...draft, mode: 'image' }; // user clicks the Image tab (updateConfig('mode','image'))
  assert.ok(['1K', '2K', '4K'].includes(imageDraft.resolution), `image resolution after recreating a video: ${imageDraft.resolution}`);
  assert.ok(['1:1', '3:4', '4:3', '9:16', '16:9'].includes(imageDraft.aspectRatio), `image aspect ratio after recreating a video: ${imageDraft.aspectRatio}`);
});

test('real Controls after Re-create on a video then Image tab shows a valid Resolution', async () => {
  const { createRecreateConfig } = await bundle(root + '/src/lib/gallery/recreateDraft.ts');
  const out = await build({ entryPoints: [root + '/src/components/Controls.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', define: { 'import.meta.url': '"file:///x/"', 'import.meta.env': '{"VITE_X":""}' },
    plugins: [{ name: 'p', setup(b) {
      b.onLoad({ filter: /components\/Controls\.tsx$/ }, a => {
        const src = fs.readFileSync(a.path, 'utf8').replace('useState(false);\n', 'useState(false);\n');
        return { contents: src, loader: 'tsx', resolveDir: root + '/src/components' };
      });
      b.onResolve({ filter: /\/(authService|storageService)$/ }, a => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = new Proxy({}, { get: (_, k) => k === "__esModule" ? false : () => undefined });', loader: 'js' }));
      b.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'rd', namespace: 'rd' }));
      b.onLoad({ filter: /.*/, namespace: 'rd' }, () => ({ contents: "const r=require('/__rd__');module.exports={...r,createPortal:c=>c,flushSync:f=>f()};", loader: 'js' }));
      b.onResolve({ filter: /^__rd__|^\/__rd__$/ }, () => ({ path: req.resolve('react-dom'), external: true }));
      b.onResolve({ filter: /^[^./]/ }, a => (a.path.startsWith('node:') || a.path === 'rd' || a.path.includes('__rd__')) ? undefined : (() => { try { return { path: req.resolve(a.path), external: true }; } catch { return undefined; } })());
    } }] });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, p => p === '/__rd__' ? { ...req('react-dom') } : req(p));
  const video = { id: 'v1', mediaType: 'video', url: 'u', prompt: 'a clip', createdAt: 1, videoModel: 'seedance-2.5', videoQuality: '1080p', videoAspectRatio: '21:9', aspectRatio: '21:9', resolution: '1080p', videoDuration: 5 };
  const config = { ...createRecreateConfig(video, 'gemini-nano-banana-2.1'), mode: 'image' };
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(mod.exports.Controls, { config, templates: [], onChange: noop, onGenerate: noop, onSaveTemplate: noop, onUpdateTemplate: noop, onDeleteTemplate: noop, onSelectTemplate: noop, activeRequests: 0 }));
  const label = name => (html.match(new RegExp('aria-label="' + name + '"[^>]*>[\\s\\S]*?font-semibold[^>]*>([^<]+)<')) || [])[1];
  const res = label('Resolution'), ratio = label('Aspect Ratio');
  assert.ok(['1K', '2K', '4K'].includes(res), `Resolution dropdown reads: ${res}; Aspect Ratio dropdown reads: ${ratio}`);
});
