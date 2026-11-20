import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: ['src/lib/video/h3MaxConfig.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { getH3MaxConfigError, getH3MaxRequestBody, getKnownVideoDuration } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const config = (h3MaxMode, duration) => ({
  mode: 'video', videoModel: 'minimax-h3', h3MaxMode, prompt: 'Keep the same scene', videoDuration: 5, videoQuality: '1080p', videoAspectRatio: '16:9',
  referenceImages: h3MaxMode === 'recast' ? [{ id: 'person', data: 'https://example.invalid/person.png', mimeType: 'image/png', width: 1024, height: 1024 }] : [],
  referenceAudios: [], referenceVideos: [{ id: 'source', url: 'https://example.invalid/source.mp4', mimeType: 'video/mp4', duration }],
});

for (const mode of ['extend_video', 'reference_to_video', 'recast']) {
  test(`${mode} accepts a source saved with the Seedance Auto duration`, () => {
    assert.equal(getH3MaxConfigError(config(mode, -1)), getH3MaxConfigError(config(mode, undefined)));
    assert.doesNotMatch(getH3MaxConfigError(config(mode, -1)) || '', /duration/i);
  });
}

test('real source durations are still validated', () => {
  assert.match(getH3MaxConfigError(config('recast', 3)), /Recast source duration/);
  assert.equal(getH3MaxRequestBody(config('recast', 12)).mediaMetadata.videos[0].duration, 12);
  assert.equal(getH3MaxRequestBody(config('recast', -1)).mediaMetadata.videos[0].duration, undefined);
});

test('only finite positive durations count as known', () => {
  for (const value of [-1, 0, NaN, Infinity, undefined]) assert.equal(getKnownVideoDuration(value), undefined);
  assert.equal(getKnownVideoDuration(4.5), 4.5);
});

test('H3 submission measures a source saved with the Auto duration', () => {
  const service = readFileSync(new URL('../src/services/runwayService.ts', import.meta.url), 'utf8');
  assert.match(service, /getKnownVideoDuration\(ref\.duration\)\?\?await getMediaDuration\(url,'video'\)/);
});
