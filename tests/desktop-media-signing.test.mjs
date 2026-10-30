import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: ['desktop/shared/browserClient.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true,
  write: false, format: 'esm', platform: 'node' });
const { createLocalWorkspaceClient } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function fixture(t, result) {
  const oldLocation = globalThis.location;
  globalThis.location = { origin: 'http://127.0.0.1:12345' };
  t.after(() => {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/local/query');
    assert.equal(options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(options.body), { storage: 'stat', paths: ['refs/a b.png', 'refs/missing.png'] });
    return Response.json(result());
  });
  return createLocalWorkspaceClient({ userId: 'user', sessionId: 'session' }).storage.from('media');
}

const paths = ['refs/a b.png', 'refs/missing.png'];
test('batch signing preserves a workspace error instead of reporting every file missing', async t => {
  const error = { code: 'LOCAL_VALIDATION', message: 'Local workspace operation could not be completed.' };
  const storage = fixture(t, () => ({ data: null, error }));
  assert.deepEqual(await storage.createSignedUrls(paths), { data: null, error });
});

test('batch signing retains per-file existence results and encoded local URLs', async t => {
  const storage = fixture(t, () => ({ data: [{ exists: true }, { exists: false }], error: null }));
  assert.deepEqual(await storage.createSignedUrls(paths), { data: [
    { path: paths[0], signedUrl: 'http://127.0.0.1:12345/storage/v1/object/authenticated/media/refs/a%20b.png', error: null },
    { path: paths[1], signedUrl: '', error: 'Not found' },
  ], error: null });
});

test('the same batch signer can retry after a workspace failure', async t => {
  let failed = true;
  const storage = fixture(t, () => failed ? { data: null, error: { message: 'Temporary failure' } }
    : { data: [{ exists: true }, { exists: true }], error: null });
  assert.ok((await storage.createSignedUrls(paths)).error);
  failed = false;
  const recovered = await storage.createSignedUrls(paths);
  assert.equal(recovered.error, null);
  assert.ok(recovered.data.every(entry => entry.signedUrl && entry.error === null));
});
