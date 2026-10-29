import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const PROVIDER_URL = 'https://provider.example/video.mp4';
const f = { upserts: [], uploads: [] };
f.client = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
  storage: { from: () => ({
    async upload(path) { f.uploads.push(path); return { error: f.uploadError || null }; },
    async createSignedUrl(path) { return { data: { signedUrl: `https://storage.example/${path}?token=t` }, error: null }; },
  }) },
  from(table) {
    assert.equal(table, 'generations');
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      async upsert(row) { f.upserts.push(row); return { error: null }; },
    };
    return query;
  },
};
globalThis.__videoSaveFixture = f;
const bundle = await build({ stdin: { contents: "export { saveVideo } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'video-save', setup(b) {
    b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, args => ({ path: args.path === 'tus-js-client' ? 'upload' : 'auth', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'upload' ? 'export class Upload {}' : `export const supabase=globalThis.__videoSaveFixture.client;
      export const getCurrentUserId=async()=>'user-1',SUPABASE_URL='https://example.invalid';` }));
  } }],
});
const { saveVideo } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const video = { id: 'video-1', url: PROVIDER_URL, prompt: 'A test video', mediaType: 'video', createdAt: 123 };

function setup(t, download) {
  Object.assign(f, { upserts: [], uploads: [], uploadError: null });
  t.mock.method(globalThis, 'fetch', async () => download());
  t.mock.method(console, 'warn', () => {});
}

const videoResponse = () => new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'content-type': 'video/mp4' } });

test('a completed video is saved with its durable storage path', async t => {
  setup(t, videoResponse);
  const saved = await saveVideo(video, 'user-1');
  assert.equal(saved.storagePath, 'user-1/video-1.mp4');
  assert.deepEqual(f.uploads, ['user-1/video-1.mp4']);
  assert.equal(f.upserts.length, 1);
  assert.equal(f.upserts[0].storage_path, 'user-1/video-1.mp4');
  assert.notEqual(f.upserts[0].url, PROVIDER_URL);
});

for (const [name, download] of [
  ['a failed download', () => new Response('Bad gateway', { status: 502 })],
  ['a network error', () => { throw new TypeError('fetch failed'); }],
]) {
  test(`${name} leaves the row untouched so the copy can be retried`, async t => {
    setup(t, download);
    assert.equal(await saveVideo(video, 'user-1'), undefined);
    assert.deepEqual(f.upserts, []);
  });
}

test('a failed storage upload does not save the expiring provider URL', async t => {
  setup(t, videoResponse);
  f.uploadError = { message: 'Upload rejected' };
  assert.equal(await saveVideo(video, 'user-1'), undefined);
  assert.deepEqual(f.upserts, []);

  // The caller's retry then saves the durable copy exactly once.
  f.uploadError = null;
  const saved = await saveVideo(video, 'user-1');
  assert.equal(saved?.storagePath, 'user-1/video-1.mp4');
  assert.equal(f.upserts.length, 1);
  assert.equal(f.upserts[0].storage_path, 'user-1/video-1.mp4');
  assert.notEqual(f.upserts[0].url, PROVIDER_URL);
});
