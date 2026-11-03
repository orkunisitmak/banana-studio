import type { GeneratedMedia } from '../../types';
import { readMediaDownloadBlob } from './mediaDownload';

export interface BatchDownloadFile { name: string; blob: Blob }

/** Fetch every selected item on its own, so one failed download no longer
 * cancels the whole ZIP. Items missing from the loaded list count as failed. */
export const collectBatchDownload = async (
  ids: string[], media: Pick<GeneratedMedia, 'id' | 'url' | 'mediaType'>[], fetcher: typeof fetch = fetch,
): Promise<{ files: BatchDownloadFile[]; failed: number }> => {
  const results = await Promise.allSettled(ids.map(async id => {
    const item = media.find(entry => entry.id === id);
    if (!item?.url) throw new Error('This item is not available.');
    const response = await fetcher(item.url);
    // An error page must never be saved as the media file, even with HTTP 200.
    const blob = await readMediaDownloadBlob(response);
    const ext = item.mediaType === 'video' ? 'mp4' : blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    return { name: `banana-${id}.${ext}`, blob };
  }));
  const files = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  return { files, failed: results.length - files.length };
};

export const describeBatchDownloadFailure = (failed: number, total: number): string => failed >= total
  ? `${total === 1 ? 'The selected item could not' : `None of the ${total} selected items could`} be downloaded. Try again.`
  : `${failed} of ${total} items could not be downloaded. The ZIP contains the other ${total - failed}. Your selection is kept so you can try again.`;
