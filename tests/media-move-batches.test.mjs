import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real moveImagesToFolder with a fake Supabase client and IndexedDB cache.
const f = { updates: [], failAt: -1, cached: [] };
f.client = { from(table) {
  assert.equal(table, 'generations');
  return { update(values) {
    const call = { values, filters: {} };
    const query = {
      eq(column, value) { call.filters[column] = value; return query; },
      in(column, ids) {
        call.filters[column] = ids;
        const failed = f.updates.length === f.failAt;
        f.updates.push(call);
        return Promise.resolve({ error: failed ? { message: 'URI too long' } : null });
      },
    };
    return query;
  } };
} };
globalThis.__moveFixture = f;
const bundle = await build({ stdin: { contents: "export { moveImagesToFolder, MoveImagesError } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{ name: 'media-move', setup(b) {
    b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, args => ({ path: args.path === 'tus-js-client' ? 'upload' : 'auth', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'upload' ? 'export class Upload {}' : `export const supabase=globalThis.__moveFixture.client;
      export const getCurrentUserId=async()=>'user-1',SUPABASE_URL='https://example.invalid';` }));
  } }],
});
const { moveImagesToFolder, MoveImagesError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const ids = Array.from({ length: 250 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

function setup(t, failAt = -1) {
  Object.assign(f, { updates: [], failAt, cached: [] });
  const previous = globalThis.indexedDB;
  t.after(() => {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  });
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { transaction() {
        let pending = 0;
        const tx = { objectStore: () => ({
          get(id) {
            pending++;
            const get = {};
            queueMicrotask(() => { get.result = { id, folderId: null }; get.onsuccess?.(); if (--pending === 0) tx.oncomplete?.(); });
            return get;
          },
          put(value) { f.cached.push(value); },
        }) };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
}

test('moving a large selection splits the ID filter into bounded batches', async t => {
  setup(t);
  await moveImagesToFolder(ids, 'folder-1');
  assert.deepEqual(f.updates.map(call => call.filters.id.length), [100, 100, 50]);
  assert.deepEqual(f.updates.flatMap(call => call.filters.id), ids);
  for (const call of f.updates) {
    assert.deepEqual(call.values, { folder_id: 'folder-1' });
    assert.equal(call.filters.user_id, 'user-1');
  }
  assert.deepEqual(f.cached.map(item => item.id), ids);
});

test('a failed later batch reports and caches only the media that moved', async t => {
  setup(t, 1);
  const error = await moveImagesToFolder(ids, 'folder-1').then(() => null, error => error);
  assert.ok(error instanceof MoveImagesError);
  assert.deepEqual(error.movedIds, ids.slice(0, 100));
  assert.equal(f.updates.length, 2);
  assert.deepEqual(f.cached.map(item => item.id), ids.slice(0, 100));
});

test('a failed first batch moves nothing', async t => {
  setup(t, 0);
  const error = await moveImagesToFolder(ids, 'folder-1').then(() => null, error => error);
  assert.ok(error instanceof Error && !(error instanceof MoveImagesError));
  assert.match(error.message, /Media could not be moved/);
  assert.deepEqual(f.cached, []);
});
