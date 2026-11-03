import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/references/referenceUploadCache.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { createReferenceUploader } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const setup = origin => {
  if (origin) globalThis.location = { origin }; else delete globalThis.location;
  const uploaded = [], refreshed = [];
  const send = createReferenceUploader(async data => { uploaded.push(data); return 'uploaded-url'; }, async url => { refreshed.push(url); return `signed:${url}`; });
  return { send: data => send(data, 'image/png', 'openai_ref', 'u1'), uploaded, refreshed };
};

test('desktop workspace media URLs are signed, not uploaded as base64', async () => {
  const desktop = setup('http://127.0.0.1:4321');
  const stored = 'http://127.0.0.1:4321/storage/v1/object/authenticated/media/u1/a.png';
  assert.equal(await desktop.send(stored), `signed:${stored}`);
  assert.deepEqual(desktop.uploaded, []);
});

test('only stored media on the page origin skips the upload', async () => {
  const desktop = setup('http://127.0.0.1:4321');
  await desktop.send('http://127.0.0.1:9999/storage/v1/object/authenticated/media/u1/a.png');
  await desktop.send('http://127.0.0.1:4321/other/a.png');
  await desktop.send('aGVsbG8=');
  assert.deepEqual(desktop.refreshed, []);
  assert.equal(desktop.uploaded.length, 3);
  const hosted = setup('https://studio.example');
  assert.equal(await hosted.send('https://project.supabase.co/storage/v1/object/public/media/u1/a.png'), 'signed:https://project.supabase.co/storage/v1/object/public/media/u1/a.png');
  const noPage = setup();
  await noPage.send('http://127.0.0.1:4321/storage/v1/object/authenticated/media/u1/a.png');
  assert.deepEqual([noPage.refreshed.length, noPage.uploaded.length], [0, 1]);
});
