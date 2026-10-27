import { MediaAccessError } from './mediaAccess';

type UploadReference = (data: string, mime: string, prefix: string) => Promise<string | null>;

/** Share uploads across simultaneous Brainstorm images, retaining the exact input bytes. */
export const createReferenceUploader = (
  upload: UploadReference,
  refreshUrl: (url: string) => Promise<string> = async url => url,
) => {
  type Entry = { expires: number; result: Promise<string>; pending: boolean; checkedThrough: number };
  const cache = new Map<string, Entry>();
  let sequence = 0;
  return async (data: string, mime: string, prefix: string, userScope: string): Promise<string> => {
    // The standalone workspace serves its own media over http://127.0.0.1; those
    // URLs are already stored, not inline bytes to upload again.
    if (data.startsWith('https://') || (typeof location !== 'undefined' && data.startsWith(`${location.origin}/storage/`))) return refreshUrl(data);
    const request = ++sequence;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = `${userScope}:${mime}:${prefix}:${hash}`;
    const now = Date.now();
    for (const [key, entry] of cache) if (entry.expires < now) cache.delete(key);
    const uploadOriginal = async () => {
      const url = await upload(data, mime, prefix);
      if (!url) throw new Error('Could not upload a reference image. No OpenAI request was sent.');
      return url;
    };
    const existing = cache.get(key);
    // Hashing finishes in separate tasks. Calls already started when a check
    // finished belong to the same batch even if their digest resolves later.
    if (existing && (existing.pending || request <= existing.checkedThrough)) return existing.result;
    while (!existing && cache.size >= 48) cache.delete(cache.keys().next().value!);
    const entry = existing || { expires: now + 5 * 60_000, result: Promise.resolve(''), pending: false, checkedThrough: 0 };
    const previous = entry.result;
    entry.pending = true;
    entry.result = (existing ? previous.then(async url => {
      try { return await refreshUrl(url); }
      catch (error) {
        // Only restore our own cached upload when the original bytes are
        // still present. URL-only references retain their normal RLS check.
        if (!(error instanceof MediaAccessError) || !error.missing) throw error;
        return uploadOriginal();
      }
    }) : uploadOriginal()).catch(error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    }).finally(() => { entry.pending = false; entry.checkedThrough = sequence; });
    cache.set(key, entry);
    return entry.result;
  };
};
