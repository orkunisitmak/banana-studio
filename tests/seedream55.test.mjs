import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  export * from './src/lib/images/seedream55.ts';
  export { resolveImageOperation } from './src/lib/images/imageOperation.ts';
  export { validateImageGenerationReferences, buildSunburstGuidance } from './src/lib/images/imagePrompting.ts';
  export { getActiveImageModel, getImageModelLabel, estimateImageCost } from './src/types.ts';
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { buildSeedreamRequest: request, validateSeedreamInput: validate, getSeedreamDraftError: draftError,
  SEEDREAM_ENDPOINTS: endpoints, SEEDREAM_IMAGE_SIZES, SEEDREAM_LAYER_SIZES, SEEDREAM_MODEL,
  getActiveImageModel, getImageModelLabel, estimateImageCost, buildSunburstGuidance, resolveImageOperation, validateImageGenerationReferences } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const url = 'https://example.org/image.png';
const ref = (id, extra = {}) => ({ id, data: url, mimeType: 'image/png', ...extra });
const text = endpoints['text-to-image'];

test('Seedream requests select the exact endpoint and send only its documented fields', () => {
  assert.deepEqual(request(undefined, 'A still life', []), { endpoint: 'bytedance/seedream/v5.5/text-to-image', input: {
    prompt: 'A still life', image_size: 'auto_2K', num_images: 1, output_format: 'png', watermark: false,
    sync_mode: false, enable_safety_checker: true, background: 'auto',
  } });
  const refs = ['https://example.org/a.png', 'data:image/png;base64,Yg=='];
  const edit = request({ mode: 'edit', numImages: 6, imageSize: { width: 1280, height: 720 }, background: 'opaque', outputFormat: 'jpeg',
    watermark: true, syncMode: true, enableSafetyChecker: false, maxImages: 100 }, 'Edit image 2', refs);
  assert.deepEqual(edit, { endpoint: 'bytedance/seedream/v5.5/edit', input: { prompt: 'Edit image 2', image_urls: refs,
    num_images: 6, image_size: { width: 1280, height: 720 }, background: 'opaque', output_format: 'jpeg', watermark: true,
    sync_mode: true, enable_safety_checker: false } });
  assert.deepEqual(request({ mode: 'layerize', numImages: 6, background: 'transparent', outputFormat: 'jpeg' }, '', [url]), {
    endpoint: 'bytedance/seedream/v5.5/layerize', input: { prompt: '', image_url: url, image_size: 'auto', output_format: 'jpeg',
      max_images: 30, enable_text_recognition: false, enable_safety_checker: true, sync_mode: false, watermark: false },
  });
  const prompt = 'Separate <bbox>0 10 450 900</bbox>';
  assert.deepEqual(request({ mode: 'layerize', layerSize: 'auto_1.5K', maxImages: 100, enableTextRecognition: true, syncMode: true }, prompt, [url]).input,
    { prompt, image_url: url, image_size: 'auto_1.5K', max_images: 100, enable_text_recognition: true, output_format: 'png', watermark: false, sync_mode: false, enable_safety_checker: true });
  for (const maxImages of [30, 31]) {
    assert.equal(request({ mode: 'layerize', maxImages, syncMode: true }, '', [url]).input.sync_mode, maxImages === 30);
  }
});

test('the proxy accepts optional defaults and enforces inclusive ranges and per-mode enum values', () => {
  assert.equal(validate(text, { prompt: 'go' }), null);
  assert.equal(validate(endpoints.layerize, { image_url: url }), null);
  assert.equal(validate(endpoints.edit, { prompt: 'go', image_urls: [url] }), null);
  assert.deepEqual([...SEEDREAM_IMAGE_SIZES].sort(), ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9',
    'landscape_4_3', 'landscape_16_9', 'auto_1K', 'auto_1.5K', 'auto_2K'].sort());
  assert.deepEqual([...SEEDREAM_LAYER_SIZES].sort(), ['auto', 'auto_1K', 'auto_1.5K', 'auto_2K'].sort());
  for (const size of [...SEEDREAM_IMAGE_SIZES, { width: 3840, height: 240 }, { width: 240, height: 3840 }, { height: 2048 }]) {
    assert.equal(validate(text, { prompt: 'go', image_size: size }), null, JSON.stringify(size));
  }
  for (const size of SEEDREAM_LAYER_SIZES) assert.equal(validate(endpoints.layerize, { image_url: url, image_size: size }), null);
  for (const size of ['auto', null, {}, { width: 3841, height: 240 }, { width: 240, height: 3841 }, { width: 1279, height: 720 },
    { width: 2151, height: 2151 }, { width: 1280.5, height: 720 }, { width: 0, height: 720 }, { width: 14143, height: 720 }, { width: 1280, height: 720, bogus: true }]) {
    assert.ok(validate(text, { prompt: 'go', image_size: size }), JSON.stringify(size));
  }
  for (const value of [0, 7, 1.5, '2', null]) assert.ok(validate(text, { prompt: 'go', num_images: value }));
  for (const value of [1, 101, 2.5, '30', null]) assert.ok(validate(endpoints.layerize, { image_url: url, max_images: value }));
  for (const value of [2, 100]) assert.equal(validate(endpoints.layerize, { image_url: url, max_images: value }), null);
  for (const key of ['watermark', 'sync_mode', 'enable_safety_checker']) assert.ok(validate(text, { prompt: 'go', [key]: 0 }));
  assert.ok(validate(endpoints.layerize, { image_url: url, enable_text_recognition: 'false' }));
  assert.ok(validate(text, { prompt: 'go', output_format: 'webp' }));
  assert.ok(validate(text, { prompt: 'go', background: 'white' }));
  assert.ok(validate(text, { prompt: 'go', output_format: 'jpeg', background: 'transparent' }));
  assert.equal(validate(text, { prompt: 'go', background: 'transparent' }), null);
  assert.ok(validate(text, { prompt: '  ' }));
  assert.ok(validate(endpoints.edit, { image_urls: [url] }));
  assert.ok(validate(endpoints.layerize, { image_url: url, prompt: 0 }));
});

