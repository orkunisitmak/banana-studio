import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({
  entryPoints: ['src/lib/gallery/lateVideoTaskId.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { findLateVideoTaskId } = await import(
  'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')
);

const pending = () => ({ id: 'video-1', mediaType: 'video', status: 'processing', taskId: undefined });

test('a provider task ID saved after page reload becomes discoverable without submitting again', async () => {
  const live = pending();
  let saved = pending();
  let reads = 0;
  const lookup = () => findLateVideoTaskId(live.id, new Set(), () => live, async () => { reads++; return saved; });
  assert.equal(await lookup(), null);
  saved = { ...saved, taskId: 'bs_fal_existing' };
  const result = await lookup();
  assert.equal(result?.kind, 'accepted');
  assert.equal(result?.media.taskId, 'bs_fal_existing');
  assert.equal(reads, 2);
});

test('concurrent checks do not read the same saved video twice', async () => {
  const live = pending();
  const checking = new Set();
  let finish;
  const first = findLateVideoTaskId(live.id, checking, () => live, () => new Promise(resolve => { finish = resolve; }));
  let duplicateReads = 0;
  const duplicate = await findLateVideoTaskId(live.id, checking, () => live, async () => { duplicateReads++; return null; });
  assert.equal(duplicate, null);
  assert.equal(duplicateReads, 0);
  finish({ ...live, taskId: 'saved-task' });
  const result = await first;
  assert.equal(result?.kind, 'accepted');
  assert.equal(result?.media.taskId, 'saved-task');
  assert.equal(checking.size, 0);
});

test('a row that disappeared or finished locally while reading cannot restart polling', async () => {
  let live = pending();
  const lookup = findLateVideoTaskId(live.id, new Set(), () => live, async () => {
    live = { ...live, status: 'failed' };
    return { ...pending(), taskId: 'old-task' };
  });
  assert.equal(await lookup, null);
  assert.equal(await findLateVideoTaskId(live.id, new Set(), () => live, async () => ({ ...pending(), taskId: 'old-task' })), null);
});

test('saved completed and failed rows are terminal, not indefinitely waiting for a task ID', async () => {
  const live = pending();
  for (const status of ['completed', 'failed']) {
    const saved = { ...live, status, error: status === 'failed' ? 'Provider rejected' : undefined };
    const found = await findLateVideoTaskId(live.id, new Set(), () => live, async () => saved);
    assert.equal(found?.kind, 'terminal');
    assert.equal(found?.media.status, status);
    assert.equal(found?.media.error, saved.error);
  }
});

test('a rejected saved-row read releases the lock and the same video can retry', async () => {
  const live = pending();
  const checking = new Set();
  await assert.rejects(
    findLateVideoTaskId(live.id, checking, () => live, async () => { throw new Error('read failed'); }),
    /read failed/
  );
  assert.equal(checking.size, 0);
  const result = await findLateVideoTaskId(live.id, checking, () => live, async () => ({ ...live, taskId: 'saved-task' }));
  assert.equal(result?.kind, 'accepted');
  assert.equal(result?.media.taskId, 'saved-task');
});
