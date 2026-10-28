import type { GeneratedMedia } from '../types';
import { refreshMediaAccessUrl } from './storageService';

// These are application memory limits, not claims about an iOS API limit.
export const MAX_PHOTO_SHARE_COUNT = 20;
export const MAX_PHOTO_SHARE_BYTES = 100 * 1024 * 1024;
const PREPARATION_TIMEOUT_MS = 120_000;

type PhotoShareNavigator = Pick<Navigator, 'share' | 'canShare'> & Partial<Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>>;
type PhotoSource = Pick<GeneratedMedia, 'id' | 'url' | 'mediaType' | 'isLoading' | 'error' | 'status'>;
type PreparePhotoOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  navigator?: PhotoShareNavigator;
};

const currentNavigator = (): PhotoShareNavigator | undefined => typeof navigator === 'undefined' ? undefined : navigator;
const abortError = () => new DOMException('Photo preparation was cancelled.', 'AbortError');
const sizeError = () => new Error('These photos exceed the 100 MB sharing limit. Select fewer photos and try again.');

export const isMobilePhotoDevice = (nav = currentNavigator()): boolean => !!nav && (
  /iPhone|iPad|iPod|Android/i.test(nav.userAgent || '')
  || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1)
);

export const supportsPhotoSharing = (nav = currentNavigator()): boolean => {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || typeof File === 'undefined') return false;
  try {
    // Probe file support specifically; URL/text-only sharing is insufficient.
    return nav.canShare({ files: [new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'photo.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw signal.reason || abortError();
};

// URL signing itself has no AbortSignal API; abandon its result immediately on
// cancellation instead of allowing it to start an unwanted download afterwards.
const abortable = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const aborted = () => reject(signal.reason || abortError());
  if (signal.aborted) { aborted(); return; }
  signal.addEventListener('abort', aborted, { once: true });
  operation.then(
    value => { signal.removeEventListener('abort', aborted); resolve(value); },
    error => { signal.removeEventListener('abort', aborted); reject(error); },
  );
});

const readBoundedImage = async (response: Response, availableBytes: number, signal: AbortSignal): Promise<Blob> => {
  if (!response.ok) throw new Error(`A photo could not be downloaded (${response.status}). Your selection is unchanged; try again.`);
  const declaredBytes = Number(response.headers.get('content-length'));
  if (declaredBytes > availableBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw sizeError();
  }
  if (!response.body) {
    const blob = await abortable(response.blob(), signal);
    if (blob.size > availableBytes) throw sizeError();
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let bytes = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > availableBytes) throw sizeError();
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks);
};

const imageFormat = async (blob: Blob): Promise<{ mime: string; extension: string }> => {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  // Use actual file signatures: signed storage/provider responses occasionally
  // use application/octet-stream, while an expired URL can return an HTML page.
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  throw new Error('A selected photo is unavailable or is not a supported PNG, JPEG, or WebP image. Your selection is unchanged.');
};

/** Download originals first; this function deliberately never opens a share sheet. */
export const preparePhotosForSharing = async (media: PhotoSource[], options: PreparePhotoOptions = {}): Promise<File[]> => {
  if (!media.length) throw new Error('Select at least one photo.');
  if (media.length > MAX_PHOTO_SHARE_COUNT) throw new Error(`Select up to ${MAX_PHOTO_SHARE_COUNT} photos at a time for Photos.`);
  if (media.some(item => item.mediaType === 'video' || item.isLoading || item.error || item.status === 'failed' || item.status === 'pending' || item.status === 'processing' || !item.url)) {
    throw new Error('Select completed photos only. Remove videos or unfinished images from this selection.');
  }
  if (!supportsPhotoSharing(options.navigator || currentNavigator())) {
    throw new Error('This browser cannot share photo files. Open this gallery in Safari on your iPhone, or a browser with file sharing support.');
  }

  const controller = new AbortController();
  const parentAbort = () => controller.abort(options.signal?.reason || abortError());
  if (options.signal?.aborted) parentAbort();
  else options.signal?.addEventListener('abort', parentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Preparing photos timed out. Select fewer photos or try again.')), PREPARATION_TIMEOUT_MS);
  const files: File[] = [];
  let totalBytes = 0;
  try {
    throwIfAborted(controller.signal);
    options.onProgress?.(0, media.length);
    // Sequential downloads bound peak memory and preserve selection order.
    for (const item of media) {
      throwIfAborted(controller.signal);
      const url = await abortable(refreshMediaAccessUrl(item.url, false), controller.signal);
      throwIfAborted(controller.signal);
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      const blob = await readBoundedImage(response, MAX_PHOTO_SHARE_BYTES - totalBytes, controller.signal);
      const format = await imageFormat(blob);
      throwIfAborted(controller.signal);
      totalBytes += blob.size;
      const safeId = item.id.replace(/[^a-z0-9_-]/gi, '').slice(0, 80) || 'photo';
      // Original bytes and resolution are retained; no canvas or re-encoding.
      files.push(new File([blob], `banana-${files.length + 1}-${safeId}.${format.extension}`, { type: format.mime }));
      options.onProgress?.(files.length, media.length);
    }
    const nav = options.navigator || currentNavigator();
    if (!nav?.canShare({ files })) throw new Error('Your device cannot share this selection. Try fewer photos or a PNG/JPEG selection.');
    return files;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason || abortError();
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', parentAbort);
  }
};

/**
 * Call directly from a fresh click/tap with already prepared files. There must be
 * no fetch, timer, or await before navigator.share: Safari consumes user activation.
 * A resolved share promise is NOT confirmation that the user chose Photos.
 */
export const sharePreparedPhotos = (files: File[], nav = currentNavigator()): Promise<'shared' | 'cancelled'> => {
  try {
    if (!files.length || files.length > MAX_PHOTO_SHARE_COUNT || files.reduce((size, file) => size + file.size, 0) > MAX_PHOTO_SHARE_BYTES) {
      throw new Error('Prepare your photo selection again before sharing.');
    }
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || !nav.canShare({ files })) {
      throw new Error('Your device cannot share these photos. Try fewer photos or open the gallery in Safari.');
    }
    // Files only makes the native image actions available (e.g. Save N Images).
    // Including a page URL/text can change which targets the OS offers.
    return nav.share({ files }).then(() => 'shared' as const).catch(error => {
      if (error?.name === 'AbortError') return 'cancelled' as const;
      if (error?.name === 'NotAllowedError') throw new Error('Photo sharing was blocked. Tap Save to Photos again to open the share sheet.');
      if (error?.name === 'InvalidStateError') throw new Error('Close the current share sheet, then tap Save to Photos again.');
      throw new Error('The share sheet could not send these photos. Your selection is unchanged; try again.');
    });
  } catch (error) {
    return Promise.reject(error);
  }
};
