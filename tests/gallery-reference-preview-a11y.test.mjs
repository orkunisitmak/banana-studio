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
  assert.match(tag, /aria-label="Preview reference photo 1"/);
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

// Render once with the preview open, record the props of every element the Gallery creates, and keep the preview effect's cleanup.
function renderOpen(Gallery) {
  const realUseState = React.useState, realUseEffect = React.useEffect;
  const runtimes = ['react/jsx-runtime', 'react/jsx-dev-runtime'].map(name => req(name));
  const real = runtimes.map(rt => ({ jsx: rt.jsx, jsxs: rt.jsxs, jsxDEV: rt.jsxDEV }));
  const seen = [], cleanups = [], calls = [];
  runtimes.forEach(rt => ['jsx', 'jsxs', 'jsxDEV'].forEach(k => { const orig = rt[k]; if (orig) rt[k] = (type, props, ...rest) => { if (props && typeof type === 'string') seen.push({ type, props }); return orig(type, props, ...rest); }; }));
  React.useState = init => (init === SEEDED ? [SEEDED, v => calls.push(v)] : realUseState(init));
  React.useEffect = effect => { if (effect.toString().includes('closeOnEscape')) cleanups.push(effect()); };
  try { renderToStaticMarkup(React.createElement(Gallery, props)); }
  finally {
    React.useState = realUseState; React.useEffect = realUseEffect;
    runtimes.forEach((rt, i) => Object.assign(rt, real[i]));
  }
  return { seen, cleanups, calls };
}

test('Enter and Space on the focused thumbnail open the preview, other keys and inner targets do not', async () => {
  const { seen, calls } = renderOpen(await loadGallery(true));
  const thumb = seen.find(e => e.props.role === 'button' && /^Preview reference photo/.test(e.props['aria-label'] || ''));
  assert.ok(thumb, 'thumbnail not rendered');
  const opener = { focus() {} };
  const press = (key, target = opener) => { let prevented = false; thumb.props.onKeyDown({ key, target, currentTarget: opener, preventDefault() { prevented = true; } }); return prevented; };
  calls.length = 0;
  assert.equal(press('Enter'), true);
  assert.equal(press(' '), true);
  assert.deepEqual(calls, [SEEDED, SEEDED]);
  assert.equal(press('a'), false);
  assert.equal(press('Enter', {}), false);
  assert.equal(calls.length, 2);
});

test('Tab inside the open preview stays on the close button', async () => {
  const { seen } = renderOpen(await loadGallery(true));
  const dialog = seen.find(e => e.props.role === 'dialog' && e.props['aria-label'] === 'Reference photo preview');
  assert.ok(dialog, 'dialog not rendered');
  let prevented = 0;
  dialog.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault() { prevented++; } });
  dialog.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  dialog.props.onKeyDown({ key: 'a', preventDefault() { prevented++; } });
  assert.equal(prevented, 2);
});

test('closing the preview gives focus back to the thumbnail that opened it', async () => {
  const { seen, cleanups } = renderOpen(await loadGallery(true));
  const thumb = seen.find(e => e.props.role === 'button' && /^Preview reference photo/.test(e.props['aria-label'] || ''));
  let focused = 0;
  const opener = { isConnected: true, focus() { focused++; } };
  thumb.props.onClick({ currentTarget: opener });
  cleanups.filter(Boolean).forEach(fn => fn());
  assert.equal(focused, 1);
});

test('thumbnails of one photo list have different names', async () => {
  const Gallery = await loadGallery(false);
  const two = { ...props, images: [{ ...item('a'), referenceImages: [SEEDED, { ...SEEDED, id: 'r2' }] }, item('b')] };
  const html = renderToStaticMarkup(React.createElement(Gallery, two));
  assert.match(html, /aria-label="Preview reference photo 1"/);
  assert.match(html, /aria-label="Preview reference photo 2"/);
});
