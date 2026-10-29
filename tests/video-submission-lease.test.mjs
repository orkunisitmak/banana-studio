import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { LocalWorkspace } from '../desktop/server/store.mjs';

const compiled = await build({
  entryPoints: ['src/lib/gallery/videoSubmissionLease.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { refreshPendingVideoSubmission, failStalePendingVideo } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const withWorkspace = async run => {
  const directory = mkdtempSync(join(tmpdir(), 'banana-video-lease-'));
  const store = new LocalWorkspace(directory);
  const now = 1_000_000_000;
  const id = 'video-1';
  store.put('generations', id, {
    id, user_id: store.user.id, type: 'video', status: 'pending', task_id: '',
    created_at: now - 210_000, metadata: { submissionHeartbeatAt: now - 10_000, originalPrompt: 'safe fixture' },
  });
  try { await run({ store, client: store.client(), now, id }); }
  finally { store.db.close(); rmSync(directory, { recursive: true, force: true }); }
};

test('a second tab cannot fail a pending submission with a live database heartbeat', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    const failed = await failStalePendingVideo(client, store.user.id, id, 'Timed out', now);
    assert.equal(failed, false);
    assert.equal(store.get('generations', id).status, 'pending');
  });
});

test('the submitting tab refreshes the persisted heartbeat without losing metadata', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    assert.equal(await refreshPendingVideoSubmission(client, store.user.id, id, now), true);
    assert.equal(store.get('generations', id).metadata.submissionHeartbeatAt, now);
    assert.equal(store.get('generations', id).metadata.originalPrompt, 'safe fixture');
    assert.equal(await failStalePendingVideo(client, store.user.id, id, 'Timed out', now + 110_000), false);
  });
});

test('an abandoned pending video is failed after its heartbeat expires, only once', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    const later = now + 200_000;
    assert.equal(await failStalePendingVideo(client, store.user.id, id, 'Timed out', later), true);
    assert.equal(store.get('generations', id).status, 'failed');
    assert.equal(store.get('generations', id).metadata.error, 'Timed out');
    assert.equal(await failStalePendingVideo(client, store.user.id, id, 'Timed out', later), false);
  });
});

test('a video with a saved task id or processing status cannot be failed by another tab', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    const record = store.get('generations', id);
    store.put('generations', id, { ...record, status: 'processing', task_id: 'provider-id' });
    assert.equal(await failStalePendingVideo(client, store.user.id, id, 'Timed out', now + 200_000), false);
    assert.equal(store.get('generations', id).status, 'processing');
  });
});

test('a concurrent heartbeat wins over a stale second-tab fail decision', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    const later = now + 200_000; // The original heartbeat is now expired.
    const racingClient = {
      from(table) {
        const call = ++racingClient.calls;
        if (call === 2) {
          const row = store.get('generations', id);
          store.put('generations', id, {
            ...row, metadata: { ...row.metadata, submissionHeartbeatAt: later - 1_000 },
          });
        }
        return client.from(table);
      },
      calls: 0,
    };
    assert.equal(await failStalePendingVideo(racingClient, store.user.id, id, 'Timed out', later), false);
    assert.equal(store.get('generations', id).status, 'pending');
    assert.equal(store.get('generations', id).metadata.submissionHeartbeatAt, later - 1_000);
  });
});

test('an older renewal cannot roll back a newer shared heartbeat', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    const racingClient = {
      from(table) {
        const call = ++racingClient.calls;
        if (call === 2) {
          const row = store.get('generations', id);
          store.put('generations', id, {
            ...row, metadata: { ...row.metadata, submissionHeartbeatAt: now + 100 },
          });
        }
        return client.from(table);
      },
      calls: 0,
    };
    assert.equal(await refreshPendingVideoSubmission(racingClient, store.user.id, id, now), false);
    assert.equal(store.get('generations', id).metadata.submissionHeartbeatAt, now + 100);
  });
});

test('an abandoned legacy video with no heartbeat can still be expired', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    const row = store.get('generations', id);
    delete row.metadata.submissionHeartbeatAt;
    store.put('generations', id, row);
    assert.equal(await failStalePendingVideo(client, store.user.id, id, 'Interrupted', now), true);
    assert.equal(store.get('generations', id).status, 'failed');
  });
});

test('heartbeat compare-and-set filters use numeric JSON, not lexicographic text', async () => {
  await withWorkspace(async ({ store, client, now, id }) => {
    const filters = [];
    const inspectingClient = {
      from(table) {
        const query = client.from(table);
        const originalThen = query.then.bind(query);
        query.then = (resolve, reject) => {
          filters.push(...query.plan.filters);
          return originalThen(resolve, reject);
        };
        return query;
      },
    };
    assert.equal(await refreshPendingVideoSubmission(inspectingClient, store.user.id, id, now), true);
    assert.equal(
      filters.some(f => f.column === 'metadata->submissionHeartbeatAt' && f.operator === 'eq'),
      true,
      'renewal should compare the saved JSON number numerically',
    );
    filters.length = 0;
    assert.equal(await failStalePendingVideo(inspectingClient, store.user.id, id, 'Timed out', now + 200_000), true);
    assert.equal(
      filters.some(f => f.column === 'metadata->submissionHeartbeatAt' && f.operator === 'lt'),
      true,
      'expiration should compare the saved JSON number numerically',
    );
  });
});
