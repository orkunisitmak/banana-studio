import { getOpenAIImageOptions, SUNBURST_MODEL } from '../lib/images/openaiImage';
import type { AspectRatio, GeneratedMedia, GenerationConfig, ImageModelId, ReferenceImage } from '../types';
import type { ImageEditRegion } from '../lib/images/imageEditRegion';

const RATIOS: AspectRatio[] = ['1:1', '3:4', '4:3', '9:16', '16:9'];

/** The approved source occupies one provider input slot. */
export const getGalleryEditReferenceLimit = (model: ImageModelId): number => model === SUNBURST_MODEL ? 15 : 13;

export const readGalleryEditReference = (file: File): Promise<ReferenceImage> => {
  const extension = file.name?.split('.').pop()?.toLowerCase();
  const mimeType = file.type === 'image/jpg' ? 'image/jpeg' : file.type ||
    (extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : '');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) return Promise.reject(new Error('Choose a PNG, JPG or WebP reference image.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Reference image could not be read. Try uploading it again.'));
    reader.onabort = reader.onerror;
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.includes('base64,')) {
        reject(new Error('Reference image could not be read. Try uploading it again.')); return;
      }
      // Keep original bytes. Enhance compresses its own copies; generation
      // uploads the originals through the existing job/storage pipeline.
      resolve({ id: crypto.randomUUID(), mimeType, data: `data:${mimeType};base64,${reader.result.split('base64,')[1]}` });
    };
    reader.readAsDataURL(file);
  });
};

const getSourceMimeType = (image: GeneratedMedia): string => {
  const extension = image.url.split(/[?#]/)[0].match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
  const format = image.openaiImageOptions?.outputFormat || extension || 'png';
  return `image/${format === 'jpg' ? 'jpeg' : format}`;
};

export const getEditSource = (image: GeneratedMedia, region?: ImageEditRegion): ReferenceImage => ({
  id: `gallery-${image.id}`,
  data: image.url,
  mimeType: getSourceMimeType(image),
  isEditSource: true,
  editRegion: region,
});

/** Upscale runs as a local image job so it gets the queue, gallery result and recovery. */
export const buildGalleryUpscaleConfig = (image: GeneratedMedia, scale: 2 | 4): GenerationConfig => ({
  mode: 'image', prompt: image.prompt?.trim() || 'Upscale', count: 1, imageModel: 'local-image', localUpscale: scale,
  aspectRatio: image.aspectRatio || '1:1', resolution: image.resolution || '1K', imagePromptCategory: image.imagePromptCategory,
  referenceImages: [{ id: `gallery-${image.id}`, data: image.url, mimeType: getSourceMimeType(image) }],
  referenceVideos: [], referenceAudios: [],
  videoModel: 'seedance-2.5', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: '720p',
  videoDuration: 5, audioEnabled: false, videoPromptExpansionMode: 'disabled',
});

export const getSourceAspectRatio = (width: number, height: number): AspectRatio => {
  const ratio = width / height;
  return RATIOS.reduce((best, current) => {
    const [a, b] = current.split(':').map(Number);
    const [c, d] = best.split(':').map(Number);
    return Math.abs(Math.log(ratio / (a / b))) < Math.abs(Math.log(ratio / (c / d))) ? current : best;
  }, RATIOS[0]);
};

export const canUseNanoEditCanvas = (canvas: { width: number; height: number }): boolean => {
  if (!canvas.width || !canvas.height) return false;
  const [width, height] = getSourceAspectRatio(canvas.width, canvas.height).split(':').map(Number);
  return Math.abs(canvas.width / canvas.height / (width / height) - 1) <= .01;
};

/** Gallery edits always use the full source and its measured canvas. A history
 * thumbnail or the old requested ratio must never become the edit source. */
export const buildGalleryImageEditConfig = (
  image: GeneratedMedia,
  prompt: string,
  imageModel: ImageModelId,
  count: number,
  canvas: { width: number; height: number },
  region: ImageEditRegion,
  references: ReferenceImage[] = [],
): GenerationConfig => ({
  mode: 'image', prompt, count,
  imageModel,
  aspectRatio: getSourceAspectRatio(canvas.width, canvas.height),
  resolution: image.resolution || '2K',
  openaiImageOptions: { ...getOpenAIImageOptions(image.openaiImageOptions), size: 'custom', width: canvas.width, height: canvas.height, outputFormat: 'png' },
  imagePromptCategory: image.imagePromptCategory,
  // Additional images are donors, never a second source or a second mask.
  referenceImages: [getEditSource(image, region), ...references.map(({ isEditSource, editRegion, isVideoContext, isFirstFrame, isLastFrame, ...reference }) => reference)],
  referenceVideos: [], referenceAudios: [],
  videoModel: 'seedance-2.5', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: '720p',
  videoDuration: 5, audioEnabled: false, videoPromptExpansionMode: 'disabled',
});
