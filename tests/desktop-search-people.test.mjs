import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalWorkspace } from '../desktop/server/store.mjs';

async function people(t, references) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-search-people-'));
  const store = new LocalWorkspace(root);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const client = store.client();
  assert.equal((await client.from('generations').insert({ id: 'generation', reference_images: references })).error, null);
  const result = await client.rpc('get_gallery_search_people', { p_owner_id: store.user.id, p_limit: 500 });
  assert.equal(result.error, null);
  assert.equal(result.data[0].id, 'generation');
  return result.data[0].people;
}

// Match extract_gallery_search_people in the baseline migration: only named,
// assigned people count, never frames, edit sources or video context images.
test('desktop search excludes references without a usable person role', async t => {
  assert.deepEqual(await people(t, [
    { personId: 3, personName: 'Alex' },
    ...['isFirstFrame', 'isLastFrame', 'isDraftImage', 'isVideoContext'].map(flag => ({ personId: 4, personName: flag, [flag]: true })),
    { personName: 'Unassigned' }, { personId: 0, personName: 'Zero' },
    { personId: 10000, personName: 'Out of range' }, { personId: 1.5, personName: 'Fraction' },
  ]), ['Alex']);
});

test('desktop search normalizes and deduplicates names like the web search', async t => {
  const name = 'A'.repeat(40);
  assert.deepEqual(await people(t, [
    { personId: 3, personName: '  Alex\nSmith\t ' },
    { personId: 3, personName: 'Alex Smith' },
    { personId: 4, personName: '  ' },
    { personId: 5, personName: name + ' beyond the limit' },
    { personId: 5, personName: name },
  ]), ['Alex Smith', name]);
});

test('legacy subject and second-person flags remain searchable; empty rows remain present', async t => {
  assert.deepEqual(await people(t, [
    { isSubjectImage: true, personName: 'Me' }, { isSecondPerson: true, personName: 'Guest' },
  ]), ['Me', 'Guest']);
  assert.deepEqual(await people(t, []), []);
});
