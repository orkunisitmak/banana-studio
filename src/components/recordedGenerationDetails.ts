import type { GeneratedMedia, ImageEditLayer, ReferenceImage } from '../types';
import { getEditRegionLayers, isValidEditRegion, type ImageEditRegion } from '../lib/images/imageEditRegion';
import { isComparableImage } from './imageComparison';

export interface RecordedImageEditDetails {
  sourceReference?: ReferenceImage;
  sourceId?: string;
  source?: GeneratedMedia;
  sourcePreviewUrl?: string;
  sourceSize?: { width: number; height: number };
  region?: ImageEditRegion;
  layers: ImageEditLayer[];
  preservedOutsideRegion: boolean;
  originalRequest?: string;
}

const recordedId = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const galleryId = (referenceId?: string): string | undefined => referenceId?.startsWith('gallery-') ? recordedId(referenceId.slice(8)) : undefined;

export const parseRecordedImageSize = (value: unknown): { width: number; height: number } | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{1,6})\s*[x×]\s*(\d{1,6})$/);
  if (!match) return undefined;
  const width = Number(match[1]), height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
};

const imageUrl = (value: unknown, mimeType?: string): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const data = value.trim();
  if (/^(?:https?:\/\/|blob:|data:image\/|\/(?!\/))/i.test(data)) return data;
  // Older reference records retain raw base64 rather than a data URI.
  if (mimeType && /^image\/(?:png|jpeg|webp|gif|svg\+xml)$/i.test(mimeType)
    && data.length >= 16 && /^[a-zA-Z0-9+/]+={0,2}$/.test(data)) return `data:${mimeType};base64,${data}`;
  return undefined;
};

/** Resolve the saved source role, never an unrelated first reference. A
 * protection record pins the exact reference used for pixel compositing. */
export const getRecordedEditSourceReference = (media: GeneratedMedia): ReferenceImage | undefined => {
  const references = Array.isArray(media.referenceImages) ? media.referenceImages.filter(reference => reference && typeof reference === 'object') : [];
  const protectedId = recordedId(media.imageEditProtection?.sourceReferenceId);
  const linkedId = recordedId(media.imageEditSourceId);
  if (protectedId) {
    const matches = references.filter(reference => reference.id === protectedId);
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (linkedId) {
    const matches = references.filter(reference => reference.id === `gallery-${linkedId}`);
    if (matches.length === 1) return matches[0];
  }
  const marked = references.filter(reference => reference.isEditSource === true && (reference.editScope === 'image' || isValidEditRegion(reference.editRegion)));
  if (marked.length) return marked.length === 1 ? marked[0] : undefined;
  const selected = references.filter(reference => reference.editScope === 'image' || isValidEditRegion(reference.editRegion));
  return selected.length === 1 ? selected[0] : undefined;
};

export const isRecordedEditSourceReference = (media: GeneratedMedia, reference: ReferenceImage): boolean =>
  getRecordedEditSourceReference(media) === reference;

export const getRecordedImageEditDetails = (
  media: GeneratedMedia, images: readonly GeneratedMedia[] = [],
): RecordedImageEditDetails | undefined => {
  if (media.mediaType !== 'image') return undefined;
  const protection = media.imageEditProtection;
  const sourceReference = getRecordedEditSourceReference(media);
  const linkedId = recordedId(media.imageEditSourceId);
  if (!protection && !sourceReference && !linkedId) return undefined;

  const protectedId = recordedId(protection?.sourceReferenceId);
  const sourceId = galleryId(protectedId || recordedId(sourceReference?.id)) || linkedId;
  const source = images.find(image => image.id === sourceId && image.id !== media.id && image.mediaType === 'image' && isComparableImage(image));
  const referenceUrl = imageUrl(sourceReference?.data, sourceReference?.mimeType);
  // Embedded sources are exact snapshots. Gallery URLs can be refreshed after
  // signing expires, so prefer the current accessible URL over a saved URL.
  const sourcePreviewUrl = referenceUrl?.startsWith('data:') ? referenceUrl : imageUrl(source?.url) || referenceUrl;
  const region = isValidEditRegion(protection?.region) ? protection.region
    : isValidEditRegion(sourceReference?.editRegion) ? sourceReference.editRegion : undefined;
  const request = (media.originalPrompt ?? media.prompt ?? '').trim();
  const generationPrompt = (media.imageGenerationPrompt || media.prompt || '').trim();
  return {
    sourceReference, sourceId, source, sourcePreviewUrl,
    sourceSize: parseRecordedImageSize(protection?.sourceSize) || parseRecordedImageSize(source?.imageOutputSize),
    region, layers: getEditRegionLayers(region),
    preservedOutsideRegion: protection?.preservedOutsideRegion === true,
    originalRequest: request && request !== generationPrompt ? request : undefined,
  };
};

/** Canvas expansions produce a larger canvas than their source, so a
 * source/result overlay would misalign. */
export const isCanvasExpansionEdit = (details: RecordedImageEditDetails | undefined): boolean =>
  details?.region?.expandsCanvas === true || details?.sourceReference?.editRegion?.expandsCanvas === true;

export const getRecordedGenerationTime = (media: GeneratedMedia): string | undefined => {
  let seconds = media.generationTime;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    const start = media.generationStartedAt, end = media.generationCompletedAt;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) return undefined;
    seconds = (end - start) / 1000;
  }
  const rounded = Math.round(seconds);
  return rounded < 1 ? '<1s' : rounded >= 60 ? `${Math.floor(rounded / 60)}m ${rounded % 60}s` : `${rounded}s`;
};
