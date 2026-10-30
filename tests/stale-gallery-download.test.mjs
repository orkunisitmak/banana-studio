import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mediaDownload = await build({
  entryPoints: ['src/lib/gallery/mediaDownload.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { fetchMediaBlob } = await import(`data:text/javascript;base64,${Buffer.from(mediaDownload.outputFiles[0].text).toString('base64')}`);

const source = readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleDownloadPNG = async');
const end = source.indexOf('  const handleDownloadClick', start);
assert.ok(start >= 0 && end > start);
const compiled = transformSync(`module.exports = env => {
  const { fetchMediaBlob, refreshMediaAccessUrl, Image, URL, document, setDownloadError, setDownloadMenuId, failDownload, setTimeout, console } = env;
  ${source.slice(start, end)}
  return { handleDownloadPNG, handleDownloadJPEG };
};`, { loader: 'ts', format: 'cjs' }).code;

const createDownloads = ({ failRefresh = false } = {}) => {
  const fetched = [], refreshed = [], errors = [], downloads = [], revoked = [];
  let objectUrl = 0;
  const context = { fillStyle: '', fillRect() {}, drawImage() {} };
  const canvas = {
    getContext: () => context,
    toBlob(callback) { callback(new Blob(['jpeg'], { type: 'image/jpeg' })); },
  };
  const module = { exports: {} };
  new Function('module', compiled)(module);
  const handlers = module.exports({
    fetchMediaBlob: async url => {
      fetched.push(url);
      return fetchMediaBlob(url);
    },
    refreshMediaAccessUrl: async url => {
      refreshed.push(url);
      if (failRefresh) throw new Error('Signed URL renewal temporarily failed');
      return url.replace('token=expired', 'token=renewed');
    },
    Image: class {
      naturalWidth = 640;
      naturalHeight = 480;
      set src(value) { this.url = value; queueMicrotask(() => this.onload()); }
    },
    URL: {
      createObjectURL: () => `blob:fixture-${objectUrl++}`,
      revokeObjectURL: url => revoked.push(url),
    },
    document: {
      createElement: tag => tag === 'canvas' ? canvas : {
        click() { downloads.push({ href: this.href, name: this.download }); },
      },
      body: { appendChild() {}, removeChild() {} },
    },
    setDownloadError: (_error) => {},
    setDownloadMenuId: () => {},
    failDownload: (_media, error) => errors.push(error),
    setTimeout: () => {},
    console: { error() {} },
  });
  return { ...handlers, fetched, refreshed, errors, downloads, revoked };
};

test('single-image PNG and JPEG downloads refresh expired signed URLs first', async t => {
  const responses = new Map([
    ['https://project.example/storage/v1/object/sign/media/user/image.png?token=expired', new Response('expired', { status: 400 })],
    ['https://project.example/storage/v1/object/sign/media/user/image.png?token=renewed', new Response(new Blob(['png'], { type: 'image/png' }))],
    ['https://project.example/storage/v1/object/sign/media/user/photo.jpg?token=expired', new Response('expired', { status: 400 })],
    ['https://project.example/storage/v1/object/sign/media/user/photo.jpg?token=renewed', new Response(new Blob(['png'], { type: 'image/png' }))],
  ]);
  t.mock.method(globalThis, 'fetch', async url => {
    const response = responses.get(String(url));
    assert.ok(response, `unexpected download URL: ${url}`);
    return response;
  });
  const ui = createDownloads();
  const pngUrl = 'https://project.example/storage/v1/object/sign/media/user/image.png?token=expired';
  const jpegUrl = 'https://project.example/storage/v1/object/sign/media/user/photo.jpg?token=expired';

  await ui.handleDownloadPNG({ id: 'image', url: pngUrl, mediaType: 'image' });
  await ui.handleDownloadJPEG({ id: 'photo', url: jpegUrl, mediaType: 'image' });

  assert.deepEqual(ui.refreshed, [pngUrl, jpegUrl]);
  assert.deepEqual(ui.fetched, [pngUrl.replace('expired', 'renewed'), jpegUrl.replace('expired', 'renewed')]);
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(ui.downloads.map(download => download.name), ['banana-image.png', 'banana-photo.jpg']);
});

test('single-image downloads use the original URL if renewal fails but that URL still works', async t => {
  const pngUrl = 'https://project.example/storage/v1/object/sign/media/user/image.png?token=current';
  const jpegUrl = 'https://project.example/storage/v1/object/sign/media/user/photo.jpg?token=current';
  const responses = new Map([
    [pngUrl, new Response(new Blob(['png'], { type: 'image/png' }))],
    [jpegUrl, new Response(new Blob(['png'], { type: 'image/png' }))],
  ]);
  t.mock.method(globalThis, 'fetch', async url => {
    const response = responses.get(String(url));
    assert.ok(response, `unexpected download URL: ${url}`);
    return response;
  });
  const ui = createDownloads({ failRefresh: true });

  await ui.handleDownloadPNG({ id: 'image', url: pngUrl, mediaType: 'image' });
  await ui.handleDownloadJPEG({ id: 'photo', url: jpegUrl, mediaType: 'image' });

  assert.deepEqual(ui.refreshed, [pngUrl, jpegUrl]);
  assert.deepEqual(ui.fetched, [pngUrl, jpegUrl]);
  assert.deepEqual(ui.errors, []);
  assert.deepEqual(ui.downloads.map(download => download.name), ['banana-image.png', 'banana-photo.jpg']);
});

test('single-image downloads keep the download error when both renewal and the original URL fail', async t => {
  const pngUrl = 'https://project.example/storage/v1/object/sign/media/user/image.png?token=expired';
  const jpegUrl = 'https://project.example/storage/v1/object/sign/media/user/photo.jpg?token=expired';
  const responses = new Map([
    [pngUrl, new Response('expired', { status: 400 })],
    [jpegUrl, new Response('expired', { status: 400 })],
  ]);
  t.mock.method(globalThis, 'fetch', async url => {
    const response = responses.get(String(url));
    assert.ok(response, `unexpected download URL: ${url}`);
    return response;
  });
  const ui = createDownloads({ failRefresh: true });

  await ui.handleDownloadPNG({ id: 'image', url: pngUrl, mediaType: 'image' });
  await ui.handleDownloadJPEG({ id: 'photo', url: jpegUrl, mediaType: 'image' });

  assert.deepEqual(ui.fetched, [pngUrl, jpegUrl]);
  assert.equal(ui.errors.length, 2);
  assert.ok(ui.errors.every(error => error.message === 'Download failed (400). Reload the gallery and try again.'));
  assert.deepEqual(ui.downloads, []);
});
