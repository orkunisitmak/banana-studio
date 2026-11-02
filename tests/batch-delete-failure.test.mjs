import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Run the real deleteImage, deleteImages and handleDeleteMultiple sources; only Supabase, the local queue/cache and the UI are faked.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const slice = (src, from, to) => { const i = src.indexOf(from); return src.slice(i, src.indexOf(to, i)); };
const storage = read('../src/services/storageService.ts');
const app = read('../src/App.tsx');
const code = transformSync(`module.exports = env => { const { supabase, bindMediaSession, MEDIA_BUCKET_NAME, getOriginalStoragePath, getThumbnailStoragePath, addPendingDeletion, removePendingDeletion, deleteImagesFromIndexedDb,
  generatedMedia, setGeneratedMedia, toast, deletedMediaIdsRef, describeMediaCount } = env;
${slice(storage, 'export const deleteImage = async', 'export const toggleFavorite').replaceAll('export const', 'const')}
const deleteImagesInApp = deleteImages;
${slice(app, '  const handleDeleteMultiple = async', '  const handleToggleFavorite').replace('await deleteImages(', 'await deleteImagesInApp(')}
return { deleteImage, deleteImages, handleDeleteMultiple }; };`, { loader: 'ts', format: 'cjs' }).code;

const items = ['a', 'b', 'c'].map(id => ({ id, mediaType: 'image' }));
// dbErrors: id -> message returned by Supabase, or an Error instance to make the call throw.
const setup = ({ userId = 'u1', dbErrors = {} } = {}) => {
  const mod = { exports: {} }; new Function('module', code)(mod);
  const log = { toasts: [], pending: [], unpending: [], local: [], removedFiles: [] };
  let list = items.slice();
  const supabase = {
    storage: { from: () => ({ remove: async paths => { log.removedFiles.push(...paths); } }) },
    from: () => ({ delete: () => ({ eq: async (_, id) => {
      const failure = dbErrors[id];
      if (failure instanceof Error) throw failure;
      return { error: failure ? { message: failure } : null };
    } }) }),
  };
  const env = {
    supabase, bindMediaSession: async () => userId, MEDIA_BUCKET_NAME: 'media',
    getOriginalStoragePath: id => `${id}.png`, getThumbnailStoragePath: id => `${id}-thumb.png`,
    addPendingDeletion: id => log.pending.push(id), removePendingDeletion: id => log.unpending.push(id),
    deleteImagesFromIndexedDb: async ids => { log.local.push(...ids); },
    generatedMedia: items, setGeneratedMedia: update => { list = update(list); },
    toast: { success: (t, m) => log.toasts.push(`success:${t}:${m}`), error: (t, m) => log.toasts.push(`error:${t}:${m}`) },
    deletedMediaIdsRef: { current: new Set() },
    describeMediaCount: (ids, media) => { const n = media.filter(m => new Set(ids).has(m.id)).length; return `${n} image${n === 1 ? '' : 's'}`; },
  };
  return { ...mod.exports(env), log, env, list: () => list.map(m => m.id) };
};
const quiet = async fn => { const original = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = original; } };

test('deleteImage queues a failed DB delete, still clears local storage, then rejects', async () => {
  const t = setup({ dbErrors: { a: 'permission denied' } });
  await assert.rejects(quiet(() => t.deleteImage(items[0])), /permission denied/);
  assert.deepEqual(t.log.pending, ['a']);
  assert.deepEqual(t.log.local, ['a']);
});

test('deleteImage queues a thrown DB error, still clears local storage, then rejects with it', async () => {
  const boom = new Error('network down');
  const t = setup({ dbErrors: { a: boom } });
  await assert.rejects(quiet(() => t.deleteImage(items[0])), err => err === boom);
  assert.deepEqual(t.log.pending, ['a']);
  assert.deepEqual(t.log.local, ['a']);
});

test('deleteImage resolves and dequeues when the DB delete works', async () => {
  const t = setup();
  await t.deleteImage(items[0]);
  assert.deepEqual(t.log.unpending, ['a']);
  assert.deepEqual(t.log.pending, []);
  assert.deepEqual(t.log.local, ['a']);
});

test('a not-authenticated delete is reported failed, restored, and never queued', async () => {
  const t = setup({ userId: null });
  assert.deepEqual((await quiet(() => t.deleteImages(items))).map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(t.log.pending, []);
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.deepEqual(t.list(), ['a', 'b', 'c']);
  assert.deepEqual([...t.env.deletedMediaIdsRef.current], []);
  assert.deepEqual(t.log.toasts, ['error:Delete Failed:2 images could not be deleted and are back in your library. Try again.']);
});

test('deleteImages returns only the items that failed after trying all of them', async () => {
  const t = setup({ dbErrors: { b: 'boom' } });
  const failed = await quiet(() => t.deleteImages(items));
  assert.deepEqual(failed.map(m => m.id), ['b']);
  assert.deepEqual(t.log.local, ['a', 'b', 'c']);
});

test('a mixed batch restores only the failed items in their old place', async () => {
  const t = setup({ dbErrors: { b: 'boom' } });
  await quiet(() => t.handleDeleteMultiple(['a', 'b', 'c']));
  assert.deepEqual(t.list(), ['b']);
  assert.deepEqual([...t.env.deletedMediaIdsRef.current].sort(), ['a', 'c']);
  assert.deepEqual(t.log.toasts, ['error:Delete Failed:1 image could not be deleted and is back in your library. Try again.']);
});

test('a batch where every delete works removes everything and reports success', async () => {
  const t = setup();
  await t.handleDeleteMultiple(['a', 'b']);
  assert.deepEqual(t.list(), ['c']);
  assert.deepEqual(t.log.toasts, ['success:Deleted:2 images removed.']);
});
