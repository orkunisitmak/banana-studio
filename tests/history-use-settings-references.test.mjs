import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build, transform } from 'esbuild';

// Run the app's real handlers and the real draft helpers; only the I/O around them is faked.
const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleRecreate = async');
const end = source.indexOf('  const handleGenerateVariation = async', start);
assert.ok(start > 0 && end > start);
const load = async (code, format) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const draft = await build({ entryPoints: [new URL('../src/lib/gallery/recreateDraft.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const { createRecreateConfig, mergeRecreateHydration } = await load(draft.outputFiles[0].text);
const { code } = await transform(`export const create = env => { const { config, recreateLoadIdRef, recreateLoadingRef, setIsRecreateLoading, setConfig, setPromptLoadVersion, resolveImageModel, createRecreateConfig, mergeRecreateHydration, getImageById, toast } = env;
${source.slice(start, end)}
return { handleRecreate, handleHistorySelect }; };`, { loader: 'ts', format: 'esm' });
const { create } = await load(code);

const listRow = { id: 'img-1', mediaType: 'image', prompt: 'portrait of @Alex', imageGenerationPrompt: 'portrait of Image 1', imageGenerationReferenceIds: ['ref-1'],
  referenceImages: [], aspectRatio: '1:1', resolution: '1K', imageModel: 'gemini-3-pro-image-preview' };

const run = async getImageById => {
  let config = { imageModel: 'gemini-3-pro-image-preview', referenceImages: [] };
  const toasts = [];
  const handlers = create({ config, recreateLoadIdRef: { current: 0 }, recreateLoadingRef: { current: null }, setIsRecreateLoading() {}, setPromptLoadVersion() {},
    setConfig: value => { config = typeof value === 'function' ? value(config) : value; }, resolveImageModel: model => model, createRecreateConfig, mergeRecreateHydration,
    getImageById, toast: { info: t => toasts.push('info:' + t), error: t => toasts.push('error:' + t) } });
  await handlers.handleHistorySelect(listRow);
  return { config, toasts };
};

test('History "Use Settings" restores the saved reference photos', async () => {
  const fetched = [];
  const { config } = await run(async id => { fetched.push(id); return { ...listRow, referenceImages: [{ id: 'ref-1', data: 'data:image/png;base64,AAAA', mimeType: 'image/png' }] }; });
  assert.deepEqual(fetched, ['img-1']);
  assert.equal(config.referenceImages.length, 1);
  assert.ok(config.referenceImages.every(ref => ref.data));
});

test('History "Use Settings" warns when the saved reference photos cannot be loaded', async () => {
  const { toasts } = await run(async () => null);
  assert.deepEqual(toasts, ['error:References unavailable']);
});
