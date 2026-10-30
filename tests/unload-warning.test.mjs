import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// React's useEffect runs at once here; the test keeps the cleanup it returns.
const compiled = await build({ entryPoints: ['src/lib/shared/unloadWarning.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'react', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'export const useEffect = run => { globalThis.__cleanup = run(); };' }));
  } }] });
const { hasUnresumableVideoSubmission, useUnloadWarning } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const video = fields => ({ id: 'v', mediaType: 'video', isLoading: true, status: 'pending', videoStage: 'generating', ...fields });

test('only a video still waiting for its provider task blocks closing', () => {
  assert.equal(hasUnresumableVideoSubmission([video({})]), true);
  // A task ID resumes after reload, and so does saving a finished video.
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', status: 'processing' })]), false);
  assert.equal(hasUnresumableVideoSubmission([video({ taskId: 'task-1', videoStage: 'saving' })]), false);
  assert.equal(hasUnresumableVideoSubmission([video({ isLoading: false, status: 'failed', videoStage: undefined })]), false);
  // Rows loaded from history were not submitted by this tab.
  assert.equal(hasUnresumableVideoSubmission([video({ videoStage: undefined })]), false);
  assert.equal(hasUnresumableVideoSubmission([{ id: 'i', mediaType: 'image', isLoading: true, status: 'pending' }]), false);
  assert.equal(hasUnresumableVideoSubmission([]), false);
});

test('the browser is asked to confirm only while active', () => {
  const listeners = new Set();
  globalThis.window = { addEventListener: (type, fn) => type === 'beforeunload' && listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn) };
  useUnloadWarning(false);
  assert.equal(listeners.size, 0);
  useUnloadWarning(true);
  assert.equal(listeners.size, 1);
  const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
  [...listeners][0](event);
  assert.deepEqual([event.prevented, event.returnValue], [true, '']);
  globalThis.__cleanup();
  assert.equal(listeners.size, 0);
});
