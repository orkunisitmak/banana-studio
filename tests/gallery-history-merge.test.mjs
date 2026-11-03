import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeLoadedGalleryHistory } from '../src/lib/gallery/galleryHistoryMerge.ts';

const startedAt = 1000;
const row = (id, createdAt, extra = {}) => ({ id, createdAt, isFavorite: false, folderId: null, ...extra });

// Mirrors App: each page callback merges the cumulative snapshot with the IDs delivered before it.
const load = (pages, edits = []) => {
  let state = [], delivered = new Set();
  pages.forEach((page, index) => {
    const before = delivered;
    delivered = new Set([...before, ...page.map(item => item.id)]);
    state = mergeLoadedGalleryHistory(state, page, startedAt, before);
    state = edits[index]?.(state) ?? state;
  });
  return state;
};

test('later history pages keep edits and deletions made to rows already shown', () => {
  const first = [row('A', 900), row('B', 800)];
  const state = load([first, [...first, row('C', 700)]], [
    current => [row('NEW', 1500), ...current.filter(item => item.id !== 'B').map(item => item.id === 'A' ? { ...item, isFavorite: true, folderId: 'f1' } : item)],
  ]);
  assert.deepEqual(state.map(item => item.id), ['NEW', 'A', 'C']);
  assert.equal(state[1].isFavorite, true);
  assert.equal(state[1].folderId, 'f1');
});

test('a single snapshot still shows every row, and a job submitted during loading keeps its newer state', () => {
  assert.deepEqual(load([[row('A', 900), row('B', 800)]]).map(item => item.id), ['A', 'B']);
  const merged = mergeLoadedGalleryHistory([row('J', 1200, { status: 'completed' })], [row('J', 1200, { status: 'processing' })], startedAt, new Set());
  assert.deepEqual(merged.map(item => item.status), ['completed']);
});

test('a later page fills the url of a row shown without one, keeping the user edits', () => {
  const merged = mergeLoadedGalleryHistory([row('A', 900, { url: '', isFavorite: true })], [row('A', 900, { url: 'https://media.example/a.png' })], startedAt, new Set(['A']));
  assert.equal(merged[0].url, 'https://media.example/a.png');
  assert.equal(merged[0].isFavorite, true);
  const kept = mergeLoadedGalleryHistory([row('A', 900, { url: 'https://media.example/current.png' })], [row('A', 900, { url: 'https://media.example/a.png' })], startedAt, new Set(['A']));
  assert.equal(kept[0].url, 'https://media.example/current.png');
});

test('a later page refreshes the signed URL of the same stored file without dropping edits', () => {
  const shown = row('A', 900, { url: 'https://media.example/a.png?token=old', storagePath: 'u1/a.png', isFavorite: true });
  const refreshed = mergeLoadedGalleryHistory([shown], [row('A', 900, { url: 'https://media.example/a.png?token=fresh', storagePath: 'u1/a.png' })], startedAt, new Set(['A']));
  assert.equal(refreshed[0].url, 'https://media.example/a.png?token=fresh');
  assert.equal(refreshed[0].isFavorite, true);
  const otherFile = mergeLoadedGalleryHistory([shown], [row('A', 900, { url: 'https://media.example/old.png?token=x', storagePath: 'u1/old.png' })], startedAt, new Set(['A']));
  assert.equal(otherFile[0].url, 'https://media.example/a.png?token=old');
});
