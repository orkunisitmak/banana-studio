import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/gallery/batchDownload.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { collectBatchDownload, describeBatchDownloadFailure } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const media = [
  { id: 'a', url: 'https://cdn/a', mediaType: 'image' },
  { id: 'b', url: 'https://cdn/expired', mediaType: 'image' },
  { id: 'v', url: 'https://cdn/v', mediaType: 'video' },
];
const fetcher = async url => url.endsWith('expired')
  ? new Response('{"error":"InvalidJWT"}', { status: 400 })
  : new Response(new Blob(['x'], { type: url.endsWith('/v') ? 'video/mp4' : 'image/jpeg' }));

test('one failed item no longer cancels the rest of the ZIP', async () => {
  const { files, failed } = await collectBatchDownload(['a', 'b', 'v'], media, fetcher);
  assert.deepEqual(files.map(file => file.name), ['banana-a.jpg', 'banana-v.mp4']);
  assert.equal(failed, 1);
  // The error body is never packed as a media file.
  assert.ok(files.every(file => file.blob.size === 1));
});

test('items missing from the loaded list count as failed', async () => {
  const { files, failed } = await collectBatchDownload(['a', 'gone'], media, fetcher);
  assert.deepEqual([files.length, failed], [1, 1]);
  assert.deepEqual(await collectBatchDownload(['a'], media, async () => { throw new TypeError('Failed to fetch'); }).then(r => [r.files.length, r.failed]), [0, 1]);
});

test('a 200 JSON error page is excluded from the ZIP without dropping valid media', async () => {
  const { files, failed } = await collectBatchDownload(['a', 'b'], media, async url => url.endsWith('/expired')
    ? new Response('{"error":"expired"}', { headers: { 'content-type': 'application/problem+json' } })
    : new Response(new Blob(['image'], { type: 'image/png' })));
  assert.deepEqual(files.map(file => file.name), ['banana-a.png']);
  assert.equal(failed, 1);
});

test('legacy JSON/XML error types fail while a mislabeled PNG stays in the ZIP', async () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0);
  const { files, failed } = await collectBatchDownload(['a', 'b', 'v'], media, async url => url.endsWith('/a')
    ? new Response(png, { headers: { 'content-type': 'text/plain' } })
    : new Response('error', { headers: { 'content-type': url.endsWith('/v') ? 'application/x-xml' : 'application/x-json' } }));
  assert.deepEqual(files.map(file => [file.name, file.blob.type]), [['banana-a.png', 'image/png']]);
  assert.equal(failed, 2);
});

test('the notice says how many items are missing', () => {
  assert.equal(describeBatchDownloadFailure(1, 3), '1 of 3 items could not be downloaded. The ZIP contains the other 2. Your selection is kept so you can try again.');
  assert.equal(describeBatchDownloadFailure(3, 3), 'None of the 3 selected items could be downloaded. Try again.');
  assert.equal(describeBatchDownloadFailure(1, 1), 'The selected item could not be downloaded. Try again.');
});

test('expired image URLs are renewed before the ZIP fetch, as single downloads do', async () => {
  const signed = [
    { id: 'a', url: 'https://s/a.png?token=expired', mediaType: 'image' },
    { id: 'v', url: 'https://s/v.mp4?token=current', mediaType: 'video' },
  ];
  const fetched = [], refreshed = [];
  const fetchSigned = async url => { fetched.push(url); return url.includes('token=expired')
    ? new Response('expired', { status: 400 })
    : new Response(new Blob(['x'], { type: url.includes('.mp4') ? 'video/mp4' : 'image/png' })); };
  const { files, failed } = await collectBatchDownload(['a', 'v'], signed, fetchSigned,
    async url => { refreshed.push(url); return url.replace('token=expired', 'token=renewed'); });
  assert.deepEqual(files.map(file => file.name), ['banana-a.png', 'banana-v.mp4']);
  assert.equal(failed, 0);
  assert.deepEqual(refreshed, ['https://s/a.png?token=expired']);
  assert.deepEqual(fetched.sort(), ['https://s/a.png?token=renewed', 'https://s/v.mp4?token=current']);

  // If renewal fails, the loaded URL is still tried.
  fetched.length = 0;
  const fallback = await collectBatchDownload(['a'], signed, fetchSigned, async () => { throw new Error('offline'); });
  assert.deepEqual([fetched, fallback.failed], [['https://s/a.png?token=expired'], 1]);
});

test('the gallery batch download passes the signed URL renewer', () => {
  const gallery = readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
  assert.match(gallery, /collectBatchDownload\(Array\.from\(selectedIds\), images, undefined, url => refreshMediaAccessUrl\(url, false\)\)/);
});
