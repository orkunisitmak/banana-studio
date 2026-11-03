import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Render the real Gallery and read the Move button's accessible name. Below sm its text is display:none, so only aria-label names it.
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + '/package.json');
const { build } = req('esbuild');
async function load(entry) {
  const out = await build({
    entryPoints: ['.' + entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [deps + '/node_modules'], logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    // The selection bar only renders with a selection, so start the real component in selection mode with one item picked.
    plugins: [{ name: 'select', setup(b) { b.onLoad({ filter: /Gallery\.tsx$/ }, async a => {
      const fs = await import('node:fs'); let s = fs.readFileSync(a.path, 'utf8');
      const A = '[isSelectionMode, setIsSelectionMode] = useState(false)', B = 'useState<Set<string>>(new Set())';
      if (!s.includes(A) || !s.includes(B)) throw new Error('selection state not found');
      s = s.replace(A, A.replace('(false)', '(true)')).replace(B, "useState<Set<string>>(new Set(['a']))");
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

const buttons = html.match(/<button\b[^>]*>/g) || [];

test('the Move button keeps an accessible name when its text is hidden on small screens', () => {
  const moveButtons = buttons.filter(b => /aria-haspopup="menu"/.test(b));
  assert.ok(moveButtons.length > 0, 'no menu button rendered');
  const unnamed = moveButtons.filter(b => !/aria-label="[^"]+"/.test(b) && !/aria-labelledby=/.test(b));
  assert.deepEqual(unnamed, []);
  assert.ok(moveButtons.some(b => /aria-label="Move"/.test(b)), 'Move button not found');
});
