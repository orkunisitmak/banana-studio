import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

// Run the app's real handlers and the real draft helpers; only the I/O around them is faked.
const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleRecreate = async');
const end = source.indexOf('  const handleGenerateVariation = async', start);
assert.ok(start > 0 && end > start);
const load = async (code, format) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const draft = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/gallery/recreateDraft.ts', import.meta.url))], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const { createRecreateConfig, mergeRecreateHydration, restoreRecreateReferences } = await load(draft.outputFiles[0].text);
const { code } = await transform(`export const create = env => { const { config, recreateLoadIdRef, recreateLoadingRef, setIsRecreateLoading, setConfig, setPromptLoadVersion, resolveImageModel, createRecreateConfig, mergeRecreateHydration, restoreRecreateReferences, getImageById, getSavedPerson, toast } = env;
${source.slice(start, end)}
return { handleRecreate, handleHistorySelect }; };`, { loader: 'ts', format: 'esm' });
const { create } = await load(code);

const listRow = { id: 'img-1', mediaType: 'image', prompt: 'portrait of @Alex', imageGenerationPrompt: 'portrait of Image 1', imageGenerationReferenceIds: ['ref-1'],
  referenceImages: [], aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview' };

const refPhoto = id => ({ id, data: 'data:image/png;base64,AAAA', mimeType: 'image/png' });
const withIds = (ids, extra = {}) => ({ ...listRow, imageGenerationReferenceIds: ids, ...extra });

// One editor session: every call goes through the same handlers, config and load counter, like the real component.
const session = (getImageById, getSavedPerson) => {
  const state = { config: { imageModel: 'gemini-3-pro-image-preview', referenceImages: [] }, toasts: [] };
  const handlers = create({ config: state.config, recreateLoadIdRef: { current: 0 }, recreateLoadingRef: { current: null }, setIsRecreateLoading(value) { state.loading = value; }, setPromptLoadVersion() {},
    setConfig: value => { state.config = typeof value === 'function' ? value(state.config) : value; }, resolveImageModel: model => model, createRecreateConfig, mergeRecreateHydration,
    getImageById, getSavedPerson, restoreRecreateReferences, toast: { info: (t) => state.toasts.push('info:' + t), error: (t) => state.toasts.push('error:' + t) } });
  return { state, select: handlers.handleHistorySelect };
};
const run = async (getImageById, row = listRow) => {
  const { state, select } = session(getImageById);
  await select(row);
  return state;
};

test('History "Use Settings" restores the saved reference photos', async () => {
  const fetched = [];
  const { config, toasts } = await run(async id => { fetched.push(id); return { ...listRow, referenceImages: [refPhoto('ref-1')] }; });
  assert.deepEqual(fetched, ['img-1']);
  assert.equal(config.referenceImages.length, 1);
  assert.ok(config.referenceImages.every(ref => ref.data));
  assert.deepEqual(toasts, ['info:Settings Loaded']);
});

test('History "Use Settings" warns when the detail read returns nothing', async () => {
  const { toasts } = await run(async () => null);
  assert.deepEqual(toasts, ['error:References unavailable']);
});

test('History "Use Settings" warns when the detail read throws', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { toasts, config } = await run(async () => { throw new Error('network down'); });
    assert.deepEqual(toasts, ['error:References unavailable']);
    assert.ok(config.prompt.trim());
  } finally { console.warn = warn; }
});

test('History "Use Settings" warns on a failed read even when the row has no saved reference ids (video)', async () => {
  const video = { ...listRow, id: 'vid-1', mediaType: 'video', imageGenerationReferenceIds: undefined, referenceVideos: [] };
  const { toasts } = await run(async () => null, video);
  assert.deepEqual(toasts, ['error:References unavailable']);
});

test('History "Use Settings" warns when only some of the saved references come back', async () => {
  const row = withIds(['ref-1', 'ref-2']);
  const { config, toasts } = await run(async () => ({ ...row, referenceImages: [refPhoto('ref-1')] }), row);
  assert.deepEqual(toasts, ['error:References unavailable']);
  assert.deepEqual(config.referenceImages.map(ref => [ref.id, Boolean(ref.data)]), [['ref-1', true], ['ref-2', false]]);
});

test('History "Use Settings" stays quiet-success when every saved reference comes back', async () => {
  const row = withIds(['ref-1', 'ref-2']);
  const { toasts } = await run(async () => ({ ...row, referenceImages: [refPhoto('ref-2'), refPhoto('ref-1')] }), row);
  assert.deepEqual(toasts, ['info:Settings Loaded']);
});

test('History "Use Settings" retries the same selection after a failed read', async () => {
  let attempts = 0;
  const { state, select } = session(async () => (++attempts === 1 ? null : { ...listRow, referenceImages: [refPhoto('ref-1')] }));
  await select(listRow);
  assert.deepEqual(state.toasts, ['error:References unavailable']);
  assert.equal(state.config.referenceImages[0].data, '');
  await select(listRow);
  assert.equal(attempts, 2);
  assert.deepEqual(state.toasts, ['error:References unavailable', 'info:Settings Loaded']);
  assert.equal(state.config.referenceImages.length, 1);
  assert.ok(state.config.referenceImages[0].data);
});

