import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('..', import.meta.url));
const result = await build({ entryPoints: ['src/lib/video/h3MaxPricing.ts'], absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm' });
const { estimateH3MaxCost: cost, estimateH3MaxImageReferenceTokens: imageTokens, estimateH3MaxVideoReferenceTokens: videoTokens } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const config = (h3MaxMode, extra = {}) => ({ h3MaxMode, videoDuration: 5, videoQuality: '768p', referenceImages: [], referenceVideos: [], referenceAudios: [], ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('H3 Max regular rates are endpoint-specific, with source-defined or new-scene-only durations', () => {
  near(cost(config('text_to_video')).usd, 0.4); near(cost(config('image_to_video', { videoQuality: '1080p' })).usd, 0.8);
  near(cost(config('insert_video', { videoQuality: '768p', referenceVideos: [{ duration: 60 }] })).usd, 0.30);
  near(cost(config('extend_video', { videoQuality: '2K', videoDuration: 5, referenceVideos: [{ duration: 60 }], h3MaxOptions: { output: 'extended' } })).usd, 1.60);
  near(cost(config('extend_video', { videoQuality: '2K', videoDuration: 5, referenceVideos: [{ duration: 60 }], h3MaxOptions: { output: 'continuation' } })).usd, 1.60);
  near(cost(config('recast', { videoDuration: 5, videoQuality: '1080p', referenceVideos: [{ duration: 20 }], referenceImages: Array(4).fill({}) })).usd, 3.4 + (20 * 6750 - 4096) * 0.022 / 1000);
  near(cost(config('relight', { videoDuration: 5, videoQuality: '2K', referenceVideos: [{ duration: 10 }] })).usd, 3.2);
  assert.equal(cost(config('text_to_video')).source, 'published_estimate');
});

test('ordered R2V conditions receive the same unknown-media budgets as URL arrays', () => {
  const ordered = { referenceConditions: ['image', 'video', 'audio'].map(type => ({ type, url: `https://example.test/${type}` })) };
  const arrays = { referenceImages: [{}], referenceVideos: [{}], referenceAudios: [{}] };
  near(cost(config('reference_to_video', { h3MaxOptions: ordered })).usd, cost(config('reference_to_video', arrays)).usd);
});

test('Lip Sync follows actual target audio duration and adds the published long-output multiplier', () => {
  near(cost(config('lip_sync', { videoDuration: 15, referenceAudios: [{ duration: 5 }] })).usd, 0.4);
  near(cost(config('lip_sync', { videoDuration: 5, referenceAudios: [{ duration: 15 }] })).usd, 1.2);
  near(cost(config('lip_sync', { videoDuration: 5, referenceAudios: [{ duration: 30 }] })).usd, 2.88);
  near(cost(config('lip_sync', { videoQuality: '2K', referenceAudios: [{ duration: 900 }] })).usd, 345.6);
});

test('fractional Lip Sync audio budgets whole seconds while retaining the raw-duration multiplier threshold', () => {
  near(cost(config('lip_sync', { videoQuality: '2K', referenceAudios: [{ duration: 6.5 }] })).usd, 2.24);
  near(cost(config('lip_sync', { referenceAudios: [{ duration: 14.5 }] })).usd, 1.2);
  near(cost(config('lip_sync', { referenceAudios: [{ duration: 15.5 }] })).usd, 1.536);
  near(cost(config('lip_sync', { referenceAudios: [{ duration: 7.0000000001 }] })).usd, 0.56);
  assert.equal(cost(config('lip_sync', { referenceAudios: [{ duration: 6.5 }] })).source, 'published_estimate');
});

test('image reference tokens follow normalized aspect ratio, independent of original pixel area', () => {
  assert.equal(imageTokens({ width: 1024, height: 1024 }), 1024); assert.equal(imageTokens({ width: 2048, height: 2048 }), 1024);
  assert.equal(imageTokens({ width: 1024, height: 768 }), 1376); assert.equal(imageTokens({ width: 768, height: 1024 }), 1376);
  assert.equal(imageTokens({ width: 1920, height: 1080 }), 1824); assert.equal(imageTokens({ width: 1080, height: 1920 }), 1824);
  assert.equal(imageTokens({ width: 2500, height: 1000 }), 2560); assert.equal(imageTokens({}), 2560, 'Unknown image shape uses a documented maximum budget');
});

test('reference surcharge pools allowance once and bills keyframes by output canvas rather than reference shape', () => {
  const square = { width: 2048, height: 2048 };
  near(cost(config('reference_to_video', { referenceImages: Array(4).fill(square) })).usd, 0.4);
  near(cost(config('reference_to_video', { referenceImages: Array(5).fill(square) })).usd, 0.42048);
  near(cost(config('reference_to_video', { referenceImages: Array(3).fill({ width: 1920, height: 1080 }) })).usd, 0.42752);
  near(cost(config('reference_to_video', { referenceImages: [...Array(4).fill(square), { id: 'start', ...square }], h3MaxOptions: { startImageId: 'start' } })).usd, 0.4 + 576 * 0.00002);
  near(cost(config('reference_to_video', { videoAspectRatio:'16:9', referenceImages: Array(4).fill(square), h3MaxOptions: { endImageUrl: 'https://test.invalid/end.png' } })).usd, 0.4 + 1008 * 0.00002);
  near(cost(config('reference_to_video', { referenceImages: Array(4).fill(square), referenceAudios: [{ duration: 20 }], h3MaxOptions: { useTargetAudio: true } })).usd, 0.4);
  near(cost(config('reference_to_video', { referenceImages: Array(4).fill(square), referenceAudios: [{ duration: 5 }] })).usd, 0.408);
});

test('published reference-video examples are reproduced with output-duration capping and shared input allowance', () => {
  for (const [duration, low, high] of [[2, 4680, 12096], [5, 12480, 32256], [10, 26130, 67536], [15, 39780, 102816]]) {
    near(videoTokens({ duration, width: 1920, height: 1080, fps: 24 }, '480p', 15), low);
    near(videoTokens({ duration, width: 1920, height: 1080, fps: 24 }, '768p', 15), high);
    near(videoTokens({ duration, width: 1920, height: 1080, fps: 24 }, '1080p', 15), high);
  }
  near(videoTokens({ duration: 15 }, '768p', 5), 32256);
  near(cost(config('reference_to_video', { referenceImages: [{ width: 1024, height: 1024 }, { width: 1024, height: 1024 }], referenceVideos: [{ duration: 5 }] })).usd, 1.00416);
  near(cost(config('insert_video', { referenceVideos: [{ duration: 60 }, { duration: 5 }] })).usd, 0.8632);
});

test('Extend audio references share one allowance, whereas supplied target audio and recast photos have no reference surcharge', () => {
  near(cost(config('extend_video', { referenceVideos: [{ duration: 30 }], referenceAudios: [{ duration: 5 }, { duration: 5 }, { duration: 5 }] })).usd, 0.4);
  near(cost(config('text_to_video', { referenceAudios: [{ duration: 600 }] })).usd, 0.4);
  near(cost(config('recast', { referenceVideos: [{ duration: 5 }], referenceImages: Array(4).fill({ width: 5000, height: 2000 }) })).usd, 0.425 + (5 * 6750 - 4096) * 0.022 / 1000);
});

test('Insert budgets the full supplementary reference clip without applying the R2V output-duration cap', () => {
  const scene = { id:'scene', width:1344, height:768 };
  const source = { duration:6.592, width:1344, height:768 };
  const reference = { duration:7.041667, width:1280, height:720, fps:24 };
  const inserted = cost(config('insert_video', { videoDuration:5, videoQuality:'480p', referenceImages:[scene], referenceVideos:[source,reference] }));
  const fullReference = videoTokens(reference,'480p',15);
  const cappedReference = videoTokens(reference,'480p',5);
  near(inserted.usd, 0.25 + Math.max(0,imageTokens(scene)+fullReference-4096)*0.00002);
  assert.ok(fullReference>cappedReference);
  const r2v = cost(config('reference_to_video', { videoDuration:5, videoQuality:'480p', referenceImages:[scene], referenceVideos:[reference] }));
  near(r2v.usd, 0.25 + Math.max(0,imageTokens(scene)+cappedReference-4096)*0.00002);
  assert.ok(inserted.usd>r2v.usd);
});

test('regular T2V and I2V estimates do not assume an expired promotion or apply Lip Sync rounding', () => {
  near(cost(config('text_to_video', { videoDuration:6.5, videoQuality:'480p' })).usd,0.325);
  near(cost(config('image_to_video', { videoDuration:6.5, videoQuality:'1080p' })).usd,1.04);
});

