import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');

async function loadGallery(initialMediaFilter) {
  const out = await build({
    entryPoints: ['./src/components/Gallery.tsx'],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    nodePaths: [root + '/node_modules'],
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{
      name: 'gallery-filter-state',
      setup(b) {
        b.onLoad({ filter: /Gallery\.tsx$/ }, args => {
          let src = fs.readFileSync(args.path, 'utf8');
          const loading = '[isFoldersLoading, setIsFoldersLoading] = useState(true)';
          const filter = "[mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video'>('all')";
          assert.ok(src.includes(loading), 'Gallery.tsx no longer declares isFoldersLoading as expected');
          assert.ok(src.includes(filter), 'Gallery.tsx no longer declares mediaFilter as expected');
          src = src.replace(loading, '[isFoldersLoading, setIsFoldersLoading] = useState(false)');
          if (initialMediaFilter !== 'all') {
            src = src.replace(filter, `[mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video'>('${initialMediaFilter}')`);
          }
          return { contents: src, loader: 'tsx' };
        });
      },
    }],
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports.Gallery;
}

globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const { renderToStaticMarkup } = req('react-dom/server');
const React = req('react');
req('react-dom').createPortal = node => node;

const makeItem = (id, mediaType) => ({
  id,
  url: `https://example.com/${id}.${mediaType === 'video' ? 'mp4' : 'png'}`,
  thumbnailUrl: `https://example.com/${id}.png`,
  prompt: 'sample ' + id,
  aspectRatio: '16:9',
  resolution: '1K',
  imageModel: 'gemini-3-pro-image-preview',
  mediaType,
  timestamp: Date.now(),
  createdAt: Date.now(),
  referenceImages: [],
});

const baseProps = {
  currentFolderId: null,
  onFolderSelect() {},
  selectedImageId: null,
  onImageSelect() {},
  onClear() {},
  onUseAsReference() {},
  onRecreate() {},
  onDelete() {},
  onDeleteMultiple() {},
  onMove() {},
  onToggleFavorite() {},
};

test('filtering an image-only gallery by Videos keeps the header and filter buttons visible', async () => {
  const Gallery = await loadGallery('video');
  const html = renderToStaticMarkup(React.createElement(Gallery, { ...baseProps, images: [makeItem('img-1', 'image')] }));
  assert.doesNotMatch(html, /No Generations Yet/);
  assert.match(html, /aria-label="Show all media"/);
  assert.match(html, /aria-label="Show images"/);
  assert.match(html, /aria-label="Show videos"/);
});

test('filtering a video-only gallery by Images keeps the header and filter buttons visible', async () => {
  const Gallery = await loadGallery('image');
  const html = renderToStaticMarkup(React.createElement(Gallery, { ...baseProps, images: [makeItem('vid-1', 'video')] }));
  assert.doesNotMatch(html, /No Generations Yet/);
  assert.match(html, /aria-label="Show all media"/);
});

test('control: an empty unfiltered root gallery still shows the No Generations Yet screen', async () => {
  const Gallery = await loadGallery('all');
  const html = renderToStaticMarkup(React.createElement(Gallery, { ...baseProps, images: [] }));
  assert.match(html, /No Generations Yet/);
});