test('unknown endpoints, foreign keys, reference loss and wrong source forms fail before submission', () => {
  assert.throws(() => request({ mode: 'unknown' }, 'go', []));
  assert.throws(() => request(undefined, 'go', [url]), /Edit/);
  for (const count of [0, 11]) assert.throws(() => request({ mode: 'edit' }, 'go', Array(count).fill(url)), /1–10/);
  assert.equal(request({ mode: 'edit' }, 'go', Array(10).fill(url)).input.image_urls.length, 10);
  for (const count of [0, 2]) assert.throws(() => request({ mode: 'layerize' }, '', Array(count).fill(url)), /one source/);
  assert.ok(validate(text + '/bad', { prompt: 'go' }));
  for (const key of ['image_urls', 'image_url', 'max_images', 'enable_text_recognition', 'seed']) assert.ok(validate(text, { prompt: 'go', [key]: true }));
  for (const key of ['image_urls', 'background', 'num_images']) assert.ok(validate(endpoints.layerize, { image_url: url, [key]: true }));
  assert.ok(validate(endpoints.layerize, { image_url: url, image_size: { width: 1280, height: 720 } }));
  for (const input of [[], [null], ['file:///local.png'], ['data:image/png;base64,%bad'], 'url']) assert.ok(validate(endpoints.edit, { prompt: 'go', image_urls: input }));
  assert.ok(validate(endpoints.layerize, {}));
});

test('photos-only edit briefs can await a brainstorm prompt but cannot submit without one', () => {
  const config = { prompt: '', referenceImages: [ref('photo')], imageModel: SEEDREAM_MODEL, seedreamOptions: { mode: 'edit' } };
  assert.doesNotThrow(() => validateImageGenerationReferences(config, true));
  assert.throws(() => validateImageGenerationReferences(config), /prompt/);
  assert.throws(() => validateImageGenerationReferences({ ...config, referenceImages: [] }, true), /reference images/);
  assert.throws(() => request(config.seedreamOptions, '', [url]), /prompt/);
  assert.match(validate(endpoints.edit, { image_urls: [url], prompt: '' }), /prompt/);
  assert.doesNotThrow(() => request(config.seedreamOptions, 'Keep the vase, change its color to blue.', [url]));
});

test('reference preflight honors attached order and layer source area, aspect ratio, and file size', () => {
  const options = { mode: 'layerize' };
  for (const [width, height] of [[512, 512], [6000, 6000], [2048, 128], [128, 2048]]) {
    assert.equal(draftError(options, '', [ref('source', { width, height })]), null);
  }
  for (const [width, height] of [[511, 512], [6000, 6001], [2049, 128], [128, 2049]]) {
    assert.match(draftError(options, '', [ref('source', { width, height })]), /pixels/);
  }
  const payload = 'A'.repeat(30 * 1024 * 1024 * 4 / 3);
  assert.equal(draftError(options, '', [ref('source', { data: payload })]), null);
  assert.match(draftError(options, '', [ref('source', { data: `data:image/png;base64,${payload}AA==` })]), /30 MB/);
  const refs = [ref('person', { personId: 1 }), ref('context', { isVideoContext: true })];
  const config = { prompt: 'replace the background', referenceImages: refs, imageModel: SEEDREAM_MODEL, seedreamOptions: {mode:'edit',numImages:5}, imageOperation:'generate', count:4 };
  const resolved = resolveImageOperation(config);
  assert.equal(resolved.referenceImages, refs);
  assert.equal(resolved.imageOperation, 'edit'); assert.equal(resolved.count, 1);
  assert.doesNotThrow(() => validateImageGenerationReferences(resolved));
  assert.throws(() => validateImageGenerationReferences({ ...config, referenceImages: [ref('source', {editRegion:{x:0,y:0,width:.5,height:.5}})] }), /protected Edit areas/);
  assert.doesNotThrow(() => validateImageGenerationReferences({ ...config, prompt:'', seedreamOptions:options, referenceImages: [refs[0]] }));
});

test('Seedream is selectable, avoids legacy costs and prepares prompts for the selected operation', () => {
  assert.equal(getActiveImageModel(SEEDREAM_MODEL), SEEDREAM_MODEL);
  assert.equal(getImageModelLabel(SEEDREAM_MODEL), 'Seedream 5.5');
  assert.equal(estimateImageCost(SEEDREAM_MODEL, '4K', 1), null);
  for (const mode of Object.keys(endpoints)) {
    const guidance = buildSunburstGuidance('brainstorm', [], { imageModel: SEEDREAM_MODEL, seedreamOptions: { mode } }, 'simple', 3, 'go');
    assert.ok(guidance.includes(`Seedream 5.5 (${mode})`));
    assert.match(guidance, /exactly 3/);
    assert.doesNotMatch(guidance, /Nano Banana|Sunburst/);
  }
});
