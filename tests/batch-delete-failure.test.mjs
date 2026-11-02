import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Run the real deleteImage, deleteImages, handleDelete and handleDeleteMultiple sources;
// only Supabase, the pending-deletion queue, IndexedDB opening and the UI are faked.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const slice = (src, from, to) => { const i = src.indexOf(from); return src.slice(i, src.indexOf(to, i)); };
const storage = read('../src/services/storageService.ts');
const app = read('../src/App.tsx');
const code = transformSync(`module.exports = env => { const { supabase, bindMediaSession, MEDIA_BUCKET_NAME, STORE_NAME, openDB, getOriginalStoragePath, getThumbnailStoragePath, addPendingDeletion, removePendingDeletion,
  generatedMedia, setGeneratedMedia, toast, deletedMediaIdsRef, describeMediaCount } = env;
${slice(storage, 'const deleteImagesFromIndexedDb', 'const clearImagesFromIndexedDb')}
${slice(storage, '/** The delete never ran', 'export const toggleFavorite').replaceAll('export ', '')}
const workspaceStorage = { DeleteNotQueuedError };
${slice(app, '  // Put items whose delete never ran', '  const handleToggleFavorite')}
return { deleteImage, deleteImages, handleDelete, handleDeleteMultiple, DeleteNotQueuedError }; };`, { loader: 'ts', format: 'cjs' }).code;

const items = ['a', 'b', 'c'].map(id => ({ id, mediaType: 'image' }));
// dbErrors: id -> message returned by Supabase, or an Error instance to make the call throw.
// signedOutCalls: which deleteImage calls (0-based, in call order) find no session.
const setup = ({ signedOutCalls = [], dbErrors = {}, indexedDbBroken = false } = {}) => {
  const mod = { exports: {} }; new Function('module', code)(mod);
  const log = { toasts: [], pending: [], unpending: [], idbDeleted: [] };
  let list = items.slice(), calls = 0;
  const supabase = {
    storage: { from: () => ({ remove: async () => {} }) },
    from: () => ({ delete: () => ({ eq: async (_, id) => {
      const failure = dbErrors[id];
      if (failure instanceof Error) throw failure;
      return { error: failure ? { message: failure } : null };
    } }) }),
  };
  const store = { delete: id => log.idbDeleted.push(id) };
  const env = {
    supabase, bindMediaSession: async () => (signedOutCalls.includes(calls++) ? null : 'u1'), MEDIA_BUCKET_NAME: 'media', STORE_NAME: 'media',
    openDB: async () => {
      if (indexedDbBroken) throw new Error('IndexedDB unavailable');
      return { transaction: () => { const tx = { objectStore: () => store }; setTimeout(() => tx.oncomplete()); return tx; } };
    },
    getOriginalStoragePath: id => `${id}.png`, getThumbnailStoragePath: id => `${id}-thumb.png`,
    addPendingDeletion: id => log.pending.push(id), removePendingDeletion: id => log.unpending.push(id),
    generatedMedia: items, setGeneratedMedia: update => { list = update(list); },
    toast: { success: (t, m) => log.toasts.push(`success:${t}:${m}`), error: (t, m) => log.toasts.push(`error:${t}:${m}`) },
    deletedMediaIdsRef: { current: new Set() },
    describeMediaCount: (ids, media) => { const n = media.filter(m => new Set(ids).has(m.id)).length; return `${n} image${n === 1 ? '' : 's'}`; },
  };
  return { ...mod.exports(env), log, env, list: () => list.map(m => m.id), marked: () => [...env.deletedMediaIdsRef.current].sort() };
};
const quiet = async fn => { const original = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = original; } };
const ids = list => list.map(m => m.id);

test('deleteImage queues a returned DB error, clears the local copy, then rejects', async () => {
  const t = setup({ dbErrors: { a: 'permission denied' } });
  await assert.rejects(quiet(() => t.deleteImage(items[0])), err => /permission denied/.test(err.message) && !(err instanceof t.DeleteNotQueuedError));
  assert.deepEqual(t.log.pending, ['a']);
  assert.deepEqual(t.log.idbDeleted, ['a']);
});

