import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { WorkspaceQuery } from '../desktop/shared/query.mjs';

const fixture = { rows: [], cap: 2, failureAt: null, deleteFailureAt: null, deleteCalls: 0, removed: [], deleted: [] };
fixture.client = { from(table) {
  assert.equal(table, 'generations');
  return new WorkspaceQuery(async plan => {
    let rows = fixture.rows.filter(row => plan.filters.every(f => f.operator === 'in' ? f.value.includes(row[f.column]) : row[f.column] === f.value));
    if (plan.operation === 'delete') {
      fixture.deleteCalls++;
      if (fixture.deleteCalls === fixture.deleteFailureAt) return { data: null, error: { message: 'Deletion unavailable' } };
      const ids = new Set(rows.map(row => row.id));
      fixture.rows = fixture.rows.filter(row => !ids.has(row.id));
      fixture.deleted.push(...ids);
      return { data: null, error: null };
    }
    const from = plan.range?.[0] || 0;
    if (fixture.failureAt !== null && from >= fixture.failureAt) return { data: null, error: { message: 'Page unavailable' } };
    rows.sort((a,b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    const size = Math.min(fixture.cap, plan.range ? plan.range[1] - from + 1 : fixture.cap);
    return { data: structuredClone(rows.slice(from, from + size)), error: null };
  }, table);
}, storage: { from() { return { remove: async paths => { fixture.removed.push(...paths); return { error: null }; } }; } } };
globalThis.__rowCapFixture = fixture;
const bundle = await build({ stdin: { contents: "export { getImagesForUser, clearImages } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'row-cap', setup(b) {
    b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'tus-js-client' ? 'export class Upload {}' :
      "export const supabase=globalThis.__rowCapFixture.client; export const getCurrentUserId=async()=>'user-1',SUPABASE_URL='https://storage.invalid';" }));
  } }] });
const { getImagesForUser, clearImages } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const row = (id, user_id = 'user-1') => ({ id, user_id, created_at: 1, type: 'image', status: 'completed', url: `https://cdn.invalid/${id}.png`, prompt: id });
function setup(t, count = 7) {
  Object.assign(fixture, { rows: [...Array.from({ length: count }, (_, i) => row(`image-${String(i).padStart(4, '0')}`)), row('other', 'user-2')], cap: 2, failureAt: null, deleteFailureAt: null, deleteCalls: 0, removed: [], deleted: [] });
  const old = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, removeItem() {} };
  t.after(() => { if (old === undefined) delete globalThis.localStorage; else globalThis.localStorage = old; });
  t.mock.method(console, 'error', () => {}); // IndexedDB is an optional browser cache here.
}

test('gallery reads continue beyond a short server-capped page', async t => {
  setup(t);
  const media = await getImagesForUser('user-1');
  assert.equal(media.length, 7);
  assert.deepEqual(media.map(item => item.id), fixture.rows.filter(row => row.user_id === 'user-1').map(row => row.id));
});

test('Clear All removes every owned page and keeps another account untouched', async t => {
  setup(t);
  await clearImages();
  assert.deepEqual(fixture.rows.map(row => row.id), ['other']);
  assert.equal(fixture.deleted.length, 7);
  assert.equal(fixture.removed.length, 14);
  assert.ok(fixture.removed.every(path => path.startsWith('user-1/')));
});

test('a failed later page rejects clearing before any media or row deletion', async t => {
  setup(t);
  fixture.failureAt = 2;
  await assert.rejects(clearImages(), /Page unavailable/);
  assert.equal(fixture.rows.length, 8);
  assert.deepEqual(fixture.removed, []);
  assert.deepEqual(fixture.deleted, []);
});

test('large clears bound storage batches and keep explicit saved file paths', async t => {
  setup(t, 1201);
  fixture.cap = 1000;
  fixture.rows[0].storage_path = 'user-1/original.webp';
  fixture.rows[0].thumbnail_path = 'user-1/preview.jpg';
  t.mock.method(fixture.client.storage, 'from', () => ({ remove: async paths => {
    assert.ok(paths.length <= 1000);
    fixture.removed.push(...paths);
    return { error: null };
  } }));
  await clearImages();
  assert.equal(fixture.deleted.length, 1201);
  assert.deepEqual(fixture.rows.map(row => row.id), ['other']);
  assert.ok(fixture.removed.includes('user-1/original.webp'));
  assert.ok(fixture.removed.includes('user-1/preview.jpg'));
});

test('an empty gallery does not remove any storage objects', async t => {
  setup(t, 0);
  await clearImages();
  assert.deepEqual(await getImagesForUser('user-1'), []);
  assert.deepEqual(fixture.rows.map(row => row.id), ['other']);
  assert.deepEqual(fixture.removed, []);
});

test('a later deletion failure rejects and retry clears the remaining owned rows', async t => {
  setup(t, 1201);
  fixture.cap = 1000;
  fixture.deleteFailureAt = 2;
  await assert.rejects(clearImages(), /Deletion unavailable/);
  assert.equal(fixture.deleted.length, 500);
  assert.equal(fixture.rows.filter(row => row.user_id === 'user-1').length, 701);
  assert.ok(fixture.rows.some(row => row.id === 'other'));
  fixture.deleteFailureAt = null;
  await clearImages();
  assert.deepEqual(fixture.rows.map(row => row.id), ['other']);
  assert.equal(fixture.deleted.length, 1201);
  assert.equal(new Set(fixture.deleted).size, 1201);
});
