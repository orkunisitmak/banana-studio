import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Exercise the actual Gallery handler with browser APIs replaced by local fakes.
const source = readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleDownloadJPEG = async');
const end = source.indexOf('  const handleDownloadClick', start);
assert.ok(start >= 0 && end > start);
const compiled = transformSync(`module.exports = env => {
  const { fetchMediaBlob, refreshMediaAccessUrl, Image, URL, document, setDownloadError, setDownloadMenuId, failDownload, setTimeout, console } = env;
  ${source.slice(start, end)}
  return handleDownloadJPEG;
};`, { loader: 'ts', format: 'cjs' }).code;

const setup = ({ decodeFails = false, contextFails = false } = {}) => {
  const errors = [], urls = [], revoked = [], downloads = [], menu = [], timers = [];
  let encode, encoding;
  const ready = new Promise(resolve => { encoding = resolve; });
  const context = { fillStyle: '', fillRect() {}, drawImage() {} };
  const canvas = {
    getContext: () => contextFails ? null : context,
    toBlob(callback, type, quality) { encode = callback; encoding({ type, quality }); },
  };
  const mod = { exports: {} };
  new Function('module', compiled)(mod);
  const handler = mod.exports({
    fetchMediaBlob: async () => new Blob(['source'], { type: 'image/png' }),
    refreshMediaAccessUrl: async url => url,
    Image: class {
      naturalWidth = 640;
      naturalHeight = 480;
      set src(value) { this.url = value; queueMicrotask(() => decodeFails ? this.onerror(new Error('Decode failed')) : this.onload()); }
      get src() { return this.url; }
    },
    URL: {
      createObjectURL(blob) { const url = `blob:fixture-${urls.length}`; urls.push({ url, blob }); return url; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    document: {
      createElement: tag => tag === 'canvas' ? canvas : {
        click() { downloads.push({ href: this.href, name: this.download }); },
      },
      body: { appendChild() {}, removeChild() {} },
    },
    setDownloadError() {},
    setDownloadMenuId: value => menu.push(value),
    failDownload: (media, error) => errors.push({ media, error }),
    setTimeout: callback => timers.push(callback),
    console: { error() {} },
  });
  return { handler, ready, finish: blob => encode(blob), errors, urls, revoked, downloads, menu, timers, canvas, context };
};
const media = { id: 'fixture', url: 'https://example.test/image.png' };

test('a failed JPEG encoder reaches the existing download error handler', async () => {
  const ui = setup();
  const pending = ui.handler(media);
  await ui.ready;
  ui.finish(null);
  await pending;
  assert.equal(ui.errors.length, 1);
  assert.equal(ui.errors[0].media, media);
  assert.match(ui.errors[0].error.message, /JPEG conversion failed/);
  assert.deepEqual(ui.downloads, []);
  assert.deepEqual(ui.menu, []);
  assert.deepEqual(ui.revoked, ['blob:fixture-0']);
});

test('JPEG download waits for encoding and preserves filename, dimensions and quality', async () => {
  const ui = setup();
  let settled = false;
  const pending = ui.handler(media).then(() => { settled = true; });
  assert.deepEqual(await ui.ready, { type: 'image/jpeg', quality: 1 });
  await Promise.resolve();
  assert.equal(settled, false);
  const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
  ui.finish(jpeg);
  await pending;
  assert.equal(ui.urls[1].blob, jpeg);
  assert.deepEqual(ui.downloads, [{ href: 'blob:fixture-1', name: 'banana-fixture.jpg' }]);
  assert.deepEqual([ui.canvas.width, ui.canvas.height, ui.context.fillStyle], [640, 480, '#FFFFFF']);
  assert.deepEqual(ui.menu, [null]);
  assert.deepEqual(ui.errors, []);
  ui.timers.forEach(run => run());
  assert.deepEqual(ui.revoked.sort(), ['blob:fixture-0', 'blob:fixture-1']);
});

test('failed image decoding or canvas setup releases the source object URL', async () => {
  for (const options of [{ decodeFails: true }, { contextFails: true }]) {
    const ui = setup(options);
    await ui.handler(media);
    assert.equal(ui.errors.length, 1);
    assert.deepEqual(ui.downloads, []);
    assert.deepEqual(ui.revoked, ['blob:fixture-0']);
  }
});