test('deleteImage queues a thrown DB error, clears the local copy, then rejects with it', async () => {
  const boom = new Error('network down');
  const t = setup({ dbErrors: { a: boom } });
  await assert.rejects(quiet(() => t.deleteImage(items[0])), err => err === boom);
  assert.deepEqual(t.log.pending, ['a']);
  assert.deepEqual(t.log.idbDeleted, ['a']);
});

test('deleteImage with no session rejects as not queued and queues nothing', async () => {
  const t = setup({ signedOutCalls: [0] });
  await assert.rejects(t.deleteImage(items[0]), err => err instanceof t.DeleteNotQueuedError);
  assert.deepEqual(t.log.pending, []);
});

test('deleteImage resolves when the server delete worked but the local cleanup failed', async () => {
  const t = setup({ indexedDbBroken: true });
  await quiet(() => t.deleteImage(items[0]));
  assert.deepEqual(t.log.unpending, ['a']);
  assert.deepEqual(t.log.pending, []);
});

test('a local cleanup failure does not hide a DB error', async () => {
  const t = setup({ indexedDbBroken: true, dbErrors: { a: 'boom' } });
  await assert.rejects(quiet(() => t.deleteImage(items[0])), /boom/);
  assert.deepEqual(t.log.pending, ['a']);
});

test('deleteImages splits failures into not queued and queued, and ignores local cleanup failures', async () => {
  const t = setup({ signedOutCalls: [0], dbErrors: { b: 'boom' }, indexedDbBroken: true });
  const result = await quiet(() => t.deleteImages(items));
  assert.deepEqual([ids(result.notQueued), ids(result.queued)], [['a'], ['b']]);
  assert.deepEqual(t.log.pending, ['b']);
});

test('a signed-out batch restores every item, clears its mark, and says it was not deleted', async () => {
  const t = setup({ signedOutCalls: [0, 1] });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.deepEqual(t.list(), ['a', 'b', 'c']);
  assert.deepEqual(t.marked(), []);
  assert.deepEqual(t.log.toasts, ['error:Delete Failed:2 images could not be deleted and are back in your library. Try again.']);
});

test('a batch of queued DB failures stays off the list and promises the retry', async () => {
  const t = setup({ dbErrors: { a: 'boom', b: 'boom' } });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.deepEqual(t.list(), ['c']);
  assert.deepEqual(t.marked(), ['a', 'b']);
  assert.deepEqual(t.log.toasts, ['error:Delete Failed:2 images could not be fully deleted. They will be retried automatically.']);
});

test('a mixed batch restores only the not-queued item and words each group correctly', async () => {
  const t = setup({ signedOutCalls: [0], dbErrors: { b: 'boom' } });
  await quiet(() => t.handleDeleteMultiple(['a', 'b', 'c']));
  assert.deepEqual(t.list(), ['a']);
  assert.deepEqual(t.marked(), ['b', 'c']);
  assert.deepEqual(t.log.toasts, ['error:Delete Failed:1 image could not be deleted and is back in your library. Try again. 1 image could not be fully deleted. It will be retried automatically.']);
});

test('a batch where every delete works, even with broken local storage, reports success', async () => {
  const t = setup({ indexedDbBroken: true });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.deepEqual(t.list(), ['c']);
  assert.deepEqual(t.log.toasts, ['success:Deleted:2 images removed.']);
});

test('single delete with no session puts the item back where it was', async () => {
  const t = setup({ signedOutCalls: [0] });
  await quiet(() => t.handleDelete(items[1]));
  assert.deepEqual(t.list(), ['a', 'b', 'c']);
  assert.deepEqual(t.marked(), []);
  assert.deepEqual(t.log.toasts, ['error:Delete Failed:The image could not be deleted and is back in your library. Try again.']);
});

test('single delete with a queued DB failure stays off the list and promises the retry', async () => {
  const t = setup({ dbErrors: { b: 'boom' } });
  await quiet(() => t.handleDelete(items[1]));
  assert.deepEqual(t.list(), ['a', 'c']);
  assert.deepEqual(t.log.toasts, ['error:Delete Failed:Could not fully delete the image. It will be retried automatically.']);
});
