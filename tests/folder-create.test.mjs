import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { WorkspaceQuery } from '../desktop/shared/query.mjs';

const f = { error: null, reject: null, cacheError: null, hold: false, tx: null, inserts: [], cached: [], events: [] };
f.client = { from(table) {
  assert.equal(table, 'folders');
  return { async insert(row) {
    f.events.push('insert');
    f.inserts.push(row);
    if (f.reject) throw f.reject;
    return { error: f.error };
  } };
} };
globalThis.__folderFixture = f;
const bundle = await build({ stdin: { contents: "export { saveFolder } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'folder-create', setup(b) {
    b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, args => ({ path: args.path === 'tus-js-client' ? 'upload' : 'auth', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'upload' ? 'export class Upload {}' : `export const supabase=globalThis.__folderFixture.client;
      export const getCurrentUserId=async()=>'user-1',SUPABASE_URL='https://example.invalid';` }));
  } }],
});
const { saveFolder } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const folder = { id: 'folder-1', name: 'Example', createdAt: 123 };

function setup(t) {
  Object.assign(f, { error: null, reject: null, cacheError: null, hold: false, tx: null, inserts: [], cached: [], events: [] });
  const previous = globalThis.indexedDB;
  t.after(() => {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  });
  globalThis.indexedDB = { open(name) {
    assert.equal(name, 'NanoGenDB:user-1');
    f.events.push('open');
    const request = {};
    queueMicrotask(() => {
      if (f.cacheError === 'open') {
        request.error = new Error('Cache unavailable');
        request.onerror();
        return;
      }
      request.result = { transaction(store, mode) {
        assert.equal(store, 'folders');
        assert.equal(mode, 'readwrite');
        const tx = { objectStore: () => ({ put(value) {
          f.cached.push(value);
          queueMicrotask(() => {
            if (f.hold) return;
            if (f.cacheError) {
              tx.error = new Error('Cache write failed');
              if (f.cacheError === 'abort') tx.onabort?.();
              else tx.onerror?.();
            } else tx.oncomplete?.();
          });
        } }) };
        f.tx = tx;
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
}

for (const parentId of [undefined, 'parent-1']) {
  test(`folder creation saves the backend row before caching (parent: ${parentId ?? 'root'})`, async t => {
    setup(t);
    const value = { ...folder, parentId };
    await saveFolder(value);
    assert.deepEqual(f.inserts, [{ id: folder.id, user_id: 'user-1', name: folder.name, created_at: folder.createdAt, parent_id: parentId || null }]);
    assert.deepEqual(f.cached, [value]);
    assert.deepEqual(f.events, ['insert', 'open']);
  });
}

test('folder creation waits for the cache transaction to complete', async t => {
  setup(t);
  f.hold = true;
  let done = false;
  const saved = saveFolder(folder).then(() => { done = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.cached.length, 1);
  assert.equal(done, false);
  f.tx.oncomplete();
  await saved;
  assert.equal(done, true);
});

test('folder creation accepts the desktop workspace query result', async t => {
  setup(t);
  t.mock.method(f.client, 'from', table => new WorkspaceQuery(async plan => {
    assert.equal(plan.table, 'folders');
    assert.equal(plan.operation, 'insert');
    f.inserts.push(plan.value);
    return { data: [plan.value], error: null };
  }, table));
  await saveFolder(folder);
  assert.equal(f.inserts[0].user_id, 'user-1');
  assert.deepEqual(f.cached, [folder]);
});

test('a Supabase insert error rejects folder creation without opening the cache', async t => {
  setup(t);
  f.error = { message: 'Folder insert rejected' };
  await assert.rejects(saveFolder(folder), /Folder insert rejected/);
  assert.deepEqual(f.events, ['insert']);
  assert.deepEqual(f.cached, []);
});

test('a rejected insert request propagates without opening the cache', async t => {
  setup(t);
  f.reject = new Error('Network unavailable');
  await assert.rejects(saveFolder(folder), error => error === f.reject);
  assert.deepEqual(f.events, ['insert']);
  assert.deepEqual(f.cached, []);
});

for (const failure of ['open', 'error', 'abort']) {
  test(`a cache ${failure} failure does not reject an already saved folder`, async t => {
    setup(t);
    f.cacheError = failure;
    const warn = t.mock.method(console, 'warn', () => {});
    await assert.doesNotReject(saveFolder(folder));
    assert.equal(f.inserts.length, 1);
    assert.equal(warn.mock.callCount(), 1);
  });
}
