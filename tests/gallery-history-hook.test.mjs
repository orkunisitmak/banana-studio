import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Replay queued state updaters twice, as React StrictMode does, while preserving
// update ordering. This also checks that rendering doesn't mutate earlier state.
const runtime = globalThis.__galleryHook = { state: undefined, queue: [] };
const compiled = await build({ entryPoints: ['src/components/useGalleryHistory.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{ name: 'hook-queue', setup(b) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hook' }));
  b.onLoad({ filter: /.*/, namespace: 'hook' }, () => ({ contents: `export const useCallback=fn=>fn; export const useState=initial=>{const runtime=globalThis.__galleryHook;if(runtime.state===undefined)runtime.state=initial();return[runtime.state,update=>runtime.queue.push(update)];};` }));
} }] });
const { useGalleryHistory } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const render = () => useGalleryHistory();
function flush() {
  for (const update of runtime.queue.splice(0)) {
    const previous = runtime.state;
    const first = update(previous), replay = update(previous);
    assert.deepEqual(first, replay, 'updaters can be replayed without side effects');
    runtime.state = replay;
  }
}
const row = { id: 'old', url: 'old', createdAt: 1, isFavorite: false, referenceImages: [] };

test('finishing the initial load preserves the queued final merge and releases mutation data', () => {
  runtime.state = undefined; runtime.queue = [];
  const hook = render();
  hook.mergeHistory([row], new Set()); flush();
  const largeReference = { id: 'ref', data: 'synthetic media held by a mutation', mimeType: 'image/png' };
  hook.setMedia(items => items.map(item => ({ ...item, isFavorite: true, referenceImages: [largeReference] })));
  hook.mergeHistory([{ ...row, url: 'fresh' }], new Set());
  // The final queued page must apply before cleanup.
  hook.endHistoryLoad(); flush();
  assert.equal(render().media[0].url, 'fresh');
  assert.equal(render().media[0].isFavorite, true);
  assert.equal(runtime.state.mutations.patches.size, 0, 'no completed-load mutation history remains');
  assert.equal(runtime.state.mutations.additions.size, 0);
  assert.equal(runtime.state.mutations.deletedIds.size, 0);
  hook.setMedia(items => items.map(item => ({ ...item, isFavorite: false, referenceImages: [] }))); flush();
  assert.equal(runtime.state.mutations.patches.size, 0, 'ordinary edits no longer retain load-only patches');
  hook.mergeHistory([row], new Set()); flush();
  assert.equal(render().media[0].url, 'fresh', 'an already-finished load cannot deliver a stale page');
});
