import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  export * from './src/lib/images/imageOperation.ts';
  export { getSunburstEditIntent, validateImageGenerationReferences, moveEditSourceFirst, prepareSunburstGeneration } from './src/lib/images/imagePrompting.ts';
  export { toggleWholeImageEditSource } from './src/lib/images/imageReferences.ts';
  export * from './src/lib/video/omniFlash.ts';
  export { IMAGE_MODEL_OPTIONS, VIDEO_MODEL_OPTIONS, VIDEO_QUALITY_OPTIONS, DEFAULT_IMAGE_MODEL, getActiveImageModel, getImageModelLabel } from './src/types.ts';
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const ref = (id, extra = {}) => ({ id, data: `https://storage.test/${id}.png`, mimeType: 'image/png', ...extra });
const area = { x: .1, y: .2, width: .3, height: .4 };
const settings = { imageModel: 'gpt-image-2.6-sunburst', aspectRatio: '16:9', resolution: '2K' };

test('GPT Image 2.6 Sunburst is the new default and 2.5 keeps its stored ID with a shorter label', () => {
  assert.equal(api.DEFAULT_IMAGE_MODEL, 'gpt-image-2.6-sunburst');
  const labels = Object.fromEntries(api.IMAGE_MODEL_OPTIONS.map(option => [option.value, option.label]));
  assert.equal(labels['gpt-image-2.6-sunburst'], 'GPT Image 2.6 Sunburst');
  assert.equal(labels['gpt-image-2.6-flare'], undefined);
  assert.equal(api.getActiveImageModel('gpt-image-2.6-flare'), 'gpt-image-2.6-sunburst');
  assert.equal(api.getImageModelLabel('gpt-image-2.6-flare'), 'GPT Image 2.6 Flare (retired)');
  assert.equal(labels['gpt-image-2.5-sunburst'], 'GPT Image 2.5');
  assert.equal(api.getActiveImageModel('gpt-image-2-beta'), 'gpt-image-2.5-sunburst');
});

test('a prompt that says edit or düzenle with the Generate action never takes the edit path', () => {
  for (const prompt of ['Edit image 1: make the sky orange.', 'Bu görseli düzenle, gökyüzü turuncu olsun.', 'edit edit edit']) {
    const config = { ...settings, prompt, imageOperation: 'generate', referenceImages: [ref('source', { isEditSource: true, editRegion: area }), ref('donor')] };
    const resolved = api.resolveImageOperation(config);
    assert.ok(resolved.referenceImages.every(image => image.editRegion == null && image.editScope == null && !image.isEditSource), 'leftover selections are cleared');
    assert.equal(api.getSunburstEditIntent(prompt, config.referenceImages, config), undefined);
    assert.doesNotThrow(() => api.validateImageGenerationReferences(config));
    const prepared = api.prepareSunburstGeneration(prompt, resolved.referenceImages, resolved);
    assert.match(prepared.prompt, /REFERENCE-BASED GENERATION/);
    assert.doesNotMatch(prepared.prompt, /WHOLE IMAGE EDIT|LOCAL IMAGE EDIT|SOURCE: IMAGE/);
    // Without references the same words are plain text-to-image.
    assert.equal(api.getImageOperation({ prompt, referenceImages: [] }), 'generate');
  }
});

