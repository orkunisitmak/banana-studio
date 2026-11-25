import { useEffect, useState } from 'react';
import type { GeneratedMedia } from '../types';
import { getImageById } from '../services/storageService';
import { isComparableImage } from './imageComparison';
import { getRecordedImageEditDetails, isCanvasExpansionEdit } from './recordedGenerationDetails';

interface SourceLookup {
  key: string;
  status: 'loading' | 'ready' | 'unavailable';
  source?: GeneratedMedia;
}

const isUsableSource = (media: GeneratedMedia | null | undefined, id?: string): media is GeneratedMedia =>
  Boolean(media && media.id === id && media.mediaType === 'image' && isComparableImage(media)
    && /^(?:https?:\/\/|blob:|data:image\/|\/(?!\/))/i.test(media.url.trim()));

/** The output renders immediately. Only its explicitly recorded edit source
 * may be fetched; owner/selection changes invalidate pending responses. */
export const useSavedImageEditSource = (
  result: GeneratedMedia | null,
  images: GeneratedMedia[],
  ownerId?: string,
  accountId?: string,
) => {
  const [lookup, setLookup] = useState<SourceLookup | null>(null);
  const [attempt, setAttempt] = useState(0);
  const eligible = result?.mediaType === 'image' && isComparableImage(result);
  const recorded = eligible ? getRecordedImageEditDetails(result, images) : undefined;
  // Expanded canvases differ in size from their source, so they are never
  // compared and their source is not fetched.
  const edit = isCanvasExpansionEdit(recorded) ? undefined : recorded;
  const selfSource = Boolean(edit?.sourceId && edit.sourceId === result?.id);
  const sourceId = !selfSource ? edit?.sourceId : undefined;
  const indexed = isUsableSource(edit?.source, sourceId) ? edit.source : undefined;
  const hasEmbeddedSnapshot = Boolean(edit?.sourceReference && edit.sourcePreviewUrl?.startsWith('data:image/'));
  const key = result && sourceId ? JSON.stringify([ownerId ? `admin:${ownerId}` : `self:${accountId || ''}`, result.id, sourceId, attempt]) : null;

  useEffect(() => {
    let active = true;
    if (!key || !sourceId || indexed || hasEmbeddedSnapshot) { setLookup(null); return; }
    setLookup({ key, status: 'loading' });
    getImageById(sourceId, ownerId).then(media => {
      if (active) setLookup(isUsableSource(media, sourceId) ? { key, status: 'ready', source: media } : { key, status: 'unavailable' });
    }).catch(() => { if (active) setLookup({ key, status: 'unavailable' }); });
    return () => { active = false; };
    // Polls recreate the whole index. Only the recorded identity, owner, a
    // source becoming available, or an explicit retry starts another lookup.
  }, [key, sourceId, ownerId, Boolean(indexed), hasEmbeddedSnapshot]);

  const loaded = lookup?.key === key ? lookup.source : undefined;
  const snapshot: GeneratedMedia | undefined = result && !selfSource && edit?.sourceReference && edit.sourcePreviewUrl ? {
    id: sourceId || `edit-source:${result.id}:${edit.sourceReference.id}`,
    url: edit.sourcePreviewUrl, prompt: 'Edit source', mediaType: 'image', createdAt: result.createdAt,
    aspectRatio: result.aspectRatio, resolution: result.resolution, referenceImages: [],
    ...(edit.sourceSize ? { imageOutputSize: `${edit.sourceSize.width}x${edit.sourceSize.height}` } : {}),
  } : undefined;
  const source = hasEmbeddedSnapshot ? snapshot : indexed || loaded || snapshot;
  const loadingSource = Boolean(edit && !source && key && (lookup?.key !== key || lookup.status === 'loading'));
  return { source, isEditedImage: Boolean(edit), loadingSource,
    sourceUnavailable: Boolean(edit && !source && !loadingSource),
    retrySource: () => setAttempt(value => value + 1),
    canRetrySource: Boolean(key && !source && !loadingSource) };
};
