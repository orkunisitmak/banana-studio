import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Run the real deleteImages and handleDeleteMultiple sources; only the single-item delete and the UI are faked.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const slice = (src, from, to) => { const i = src.indexOf(from); return src.slice(i, src.indexOf(to, i)); };
const storage = read('../src/services/storageService.ts');
const app = read('../src/App.tsx');
const code = transformSync(`module.exports = env => { const { generatedMedia, setGeneratedMedia, deleteImage, toast, deletedMediaIdsRef, describeMediaCount } = env;
${slice(storage, 'export const deleteImages = async', 'export const toggleFavorite').replace('export const', 'const')}
${slice(app, '  const handleDeleteMultiple = async', '  const handleToggleFavorite')}
return { deleteImages, handleDeleteMultiple }; };`, { loader: 'ts', format: 'cjs' }).code;

const media = [{ id: 'a', mediaType: 'image' }, { id: 'b', mediaType: 'image' }];
const setup = deleteImage => {
  const mod = { exports: {} }; new Function('module', code)(mod);
  const toasts = [];
  const env = { generatedMedia: media, setGeneratedMedia() {}, deleteImage, toast: { success: t => toasts.push('success:' + t), error: t => toasts.push('error:' + t) },
    deletedMediaIdsRef: { current: new Set() }, describeMediaCount: ids => `${ids.length} images` };
  return { ...mod.exports(env), toasts };
};
const quiet = async fn => { const original = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = original; } };

test('batch delete reports a failure when every delete fails', async () => {
  const t = setup(async () => { throw new Error('Not authenticated'); });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.deepEqual(t.toasts, ['error:Delete Failed']);
});

test('batch delete reports a failure when only some deletes fail, after trying all of them', async () => {
  const tried = [];
  const t = setup(async m => { tried.push(m.id); if (m.id === 'a') throw new Error('boom'); });
  await quiet(() => t.handleDeleteMultiple(['a', 'b']));
  assert.deepEqual(tried, ['a', 'b']);
  assert.deepEqual(t.toasts, ['error:Delete Failed']);
});

test('batch delete still reports success when every delete works', async () => {
  const t = setup(async () => {});
  await t.handleDeleteMultiple(['a', 'b']);
  assert.deepEqual(t.toasts, ['success:Deleted']);
});
