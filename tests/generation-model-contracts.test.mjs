import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ stdin: { contents: `
  export { buildFalSeedanceInput as prepare, estimateFalSeedance20Usd } from './src/lib/video/falSeedance25.ts';
  export { buildEvoH3MaxInput } from './src/lib/video/evoH3Max.ts';
  export { estimateSeedreamCost, getSeedreamCostBounds } from './src/lib/images/seedreamPricing.ts';
  export { buildNanoBananaRequest, getNanoBananaInputError } from './src/lib/images/nanoBanana21.ts';
  export { createRecreateConfig } from './src/lib/gallery/recreateDraft.ts';
  export { VIDEO_MODEL_OPTIONS, IMAGE_MODEL_OPTIONS, DEFAULT_IMAGE_MODEL } from './src/types.ts';
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { prepare, estimateFalSeedance20Usd, buildEvoH3MaxInput, estimateSeedreamCost, getSeedreamCostBounds,
  buildNanoBananaRequest, getNanoBananaInputError, createRecreateConfig, VIDEO_MODEL_OPTIONS, IMAGE_MODEL_OPTIONS, DEFAULT_IMAGE_MODEL } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const prompt = 'Walk down the beach.', image = 'https://media.example/start.png', video = 'https://media.example/source.mp4', audio = 'https://media.example/sound.wav';
const request = (mode, fields = {}) => ({ videoModel: 'seedance-2.5', mode, prompt, duration: 6, quality: '4K', aspectRatio: '16:9', generateAudio: false, ...fields });

test('schema controls and optional prompt semantics are mode-specific', () => {
  assert.deepEqual(prepare(request('reference_to_video', { prompt: '', audioUrls: [audio], duration: -1, aspectRatio: 'adaptive', task: 'auto', draft: true, codec: 'H265', returnLastFrame: true, outputFormat: 'mov', bitrateMode: 'high' })).input,
    { aspect_ratio: 'auto', duration: 'auto', resolution: '480p', generate_audio: false, draft: true, codec: 'H265', return_last_frame: true, output_format: 'mov', bitrate_mode: 'high', audio_urls: [audio], task: 'auto' });
  const firstOnly = prepare(request('image_to_video', { imageUrls: [image], prompt: undefined }));
  assert.equal(firstOnly.input.image_url, image); assert.equal(firstOnly.input.prompt, undefined); assert.equal(firstOnly.input.end_image_url, undefined);
  for (let d = 4; d <= 30; d++) assert.equal(prepare(request('text_only', { duration: d })).input.duration, String(d));
  const max = prepare(request('reference_to_video', { imageUrls: Array(30).fill(image), videoUrls: Array(10).fill(video), audioUrls: Array(10).fill(audio) }));
  assert.equal(max.input.image_urls.length + max.input.video_urls.length + max.input.audio_urls.length, 50);
});

test('fal 2.0 uses nominal token estimates, never EvoLink rates or a guessed auto duration', () => {
  const config = { videoDuration: 10, videoQuality: '720p' };
  const tokens = 1280 * 720 * 24 / 1024;
  assert.equal(estimateFalSeedance20Usd(config), tokens * 10 * 0.014 / 1000);
  assert.equal(estimateFalSeedance20Usd({ ...config, referenceVideos: [{ duration: 6 }] }), tokens * 16 * 0.0086016 / 1000);
  assert.equal(estimateFalSeedance20Usd({ ...config, videoDuration: -1 }), undefined);
  assert.equal(estimateFalSeedance20Usd({ ...config, referenceVideos: [{}] }), undefined);
});

test('public pickers have one logical ID per model, not an entry for each provider', () => {
  assert.deepEqual(IMAGE_MODEL_OPTIONS.map(({ value }) => value).sort(), ['gemini-3-pro-image-preview', 'gemini-nano-banana-2.1', 'gpt-image-2.5-sunburst', 'gpt-image-2.6-sunburst', 'seedream-5.5']);
  assert.deepEqual(VIDEO_MODEL_OPTIONS.map(({ value }) => value).sort(), ['gemini-omni-1.2-flash', 'magi-2', 'minimax-h3', 'seedance-2.0', 'seedance-2.5']);
});

test('EvoLink H3 maps its own endpoint, limits and supported fields', () => {
  const base = { videoModel: 'minimax-h3', prompt };
  assert.deepEqual(buildEvoH3MaxInput({ ...base, mode: 'text_only' }), { model: 'minimax-h3-max-text-to-video', prompt, quality: '768p', duration: 5, aspect_ratio: '16:9' });
  assert.deepEqual(buildEvoH3MaxInput({ ...base, mode: 'image_to_video', imageUrls: [image, image] }), { model: 'minimax-h3-max-image-to-video', prompt, quality: '768p', duration: 5, image_start: image, image_end: image });
  assert.deepEqual(buildEvoH3MaxInput({ ...base, mode: 'reference_to_video', videoUrls: [video] }), { model: 'minimax-h3-max-reference-to-video', prompt, quality: '768p', duration: 5, aspect_ratio: 'adaptive', video_urls: [video] });
  for (const fields of [{ mode: 'text_only', quality: '4K' }, { mode: 'text_only', generateAudio: true }, { mode: 'reference_to_video', audioUrls: [audio] }, { mode: 'image_to_video', imageUrls: [image], aspectRatio: '16:9' }]) {
    assert.throws(() => buildEvoH3MaxInput({ ...base, ...fields }));
  }
});

test('Seedream edit fees repeat per output; layerize bills its source only once', () => {
  assert.equal(estimateSeedreamCost({ mode: 'edit', imageSize: 'auto_1K' }, 2, 3), .162);
  assert.deepEqual(getSeedreamCostBounds({ mode: 'layerize', layerSize: 'auto_1K' }, 1, 1, 3), { min: .042, max: .102 });
  assert.equal(estimateSeedreamCost({ mode: 'layerize', layerSize: 'auto' }, 1, 1), null);
});

test('Nano 2.1 requests high thinking; Pro does not override its default', () => {
  const settings = { aspectRatio: '16:9', resolution: '2K' };
  for (const [model, endpoint, thinking] of [['gemini-3-pro-image-preview', 'fal-ai/nano-banana-pro', undefined], ['gemini-nano-banana-2.1', 'google/nano-banana-2.1', 'high']]) {
    const result = buildNanoBananaRequest(model, prompt, settings, [image]);
    assert.equal(result.endpoint, endpoint + '/edit'); assert.equal(result.input.thinking_level, thinking);
    assert.deepEqual(result.input.image_urls, [image]); assert.equal(getNanoBananaInputError(result.input, result.endpoint), null);
  }
});

test('recreate keeps provider-specific controls without changing the logical model', () => {
  const row = { id: 'item', mediaType: 'video', prompt, referenceImages: [], videoOperation: 'generate' };
  const seedance = createRecreateConfig({ ...row, videoModel: 'seedance-2.0', videoDuration: -1, falSeedanceOptions: { returnLastFrame: true }, generationProvider: 'fal' }, DEFAULT_IMAGE_MODEL);
  assert.equal(seedance.videoDuration, -1); assert.equal(seedance.videoProvider, 'fal');
  assert.deepEqual(seedance.falSeedanceOptions, { returnLastFrame: true });
  const h3 = createRecreateConfig({ ...row, videoModel: 'minimax-h3', generationProvider: 'evolink', h3MaxMode: 'text_to_video', h3MaxOptions: { seed: 0 } }, DEFAULT_IMAGE_MODEL);
  assert.equal(h3.videoProvider, 'evolink'); assert.equal(h3.videoModel, 'minimax-h3'); assert.equal(h3.h3MaxOptions, undefined); assert.equal(h3.videoQuality, '768p');
  const magi = createRecreateConfig({ ...row, videoModel: 'magi-2', generationProvider: 'evolink', magi2Mode: 'image_to_video' }, DEFAULT_IMAGE_MODEL);
  assert.equal(magi.videoAspectRatio, 'adaptive'); assert.equal(magi.videoQuality, '1080p'); assert.equal(magi.magi2Mode, 'image_to_video');
});
