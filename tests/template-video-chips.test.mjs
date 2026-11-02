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

test('video template row shows the video quality and ratio, not the image leftovers', async () => {
  const out = await build({ entryPoints: ['src/components/Controls.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', define: { 'import.meta.url': '"file:///x/"', 'import.meta.env': '{"VITE_X":""}' },
    plugins: [{ name: 'p', setup(b) {
      b.onLoad({ filter: /components\/Controls\.tsx$/ }, a => {
        const src = fs.readFileSync(a.path, 'utf8').replace('useState(false);\n', 'useState(false);\n').replace(/(\[isTemplateMenuOpen, setIsTemplateMenuOpen\] = useState\()false\)/, '$1true)');
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
  const base = { prompt: 'p', count: 1, aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-nano-banana-2.1', referenceImages: [], referenceVideos: [], referenceAudios: [], mode: 'image', videoModel: 'seedance-2.5', videoOperation: 'generate', videoAspectRatio: '9:16', videoQuality: '1080p', videoDuration: 5, audioEnabled: true, videoPromptExpansionMode: 'balanced' };
  const tpl = { id: 't', name: 'Tall clip', createdAt: 1, config: { ...base, mode: 'video' } };
  const bare = { id: 'b', name: 'Bare clip', createdAt: 2, config: { ...base, mode: 'video', videoQuality: undefined, videoAspectRatio: undefined } };
  const blank = { id: 'x', name: 'Blank clip', createdAt: 3, config: { ...base, mode: 'video', videoQuality: undefined, videoAspectRatio: undefined, aspectRatio: undefined } };
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(mod.exports.Controls, { config: base, templates: [tpl, bare, blank], onChange: noop, onGenerate: noop, onSaveTemplate: noop, onUpdateTemplate: noop, onDeleteTemplate: noop, onSelectTemplate: noop, activeRequests: 0 }));
  assert.ok(html.includes('Tall clip'), 'template list rendered');
  const row = html.slice(html.indexOf('Tall clip'), html.indexOf('Tall clip') + 600);
  const chips = [...row.matchAll(/text-gray-400">([^<]+)</g)].map(m => m[1]);
  assert.ok(chips.includes('1080p') && chips.includes('9:16'), `video template chips read: ${chips.join(' | ')}`);
  assert.ok(!chips.includes('1K') && !chips.includes('1:1'), `video template row shows image leftovers: ${chips.join(' | ')}`);
  // A saved video template without quality or ratio reads like History: 720p, and the image ratio as the fallback.
  const bareRow = html.slice(html.indexOf('Bare clip'), html.indexOf('Bare clip') + 600);
  const bareChips = [...bareRow.matchAll(/text-gray-400">([^<]+)</g)].map(m => m[1]);
  assert.ok(bareChips.includes('720p') && bareChips.includes('1:1') && !bareChips.includes('1K'), `bare video template chips read: ${bareChips.join(' | ')}`);
  // With no ratio anywhere the chip shows a dash, not an empty box.
  const blankRow = html.slice(html.indexOf('Blank clip'), html.indexOf('Blank clip') + 600);
  const blankChips = [...blankRow.matchAll(/text-gray-400">([^<]+)</g)].map(m => m[1]);
  assert.ok(blankChips.includes('720p') && blankChips.includes('—'), `blank video template chips read: ${blankChips.join(' | ')}`);
});
