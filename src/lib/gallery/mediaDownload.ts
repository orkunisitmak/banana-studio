/** The server answered with an error status or a non-media page. */
export class DownloadHttpError extends Error {}

/** Recognize supported media when a server labels its bytes as a text page. */
const sniffMediaType = async (blob: Blob): Promise<string | undefined> => {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 8 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(4, 4) === 'ftyp') return 'video/mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
};

/** Reject error pages, but retain valid media whose Content-Type is wrong. */
export const readMediaDownloadBlob = async (response: Response): Promise<Blob> => {
  if (!response.ok) throw new DownloadHttpError(`Download failed (${response.status}). Reload the gallery and try again.`);
  const mime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  const blob = await response.blob();
  if (!mime.startsWith('text/') && !/^application\/(?:(?:x-)?(?:json|xml)|[^/]+\+(?:json|xml))$/.test(mime)) return blob;
  const detected = await sniffMediaType(blob);
  if (detected) return blob.slice(0, blob.size, detected);
  throw new DownloadHttpError('The download link returned a page instead of media. Reload the gallery and try again.');
};

/** Read a media file for download. Error bodies are never saved as files. */
export const fetchMediaBlob = async (url: string, fetcher: typeof fetch = fetch): Promise<Blob> => {
  const response = await fetcher(url);
  return readMediaDownloadBlob(response);
};

/** Opening the URL in a new tab helps only when the request itself failed. */
export const shouldOpenDownloadFallback = (error: unknown): boolean => !(error instanceof DownloadHttpError);
