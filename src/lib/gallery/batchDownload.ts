import type { GeneratedMedia } from '../../types';
import { createTaskDeadline, waitForTask } from '../shared/asyncTask';
import { readMediaDownloadBlob, originalDownloadExtension } from './mediaDownload';

export interface BatchDownloadFile { name: string; blob: Blob }

/** Fetch every selected item on its own, so one failed download no longer
 * cancels the whole ZIP. Items missing from the loaded list count as failed.
 * Image URLs are signed for a limited time, so renew them first, as single
 * downloads do; keep the loaded URL if renewal fails or takes too long, so a
 * renewal that never answers cannot hold up the whole ZIP. */
export const collectBatchDownload = async (
  ids: string[], media: Pick<GeneratedMedia, 'id' | 'url' | 'mediaType' | 'seedreamResult' | 'openaiImageOptions' | 'falSeedanceOptions'>[], fetcher: typeof fetch = fetch,
  refreshUrl: (url: string) => Promise<string> = async url => url, renewTimeoutMs = 10_000,
): Promise<{ files: BatchDownloadFile[]; failed: number }> => {
  const results = await Promise.allSettled(ids.map(async id => {
    const item = media.find(entry => entry.id === id);
    if (!item?.url) throw new Error('This item is not available.');
    const load = async (source: string) => {
      let url = source;
      if (item.mediaType !== 'video') {
        const renewal = createTaskDeadline(renewTimeoutMs);
        try { url = await waitForTask(refreshUrl(source), renewal.signal); } catch { /* Keep the existing link. */ } finally { renewal.dispose(); }
      }
      return readMediaDownloadBlob(await fetcher(url));
    };
    const result = item.seedreamResult;
    if (!result?.images.length) {
      const blob = await load(item.url);
      return [{ name: `banana-${id}.${originalDownloadExtension(item, blob.type)}`, blob }];
    }
    const files: BatchDownloadFile[] = [], names: string[] = [];
    for (const [index, image] of result.images.entries()) {
      const blob = await load(image.url);
      const name = `${index}.${originalDownloadExtension(item, blob.type)}`;
      files.push({ name: `banana-${id}/${name}`, blob });
      names.push(name);
    }
    const manifest = { images: result.images.map((image, i) => ({ ...image, url: names[i] })),
      layers: result.layers?.map((layer, i) => ({ ...layer, image: { ...layer.image, url: names[i] } })) };
    files.push({ name: `banana-${id}/manifest.json`, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) });
    return files;
  }));
  const files = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  return { files, failed: results.filter(result => result.status === 'rejected').length };
};

export const describeBatchDownloadFailure = (failed: number, total: number): string => failed >= total
  ? `${total === 1 ? 'The selected item could not' : `None of the ${total} selected items could`} be downloaded. Try again.`
  : `${failed} of ${total} items could not be downloaded. The ZIP contains the other ${total - failed}. Your selection is kept so you can try again.`;