test('the Edit action edits even when the prompt never says edit, and needs a source image', () => {
  const config = { ...settings, prompt: 'Make the sky orange.', imageOperation: 'edit', referenceImages: [ref('person', { personId: 1 }), ref('photo')] };
  assert.deepEqual(api.getSunburstEditIntent(config.prompt, config.referenceImages, config), { sourceIndex: 1, wholeImage: true });
  const resolved = api.resolveImageOperation(config);
  assert.equal(resolved.referenceImages[1].editScope, 'image', 'the first non-person image becomes the whole-image source');
  assert.equal(resolved.referenceImages[0].editScope, undefined);
  assert.match(api.prepareSunburstGeneration(config.prompt, resolved.referenceImages, resolved).prompt, /WHOLE IMAGE EDIT/);
  const withArea = { ...config, referenceImages: [ref('photo', { isEditSource: true, editRegion: area })] };
  assert.deepEqual(api.getSunburstEditIntent(withArea.prompt, withArea.referenceImages, withArea), { sourceIndex: 0 });
  for (const referenceImages of [[], [ref('person', { personId: 1 })]]) {
    assert.throws(() => api.resolveImageOperation({ ...config, referenceImages }), new RegExp(api.IMAGE_EDIT_SOURCE_REQUIRED.slice(0, 30)));
    assert.throws(() => api.validateImageGenerationReferences({ ...config, referenceImages }), /source image/);
  }
  assert.throws(() => api.validateImageGenerationReferences({ ...config, imageModel: 'gpt-image-2.5-sunburst' }), /Draw an Edit area/);
});

test('switching to Generate clears selections; older drafts without an action keep explicit selections only', () => {
  const editing = { ...settings, prompt: 'x', imageOperation: 'edit', referenceImages: [ref('photo', { isEditSource: true, editRegion: area })] };
  const generating = api.setImageOperation(editing, 'generate');
  assert.equal(generating.imageOperation, 'generate');
  assert.equal(generating.referenceImages[0].editRegion, undefined);
  assert.equal(api.setImageOperation(generating, 'edit').imageOperation, 'edit');
  assert.equal(api.getImageOperation({ referenceImages: [ref('photo', { editRegion: area })] }), 'edit');
  assert.equal(api.getImageOperation({ referenceImages: [ref('photo', { isEditSource: true })] }), 'generate', 'an old source label alone never edits');
  assert.equal(api.getRequestedImageOperation('generate', [ref('photo', { editRegion: area })]), 'generate');
  assert.equal(api.getRequestedImageOperation(undefined, [ref('photo', { editScope: 'image' })]), 'edit');
  assert.equal(api.getRequestedImageOperation('inpaint', []), null);
  const whole = api.toggleWholeImageEditSource({ ...settings, mode: 'image', prompt: 'x', referenceImages: [ref('photo')] }, 'photo');
  assert.equal(whole.imageOperation, 'edit');
  assert.equal(api.toggleWholeImageEditSource(whole, 'photo').imageOperation, 'generate');
});

test('moving the edit source first renumbers image mentions outside quoted copy', () => {
  const moved = api.moveEditSourceFirst('Put the bar from image 1 on image 3. Sign reads "image 3".', ['donor', 'other', 'source'], 2);
  assert.deepEqual(moved.referenceImages, ['source', 'donor', 'other']);
  assert.equal(moved.prompt, 'Put the bar from image 2 on image 1. Sign reads "image 3".');
  assert.deepEqual(api.moveEditSourceFirst('image 1', ['a', 'b'], 0), { prompt: 'image 1', referenceImages: ['a', 'b'] });
});

