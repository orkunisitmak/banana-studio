import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const req = createRequire(import.meta.url);
const { build } = req('esbuild');
const SEEDED = { id: 'r1', data: 'data:image/png;base64,AAAA', mimeType: 'image/png' };

async function loadGallery(seedPreview) {
  const plugins = seedPreview ? [{ name: 'seed', setup(b) {
    b.onLoad({ filter: /components[\\/]Gallery\.tsx$/ }, args => {
      const needle = 'useState<ReferenceImage | null>(null)';
      const src = fs.readFileSync(args.path, 'utf8');
      assert.ok(src.includes(needle), 'previewRefImage state not found');
      return { contents: src.replace(needle, 'useState<ReferenceImage | null>(globalThis.__SEEDED_REF)'), loader: 'tsx' };
    });
  } }] : [];
  const out = await build({
    entryPoints: ['src/components/Gallery.tsx'], absWorkingDir: process.cwd(), bundle: true, write: false,
    format: 'cjs', platform: 'node', logLevel: 'silent', plugins,
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports.Gallery;
}

const listeners = [];
globalThis.window = globalThis;
globalThis.addEventListener = (type, fn) => listeners.push([type, fn]);
globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.__SEEDED_REF = SEEDED;
req('react-dom').createPortal = node => node;

const item = id => ({ id, url: `https://example.com/${id}.png`, thumbnailUrl: `https://example.com/${id}.png`, prompt: `a cat ${id}`,
  aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview', mediaType: 'image', timestamp: Date.now(), createdAt: Date.now(),
  referenceImages: [SEEDED] });
const props = { images: [item('a'), item('b')], currentFolderId: null, onFolderSelect() {}, selectedImageId: 'a',
  onImageSelect() {}, onClear() {}, onUseAsReference() {}, onRecreate() {}, onDelete() {}, onDeleteMultiple() {}, onMove() {}, onToggleFavorite() {} };

test('reference photo thumbnail is a focusable named button', async () => {
  const Gallery = await loadGallery(false);
  const html = renderToStaticMarkup(React.createElement(Gallery, props));
  const tag = html.match(/<div[^>]*aspect-square[^>]*cursor-pointer[^>]*>/)?.[0];
  assert.ok(tag, 'reference thumbnail not rendered');
  assert.match(tag, /role="button"/);
  assert.match(tag, /tabindex="0"/);
  assert.match(tag, /aria-label="Preview reference photo"/);
});

test('open reference preview is a modal dialog with a named close button that Escape closes', async () => {
  const Gallery = await loadGallery(true);
  const realUseState = React.useState;
  const realUseEffect = React.useEffect;
  React.useEffect = effect => {
    if (!effect.toString().includes('closeOnEscape')) return;
    effect();
  };
  let html;
  try {
    // Record what the Escape listener does to the seeded state.
    const calls = [];
    React.useState = init => {
      if (init === SEEDED) return [SEEDED, v => calls.push(v)];
      return realUseState(init);
    };
    html = renderToStaticMarkup(React.createElement(Gallery, props));
    const escape = listeners.filter(([type]) => type === 'keydown');
    assert.ok(escape.length, 'no keydown listener registered while the preview is open');
    for (const [, fn] of escape) fn({ key: 'a', defaultPrevented: false });
    assert.deepEqual(calls, []);
    for (const [, fn] of escape) fn({ key: 'Escape', defaultPrevented: false });
    assert.deepEqual(calls, [null]);
  } finally {
    React.useState = realUseState;
    React.useEffect = realUseEffect;
  }
  const tag = html.match(/<div[^>]*fixed inset-0 z-\[200\][^>]*>/)?.[0];
  assert.ok(tag, 'preview popup not rendered');
  assert.match(tag, /role="dialog"/);
  assert.match(tag, /aria-modal="true"/);
  const close = html.match(/<button[^>]*absolute top-4 right-4[^>]*>/)[0];
  assert.match(close, /aria-label="Close reference preview"/);
});
