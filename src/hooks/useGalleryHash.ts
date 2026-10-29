import { useEffect, useRef } from 'react';

/** Keeps folder/image navigation in the URL hash without adding history noise. */
export const useGalleryHash = (
  currentFolderId: string | null,
  selectedImageId: string | null,
  setCurrentFolderId: (id: string | null) => void,
  setSelectedImageId: (id: string | null) => void,
) => {
  useEffect(() => {
    const parseHash = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      setCurrentFolderId(params.get('folder') || null);
      setSelectedImageId(params.get('image') || null);
    };
    parseHash();
    window.addEventListener('popstate', parseHash);
    return () => window.removeEventListener('popstate', parseHash);
  }, [setCurrentFolderId, setSelectedImageId]);

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (currentFolderId) params.set('folder', currentFolderId);
    if (selectedImageId) params.set('image', selectedImageId);
    const hash = params.toString();
    const newHash = hash ? `#${hash}` : window.location.pathname;
    if (window.location.hash.slice(1) !== hash) {
      window.history.pushState(null, '', newHash);
    }
  }, [currentFolderId, selectedImageId]);
};