test('Omni chooses Generate routes from attachments and validates its limits', () => {
  const base = { videoModel: 'gemini-omni-1.2-flash', videoOperation: 'generate', videoQuality: '720p', videoAspectRatio: '16:9', videoDuration: 8, prompt: 'A dancer turns.', referenceImages: [], referenceVideos: [], referenceAudios: [] };
  assert.equal(api.getOmniMode(base), 'text_to_video');
  assert.equal(api.getOmniMode({ ...base, referenceImages: [ref('a', { isFirstFrame: true })] }), 'image_to_video');
  assert.equal(api.getOmniMode({ ...base, referenceImages: [ref('a')] }), 'reference_to_video');
  for (const videoOperation of ['edit', 'extend', 'upscale']) assert.equal(api.getOmniMode({ ...base, videoOperation }), videoOperation);
  assert.deepEqual(api.getOmniDurationOptions('text_to_video'), Array.from({ length: 13 }, (_, i) => i + 3));
  assert.equal(api.getOmniDurationOptions('image_to_video', true).at(-1), 10);
  assert.deepEqual(api.getOmniDurationOptions('extend'), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(api.getOmniConfigError(base), null);
  assert.match(api.getOmniConfigError({ ...base, videoAspectRatio: '1:1' }), /16:9 and 9:16/);
  assert.match(api.getOmniConfigError({ ...base, videoDuration: 2 }), /3–15/);
  assert.match(api.getOmniConfigError({ ...base, referenceImages: [ref('a', { isFirstFrame: true }), ref('b', { isLastFrame: true })], videoDuration: 12 }), /3–10/);
  assert.match(api.getOmniConfigError({ ...base, referenceAudios: [{ id: 'a' }] }), /audio/);
  assert.match(api.getOmniConfigError({ ...base, videoOperation: 'edit' }), /one source video/);
  assert.equal(api.getOmniConfigError({ ...base, videoOperation: 'upscale', prompt: '', videoQuality: '1080p', referenceVideos: [{ id: 'v', url: 'https://storage.test/v.mp4', duration: 10, width: 1280, height: 720 }] }), null, 'Upscale needs no prompt');
  assert.match(api.getOmniConfigError({ ...base, videoOperation: 'upscale', videoQuality: '720p', referenceVideos: [{ id: 'v', url: 'https://storage.test/v.mp4', duration: 10, width: 1280, height: 720 }] }), /higher than the source/);
  assert.match(api.getOmniConfigError({ ...base, videoOperation: 'upscale', videoQuality: '4K', referenceVideos: [{ width: 3840, height: 2160 }] }), /higher than the source/);
  assert.equal(api.getOmniConfigError({ ...base, videoOperation: 'upscale', videoQuality: '720p', referenceVideos: [{ width: 854, height: 480 }] }), null);
  assert.match(api.getOmniConfigError({ ...base, prompt:'x'.repeat(20001) }), /20,000/);
  assert.equal(api.getOmniConfigError({ ...base, prompt: '\u{20000}'.repeat(20000) }), null);
  assert.ok(api.VIDEO_QUALITY_OPTIONS.some(option => option.value === '360p'));
  assert.ok(api.VIDEO_MODEL_OPTIONS.some(option => option.value === 'gemini-omni-1.2-flash' && option.label === 'Gemini Omni 1.2 Flash'));
});

test('Omni cost uses the published fal per-second rates and stays unknown without a length', () => {
  const base = { videoModel: 'gemini-omni-1.2-flash', videoOperation: 'generate', videoAspectRatio: '16:9', prompt: 'x', referenceImages: [], referenceVideos: [] };
  for (const [quality, rate] of [['360p', .0273], ['720p', .0819], ['1080p', .1229], ['4K', .2457]]) {
    assert.ok(Math.abs(api.estimateOmniCost({ ...base, videoQuality: quality, videoDuration: 10 }).usd - rate * 10) < 1e-9, quality);
  }
  const source = { id: 'v', url: 'https://storage.test/v.mp4', duration: 10, width: 1280, height: 720 };
  assert.ok(Math.abs(api.estimateOmniCost({ ...base, videoOperation: 'extend', videoQuality: '720p', videoDuration: 8, referenceVideos: [source] }).usd - .6552) < 1e-9, 'extend bills only new seconds');
  assert.ok(Math.abs(api.estimateOmniCost({ ...base, videoOperation: 'edit', videoQuality: '720p', videoDuration: -1, referenceVideos: [source] }).usd - .819) < 1e-9);
  assert.ok(Math.abs(api.estimateOmniCost({ ...base, videoOperation: 'upscale', videoQuality: '4K', referenceVideos: [source] }).usd - 1.638) < 1e-9);
  assert.equal(api.estimateOmniCost({ ...base, videoOperation: 'upscale', videoQuality: '720p', referenceVideos: [{ ...source, width:854, height:480 }] }), null, 'no published price for that source resolution');
  assert.equal(api.estimateOmniCost({ ...base, videoOperation: 'edit', videoQuality: '720p', referenceVideos: [{ ...source, duration: undefined }] }), null);
});

test('Omni requests map onto the exact fal schema per action and reject inputs the route does not take', () => {
  const image = i => `https://storage.test/image-${i}.png`, video = i => `https://storage.test/video-${i}.mp4`;
  assert.deepEqual(api.buildOmniInput({ mode: 'text_to_video', prompt: 'A dancer.', resolution: '4K', aspectRatio: '9:16', duration: 15 }),
    { endpoint: 'google/gemini-omni-flash/v1.2/text-to-video', mode: 'text_to_video', input: { resolution: '4k', prompt: 'A dancer.', aspect_ratio: '9:16', duration: 15 } });
  assert.deepEqual(api.buildOmniInput({ mode: 'image_to_video', prompt: 'Turn.', resolution: '720p', aspectRatio: '16:9', duration: 10, imageUrls: [image(1)], endImageUrl: image(2) }).input,
    { resolution: '720p', prompt: 'Turn.', aspect_ratio: '16:9', image_url: image(1), end_image_url: image(2), duration: 10 });
  assert.throws(() => api.buildOmniInput({ mode: 'image_to_video', prompt: 'Turn.', resolution: '720p', aspectRatio: '16:9', duration: 11, imageUrls: [image(1)], endImageUrl: image(2) }), /3–10/);
  assert.deepEqual(api.buildOmniInput({ mode: 'reference_to_video', prompt: '<IMAGE_REF_0> dances.', resolution: '1080p', aspectRatio: '16:9', duration: 5, imageUrls: [image(1)], videoUrls: [video(1)] }).input,
    { resolution: '1080p', prompt: '<IMAGE_REF_0> dances.', aspect_ratio: '16:9', image_urls: [image(1)], reference_video_urls: [video(1)], duration: 5 });
  assert.deepEqual(api.buildOmniInput({ mode: 'edit', prompt: 'Make it night.', resolution: '720p', videoUrls: [video(1)] }).input, { resolution: '720p', prompt: 'Make it night.', video_url: video(1) });
  assert.deepEqual(api.buildOmniInput({ mode: 'extend', prompt: 'Keep walking.', resolution: '720p', duration: 4, videoUrls: [video(1)] }).input, { resolution: '720p', prompt: 'Keep walking.', video_url: video(1), duration: 4 });
  assert.deepEqual(api.buildOmniInput({ mode: 'upscale', resolution: '4K', videoUrls: [video(1)] }), { endpoint: 'google/gemini-omni-flash/v1.2/upscale', mode: 'upscale', input: { resolution: '4k', video_url: video(1) } });
  for (const invalid of [
    { mode: 'upscale', resolution: '360p', videoUrls: [video(1)] },
    { mode: 'extend', prompt: 'x', resolution: '720p', duration: 11, videoUrls: [video(1)] },
    { mode: 'text_to_video', prompt: 'x', resolution: '720p', aspectRatio: '1:1', duration: 8 },
    { mode: 'reference_to_video', prompt: 'x', resolution: '720p', aspectRatio: '16:9', duration: 8, imageUrls: Array.from({ length: 11 }, (_, i) => image(i)) },
    { mode: 'reference_to_video', prompt: 'x', resolution: '720p', aspectRatio: '16:9', duration: 8, imageUrls:[image(1)], endImageUrl:image(2) },
    { mode: 'edit', prompt: 'x', resolution: '720p', videoUrls: ['http://insecure.test/v.mp4'] },
    { mode: 'lip_sync', prompt: 'x', resolution: '720p' },
  ]) assert.throws(() => api.buildOmniInput(invalid), undefined, JSON.stringify(invalid));
  assert.equal(api.normalizeOmniPrompt('Show @REFERENCE[a], caption "@IMAGE_2  @VIDEO_1".', 'reference_to_video', [ref('a')]), 'Show <IMAGE_REF_0>, caption "@IMAGE_2  @VIDEO_1".');
  assert.equal(api.normalizeOmniPrompt('@REF_IMAGE_1 meets @VIDEO_2', 'reference_to_video', [ref('a')]), '<IMAGE_REF_0> meets <VIDEO_REF_1>');
});
