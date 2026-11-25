import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(new URL('../package.json', import.meta.url));
const { build } = req('esbuild');
const out = await build({
  entryPoints: ['./src/components/Gallery.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
});
globalThis.window = globalThis; globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; globalThis.sessionStorage = globalThis.localStorage;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const { renderToStaticMarkup } = req('react-dom/server');
const React = req('react');
req('react-dom').createPortal = node => node;
const { Gallery } = mod.exports;

const video = (id, o) => ({ id, url: `https://example.com/${id}.mp4`, prompt: 'p', aspectRatio: '16:9', resolution: '1K', mediaType: 'video', createdAt: Date.now(),
  referenceImages: [], referenceVideos: [], referenceAudios: [], status: 'completed', videoQuality: '768p', videoAspectRatio: 'adaptive', ...o });
const details = media => {
  const html = renderToStaticMarkup(React.createElement(Gallery, { images: [media], currentFolderId: null, onFolderSelect() {}, selectedImageId: media.id, onImageSelect() {},
    onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {} }));
  const cell = label => html.match(new RegExp(`>${label}</span></div><span[^>]*>([^<]*)</span>`))?.[1];
  return { action: cell('Action'), duration: cell('Duration') };
};
const h3 = (id, mode, o) => video(id, { videoModel: 'minimax-h3', videoOperation: 'generate', h3MaxMode: mode, falEndpoint: `minimax/h3-max/${mode}`, videoDuration: 5, ...o });

test('an H3 Max Recast video names its action and shows the output length, not the composer duration', () => {
  assert.deepEqual(details(h3('r', 'recast', { videoOutputDuration: 20 })), { action: 'Recast', duration: '20s' });
});

test('an H3 Max Lip Sync video names its action and follows the audio length', () => {
  assert.deepEqual(details(h3('l', 'lip_sync', { videoOutputDuration: 42.04 })), { action: 'Lip Sync', duration: '42s' });
});

test('an H3 Max video without a saved output length shows a dash for source-driven actions', () => {
  assert.deepEqual(details(h3('r2', 'recast')), { action: 'Recast', duration: '—' });
});

test('H3 Max Extend names its action and keeps the chosen duration', () => {
  assert.deepEqual(details(h3('e', 'extend_video', { videoDuration: 7 })), { action: 'Extend', duration: '7s' });
});

test('a plain H3 Max generate video and a Seedance Edit video are unchanged', () => {
  assert.deepEqual(details(h3('t', 'text_to_video')), { action: 'Generate', duration: '5s' });
  assert.deepEqual(details(video('s', { videoModel: 'seedance-2.5', videoOperation: 'edit', videoDuration: -1 })), { action: 'Edit', duration: 'Auto' });
});
