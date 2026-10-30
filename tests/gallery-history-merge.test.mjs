import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/lib/gallery/galleryHistoryMerge.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { mergeLoadedGalleryHistory, recordGalleryHistoryMutation } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const row = (id, extra = {}) => ({ id, createdAt: 1, url: 'old', isFavorite: false, folderId: null, ...extra });
const snapshot = () => ({ patches: new Map(), additions: new Set(), deletedIds: new Set(), discardLoaded: false });

test('late history pages retain deletes, favorites and moves on older cards', () => {
  let load = snapshot();
  const initial = mergeLoadedGalleryHistory([], [row('deleted'), row('favorite'), row('moved')], load);
  const edited = initial.filter(item => item.id !== 'deleted').map(item => ({ ...item,
    ...(item.id === 'favorite' ? { isFavorite: true } : {}), ...(item.id === 'moved' ? { folderId: 'new' } : {}) }));
  load = recordGalleryHistoryMutation(initial, edited, load);
  const result = mergeLoadedGalleryHistory(edited, [row('deleted'), row('favorite'), row('moved'), row('older')], load);
  assert.deepEqual(result.map(item => item.id), ['favorite', 'moved', 'older']);
  assert.equal(result.find(item => item.id === 'favorite').isFavorite, true);
  assert.equal(result.find(item => item.id === 'moved').folderId, 'new');
  assert.equal(mergeLoadedGalleryHistory(result, [row('deleted'), row('favorite'), row('moved')], load).find(item => item.id === 'favorite').isFavorite, true);
});

test('only changed fields win so stale preexisting status and URLs hydrate', () => {
  const load = snapshot();
  const first = mergeLoadedGalleryHistory([], [row('a', { status: 'pending' })], load);
  const edited = [{ ...first[0], isFavorite: true }];
  const changes = recordGalleryHistoryMutation(first, edited, load);
  const result = mergeLoadedGalleryHistory(edited, [row('a', { status: 'completed', url: 'fresh' })], changes);
  assert.deepEqual([result[0].isFavorite, result[0].status, result[0].url], [true, 'completed', 'fresh']);
});

test('local new rows survive and external tombstones suppress unseen deleted rows', () => {
  const load = snapshot(); load.deletedIds.add('unseen');
  const current = [row('new', { createdAt: 20, status: 'completed' })];
  const changes = recordGalleryHistoryMutation([], current, load);
  const result = mergeLoadedGalleryHistory(current, [row('unseen'), row('new', { status: 'pending' }), row('old')], changes);
  assert.deepEqual(result.map(item => item.id), ['new', 'old']);
  assert.equal(result[0].status, 'completed');
});

test('clear history discards rows from pages still in flight', () => {
  const load = snapshot();
  const initial = mergeLoadedGalleryHistory([], [row('old')], load);
  load.discardLoaded = true;
  assert.deepEqual(mergeLoadedGalleryHistory(initial.filter(item => item.isLoading), [row('old'), row('unseen')], load), []);
});
