import type { GenerationConfig, ReferenceImage, ReferenceVideo, VideoCost } from '../../types.js';
import { H3_MAX_CAPABILITIES, resolveH3MaxMode, type H3MaxMode } from './h3Max.js';

/** Published regular rates, reviewed 2026-11-27. No expiring/ambiguous promo is assumed.
 * https://fal.ai/models/minimax/h3-max/text-to-video
 * https://fal.ai/models/minimax/h3-max/reference-to-video
 * https://fal.ai/models/minimax/h3-max/extend-video
 * https://fal.ai/models/minimax/h3-max/insert-video
 * https://fal.ai/models/minimax/h3-max/lip-sync/image-to-video
 * https://fal.ai/models/minimax/h3-max/recast
 * https://fal.ai/models/minimax/h3-max/relight
 * Billing Events remain authoritative; these are pre-submission estimates.
 */
export const H3_MAX_OUTPUT_RATES: Record<H3MaxMode, Readonly<Record<string, number>>> = {
  text_to_video: { '480P': 0.05, '768P': 0.08, '1080P': 0.16 },
  image_to_video: { '480P': 0.05, '768P': 0.08, '1080P': 0.16 },
  reference_to_video: { '480P': 0.05, '768P': 0.08, '1080P': 0.16 },
  extend_video: { '480P': 0.05, '768P': 0.08, '1080P': 0.16, '2K': 0.32 },
  insert_video: { '480P': 0.05, '768P': 0.06 },
  lip_sync: { '480P': 0.05, '768P': 0.08, '1080P': 0.16, '2K': 0.32 },
  recast: { '768P': 0.085, '1080P': 0.17 },
  relight: { '480P': 0.05, '768P': 0.08, '1080P': 0.16, '2K': 0.32 },
};
const REFERENCE_ALLOWANCE = 4096;
const REFERENCE_TOKEN_USD = 0.02 / 1000;
const finitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
type Dimensions = { width?: number; height?: number };
/** Image normalization is shape-based, not original pixel area. Unknown shapes use
 * the maximum supported 5:2 shape as a budget instead of assuming four free photos.
 */
export const estimateH3MaxImageReferenceTokens = (image: Dimensions): number => {
  if (!finitePositive(image.width) || !finitePositive(image.height)) return 2560;
  const ratio = Math.min(2.5, Math.max(image.width / image.height, image.height / image.width));
  return Math.ceil((1024 * ratio) / 32) * 32;
};
// fal publishes these exact examples for 16:9/9:16 reference clips at 24 fps.
// Other durations are interpolated: the real encoder uses temporal steps, and
// actual source FPS/aspect ratio can change the bill. 768P and 1080P share tokens.
const VIDEO_TOKEN_EXAMPLES: readonly [number, number][] = [[0, 0], [2, 4680], [5, 12480], [10, 26130], [15, 39780]];
export const estimateH3MaxVideoReferenceTokens = (
  video: Dimensions & { duration?: number; fps?: number }, resolution: string, outputDuration: number,
): number => {
  const seconds = Math.max(0, Math.min(finitePositive(video.duration) ? video.duration : 15, outputDuration, 15));
  let tokens = 0;
  for (let index = 1; index < VIDEO_TOKEN_EXAMPLES.length; index++) {
    const [rightSeconds, rightTokens] = VIDEO_TOKEN_EXAMPLES[index];
    if (seconds > rightSeconds && index < VIDEO_TOKEN_EXAMPLES.length - 1) continue;
    const [leftSeconds, leftTokens] = VIDEO_TOKEN_EXAMPLES[index - 1];
    tokens = leftTokens + ((seconds - leftSeconds) / (rightSeconds - leftSeconds)) * (rightTokens - leftTokens);
    break;
  }
  const resolutionFactor = resolution.toUpperCase() === '480P' ? 1 : 1008 / 390;
  const sourceFpsFactor = finitePositive(video.fps) ? video.fps / 24 : 1;
  const sourceShape = finitePositive(video.width) && finitePositive(video.height)
    ? Math.min(2.5, Math.max(video.width / video.height, video.height / video.width)) : 16 / 9;
  return tokens * resolutionFactor * sourceFpsFactor * (sourceShape / (16 / 9));
};

const modeFor = (config: GenerationConfig) => resolveH3MaxMode(config.h3MaxMode, {
  images: config.referenceImages?.length || 0, videos: config.referenceVideos?.length || 0, audios: config.referenceAudios?.length || 0,
});
const generatedDuration = (config: GenerationConfig, mode: H3MaxMode): number => {
  const bounds = H3_MAX_CAPABILITIES[mode].duration;
  if (!bounds) return 5;
  return Math.max(bounds.min, Math.min(bounds.max, finitePositive(config.videoDuration) ? config.videoDuration : bounds.default));
};

/** Shared token allowance across supplied R2V / Insert references and Extend audio.
 * R2V keyframes are billed by output canvas size, not as numbered photo references.
 * Missing audio/video durations use their documented maximum as a budget.
 * Only R2V documents truncating counted video frames to the requested output
 * duration. Insert references guide a replacement scene; budget their full
 * supplied duration instead of reusing that endpoint-specific truncation.
 */
