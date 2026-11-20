import type { GeneratedMedia } from '../types';
import { isImagePresetLabel } from '../lib/images/openaiImage';

/** Prefer the rendered file's shape; selected/provider sizes can differ. */
export const getGalleryAspectRatio = (media: GeneratedMedia, detectedRatio?: number): number => {
  if (detectedRatio && Number.isFinite(detectedRatio) && detectedRatio > 0) return detectedRatio;
  const size = media.mediaType !== 'video'
    ? media.imageOutputSize || (media.isLoading && !isImagePresetLabel(media.imageRequestedSize) ? media.imageRequestedSize : undefined)
    : undefined;
  const ratio = size || (media.mediaType === 'video' && media.videoAspectRatio !== 'adaptive'
    ? media.videoAspectRatio || media.aspectRatio : media.aspectRatio);
  const match = ratio?.match(/^\s*(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)\s*$/i);
  if (!match) return 1;
  const width = Number(match[1]), height = Number(match[2]);
  return width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 1;
};

export const getGalleryCardStyle = (aspectRatio: number, targetRowHeight: number) => ({
  width: targetRowHeight * aspectRatio,
  maxWidth: '100%',
  aspectRatio,
  flexGrow: aspectRatio,
  flexShrink: 0,
});

export const getNavigableGalleryMedia = <T extends Pick<GeneratedMedia, 'id' | 'url' | 'isLoading' | 'status'>>(media: T[]): T[] =>
  media.filter(item => !!item.url && !item.isLoading && item.status !== 'failed');

export interface GallerySwipeStart {
  x: number;
  y: number;
  startedAt: number;
  viewportWidth: number;
  cancelled: boolean;
  canDismiss?: boolean;
  axis?: 'horizontal' | 'vertical';
}

/** A clear downward pull on a fitted image, not scrolling or a diagonal tap. */
export const isGalleryDismissSwipe = (
  start: GallerySwipeStart | null,
  end: { x: number; y: number; endedAt: number; scale?: number },
): boolean => {
  if (!start?.canDismiss || start.cancelled || start.axis === 'horizontal' || (end.scale || 1) > 1.01 || end.endedAt - start.startedAt > 1500) return false;
  const dx = end.x - start.x, dy = end.y - start.y;
  return dy >= Math.max(72, Math.min(120, start.viewportWidth * .2)) && dy > Math.abs(dx) * 1.5;
};

/** A deliberate horizontal gesture, never a scroll, long press or pinch. */
export const getGallerySwipeDirection = (
  start: GallerySwipeStart | null,
  end: { x: number; y: number; endedAt: number; scale?: number },
): -1 | 0 | 1 => {
  if (!start || start.cancelled || start.axis === 'vertical' || (end.scale || 1) > 1.01 || end.endedAt - start.startedAt > 1500) return 0;
  const dx = end.x - start.x, dy = end.y - start.y;
  const threshold = Math.max(45, Math.min(90, start.viewportWidth * 0.12));
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
};
