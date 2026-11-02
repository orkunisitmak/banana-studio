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

const load = async () => {
  const out = await build({ entryPoints: ['src/components/Controls.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', define: { 'import.meta.url': '"file:///x/"', 'import.meta.env': '{"VITE_X":""}' },
    plugins: [{ name: 'p', setup(b) {
      b.onResolve({ filter: /\/(authService|storageService)$/ }, a => ({ path: a.path, namespace: 'stub' }));
      b.onResolve({ filter: /\/ControlDropdown$/ }, () => ({ path: 'dd', namespace: 'dd' }));
      b.onLoad({ filter: /.*/, namespace: 'dd' }, () => ({ contents: 'module.exports={Dropdown:p=>{(globalThis.__dd=globalThis.__dd||{})[p.label]=p;return null}};', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = new Proxy({}, { get: (_, k) => k === "__esModule" ? false : () => undefined });', loader: 'js' }));
      b.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'rd', namespace: 'rd' }));
      b.onLoad({ filter: /.*/, namespace: 'rd' }, () => ({ contents: "const r=require('/__rd__');module.exports={...r,createPortal:c=>c,flushSync:f=>f()};", loader: 'js' }));
      b.onResolve({ filter: /^__rd__|^\/__rd__$/ }, () => ({ path: req.resolve('react-dom'), external: true }));
      b.onResolve({ filter: /^[^./]/ }, a => (a.path.startsWith('node:') || a.path === 'rd' || a.path === 'dd' || a.path.includes('__rd__')) ? undefined : (() => { try { return { path: req.resolve(a.path), external: true }; } catch { return undefined; } })());
    } }] });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, p => p === '/__rd__' ? { ...req('react-dom') } : req(p));
  return mod.exports.Controls;
};

const base = { prompt: 'a', count: 1, aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-nano-banana-2.1', referenceImages: [], referenceVideos: [], referenceAudios: [], mode: 'video', videoModel: 'seedance-2.5', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: true, videoPromptExpansionMode: 'balanced' };
const render = (Controls, config) => {
  globalThis.__dd = {};
  let next = null;
  const onChange = v => { next = typeof v === 'function' ? v(config) : v; };
  renderToStaticMarkup(React.createElement(Controls, { config, templates: [], onChange, onGenerate() {}, onSaveTemplate() {}, onUpdateTemplate() {}, onDeleteTemplate() {}, onSelectTemplate() {}, activeRequests: 0 }));
  const dd = globalThis.__dd;
  return { dd, select: (label, value) => { next = null; dd[label].onSelect(value); return next; } };
};
const invalid = (dd) => Object.entries(dd).filter(([l, p]) => ['Ratio', 'Quality', 'Duration', 'Action', 'Model', 'Resolution', 'Aspect Ratio'].includes(l) && p.options && !p.options.some(o => o.value === p.value)).map(([l, p]) => `${l}=${p.value} not in [${p.options.map(o => o.value)}]`);

test('video model/action walks never leave a dropdown holding a value it does not offer', async () => {
  const Controls = await load();
  const seen = new Set(), bad = [];
  const walk = (config, path, depth) => {
    const { dd, select } = render(Controls, config);
    const inv = invalid(dd);
    if (inv.length) bad.push(path.join(' > ') + ' => ' + inv.join('; '));
    if (depth === 0) return;
    for (const [label, vals] of [['Model', ['seedance-2.0', 'seedance-2.5', 'minimax-h3']], ['Action', ['generate', 'edit', 'extend', 'reference_edit']], ['Ratio', ['adaptive', '21:9']], ['Quality', ['1080p', '480p']], ['Duration', ['-1', '30']]]) {
      for (const v of vals) {
        if (!dd[label] || !dd[label].options.some(o => o.value === v)) continue;
        const n = select(label, v); if (!n) continue;
        const key = JSON.stringify([n.videoModel, n.videoOperation, n.videoAspectRatio, n.videoQuality, n.videoDuration]);
        if (seen.has(key)) continue; seen.add(key);
        walk(n, [...path, `${label}:${v}`], depth - 1);
      }
    }
  };
  walk(base, ['start'], 4);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} invalid states, e.g.`);
});