export const estimateH3MaxReferenceTokens = (config: GenerationConfig, selectedMode?: H3MaxMode): number => {
  const mode = selectedMode || modeFor(config);
  if (!['reference_to_video', 'extend_video', 'insert_video'].includes(mode)) return 0;
  const options = config.h3MaxOptions || {};
  const keyframes = new Set([options.startImageId, options.endImageId, options.middleImageId].filter(Boolean));
  const images = mode === 'extend_video' ? [] : (config.referenceImages || []).filter(image => mode !== 'reference_to_video' || !keyframes.has(image.id));
  const videos = mode === 'reference_to_video' ? config.referenceVideos || [] : mode === 'insert_video' ? (config.referenceVideos || []).slice(1) : [];
  const audios = mode === 'insert_video' || (mode === 'reference_to_video' && options.useTargetAudio) ? [] : config.referenceAudios || [];
  const outputDuration = generatedDuration(config, mode);
  let keyframeTokens = 0;
  let orderedTokens = 0;
  if (mode === 'reference_to_video') {
    // Ordered conditions replace the reference URL arrays. They carry no
    // decoded metadata, so apply the same published unknown-media budgets.
    for (const condition of options.referenceConditions || []) {
      if (condition.type === 'image') orderedTokens += estimateH3MaxImageReferenceTokens({});
      else if (condition.type === 'video') orderedTokens += estimateH3MaxVideoReferenceTokens({}, config.videoQuality, outputDuration);
      else if (condition.type === 'audio') orderedTokens += 15 * 80;
    }
    const count = [options.startImageId || options.startImageUrl, options.middleImageId || options.middleImageUrl, options.endImageId || options.endImageUrl].filter(Boolean).length;
    if (count) {
      const start = options.startImageId ? config.referenceImages?.find(image => image.id === options.startImageId) : undefined;
      const [w, h] = (config.videoAspectRatio || '').split(':').map(Number);
      const ratio = finitePositive(start?.width) && finitePositive(start?.height) ? start.width / start.height : w / h;
      // fal snaps the canvas to its supported sizes. Budget the largest shape
      // for unknown adaptive dimensions rather than assuming all frames are square.
      const shape = finitePositive(ratio) ? Math.min(2.5, Math.max(ratio, 1 / ratio)) : 2.5;
      const shortEdge = /^(480|1080)p$/i.test(config.videoQuality) ? parseInt(config.videoQuality, 10) : 768;
      keyframeTokens = count * Math.floor(shortEdge / 32) * Math.floor(shortEdge * shape / 32);
    }
  }
  return images.reduce((sum, image) => sum + estimateH3MaxImageReferenceTokens(image as ReferenceImage & Dimensions), 0)
    + keyframeTokens + orderedTokens + videos.reduce((sum, video) => sum + estimateH3MaxVideoReferenceTokens(video as ReferenceVideo & Dimensions & { fps?: number }, config.videoQuality, mode === 'insert_video' ? 15 : outputDuration), 0)
    + audios.reduce((sum, audio) => sum + (finitePositive(audio.duration) ? audio.duration : 15) * 80, 0);
};

export const estimateH3MaxCost = (config: GenerationConfig): VideoCost => {
  const mode = modeFor(config);
  const rates = H3_MAX_OUTPUT_RATES[mode];
  const resolution = config.videoQuality.toUpperCase();
  // Stale unsupported resolutions get a documented supported fallback in the
  // estimate; submission validation still blocks them until the UI is corrected.
  const rate = rates[resolution] ?? rates['768P'] ?? Object.values(rates)[0];
  let duration = generatedDuration(config, mode);
  if (mode === 'lip_sync') duration = finitePositive(config.referenceAudios?.[0]?.duration) ? config.referenceAudios[0].duration! : 5;
  if (mode === 'recast' || mode === 'relight') duration = finitePositive(config.referenceVideos?.[0]?.duration) ? config.referenceVideos[0].duration! : 5;
  if (mode === 'recast') {
    // Actual usage counts each shot as at least 2.5s. Individual shot lengths
    // aren't available in the composer; budget source duration and reconcile.
    const sourceTokens = duration * 6750;
    const inputCost = Math.max(0, sourceTokens - REFERENCE_ALLOWANCE) * 0.022 / 1000;
    return { usd: Math.max(5, duration) * rate + inputCost, source: 'published_estimate' };
  }
  const outputMultiplier = mode === 'lip_sync' && duration > 15 ? 1.2 : 1;
  // A verified 6.5-second Lip Sync request was billed for 7 seconds. Budget
  // whole seconds conservatively; fal's page only documents a per-second rate,
  // so this is not a claim that every fractional input has that exact charge.
  // The actual Billing Events amount always replaces this estimate afterward.
  const billedDuration = mode === 'lip_sync' ? Math.ceil(duration - 1e-8) : duration;
  const referenceCost = Math.max(0, estimateH3MaxReferenceTokens(config, mode) - REFERENCE_ALLOWANCE) * REFERENCE_TOKEN_USD;
  return { usd: rate * billedDuration * outputMultiplier + referenceCost, source: 'published_estimate' };
};
