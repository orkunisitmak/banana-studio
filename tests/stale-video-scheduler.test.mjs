import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({
  entryPoints: ['src/lib/gallery/videoSubmissionLease.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { scheduleStaleVideoCheck, allowPeriodicStaleCheck } = await import(
  'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')
);

test('startup recovery schedules pending-video check without blocking later gallery work', async () => {
  assert.equal(typeof scheduleStaleVideoCheck, 'function');
  let resolveCheck;
  const operations = [];
  scheduleStaleVideoCheck(
    () => new Promise(resolve => { resolveCheck = resolve; }),
    () => false,
    () => operations.push('fail-row'),
  );
  operations.push('resume-pending-images');
  assert.deepEqual(operations, ['resume-pending-images']);
  resolveCheck(true);
  await Promise.resolve();
  assert.deepEqual(operations, ['resume-pending-images', 'fail-row']);
});

test('a finished, failed or cancelled recovery check does not update a departed view', async () => {
  assert.equal(typeof scheduleStaleVideoCheck, 'function');
  let updates = 0;
  let cancelled = true;
  const tick = () => updates++;
  scheduleStaleVideoCheck(async () => true, () => cancelled, tick);
  await Promise.resolve();
  assert.equal(updates, 0);
  cancelled = false;
  scheduleStaleVideoCheck(async () => false, () => cancelled, tick);
  await Promise.resolve();
  assert.equal(updates, 0);
  scheduleStaleVideoCheck(async () => { throw new Error('offline'); }, () => cancelled, tick);
  await Promise.resolve();
  assert.equal(updates, 0);
});

test('stale video status reads are limited to one per id per minute', () => {
  assert.equal(typeof allowPeriodicStaleCheck, 'function');
  const lastChecked = new Map();
  assert.equal(allowPeriodicStaleCheck(lastChecked, 'video-a', 1_000_000), true);
  assert.equal(allowPeriodicStaleCheck(lastChecked, 'video-a', 1_014_999), false);
  assert.equal(allowPeriodicStaleCheck(lastChecked, 'video-a', 1_059_999), false);
  assert.equal(allowPeriodicStaleCheck(lastChecked, 'video-b', 1_059_999), true);
  assert.equal(allowPeriodicStaleCheck(lastChecked, 'video-a', 1_060_000), true);
});
