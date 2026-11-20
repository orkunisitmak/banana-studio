import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Stands in for one mounted component: like React, each render reruns the effect
// only when its dependencies changed, after cleaning up the previous run.
const compiled = await build({ entryPoints: ['src/lib/shared/unloadWarning.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'let last, cleanup; export const useEffect = (run, deps) => { if (last && deps && deps.length === last.length && deps.every((dep, i) => Object.is(dep, last[i]))) return; cleanup?.(); last = deps; cleanup = run(); };' }));
  } }] });
const { hasUnresumableVideoSubmission, useUnloadWarning } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const video = fields => ({ id: 'v', mediaType: 'video', isLoading: true, status: 'pending', videoStage: 'generating', ...fields });

test('only a video still waiting for its provider task blocks closing', () => {
  assert.equal(hasUnresumableVideoSubmission([video({})]), true);
  // A task ID resumes after reload, and so does saving a finished video.
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', status: 'processing' })]), false);
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', videoStage: 'saving' })]), false);
  // A task ID that never reached the gallery row resumes nothing, until the video is saved.
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', status: 'processing', taskIdUnsaved: true })]), true);
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', videoStage: 'saving', taskIdUnsaved: true })]), true);
  // A polling error clears the progress display but the task is still only in this tab.
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', isLoading: false, status: 'processing', videoStage: undefined, taskIdUnsaved: true })]), true);
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', isLoading: false, status: 'completed', videoStage: undefined, taskIdUnsaved: true })]), false);
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', isLoading: false, status: 'failed', videoStage: undefined, taskIdUnsaved: true })]), false);
  assert.equal(hasUnresumableVideoSubmission([video({ isLoading: false, status: 'failed', videoStage: undefined })]), false);
  // Rows loaded from history were not submitted by this tab.
  assert.equal(hasUnresumableVideoSubmission([video({ videoStage: undefined })]), false);
  assert.equal(hasUnresumableVideoSubmission([{ id: 'i', mediaType: 'image', isLoading: true, status: 'pending' }]), false);
  assert.equal(hasUnresumableVideoSubmission([]), false);
});

test('the browser is asked to confirm only while active, across renders', () => {
  const listeners = new Set(); let added = 0;
  globalThis.window = { addEventListener: (type, fn) => { if (type === 'beforeunload') { added++; listeners.add(fn); } }, removeEventListener: (type, fn) => listeners.delete(fn) };
  useUnloadWarning(false);
  assert.equal(listeners.size, 0);
  useUnloadWarning(true);
  assert.equal(listeners.size, 1);
  const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
  [...listeners][0](event);
  assert.deepEqual([event.prevented, event.returnValue], [true, '']);
  // Rendering again while still active keeps the one handler.
  useUnloadWarning(true);
  assert.deepEqual([listeners.size, added], [1, 1]);
  // Turning inactive removes it, and a later job warns again.
  useUnloadWarning(false);
  assert.equal(listeners.size, 0);
  useUnloadWarning(true);
  assert.deepEqual([listeners.size, added], [1, 2]);
  useUnloadWarning(false);
  assert.equal(listeners.size, 0);
});
