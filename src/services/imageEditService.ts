import type { GeneratedMedia, GenerationConfig, ReferenceImage } from '../types';
import { SUNBURST_MODEL } from '../lib/images/openaiImage';
import { EDIT_REGION_REQUIRED, isValidEditRegion, editRegionPixels } from '../lib/images/imageEditRegion';
import { compositeEditPixels } from '../lib/images/imageEditPixels';
import { refreshMediaAccessUrl } from './storageService';

const imageUrl = (ref: ReferenceImage) => /^(?:data:|blob:|https?:|\/)/.test(ref.data) ? ref.data : `data:${ref.mimeType};base64,${ref.data}`;
const loadPixels = async (url: string, size?: { width: number; height: number }) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = await refreshMediaAccessUrl(url, false);
  await image.decode().catch(() => { throw new Error('The edit image could not be loaded. Reopen it before generating.'); });
  const width = size?.width || image.naturalWidth, height = size?.height || image.naturalHeight;
  if (!width || !height || width * height > 33_554_432) throw new Error('This image is too large for protected editing.');
  if (size && Math.abs(image.naturalWidth / image.naturalHeight - width / height) / (width / height) > .01) throw new Error('The model changed the canvas proportions. The edit was not saved; check usage before retrying.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image editing is unavailable in this browser.');
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context, pixels: context.getImageData(0, 0, width, height), width, height };
};

export type ProtectedImageSource = { reference: ReferenceImage; decoded: Awaited<ReturnType<typeof loadPixels>> };

/** Decode before the paid call. Sunburst uses the server's original-pixel path. */
export const prepareProtectedImageSource = async (config: Pick<GenerationConfig, 'imageModel' | 'referenceImages' | 'aspectRatio'>): Promise<ProtectedImageSource | undefined> => {
  const refs = config.referenceImages || [];
  const marked = refs.filter(ref => ref.editRegion != null);
  if (!marked.length || config.imageModel === SUNBURST_MODEL || config.imageModel === 'gpt-image-2-beta') return undefined;
  if (marked.length !== 1 || !isValidEditRegion(marked[0].editRegion)) throw new Error(EDIT_REGION_REQUIRED);
  const reference = marked[0];
  const decoded = await loadPixels(imageUrl(reference));
  const [rw, rh] = config.aspectRatio.split(':').map(Number);
  if (Math.abs(decoded.width / decoded.height - rw / rh) / (rw / rh) > .01) throw new Error('This model cannot keep this source canvas. Choose GPT Image 2.5 for this edit.');
  return { reference, decoded };
};

export const finishProtectedImageEdit = async (media: GeneratedMedia, source?: ProtectedImageSource): Promise<GeneratedMedia> => {
  if (media.imageEditProtection?.preservedOutsideRegion) return media;
  if (!source) return media;
  const { reference, decoded } = source;
  if (!isValidEditRegion(reference.editRegion)) throw new Error(EDIT_REGION_REQUIRED);
  const output = await loadPixels(media.url, decoded);
  const pixels = compositeEditPixels(decoded.pixels.data, output.pixels.data, decoded.width, decoded.height, reference.editRegion);
  decoded.context.putImageData(new ImageData(pixels, decoded.width, decoded.height), 0, 0);
  const hash = async (data: Uint8Array | Uint8ClampedArray) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer))).map(v => v.toString(16).padStart(2, '0')).join('');
  return { ...media, url: decoded.canvas.toDataURL('image/png'), imageOutputSize: `${decoded.width}x${decoded.height}`,
    imageEditProtection: { version: 1, sourceReferenceId: reference.id, sourceSha256: await hash(decoded.pixels.data),
      sourceSize: `${decoded.width}x${decoded.height}`, region: reference.editRegion, pixelRegion: editRegionPixels(reference.editRegion, decoded.width, decoded.height),
      preservedOutsideRegion: true, providerOutputSha256: await hash(output.pixels.data) } };
};
