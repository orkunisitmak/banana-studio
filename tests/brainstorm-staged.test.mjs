import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/brainstorm/brainstormGeneration.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createBrainstormBatch } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const base = { prompt: 'A synthetic product photograph', mode: 'image', imageModel: 'gpt-image-2.5-sunburst',
  count: 2, aspectRatio: '1:1', resolution: '1K', referenceImages: [] };

function scenario(options = {}) {
  const request = { settings: structuredClone(base), category: 'simple', ideaCount: 3, textModel: 'gpt-6.1-sol', reasoningEffort: 'medium',
    generationMode: 'sample_first', imageProvider: 'openai', ...options.request };
  const calls = [], states = [], patches = [], remainingStarts = [], settled = [], gates = new Map();
  let current = true, prepares = 0;
  request.isCurrent = () => current;
  const batch = createBrainstormBatch(request, 'synthetic-folder', {
    prepare: async (settings, count, task) => {
      prepares++;
      if (options.prepare) return options.prepare(settings, count, task);
      return Array.from({ length: count }, (_, index) => ({ id: `idea-${index}`, text: `Prepared idea ${index}` }));
    },
    generate: (placeholder, settings, folderId) => {
      calls.push({ id: placeholder.id, settings, folderId });
      const pending = gate(); gates.set(placeholder.id, pending);
      return pending.promise;
    },
    patch: (ids, patch) => patches.push({ ids, patch }),
    onRemainingStart: cards => { options.onRemainingStart?.(cards); remainingStarts.push(cards); },
    onStateChange: state => states.push(state),
    onSettled: (completed, failed) => settled.push({ completed, failed }),
  });
  return { batch, calls, states, patches, remainingStarts, settled, gates, request,
    invalidate: () => { current = false; }, prepares: () => prepares,
    finish: (index = 0, result = { ok: true }) => gates.get(calls[index].id).resolve(result),
  };
}

test('the paid sample is one of the requested images; approval requires a viewable result and is single-use', async () => {
  const f = scenario(); const pending = f.batch.run();
  assert.equal(f.batch.run(), pending);
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].settings.prompt, 'Prepared idea 0');
  assert.equal(f.batch.approve(), false);
  f.finish(); await tick();
  assert.equal(f.states.at(-1).phase, 'awaiting_approval');
  assert.equal(f.states.at(-1).remaining, 5);
  assert.equal(f.calls.length, 1);
  assert.equal(f.batch.approve(), false, 'a completed but not yet visible image cannot release the rest');
  f.batch.markSampleViewed();
  assert.equal(f.batch.approve(), true);
  assert.equal(f.batch.approve(), false);
  await tick();
  assert.equal(f.calls.length, 6);
  assert.equal(f.remainingStarts.length, 1);
  assert.equal(f.remainingStarts[0].length, 5);
  for (let index = 1; index < f.calls.length; index++) f.finish(index);
  const result = await pending;
  assert.deepEqual({ completed: result.completed, failed: result.failed, skipped: result.skipped }, { completed: 6, failed: 0, skipped: 0 });
  assert.equal(f.prepares(), 1, 'approval reuses the prepared ideas');
  assert.equal(new Set(f.calls.map(call => call.id)).size, 6);
  assert.deepEqual(f.calls.map(call => call.settings.prompt), ['Prepared idea 0', 'Prepared idea 0', 'Prepared idea 1', 'Prepared idea 1', 'Prepared idea 2', 'Prepared idea 2']);
  assert.ok(f.calls.every(call => call.settings.imageProvider === 'openai' && call.folderId === 'synthetic-folder'));
});

test('one requested image completes without an approval step', async () => {
  const f = scenario({ request: { ideaCount: 1, settings: { ...base, count: 1 } } });
  const pending = f.batch.run(); await tick(); f.finish();
  const result = await pending;
  assert.equal(result.completed, 1);
  assert.equal(result.skipped, 0);
  assert.ok(!f.states.some(state => state.phase === 'awaiting_approval'));
  assert.equal(f.batch.approve(), false);
});

test('the explicit all-images path retains normal parallel batching without approval', async () => {
  const f = scenario({ request: { generationMode: 'all' } });
  const pending = f.batch.run(); await tick();
  assert.equal(f.calls.length, 6);
  f.batch.cancel();
  for (let index = 0; index < f.calls.length; index++) f.finish(index);
  const result = await pending;
  assert.equal(result.completed, 6);
  assert.equal(result.skipped, 0);
  assert.ok(!f.states.some(state => state.phase === 'awaiting_approval'));
});

test('stopping preparation prevents late success or failure from starting images', async () => {
  for (const outcome of ['success', 'failure']) {
    const preparation = gate();
    const f = scenario({ prepare: () => preparation.promise });
    const pending = f.batch.run(); await tick(); f.batch.cancel();
    const result = await pending;
    if (outcome === 'success') preparation.resolve([{ text: 'late' }]);
    else preparation.reject(new Error('late failure'));
    await tick();
    assert.equal(f.calls.length, 0);
    assert.equal(result.stopped, true);
    assert.equal(f.batch.approve(), false);
  }
});

