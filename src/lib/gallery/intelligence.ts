import type { GeneratedMedia } from '../../types';

export type GalleryQaSeverity = 'error' | 'warning';

export interface GalleryQaIssue {
  id: string;
  mediaId: string;
  severity: GalleryQaSeverity;
  message: string;
}

export const parseImageDimensions = (value?: string): { width: number; height: number } | null => {
  if (!value) return null;
  const match = value.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
};

/** Identifies the same generation recipe, not necessarily the same pixels. */
export const buildMediaFingerprint = (media: GeneratedMedia): string => JSON.stringify([
  media.mediaType,
  media.prompt.trim().toLocaleLowerCase(),
  media.imageModel || media.videoModel || '',
  media.aspectRatio,
  media.resolution,
  media.imageEditSourceId ?? null,
  media.imageGenerationReferenceIds ?? [],
  media.seed ?? null,
  media.openaiImageOptions?.quality ?? null,
  media.videoQuality ?? null,
  media.videoDuration ?? null,
]);

export const findRecipeDuplicateGroups = (images: GeneratedMedia[]): GeneratedMedia[][] => {
  const groups = new Map<string, GeneratedMedia[]>();
  for (const media of images) {
    if (media.isLoading || media.status === 'failed') continue;
    const key = buildMediaFingerprint(media);
    groups.set(key, [...(groups.get(key) || []), media]);
  }
  return [...groups.values()].filter(group => group.length > 1);
};

export const runGalleryQa = (images: GeneratedMedia[]): GalleryQaIssue[] => {
  const issues: GalleryQaIssue[] = [];
  for (const media of images) {
    if (media.isLoading) continue;
    if (media.status === 'failed' || media.error) {
      issues.push({ id: `${media.id}:failed`, mediaId: media.id, severity: 'error', message: media.error || 'Generation failed.' });
    }
    if (!media.url) {
      issues.push({ id: `${media.id}:missing-url`, mediaId: media.id, severity: 'error', message: 'No media URL is available.' });
      continue;
    }
    if (media.mediaType === 'image') {
      const dimensions = parseImageDimensions(media.imageOutputSize);
      if (dimensions && Math.min(dimensions.width, dimensions.height) < 256) {
        issues.push({ id: `${media.id}:tiny`, mediaId: media.id, severity: 'warning', message: `Very small output (${dimensions.width}×${dimensions.height}).` });
      }
    }
  }
  for (const group of findRecipeDuplicateGroups(images)) {
    for (const media of group.slice(1)) {
      issues.push({ id: `${media.id}:duplicate`, mediaId: media.id, severity: 'warning', message: `Same recipe as ${group[0].id}.` });
    }
  }
  return issues;
};

const hashBytes = async (buffer: ArrayBuffer): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Subtle crypto is unavailable.');
  const digest = await subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Fetches and hashes outputs to find identical pixels. Bounded so a huge gallery cannot freeze the tab. */
export interface VisualDuplicateResult {
  groups: GeneratedMedia[][];
  scanned: number;
  skipped: number;
}

export const findVisualDuplicateGroups = async (
  images: GeneratedMedia[],
  limit = 120,
  fetchImpl: typeof fetch = fetch,
): Promise<VisualDuplicateResult> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Pixel scanning requires a secure context (HTTPS or localhost).');
  }
  const candidateImages = images.filter(item =>
    item.mediaType === 'image' && !item.isLoading && item.status !== 'failed' && item.url,
  );
  const groups = new Map<string, GeneratedMedia[]>();
  let scanned = 0;
  let skipped = 0;
  for (const media of candidateImages.slice(0, limit)) {
    try {
      const response = await fetchImpl(media.url);
      if (!response.ok) {
        skipped += 1;
        continue;
      }
      const hash = await hashBytes(await response.arrayBuffer());
      scanned += 1;
      groups.set(hash, [...(groups.get(hash) || []), media]);
    } catch {
      skipped += 1;
    }
  }
  return { groups: [...groups.values()].filter(group => group.length > 1), scanned, skipped };
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const buildContactSheetHtml = (images: GeneratedMedia[], title = 'Banana Studio contact sheet'): string => {
  const printable = images.filter(media => !media.isLoading && media.url);
  const cards = printable.map(media => `
    <figure>
      ${media.mediaType === 'video'
        ? `<div class="video">VIDEO</div>`
        : `<img src="${escapeHtml(media.thumbnailUrl || media.url)}" alt="${escapeHtml(media.prompt.slice(0, 120))}" loading="lazy" />`}
      <figcaption>
        <strong>${escapeHtml(media.imageModel || media.videoModel || media.mediaType)}</strong>
        <span>${escapeHtml(media.prompt.replace(/\s+/g, ' ').slice(0, 160))}</span>
        ${media.tags?.length ? `<em>${escapeHtml(media.tags.join(' · '))}</em>` : ''}
      </figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p.meta { color: #666; font-size: 11px; margin: 0 0 14px; }
    main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    figure { margin: 0; break-inside: avoid; border: 1px solid #ddd; border-radius: 6px; padding: 6px; }
    img, .video { width: 100%; height: 150px; object-fit: cover; border-radius: 4px; background: #eee; }
    .video { display: grid; place-items: center; color: #888; font-size: 12px; }
    figcaption { font-size: 9px; line-height: 1.35; margin-top: 5px; }
    figcaption strong, figcaption span, figcaption em { display: block; overflow: hidden; text-overflow: ellipsis; }
    figcaption strong { font-size: 10px; }
    figcaption span { color: #444; max-height: 3.9em; }
    figcaption em { color: #666; font-style: normal; margin-top: 2px; }
  </style></head><body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${printable.length} item${printable.length === 1 ? '' : 's'} · printed ${new Date().toLocaleString()}</p>
  <main>${cards}</main>
  </body></html>`;
};
