import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/gallery/deleteConfirmation.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { describeBatchDelete, describeMediaCount } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const media = [{ id: 'i1', mediaType: 'image' }, { id: 'i2', mediaType: 'image' }, { id: 'v1', mediaType: 'video' }, { id: 'v2', mediaType: 'video' }];

test('the confirmation names the selected images and videos', () => {
  assert.equal(describeBatchDelete(['i1', 'i2', 'v1'], media), 'Delete 2 images and 1 video?');
  assert.equal(describeBatchDelete(new Set(['v1', 'v2']), media), 'Delete 2 videos?');
  assert.equal(describeBatchDelete(['i1'], media), 'Delete 1 image?');
  assert.equal(describeBatchDelete(['v1'], media), 'Delete 1 video?');
});

test('selected items missing from the loaded list are still counted', () => {
  assert.equal(describeBatchDelete(['i1', 'v1', 'gone'], media), 'Delete 1 image, 1 video and 1 other item?');
  assert.equal(describeBatchDelete(['gone', 'gone2'], media), 'Delete 2 items?');
});

test('the success message names what was deleted', () => {
  assert.equal(describeMediaCount(['v1', 'v2'], media), '2 videos');
  assert.equal(describeMediaCount(['i1', 'v1'], media), '1 image and 1 video');
  assert.equal(describeMediaCount(['i1'], media), '1 image');
});

// Runs the exact App handleDeleteMultiple source with the real helper.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = app.indexOf('  const handleDeleteMultiple = async');
const handler = transformSync(`module.exports = env => { const { generatedMedia, setGeneratedMedia, deleteImages, toast, deletedMediaIdsRef, describeMediaCount } = env;
${app.slice(start, app.indexOf('  const handleToggleFavorite', start))}return handleDeleteMultiple; };`, { loader: 'ts', format: 'cjs' }).code;

test('the batch delete success toast names the deleted images and videos', async () => {
  for (const [ids, message] of [[['v1', 'v2'], '2 videos removed.'], [['i1', 'v1'], '1 image and 1 video removed.']]) {
    const deleted = [], toasts = [], mod = { exports: {} };
    new Function('module', handler)(mod);
    await mod.exports({ generatedMedia: media, setGeneratedMedia() {}, deleteImages: async items => deleted.push(...items.map(m => m.id)),
      toast: { success: (_title, text) => toasts.push(text), error() {} }, deletedMediaIdsRef: { current: new Set() }, describeMediaCount })(ids);
    assert.deepEqual(deleted, ids);
    assert.deepEqual(toasts, [message]);
  }
});

test('an ID shared by two loaded items is counted once', () => {
  const twins = [{ id: 'temp-1', mediaType: 'image' }, { id: 'temp-1', mediaType: 'image' }];
  assert.equal(describeBatchDelete(['temp-1'], twins), 'Delete 1 image?');
  assert.equal(describeMediaCount(['temp-1', 'gone'], twins), '1 image and 1 other item');
});
