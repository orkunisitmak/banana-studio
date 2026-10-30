import type { GeneratedMedia } from '../../types';
import { DownloadHttpError, validateMediaDownloadBlob } from './mediaDownload';

export interface BatchDownloadFile { name: string; blob: Blob }
// ZIP creation also holds its output in memory, so keep originals well below a
// browser's heap limit. Large videos can be downloaded individually instead.
export const BATCH_DOWNLOAD_MAX_BYTES = 128 * 1024 * 1024;
export interface BatchDownloadProgress { completed: number; total: number; bytes: number }
export interface BatchDownloadOptions {
  concurrency?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: BatchDownloadProgress) => void;
  refreshUrl?: (url: string) => Promise<string>;
}
export class BatchDownloadLimitError extends Error {}

/** Bounded workers and a shared streaming byte budget cap retained ZIP inputs.
 * Ordinary per-item failures still allow the other selected files to download. */
export const collectBatchDownload = async (
  ids: string[], media: Pick<GeneratedMedia, 'id' | 'url' | 'mediaType'>[], fetcher: typeof fetch = fetch,
  options: BatchDownloadOptions = {},
): Promise<{ files: BatchDownloadFile[]; failed: number }> => {
  const maxBytes = options.maxBytes ?? BATCH_DOWNLOAD_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('The ZIP size budget must be positive.');
  const concurrency = Math.max(1, Math.min(3, Math.floor(options.concurrency || 3)));
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const selected = new Map(media.map(item => [item.id, item]));
  const results: Array<BatchDownloadFile | undefined> = new Array(ids.length);
  let cursor = 0, completed = 0, bytes = 0, fatal: unknown;
  const report = () => options.onProgress?.({ completed, total: ids.length, bytes });
  const limitError = () => new BatchDownloadLimitError(`ZIP input size limit (${maxBytes === BATCH_DOWNLOAD_MAX_BYTES ? '128 MiB' : `${maxBytes} bytes`}) exceeded. Select fewer items or download large videos individually.`);
  const worker = async () => {
    while (cursor < ids.length && !controller.signal.aborted) {
      const index = cursor++;
      let itemBytes = 0;
      try {
        controller.signal.throwIfAborted();
        const item = selected.get(ids[index]);
        if (!item?.url) throw new Error('This item is not available.');
        const url = options.refreshUrl ? await options.refreshUrl(item.url) : item.url;
        controller.signal.throwIfAborted();
        const response = await fetcher(url, { signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel();
          throw new DownloadHttpError(`Download failed (${response.status}).`);
        }
        const reader = response.body?.getReader();
        const chunks: BlobPart[] = [];
        const cancelReader = () => { void reader?.cancel(controller.signal.reason).catch(() => {}); };
        controller.signal.addEventListener('abort', cancelReader, { once: true });
        try {
          const advertised = Number(response.headers.get('content-length'));
          if (advertised > maxBytes - bytes) throw limitError();
          if (reader) while (true) {
            controller.signal.throwIfAborted();
            const { done, value } = await reader.read();
            controller.signal.throwIfAborted();
            if (done) break;
            if (value.byteLength > maxBytes - bytes) throw limitError();
            bytes += value.byteLength;
            itemBytes += value.byteLength;
            chunks.push(value);
            report();
          }
        } catch (error) {
          await reader?.cancel().catch(() => {});
          throw error;
        } finally {
          controller.signal.removeEventListener('abort', cancelReader);
          reader?.releaseLock();
        }
        const blob = await validateMediaDownloadBlob(new Blob(chunks, { type: response.headers.get('content-type') || '' }), response.headers.get('content-type') || '');
        controller.signal.throwIfAborted();
        const ext = item.mediaType === 'video' ? 'mp4' : blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
        results[index] = { name: `banana-${item.id}.${ext}`, blob };
      } catch (error) {
        bytes -= itemBytes;
        if (error instanceof BatchDownloadLimitError) {
          fatal = error;
          controller.abort(error);
        } else if (controller.signal.aborted && !fatal) fatal = controller.signal.reason;
      } finally {
        completed++;
        report();
      }
    }
  };
  try {
    controller.signal.throwIfAborted();
    report();
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    if (fatal) throw fatal;
    controller.signal.throwIfAborted();
    const files = results.filter((file): file is BatchDownloadFile => !!file);
    return { files, failed: ids.length - files.length };
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
};

export const describeBatchDownloadFailure = (failed: number, total: number): string => failed >= total
  ? `${total === 1 ? 'The selected item could not' : `None of the ${total} selected items could`} be downloaded. Try again.`
  : `${failed} of ${total} items could not be downloaded. The ZIP contains the other ${total - failed}. Your selection is kept so you can try again.`;
