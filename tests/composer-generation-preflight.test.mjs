import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({ stdin: { contents: `export { resolveImageDraft } from './src/lib/images/imageDraftValidation'; export { videoDraftError } from './src/lib/video/videoDraftValidation';`, resolveDir: process.cwd() }, format: 'esm', platform: 'node', write: false, bundle: true });
const { resolveImageDraft, videoDraftError } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const video = { mode: 'video', videoOperation: 'generate', videoDuration: 15, videoQuality: '720p', videoAspectRatio: '16:9', prompt: 'A slow pan across a meadow', referenceImages: [], referenceVideos: [], referenceAudios: [] };

test('a restored Seedance action is validated against the selected provider and version', () => {
  const standard = { ...video, videoModel: 'seedance-2.0', videoProvider: 'fal' };
  assert.ok(!videoDraftError(standard));
  assert.ok(videoDraftError({ ...standard, videoDuration: 30 }));
  assert.ok(videoDraftError({ ...standard, videoOperation: 'extend' }));
  assert.ok(!videoDraftError({ ...standard, videoModel: 'seedance-2.5', videoDuration: 30 }));
});

test('MAGI and Omni block incompatible inputs before creating a pending card', () => {
  const magi = { ...video, videoProvider: 'evolink', videoModel: 'magi-2', magi2Mode: 'text_only', videoQuality: '1080p' };
  assert.ok(!videoDraftError(magi));
  assert.match(videoDraftError({ ...magi, videoQuality: '720p' }), /1080p/);
  assert.ok(videoDraftError({ ...magi, magi2Mode: 'image_to_video' }));
  assert.match(videoDraftError({ ...video, videoModel: 'gemini-omni-1.2-flash', videoProvider: 'fal', referenceAudios: [{ id: 'sound' }] }), /audio/i);
});

test('Seedream retains a grouped request while invalid sources cannot enter image preparation', () => {
  const draft = { ...video, mode: 'image', imageModel: 'seedream-5.5', count: 6, aspectRatio: '1:1', resolution: '1K', seedreamOptions: { mode: 'text-to-image', numImages: 3 } };
  const ready = resolveImageDraft(draft);
  assert.equal(ready.count, 1);
  assert.equal(ready.seedreamOptions.numImages, 3);
  assert.throws(() => resolveImageDraft({ ...draft, seedreamOptions: { mode: 'layerize' } }, true));
  assert.throws(() => resolveImageDraft({ ...draft, imageModel: 'gemini-nano-banana-2.1', referenceImages: [{ id: 'missing', data: '' }] }, true), /valid reference/i);
});
