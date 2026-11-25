import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The generation bar is fixed to the bottom of the window. The populated gallery keeps its content clear of the bar
// with a bottom padding of --generation-bar-safe-area. The empty gallery has to do the same, or its centred
// "Create Folder" button ends up underneath the bar and cannot be clicked.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
async function load(entry) {
  const out = await build({
    entryPoints: ['.' + entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [root + '/node_modules'], logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    // Folders finish loading in an effect, which a static render never runs. Start loaded so the real empty state renders.
    plugins: [{ name: 'folders-loaded', setup(b) { b.onLoad({ filter: /Gallery\.tsx$/ }, async a => {
      const fs = await import('node:fs'); const src = fs.readFileSync(a.path, 'utf8');
      const loading = '[isFoldersLoading, setIsFoldersLoading] = useState(true)';
      assert.ok(src.includes(loading), 'Gallery.tsx no longer declares isFoldersLoading the way this test expects');
      return { contents: src.replace(loading, '[isFoldersLoading, setIsFoldersLoading] = useState(false)'), loader: 'tsx' }; }); } }],
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

const item = id => ({ id, url: 'https://example.com/' + id + '.png', thumbnailUrl: 'https://example.com/' + id + '.png', prompt: 'a cat ' + id,
  aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(), referenceImages: [] });
const gp = { currentFolderId: null, onFolderSelect() {}, selectedImageId: null, onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {} };
const render = props => renderToStaticMarkup(React.createElement(Gallery, { ...gp, ...props }));
const rootTag = html => html.match(/^<div[^>]*>/)[0];
const SAFE_AREA = 'padding-bottom:var(--generation-bar-safe-area, 16rem)';

test('empty gallery shows the Create Folder button', () => {
  const html = render({ images: [] });
  assert.match(html, /No Generations Yet/);
  assert.match(html, /Create Folder/);
});

test('empty gallery keeps its content above the generation bar', () => {
  assert.ok(rootTag(render({ images: [] })).includes(SAFE_AREA), 'empty gallery root does not reserve the generation bar safe area');
});

test('empty gallery reserves the same space as the populated gallery', () => {
  assert.ok(rootTag(render({ images: [item('a')] })).includes(SAFE_AREA), 'populated gallery root is expected to reserve the safe area');
  assert.ok(rootTag(render({ images: [] })).includes(SAFE_AREA));
});

test('empty gallery scrolls like the populated gallery when the window is too short', () => {
  // The app shell is a fixed-height box with overflow hidden, so each gallery view has to scroll by itself.
  const classes = html => rootTag(html).match(/class="([^"]*)"/)[1].split(/\s+/);
  assert.ok(classes(render({ images: [item('a')] })).includes('overflow-y-auto'), 'populated gallery root is expected to scroll');
  assert.ok(classes(render({ images: [] })).includes('overflow-y-auto'), 'empty gallery root cannot scroll, so short windows cannot reach Create Folder');
});

test('read-only empty gallery reserves nothing, because it has no generation bar', () => {
  const html = render({ images: [], isReadOnly: true });
  assert.match(html, /No Generations Yet/);
  assert.ok(!rootTag(html).includes('generation-bar-safe-area'));
});
