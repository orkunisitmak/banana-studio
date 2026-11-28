import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalWorkspace } from '../desktop/server/store.mjs';

const withStore = async run => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-upsert-'));
  const store = new LocalWorkspace(path.join(root, 'data'));
  try {
    return await run(store, store.client(true));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('upsert with ignoreDuplicates: true keeps existing rows and skips intra-batch duplicates', () =>
  withStore(async (store, db) => {
    assert.equal((await db.from('usage_logs').insert({ id: 'u1', estimated_cost: 0.42, created_at: 1000 })).error, null);

    const res = await db.from('usage_logs').upsert(
      [
        { id: 'u1', estimated_cost: 0.10 },
        { id: 'u2', estimated_cost: 0.25, created_at: 2000 },
        { id: 'u2', estimated_cost: 0.99 },
      ],
      { onConflict: 'id', ignoreDuplicates: true },
    ).select('*');

    assert.equal(res.error, null);
    assert.deepEqual(store.get('usage_logs', 'u1').estimated_cost, 0.42);
    assert.deepEqual(store.get('usage_logs', 'u1').created_at, 1000);
    assert.deepEqual(store.get('usage_logs', 'u2').estimated_cost, 0.25);
    assert.deepEqual(res.data.map(row => row.id), ['u2']);
  }));

test('upsert without ignoreDuplicates preserves existing created_at when omitted from the update', () =>
  withStore(async (store, db) => {
    assert.equal((await db.from('generations').insert({ id: 'g1', prompt: 'old', created_at: 1000 })).error, null);
    const res = await db.from('generations').upsert({ id: 'g1', prompt: 'new' }, { onConflict: 'id' });
    assert.equal(res.error, null);
    const saved = store.get('generations', 'g1');
    assert.equal(saved.prompt, 'new');
    assert.equal(saved.created_at, 1000);
  }));

test('batch insert rejects intra-batch duplicate IDs with 23505 without writing partial rows', () =>
  withStore(async (store, db) => {
    const res = await db.from('folders').insert([
      { id: 'f1', name: 'First' },
      { id: 'f1', name: 'Second' },
    ]);
    assert.equal(res.error?.code, '23505');
    assert.equal(store.get('folders', 'f1'), null);
  }));

test('reused WorkspaceQuery resets ignoreDuplicates on subsequent upsert without it', () =>
  withStore(async (store, db) => {
    assert.equal((await db.from('generations').insert({ id: 'g2', prompt: 'v1', created_at: 1000 })).error, null);
    const query = db.from('generations');
    assert.equal((await query.upsert({ id: 'g2', prompt: 'skipped' }, { onConflict: 'id', ignoreDuplicates: true })).error, null);
    assert.equal(store.get('generations', 'g2').prompt, 'v1');
    assert.equal((await query.upsert({ id: 'g2', prompt: 'v2' }, { onConflict: 'id' })).error, null);
    assert.equal(store.get('generations', 'g2').prompt, 'v2');
    assert.equal(store.get('generations', 'g2').created_at, 1000);
  }));
