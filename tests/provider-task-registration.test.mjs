import test from 'node:test';
import assert from 'node:assert/strict';
import { persistAcceptedTask } from '../api/_lib/persistAcceptedTask.ts';

const noWait = async () => {};

test('succeeds on first registry insert without another billable provider request', async () => {
  let inserts = 0, reads = 0;
  const ok = await persistAcceptedTask(
    async () => { inserts++; return { error: null }; },
    async () => { reads++; return { data: null, error: null }; },
    'owner', 3, noWait,
  );
  assert.equal(ok, true);
  assert.equal(inserts, 1);
  assert.equal(reads, 0);
});

test('recovers an insert whose success acknowledgement was lost', async () => {
  let inserts = 0;
  const ok = await persistAcceptedTask(
    async () => { inserts++; throw new Error('network reset after commit'); },
    async () => ({ data: { user_id: 'owner' }, error: null }),
    'owner', 3, noWait,
  );
  assert.equal(ok, true);
  assert.equal(inserts, 1);
});

test('retries transient failed registry writes but never invokes provider submission', async () => {
  let inserts = 0;
  const ok = await persistAcceptedTask(
    async () => ({ error: ++inserts === 1 ? new Error('temporary database outage') : null }),
    async () => ({ data: null, error: null }),
    'owner', 3, noWait,
  );
  assert.equal(ok, true);
  assert.equal(inserts, 2);
});

test('does not treat a foreign task association as owned', async () => {
  let inserts = 0;
  const ok = await persistAcceptedTask(
    async () => { inserts++; return { error: new Error('conflict') }; },
    async () => ({ data: { user_id: 'another-user' }, error: null }),
    'owner', 3, noWait,
  );
  assert.equal(ok, false);
  assert.equal(inserts, 1);
});

test('preserves failure if registry never becomes available', async () => {
  let inserts = 0;
  const ok = await persistAcceptedTask(
    async () => { inserts++; return { error: new Error('outage') }; },
    async () => { throw new Error('read outage'); },
    'owner', 3, noWait,
  );
  assert.equal(ok, false);
  assert.equal(inserts, 3);
});