test('a stale read that finishes late does not override the newer History selection', async () => {
  const other = { ...listRow, id: 'img-2', prompt: 'landscape', imageGenerationPrompt: 'landscape', imageGenerationReferenceIds: ['ref-2'] };
  const releases = {};
  const { state, select } = session(id => new Promise(resolve => { releases[id] = () => resolve(id === 'img-1'
    ? { ...listRow, referenceImages: [refPhoto('ref-1')] } : { ...other, referenceImages: [refPhoto('ref-2')] }); }));
  const first = select(listRow);
  const second = select(other);
  releases['img-2']();
  await second;
  assert.deepEqual(state.toasts, ['info:Settings Loaded']);
  assert.deepEqual(state.config.referenceImages.map(ref => ref.id), ['ref-2']);
  releases['img-1']();
  await first;
  assert.deepEqual(state.toasts, ['info:Settings Loaded']);
  assert.equal(state.config.prompt, 'landscape');
  assert.deepEqual(state.config.referenceImages.map(ref => ref.id), ['ref-2']);
});

test('a stale read that fails late does not warn over the newer selection', async () => {
  const other = { ...listRow, id: 'img-2', prompt: 'landscape', imageGenerationPrompt: 'landscape', imageGenerationReferenceIds: ['ref-2'] };
  const releases = {};
  const { state, select } = session(id => new Promise(resolve => { releases[id] = () => resolve(id === 'img-1' ? null : { ...other, referenceImages: [refPhoto('ref-2')] }); }));
  const first = select(listRow);
  const second = select(other);
  releases['img-2']();
  await second;
  releases['img-1']();
  await first;
  assert.deepEqual(state.toasts, ['info:Settings Loaded']);
  assert.equal(state.config.prompt, 'landscape');
});

test('restores missing Saved People slots by owner and photo, preserving role and exact matches before fallback', async () => {
  const missing = ['removed', 'b', 'unavailable'].map(id => ({ id: `saved-person:alice:${id}`, personId: 2, data: '' }));
  const row = withIds(missing.map(ref => ref.id), { referenceImages: missing });
  const reads = [];
  const { state, select } = session(async () => row, async id => {
    reads.push(id);
    return { id, photos: ['b', 'c'].map(key => ({ id: key, data: `data:image/png;base64,${key}`, mimeType: 'image/png' })) };
  });
  await select(row);
  assert.deepEqual(reads, ['alice']);
  assert.deepEqual(state.config.referenceImages.map(ref => [ref.id, ref.personId, ref.data]), [
    [missing[0].id, 2, 'data:image/png;base64,c'], [missing[1].id, 2, 'data:image/png;base64,b'], [missing[2].id, 2, ''],
  ]);
  assert.deepEqual(state.toasts, ['error:References unavailable']);
});

test('slow Saved People recovery cannot overwrite a newer selection', async () => {
  const id = 'saved-person:alice:photo';
  const row = withIds([id]);
  let begin, finish;
  const started = new Promise(resolve => { begin = resolve; });
  const { select, state } = session(async key => key === row.id ? row : null, () => new Promise(resolve => { finish = resolve; begin(); }));
  const first = select(row);
  await started;
  assert.equal(state.loading, true, 'keep Generate and Brainstorm blocked until recovery finishes');
  await select({ ...listRow, id: 'new', referenceImages: [refPhoto('ref-1')] });
  finish({ id: 'alice', photos: [refPhoto('photo')] });
  await first;
  assert.deepEqual(state.config.referenceImages, [refPhoto('ref-1')]);
  assert.deepEqual(state.toasts, ['info:Settings Loaded']);
});

test('Magi keeps numbered image slots and recovers the matching person even from a partial detail row', async () => {
  const ids = ['saved-person:alice:first', 'middle', 'last'];
  const row = { ...listRow, mediaType: 'video', videoModel: 'magi-2', magi2Mode: 'reference_to_video',
    videoReferenceImageIds: ids, imageGenerationReferenceIds: undefined, referenceImages: [refPhoto('last')],
    referenceVideos: [{ id: 'clip' }], referenceAudios: [{ id: 'audio' }] };
  const fetched = [];
  const { state, select } = session(async id => { fetched.push(id); return { ...row, referenceImages: [refPhoto('last'), refPhoto('middle')] }; },
    async id => ({ id, photos: [{ ...refPhoto('first'), data: 'first-pixels' }] }));
  await select(row);
  assert.deepEqual(fetched, [row.id]);
  assert.deepEqual(state.config.referenceImages.map(({ id }) => id), ids);
  assert.equal(state.config.referenceImages[0].data, 'first-pixels');
  assert.equal(state.loading, false);
  assert.deepEqual(state.toasts, ['info:Settings Loaded']);
});
