import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGalleryHash } from '../../src/hooks/useGalleryHash';

describe('useGalleryHash', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('restores folder and image from the hash on mount', () => {
    window.history.replaceState(null, '', '/#folder=folder-1&image=image-1');
    const setFolder = vi.fn();
    const setImage = vi.fn();

    renderHook(() => useGalleryHash(null, null, setFolder, setImage));

    expect(setFolder).toHaveBeenCalledWith('folder-1');
    expect(setImage).toHaveBeenCalledWith('image-1');
  });

  it('writes navigation changes once after the initial mount', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const setFolder = vi.fn();
    const setImage = vi.fn();

    const { rerender } = renderHook(
      ({ folder, image }) => useGalleryHash(folder, image, setFolder, setImage),
      { initialProps: { folder: null as string | null, image: null as string | null } },
    );

    expect(pushState).toHaveBeenCalledTimes(0);
    rerender({ folder: 'folder-2', image: 'image-2' });

    expect(pushState).toHaveBeenCalledWith(null, '', '#folder=folder-2&image=image-2');
  });
});
