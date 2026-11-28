import { useEffect, useRef, useState } from 'react';
import { refreshMediaAccessUrl } from '../services/storageService';

interface ImageSource {
  key: string;
  url: string;
  loading: boolean;
  preview: boolean;
  failed: boolean;
}

const isStoredImage = (url: string) => /\/storage\/v1\/object\/(?:sign|authenticated)\//.test(url);
const LOAD_TIMEOUT_MS = 20_000;

/** Only reads saved files. Fetching the selected original avoids leaving it in
 * Chrome's delayable <img> queue behind the gallery's thumbnail requests. */
export function useGalleryImageSource(src: string, fallbackSrc?: string) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([src, fallbackSrc, attempt]);
  const initial = (): ImageSource => ({ key, url: isStoredImage(src) ? fallbackSrc || '' : src || fallbackSrc || '', loading: Boolean(src), preview: !src && Boolean(fallbackSrc), failed: !src });
  const [source, setSource] = useState<ImageSource>(initial);
  const activeKey = useRef(key);
  const stopTimer = useRef<() => void>(() => {});
  activeKey.current = key;

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    const fail = () => {
      if (!active || activeKey.current !== key) return;
      clearTimeout(timer);
      setSource({ key, url: fallbackSrc || '', loading: false, preview: Boolean(fallbackSrc), failed: true });
    };
    setSource(initial());
    const timer = src ? setTimeout(() => { controller.abort(); fail(); }, LOAD_TIMEOUT_MS) : undefined;
    stopTimer.current = () => clearTimeout(timer);

    if (src && isStoredImage(src)) {
      void (async () => {
        // A manual retry also renews an expired private URL. Do not renew every
        // index poll or retry generation; the operation is a saved-file read.
        let url = attempt ? await refreshMediaAccessUrl(src, false) : src;
        if (!active || controller.signal.aborted) return;
        // Do not coalesce with an already stalled <img> cache entry in another
        // gallery tab. The object URL is retained for this viewer's lifetime.
        const options: RequestInit & { priority: string } = { signal: controller.signal, priority: 'high', cache: 'no-store' };
        let response = await fetch(url, options);
        if ((response.status === 401 || response.status === 403) && !attempt) {
          url = await refreshMediaAccessUrl(src, false);
          if (!active || controller.signal.aborted) return;
          response = await fetch(url, options);
        }
        if (!response.ok) throw new Error('Saved image could not be read.');
        const blob = await response.blob();
        if (!blob.size) throw new Error('Saved image is empty.');
        if (!active || controller.signal.aborted || activeKey.current !== key) return;
        objectUrl = URL.createObjectURL(blob);
        setSource({ key, url: objectUrl, loading: true, preview: false, failed: false });
      })().catch(fail);
    }

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, fallbackSrc, key]);

  const current = source.key === key ? source : initial();
  return {
    ...current,
    retry: () => setAttempt(value => value + 1),
    onLoad: () => {
      // The thumbnail may finish before the original fetch. It is a preview,
      // not confirmation that the requested full-resolution file has loaded.
      if (activeKey.current !== key || (isStoredImage(src) && !current.url.startsWith('blob:'))) return;
      stopTimer.current();
      setSource(value => value.key === key ? { ...value, loading: false } : value);
    },
    onError: () => {
      if (activeKey.current !== key || !current.url) return;
      if (current.url === fallbackSrc && (isStoredImage(src) || current.failed)) {
        setSource(value => value.key === key && value.url === fallbackSrc ? { ...value, url: '', preview: false } : value);
      } else {
        stopTimer.current();
        const nextFallback = current.url === fallbackSrc ? '' : fallbackSrc || '';
        setSource({ key, url: nextFallback, loading: false, preview: Boolean(nextFallback), failed: true });
      }
    },
  };
}
