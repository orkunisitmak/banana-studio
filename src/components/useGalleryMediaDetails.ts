import { useEffect, useRef, useState } from 'react';
import type { GeneratedMedia } from '../types';
import { getImageById } from '../services/storageService';

interface LoadedDetail { key: string; media: GeneratedMedia; indexed?: GeneratedMedia }

const LIVE_MEDIA_FIELDS = ['generationProvider', 'providerModel', 'url', 'thumbnailUrl', 'storagePath', 'thumbnailPath', 'syncStatus', 'imageOutputSize', 'imageRequestedSize', 'openaiImageOptions', 'seedreamOptions', 'seedreamResult', 'imageOperation', 'imageEditMarkup', 'imageQueue', 'magi2Mode', 'falSeedanceOptions', 'falSeedanceResult', 'falQueueEndpoint', 'falEndpoint', 'h3MaxOptions', 'h3MaxMode', 'videoOutputDuration', 'imageModel', 'resolution', 'aspectRatio', 'imageEditProtection', 'imageEditSourceId', 'promptPreparation', 'generationCost', 'generationTime', 'generationStartedAt', 'generationCompletedAt', 'error', 'taskId'] as const;

/** The gallery index omits large prompt/reference fields. Polling that index
 * must not replace the hydrated record and make the details panel jump. */
export const useGalleryMediaDetails = (
  images: GeneratedMedia[], selectedId: string | null, ownerId?: string, accountId?: string,
) => {
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const current = images.find(image => image.id === selectedId);
  const ownerKey = ownerId ? `admin:${ownerId}` : `self:${accountId || ''}`;
  const key = selectedId ? JSON.stringify([ownerKey, selectedId]) : null;
  const latestCurrent = useRef(current);
  latestCurrent.current = current;

  useEffect(() => {
    let active = true;
    if (!selectedId || !key) { setLoaded(null); setLoadingKey(null); return; }
    const indexed = latestCurrent.current;
    if (indexed?.isLoading || ['pending', 'processing'].includes(indexed?.status || '')) {
      setLoadingKey(null);
      return;
    }
    setLoadingKey(key);
    getImageById(selectedId, ownerId)
      .then(media => { if (active && media?.id === selectedId) setLoaded({ key, media, indexed }); })
      .catch(() => {})
      .finally(() => { if (active) setLoadingKey(null); });
    return () => { active = false; };
    // Object identity changes on every progress poll. Only selection, owner,
    // and this record becoming ready can start another hydration request.
  }, [selectedId, key, ownerId, current?.isLoading, current?.status]);

  let selectedMedia: GeneratedMedia | null = loaded?.key === key ? loaded.media : current || null;
  if (selectedMedia && current && loaded?.key === key) {
    selectedMedia = {
      ...current, ...selectedMedia,
      ...(Object.prototype.hasOwnProperty.call(current, 'isFavorite') ? { isFavorite: current.isFavorite } : {}),
      ...(Object.prototype.hasOwnProperty.call(current, 'folderId') ? { folderId: current.folderId } : {}),
      ...(Object.prototype.hasOwnProperty.call(current, 'status') ? { status: current.status } : {}),
      ...(Object.prototype.hasOwnProperty.call(current, 'isLoading') ? { isLoading: current.isLoading } : {}),
    };
    for (const field of LIVE_MEDIA_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(current, field) && current[field] !== loaded.indexed?.[field]) {
        Object.assign(selectedMedia, { [field]: current[field] });
      }
    }
  }
  return { selectedMedia, loadingDetails: Boolean(key && loadingKey === key) };
};