test('stopping during the sample keeps its late result without ever releasing the rest', async () => {
  for (const outcome of ['success', 'failure']) {
    const f = scenario(); const pending = f.batch.run(); await tick();
    f.batch.cancel();
    f.finish(0, outcome === 'success' ? { ok: true } : { ok: false, error: 'The outcome could not be recovered.' });
    const result = await pending;
    f.batch.markSampleViewed();
    assert.equal(f.batch.approve(), false);
    assert.equal(f.calls.length, 1);
    assert.equal(result.skipped, 5);
    assert.equal(result.stopped, true);
    assert.ok(!f.states.some(state => state.phase === 'awaiting_approval'));
  }
});

test('closing or stopping at approval is final, including stale load and approval callbacks', async () => {
  const f = scenario(); const pending = f.batch.run(); await tick(); f.finish(); await tick();
  f.batch.cancel(); f.batch.cancel(); f.batch.markSampleViewed();
  assert.equal(f.batch.approve(), false);
  const result = await pending;
  assert.equal(result.completed, 1);
  assert.equal(result.skipped, 5);
  assert.equal(f.calls.length, 1);
});

test('a changed draft cannot be approved, even before the UI invalidation effect runs', async () => {
  const f = scenario(); const pending = f.batch.run(); await tick(); f.finish(); await tick();
  f.batch.markSampleViewed(); f.invalidate();
  assert.equal(f.batch.approve(), false);
  const result = await pending;
  assert.equal(result.skipped, 5);
  assert.equal(f.calls.length, 1);
});

test('changed inputs during preparation or the sample cannot produce an approval step', async () => {
  const preparation = gate();
  const f = scenario({ prepare: () => preparation.promise });
  const pending = f.batch.run(); f.invalidate();
  preparation.resolve(Array.from({ length: 3 }, (_, index) => ({ text: `idea ${index}` })));
  await pending; assert.equal(f.calls.length, 0);
  assert.deepEqual(f.settled.at(-1), { completed: 0, failed: 1 }, 'release the single visible preparation card');
  const sample = scenario(); const samplePending = sample.batch.run(); await tick();
  sample.invalidate(); sample.finish(); await samplePending;
  assert.equal(sample.calls.length, 1);
  assert.ok(!sample.states.some(state => state.phase === 'awaiting_approval'));
});

test('a failed or uncertain sample is never repeated and never starts the remaining images', async () => {
  for (const failure of ['reported', 'network']) {
    const f = scenario(); const pending = f.batch.run(); await tick();
    if (failure === 'reported') f.finish(0, { ok: false, error: 'Submission outcome unknown; inspect the saved job.' });
    else f.gates.get(f.calls[0].id).reject(new Error('Connection lost'));
    const result = await pending;
    assert.equal(f.calls.length, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.skipped, 5);
    assert.equal(f.batch.approve(), false);
    assert.equal(f.prepares(), 1);
  }
});

test('partial ideas fail before any image submission', async () => {
  const f = scenario({ prepare: async () => [{ text: 'one of three' }] });
  const result = await f.batch.run();
  assert.equal(f.calls.length, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 5);
});

test('a draft change in the approval microtask gap still prevents the remainder', async () => {
  const f = scenario(); const pending = f.batch.run(); await tick(); f.finish(); await tick();
  f.batch.markSampleViewed(); assert.equal(f.batch.approve(), true);
  f.invalidate();
  const result = await pending;
  assert.equal(f.calls.length, 1);
  assert.equal(result.skipped, 5);
});

test('an image load failure revokes approval until the same sample becomes viewable', async () => {
  const f = scenario(); const pending = f.batch.run(); await tick(); f.finish(); await tick();
  f.batch.markSampleViewed(); f.batch.markSampleViewed(false);
  assert.equal(f.batch.approve(), false);
  f.batch.cancel(); await pending;
});

test('an image viewed before the completion callback stays viewable at the approval step', async () => {
  const f = scenario(); const pending = f.batch.run(); await tick();
  f.batch.markSampleViewed(); assert.equal(f.batch.approve(), false);
  f.finish(); await tick();
  assert.equal(f.batch.snapshot.canApprove, true);
  f.batch.cancel(); await pending;
});

test('a failed remainder handoff preserves the completed sample without submitting more work', async () => {
  const f = scenario({ onRemainingStart: () => { throw new Error('Review owner unavailable'); } });
  const pending = f.batch.run(); await tick(); f.finish(); await tick();
  f.batch.markSampleViewed(); f.batch.approve();
  const result = await pending;
  assert.deepEqual(result, { completed: 1, failed: 0, skipped: 5, stopped: true });
  assert.equal(f.calls.length, 1);
  assert.ok(!f.patches.some(item => item.patch.status === 'failed'));
});

test('staged work requires a pinned provider and rejects invalid counts before preparation', () => {
  assert.throws(() => scenario({ request: { imageProvider: undefined } }), /provider|sağlayıcı/i);
  assert.throws(() => scenario({ request: { ideaCount: 0 } }));
  assert.throws(() => scenario({ request: { settings: { ...base, count: 11 } } }));
  assert.throws(() => scenario({ request: { settings: { ...base, referenceImages: Array.from({ length: 17 }, (_, index) => ({ id: `ref-${index}`, data: 'synthetic', mimeType: 'image/png' })) } } }));
});
