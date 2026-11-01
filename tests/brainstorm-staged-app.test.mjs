import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, transformSync } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = await build({ entryPoints: [`${root}/src/lib/brainstorm/brainstormGeneration.ts`], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createBrainstormBatch } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleBrainstormGenerate =');
const end = source.indexOf('  const handleClearHistory =', start);
assert.ok(start > 0 && end > start);
const code = transformSync(`module.exports = env => {
  const { currentFolderId, brainstormBatchesRef, setIsBrainstormPreparing, createBrainstormBatch, brainstormIdeas,
    runImageGeneration, setGeneratedMedia, setActiveRequests, toast, workspaceActive, brainstormDraftRef,
    setBrainstormReview, generatedMediaRef } = env;
  ${source.slice(start, end)}
  return { start: handleBrainstormGenerate, stop: handleCancelBrainstorm, check: handleCheckBrainstorm,
    viewed: handleBrainstormSampleViewed, approve: handleApproveBrainstorm };
};`, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} }; new Function('module', code)(mod);
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function scenario(options = {}) {
  const original = { prompt: 'Synthetic concept', mode: 'image', imageModel: 'gpt-image-2.5-sunburst', count: 2,
    aspectRatio: '1:1', resolution: '1K', referenceImages: [] };
  const draft = { current: original }, batches = { current: new Map() }, mediaRef = { current: [] }, calls = [], gates = [];
  let media = [], active = 0, review = null, preparing = false, toastCounter = 0;
  const setMedia = update => { media = update(media); mediaRef.current = media; };
  const api = mod.exports({ currentFolderId: 'synthetic-folder', brainstormBatchesRef: batches, createBrainstormBatch,
    workspaceActive: { current: true }, brainstormDraftRef: draft, generatedMediaRef: mediaRef,
    setIsBrainstormPreparing: value => { preparing = value; },
    setGeneratedMedia: setMedia, setActiveRequests: update => { active = update(active); },
    setBrainstormReview: update => { review = typeof update === 'function' ? update(review) : update; },
    brainstormIdeas: async (_refs, _category, _prompt, _unused, count) => {
      if (options.prepare) return options.prepare(count);
      return Array.from({ length: count }, (_, index) => ({ text: `Prepared idea ${index}` }));
    },
    runImageGeneration: async (placeholder, settings, folderId) => {
      const pending = gate(); calls.push({ placeholder, settings, folderId }); gates.push(pending);
      const result = await pending.promise;
      setMedia(previous => previous.map(item => item.id === placeholder.id
        ? { ...item, isLoading: false, status: result.ok ? 'completed' : 'failed', url: result.ok ? 'data:image/png;base64,synthetic' : '' } : item));
      return result;
    },
    toast: { loading: () => `toast-${toastCounter++}`, updateToast() {}, dismissToast() {}, success() {}, warning() {}, error() {}, info() {} },
  });
  const request = mode => ({ settings: draft.current, category: 'simple', ideaCount: 2, textModel: 'gpt-6.1-sol', reasoningEffort: 'medium',
    generationMode: mode || 'sample_first', imageProvider: 'openai' });
  return { api, draft, batches, calls, gates, request,
    finish: (index, result = { ok: true }) => gates[index].resolve(result),
    state: () => ({ media, active, review, preparing }),
    removeSample: id => setMedia(previous => previous.filter(item => item.id !== id)),
  };
}

test('App reserves only the sample, releases its busy slot while paused, and adds the rest once', async () => {
  const f = scenario(); const id = f.api.start(f.request()); const batch = f.batches.current.get(id);
  assert.equal(f.state().media.length, 1);
  assert.equal(f.state().active, 1);
  await tick(); assert.equal(f.calls.length, 1);
  assert.equal(f.state().preparing, false);
  f.finish(0); await tick();
  assert.equal(f.state().active, 0);
  assert.equal(f.state().review.phase, 'awaiting_approval');
  assert.equal(f.state().review.remaining, 3);
  f.api.approve(id); await tick(); assert.equal(f.calls.length, 1);
  f.api.viewed(id, true); f.api.approve(id); f.api.approve(id); await tick();
  assert.equal(f.calls.length, 4);
  assert.equal(f.state().media.length, 4);
  assert.equal(f.state().active, 3);
  for (let index = 1; index < 4; index++) f.finish(index);
  await batch.run(); await tick();
  assert.equal(f.state().active, 0);
  assert.equal(f.state().review, null);
  assert.equal(f.batches.current.size, 0);
  assert.equal(f.state().media.filter(item => item.status === 'completed').length, 4);
});

test('App rejects repeated sample starts while one sample owns the review', async () => {
  const f = scenario(); const id = f.api.start(f.request());
  assert.throws(() => f.api.start(f.request()), /denemeyi/);
  await tick(); assert.equal(f.calls.length, 1);
  f.api.stop(id); f.finish(0); await f.batches.current.get(id).run(); await tick();
  assert.equal(f.state().active, 0);
});

test('App catches a changed draft on approval even without a prior invalidation callback', async () => {
  const f = scenario(); const id = f.api.start(f.request()); const batch = f.batches.current.get(id);
  await tick(); f.finish(0); await tick(); f.api.viewed(id, true);
  f.draft.current = { ...f.draft.current, prompt: 'New concept' };
  f.api.approve(id); await batch.run(); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.draft.current.prompt, 'New concept');
  assert.equal(f.state().review, null);
  assert.equal(f.state().active, 0);
});

test('App releases the visible preparation card when changed inputs stop a late preparation', async () => {
  const preparation = gate(); const f = scenario({ prepare: () => preparation.promise });
  const id = f.api.start(f.request()); const batch = f.batches.current.get(id);
  f.draft.current = { ...f.draft.current, prompt: 'New brief' }; f.api.check();
  await batch.run(); preparation.resolve([{ text: 'late 0' }, { text: 'late 1' }]); await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.state().active, 0);
  assert.equal(f.state().preparing, false);
  assert.equal(f.state().review, null);
});

test('a stopped sample finishing late cannot clear or approve a newer review', async () => {
  const f = scenario(); const first = f.api.start(f.request()); const firstBatch = f.batches.current.get(first);
  await tick(); f.api.stop(first);
  const second = f.api.start(f.request()); const secondBatch = f.batches.current.get(second);
  await tick(); assert.equal(f.calls.length, 2);
  f.finish(0); await firstBatch.run(); await tick();
  assert.equal(f.state().review.id, second);
  assert.equal(f.state().active, 1);
  f.finish(1); await tick();
  f.api.viewed(first, true); f.api.approve(first); await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.state().review.id, second);
  f.api.stop(second); await secondBatch.run(); await tick();
  assert.equal(f.state().active, 0);
});

test('deleting the completed sample cannot release remaining paid requests through an old callback', async () => {
  const f = scenario(); const id = f.api.start(f.request()); const batch = f.batches.current.get(id);
  await tick(); f.finish(0); await tick(); f.api.viewed(id, true);
  f.removeSample(batch.snapshot.sampleId); f.api.approve(id); await batch.run(); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.state().active, 0);
  assert.equal(f.state().review, null);
});

test('the explicit all-images App path retains four independent cards and balanced counters', async () => {
  const f = scenario(); const id = f.api.start(f.request('all')); const batch = f.batches.current.get(id);
  await tick(); assert.equal(f.calls.length, 4); assert.equal(f.state().active, 4);
  assert.equal(f.state().review, null);
  for (let index = 0; index < 4; index++) f.finish(index);
  await batch.run(); await tick();
  assert.equal(f.state().active, 0);
  assert.equal(f.batches.current.size, 0);
});
