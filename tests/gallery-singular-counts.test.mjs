import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const root = process.cwd();
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
async function load(entry) {
  const out = await build({
    entryPoints: ['.' + entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [root + '/node_modules'], logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
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

const item = (id) => ({ id, url: 'https://example.com/' + id + '.png', thumbnailUrl: 'https://example.com/' + id + '.png', prompt: 'a cat ' + id,
  aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(), referenceImages: [] });
const gp = { currentFolderId: null, onFolderSelect() {}, selectedImageId: null, onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {} };
const header = n => renderToStaticMarkup(React.createElement(Gallery, { ...gp, images: Array.from({ length: n }, (_, i) => item('i' + i)) })).match(/>(\d+) (items?)</)?.slice(1, 3).join(' ');

const { getCountLabel } = await load('/src/lib/gallery/countLabel.ts');

test('gallery header reads "2 items" for two images', () => assert.equal(header(2), '2 items'));
test('gallery header reads "1 item" for one image', () => assert.equal(header(1), '1 item'));
test('count label picks the singular for 1 only', () => {
  assert.equal(getCountLabel(1, 'photo', 'photos'), '1 photo');
  assert.equal(getCountLabel(0, 'photo', 'photos'), '0 photos');
  assert.equal(getCountLabel(2, 'photo', 'photos'), '2 photos');
});
