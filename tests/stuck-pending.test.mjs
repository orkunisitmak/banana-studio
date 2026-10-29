import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({entryPoints:['src/lib/gallery/stuckPending.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node'});
const { isStuckPendingMedia, STUCK_PENDING_MS } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const now = 10_000_000, old = now - STUCK_PENDING_MS - 30_000;
const image = extra => ({ id: 'i', mediaType: 'image', status: 'pending', createdAt: old, imageModel: 'gemini-nano-banana-2.1', ...extra });

test('queued images in the durable server queue are never failed by the stuck-pending watchdog', () => {
  assert.equal(isStuckPendingMedia(image({ imageStage: 'queued' }), now), false);
  assert.equal(isStuckPendingMedia(image({ imageQueue: { version: 1, queuedAt: old } }), now), false);
  assert.equal(isStuckPendingMedia(image({ imageModel: 'gpt-image-2.5-sunburst' }), now), false);
});

test('cards that never received a provider handle are still failed after the limit', () => {
  assert.equal(isStuckPendingMedia(image({ imageModel: 'gemini-3-pro-image-preview' }), now), true);
  assert.equal(isStuckPendingMedia(image({ falRequestId: 'r1' }), now), false);
  assert.equal(isStuckPendingMedia({ id: 'v', mediaType: 'video', status: 'pending', createdAt: old }, now), true);
  assert.equal(isStuckPendingMedia({ id: 'v', mediaType: 'video', status: 'pending', createdAt: old, taskId: 't' }, now), false);
  assert.equal(isStuckPendingMedia(image({ createdAt: now - 1000 }), now), false);
});

test('a video still being submitted in this tab is not failed; a reloaded one without a task ID is', () => {
  assert.equal(isStuckPendingMedia({ id: 'v', mediaType: 'video', status: 'pending', createdAt: old, videoStage: 'generating', isLoading: true }, now), false);
  assert.equal(isStuckPendingMedia({ id: 'r', mediaType: 'video', status: 'pending', createdAt: old }, now), true);
});

test('a pending video in another tab is not failed while its shared submission heartbeat is fresh', () => {
  const activeOnAnotherDevice = { id: 'shared-video', mediaType: 'video', status: 'pending', createdAt: old, submissionHeartbeatAt: now - 20_000 };
  assert.equal(isStuckPendingMedia(activeOnAnotherDevice, now), false);
});

test('an abandoned video without a task ID can be failed after its shared heartbeat expires', () => {
  const abandoned = { id: 'abandoned-video', mediaType: 'video', status: 'pending', createdAt: old, submissionHeartbeatAt: now - 240_000 };
  assert.equal(isStuckPendingMedia(abandoned, now), true);
});
