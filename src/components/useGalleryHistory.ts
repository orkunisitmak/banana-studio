import { useCallback, useState, type SetStateAction } from 'react';
import type { GeneratedMedia } from '../types';
import { createGalleryHistoryMutations, mergeLoadedGalleryHistory, recordGalleryHistoryMutation } from '../lib/gallery/galleryHistoryMerge';

/** Keep local mutations and page delivery in the same React state queue. */
export const useGalleryHistory = () => {
  const [state, setState] = useState(() => ({ media: [] as GeneratedMedia[], mutations: createGalleryHistoryMutations(), tracking: true }));
  const setMedia = useCallback((update: SetStateAction<GeneratedMedia[]>) => {
    setState(previous => {
      const media = typeof update === 'function' ? update(previous.media) : update;
      return { ...previous, media, mutations: previous.tracking ? recordGalleryHistoryMutation(previous.media, media, previous.mutations) : previous.mutations };
    });
  }, []);
  const mergeHistory = useCallback((loaded: GeneratedMedia[], deletedIds: ReadonlySet<string>) => {
    // Copy the external tombstones before enqueueing so this update is replayable.
    const tombstones = new Set(deletedIds);
    setState(previous => previous.tracking ? { ...previous, media: mergeLoadedGalleryHistory(previous.media, loaded, previous.mutations, tombstones) } : previous);
  }, []);
  const discardPendingHistory = useCallback(() => {
    setState(previous => ({ ...previous, mutations: { ...previous.mutations, discardLoaded: true } }));
  }, []);
  const endHistoryLoad = useCallback(() => {
    // Enqueue after the final merge, rather than toggling a ref immediately:
    // React can defer/replay both updates while the last page is still queued.
    setState(previous => ({ ...previous, tracking: false, mutations: createGalleryHistoryMutations() }));
  }, []);
  return { media: state.media, setMedia, mergeHistory, discardPendingHistory, endHistoryLoad };
};
