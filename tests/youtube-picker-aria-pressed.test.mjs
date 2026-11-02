import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Render the real Gallery with a selected image (selectedImageId is a prop) and the real Compare dialog as control.
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + '/package.json');
const { build } = req('esbuild');
async function load(entry) {
  const out = await build({
    entryPoints: ['.' + entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [deps + '/node_modules'], logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'force-state', setup(b) { b.onLoad({ filter: /YouTubeChannelRef\.tsx$/ }, async a => {
      const fs = await import('node:fs'); let s = fs.readFileSync(a.path, 'utf8');
      // Start with the popup open and a loaded video list with video "v1" selected (the state after the user taps Browse & Pick).
      s = s.replace('const [isOpen, setIsOpen] = useState(false)', 'const [isOpen, setIsOpen] = useState(true)')
        .replace('const [videos, setVideos] = useState<YouTubeVideo[]>([])', 'const [videos, setVideos] = useState<YouTubeVideo[]>([1, 2].map(n => ({ id: "v" + n, title: "Video " + n, publishedAt: "2026-01-01T00:00:00Z", thumbnailUrl: "https://example.com/t.jpg", viewCount: 10, durationSeconds: 600 })))')
        .replace('const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())', 'const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(["v1"]))')
        .replace("const [mode, setMode] = useState<Mode>('input')", "const [mode, setMode] = useState<Mode>('top')");
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
const { YouTubeChannelRef } = await load('/src/components/YouTubeChannelRef.tsx');
const { Gallery } = await load('/src/components/Gallery.tsx');
const html = renderToStaticMarkup(React.createElement(YouTubeChannelRef, { onAddReferences() {}, onPrepareBrainstorm() {}, draftKey: 'k', remainingSlots: 10 }));
const rows = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?Video [12](?:(?!<\/button>)[\s\S])*?<\/button>/g) || [];

test('sanity: the picker renders two video rows, one selected', () => {
  assert.equal(rows.length, 2, 'rows: ' + rows.length);
  assert.match(html, /1\/10 selected/);
});

test('selectable video rows expose their selected state with aria-pressed', () => {
  const bad = rows.filter(r => !/aria-pressed=/.test(r.match(/<button\b[^>]*>/)[0]));
  assert.deepEqual(bad.map(r => r.match(/Video [12]/)[0]), [], 'toggle rows with no aria-pressed (selection is only a check icon in a div)');
  const state = name => rows.find(r => r.includes(name)).match(/<button\b[^>]*>/)[0].match(/aria-pressed="(true|false)"/)?.[1];
  assert.equal(state('Video 1'), 'true', 'the selected row is pressed');
  assert.equal(state('Video 2'), 'false', 'the other row is not pressed');
});

test('control: Gallery filter and sort toggles expose aria-pressed', () => {
  const g = renderToStaticMarkup(React.createElement(Gallery, { images: [{ id: 'a', url: 'https://example.com/a.png', thumbnailUrl: 'https://example.com/a.png', prompt: 'cat', aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(), referenceImages: [] }], currentFolderId: null, onFolderSelect() {}, selectedImageId: null, onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {} }));
  assert.match(g, /<button\b[^>]*aria-pressed=/);
});
