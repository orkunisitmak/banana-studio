import type { GeneratedMedia } from '../../types';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Name a set of gallery items, e.g. "2 images and 1 video". */
export const describeMediaCount = (ids: Iterable<string>, media: GeneratedMedia[]): string => {
  const selected = new Set(ids), counted = new Set<string>();
  let images = 0, videos = 0;
  // Two placeholders made in the same millisecond can share an ID; count it once.
  for (const item of media) if (selected.has(item.id) && !counted.has(item.id)) { counted.add(item.id); item.mediaType === 'video' ? videos++ : images++; }
  // Selected IDs the loaded list no longer contains are still deleted.
  const other = selected.size - images - videos;
  const parts = [images && count(images, 'image'), videos && count(videos, 'video'), other && count(other, other === selected.size ? 'item' : 'other item')].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || count(0, 'item');
};

/** Name what a batch delete removes, e.g. "Delete 2 images and 1 video?". */
export const describeBatchDelete = (ids: Iterable<string>, media: GeneratedMedia[]): string => `Delete ${describeMediaCount(ids, media)}?`;
