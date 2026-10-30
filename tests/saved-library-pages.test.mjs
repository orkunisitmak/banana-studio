import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { WorkspaceQuery } from '../desktop/shared/query.mjs';

const fixture = { user: 'owner', rows: [], cap: 2, failAt: null, calls: [], afterRead: null };
fixture.client = { from(table) {
  return new WorkspaceQuery(async plan => {
    const from = plan.range?.[0] || 0;
    fixture.calls.push({ table, from, columns: plan.columns, order: plan.order });
    if (fixture.failAt !== null && from >= fixture.failAt) return { error: { message: 'Page unavailable' }, data: null };
    let rows = fixture.rows.filter(row => row.table === table);
    if (plan.or) {
      const alternatives = plan.or.split(',').map(value => value.split('.'));
      rows = rows.filter(row => alternatives.some(([field, operator, value]) => operator === 'eq' && row[field] === (value === 'true' ? true : value)));
    }
    for (const filter of plan.filters) {
      if (filter.operator === 'in') rows = rows.filter(row => filter.value.includes(row[filter.column]));
      if (filter.operator === 'is') rows = rows.filter(row => row[filter.column] == filter.value);
    }
    rows.sort((a,b) => {
      for (const order of plan.order || []) {
        const result = a[order.column] < b[order.column] ? -1 : a[order.column] > b[order.column] ? 1 : 0;
        if (result) return result * (order.ascending === false ? -1 : 1);
      }
      return 0;
    });
    fixture.afterRead?.(from);
    return { data: structuredClone(rows.slice(from, from + Math.min(fixture.cap, plan.range ? plan.range[1] - from + 1 : fixture.cap))), error: null };
  }, table);
} };
globalThis.__savedLibraryPages = fixture;
const bundle = await build({ stdin: { contents: "export { getReferenceGallery, getSavedPeople, getSavedPeopleCovers } from './src/services/storageService';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');" }, plugins: [{ name: 'library-fixture', setup(b) {
  b.onResolve({ filter: /\/authService$|^tus-js-client$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'tus-js-client' ? 'export class Upload {}' : "export const supabase=globalThis.__savedLibraryPages.client; export const getCurrentUserId=async()=>globalThis.__savedLibraryPages.user,SUPABASE_URL='https://storage.invalid';" }));
} }] });
const service = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function setup(t, table) {
  fixture.user = 'owner'; fixture.cap = 2; fixture.failAt = null; fixture.calls = []; fixture.afterRead = null;
  fixture.rows = Array.from({ length: 7 }, (_, i) => ({ table, id: `item-${i}`, user_id: i === 6 ? 'teammate' : 'owner', is_shared: i === 6,
    created_at: 1, updated_at: 1, data: 'data:image/png;base64,cGhvdG8=', cover: { data: `photo-${i}` }, name: `Person ${i}` }));
  fixture.rows.push({ table, id: 'private-other', user_id: 'other', created_at: 2 });
  t.mock.method(console, 'error', () => {});
}
for (const [table, method] of [['reference_images', 'getReferenceGallery'], ['saved_people', 'getSavedPeople']]) {
  test(`${method} returns every owned/shared item past a short server page`, async t => {
    setup(t, table);
    const result = await service[method]();
    assert.deepEqual(result.map(item => item.id), Array.from({ length: 7 }, (_, i) => `item-${i}`));
    assert.equal(result.at(-1).canEdit, false);
    assert.deepEqual(fixture.calls.map(call => call.from), [0,2,4,6,7]);
  });
  test(`${method} rejects an incomplete library and can retry`, async t => {
    setup(t, table); fixture.failAt = 2;
    await assert.rejects(service[method](), /could not be loaded/i);
    fixture.failAt = null;
    assert.equal((await service[method]()).length, 7);
  });
}
test('person covers load all requested cards and are cached only after a complete read', async t => {
  setup(t, 'saved_people');
  const people = fixture.rows.slice(0,7).map(row => ({ id: row.id, updatedAt: row.updated_at }));
  fixture.failAt = 2;
  await assert.rejects(service.getSavedPeopleCovers(people), /could not be loaded/i);
  fixture.failAt = null; fixture.calls = [];
  assert.deepEqual(await service.getSavedPeopleCovers(people), Object.fromEntries(people.map((p,i) => [p.id, `photo-${i}`])));
  const calls = fixture.calls.length;
  assert.deepEqual(await service.getSavedPeopleCovers(people), Object.fromEntries(people.map((p,i) => [p.id, `photo-${i}`])));
  assert.equal(fixture.calls.length, calls);
});
test('a later-page account change invalidates the whole people result', async t => {
  setup(t, 'saved_people'); fixture.afterRead = from => { if (from === 2) fixture.user = 'other'; };
  await assert.rejects(service.getSavedPeople(), /session changed/i);
});
test('cancelling between people pages stops the read', async t => {
  setup(t, 'saved_people'); const controller = new AbortController();
  fixture.afterRead = from => { if (from === 2) controller.abort(); };
  await assert.rejects(service.getSavedPeople(controller.signal), { name: 'AbortError' });
});

test('empty libraries return empty results without reading photos', async t => {
  setup(t, 'saved_people'); fixture.rows = [];
  assert.deepEqual(await service.getSavedPeople(), []);
  assert.deepEqual(await service.getReferenceGallery(), []);
  assert.deepEqual(await service.getSavedPeopleCovers([]), {});
});
test('person summaries exclude deleted rows and never request full photo sets', async t => {
  setup(t, 'saved_people'); fixture.rows[2].deleted_at = '2026-10-30';
  const people = await service.getSavedPeople();
  assert.equal(people.length, 6);
  assert.ok(!people.some(person => person.id === 'item-2' || person.id === 'private-other'));
  assert.ok(fixture.calls.every(call => !call.columns.includes('photos')));
});
