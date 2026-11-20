import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Without Supabase, getImageById reads the account's IndexedDB cache directly.
const bundle = await build({ stdin: { contents: "export { getImageById } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'idb-reuse', setup(b) {
    b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, args => ({ path: args.path === 'tus-js-client' ? 'upload' : 'auth', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'upload' ? 'export class Upload {}'
      : "export const supabase=null;export const getCurrentUserId=async()=>null,SUPABASE_URL='https://example.invalid';" }));
  } }],
});
const { getImageById } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fakeIndexedDB(t) {
  // fail: 'async' fires onerror, 'sync' throws from open(); either applies to the next open only.
  const state = { opens: 0, connections: [], fail: null };
  const previous = globalThis.indexedDB;
  t.after(() => { if (previous === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous; });
  globalThis.indexedDB = { open() {
    state.opens++;
    const fail = state.fail;
    state.fail = null;
    if (fail === 'sync') throw new Error('SecurityError');
    const request = {};
    queueMicrotask(() => {
      if (fail === 'async') {
        request.error = new Error('Open failed');
        request.onerror();
        return;
      }
      const db = { closed: false, close() { this.closed = true; }, transaction: () => ({ objectStore: () => ({ get(id) {
        const read = {};
        queueMicrotask(() => { read.result = { id, prompt: 'cached' }; read.onsuccess(); });
        return read;
      } }) }) };
      state.connections.push(db);
      request.result = db;
      request.onsuccess();
    });
    return request;
  } };
  return state;
}

test('repeated and concurrent cache reads share one IndexedDB connection', async t => {
  const state = fakeIndexedDB(t);
  const results = await Promise.all(['a', 'b', 'c', 'd'].map(id => getImageById(id)));
  for (const id of ['e', 'f']) results.push(await getImageById(id));
  assert.deepEqual(results.map(media => media?.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(state.opens, 1);
});

test('a connection closed by a version change is reopened on the next read', async t => {
  const state = fakeIndexedDB(t);
  await getImageById('a');
  assert.equal(state.opens, 1);
  state.connections[0].onversionchange();
  assert.equal(state.connections[0].closed, true);
  assert.equal((await getImageById('b'))?.id, 'b');
  assert.equal(state.opens, 2);
});

test('a failed open, async or thrown, is not cached and the next read retries', async t => {
  const state = fakeIndexedDB(t);
  state.fail = 'async';
  assert.equal(await getImageById('a'), null);
  state.fail = 'sync';
  assert.equal(await getImageById('b'), null);
  assert.equal((await getImageById('c'))?.id, 'c');
  assert.equal(state.opens, 3);
});

test('a connection closed unexpectedly is reopened on the next read', async t => {
  const state = fakeIndexedDB(t);
  await getImageById('a');
  state.connections[0].onclose();
  assert.equal((await getImageById('b'))?.id, 'b');
  assert.equal(state.opens, 2);
});
