import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/gallery/mediaDownload.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { fetchMediaBlob, shouldOpenDownloadFallback } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('an HTTP error is reported instead of saved or opened in a new tab', async () => {
  const error = await fetchMediaBlob('https://cdn/expired', async () => new Response('{"error":"InvalidJWT"}', { status: 400 })).catch(error => error);
  assert.equal(error.message, 'Download failed (400). Reload the gallery and try again.');
  assert.equal(shouldOpenDownloadFallback(error), false);
});

test('a working download returns the file, and request failures keep the new-tab fallback', async () => {
  const blob = await fetchMediaBlob('https://cdn/a', async () => new Response(new Blob(['png'], { type: 'image/png' })));
  assert.deepEqual([blob.type, blob.size], ['image/png', 3]);
  const networkError = await fetchMediaBlob('https://cdn/a', async () => { throw new TypeError('Failed to fetch'); }).catch(error => error);
  assert.equal(shouldOpenDownloadFallback(networkError), true);
  // Decoding or canvas failures while converting to JPEG also keep the fallback.
  assert.equal(shouldOpenDownloadFallback(new Error('Canvas context failed')), true);
});

test('a successful status with an HTML page is not saved or opened as media', async () => {
  const error = await fetchMediaBlob('https://cdn/login', async () => new Response('<html>Sign in</html>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })).catch(error => error);
  assert.match(error.message, /page instead of media/);
  assert.equal(shouldOpenDownloadFallback(error), false);
});

test('a mislabeled JPEG keeps its bytes and correct extension', async () => {
  const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 1);
  const blob = await fetchMediaBlob('https://cdn/photo', async () => new Response(bytes, {
    headers: { 'content-type': 'text/plain' },
  }));
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});
