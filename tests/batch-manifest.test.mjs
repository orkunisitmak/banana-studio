import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/gallery/batchManifest.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildBatchManifest } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const media = [
  { id: 'a', url: 'https://cdn/a?token=secret', mediaType: 'image', prompt: 'A pear', originalPrompt: 'pear', imageGenerationPrompt: 'A pear [ref: Me]',
    imageModel: 'gemini-3-pro-image-preview', generationProvider: 'gemini', aspectRatio: '16:9', resolution: '2K', createdAt: Date.UTC(2026, 9, 30),
    referenceImages: [{ id: 'r1', data: 'data:image/png;base64,xx', mimeType: 'image/png', personName: 'Me' }, { id: 'r2', data: 'https://cdn/r2?sig=1', mimeType: 'image/png' }] },
  { id: 'v', url: 'https://cdn/v', mediaType: 'video', prompt: 'Pan', videoModel: 'seedance-2.5', videoAspectRatio: '9:16', videoQuality: '1080p',
    videoDuration: 5, videoOutputDuration: 5.2, generationCost: { usd: 0.42 }, createdAt: Date.UTC(2026, 9, 30, 1), referenceImages: [] },
];
const files = [{ name: 'banana-a.png' }];

test('the manifest lists every selected item next to its ZIP file name', () => {
  const { items } = JSON.parse(buildBatchManifest(['a', 'v', 'gone'], media, files));
  assert.deepEqual(items.map(item => [item.id, item.file]), [['a', 'banana-a.png'], ['v', null]]);
  assert.deepEqual(items[0].references, ['Me', 'r2']);
  assert.equal(items[0].providerPrompt, 'A pear [ref: Me]');
  assert.deepEqual([items[0].model, items[0].aspectRatio, items[0].resolution], ['gemini-3-pro-image-preview', '16:9', '2K']);
  assert.deepEqual([items[1].model, items[1].aspectRatio, items[1].resolution, items[1].videoDuration, items[1].costUsd], ['seedance-2.5', '9:16', '1080p', 5.2, 0.42]);
  assert.equal(items[0].createdAt, '2026-10-30T00:00:00.000Z');
});

test('signed media and reference URLs never reach the manifest', () => {
  const text = buildBatchManifest(['a', 'v'], media, files);
  assert.ok(!/https?:|data:|secret|sig=/.test(text), text);
});
