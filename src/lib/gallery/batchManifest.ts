import type { GeneratedMedia } from '../../types';
import type { BatchDownloadFile } from './batchDownload';

export interface BatchManifestEntry {
  id: string;
  file: string | null;
  /** 'record' when the full row was loaded, 'index' when only the gallery index record was available. */
  source: 'record' | 'index';
  mediaType: GeneratedMedia['mediaType'];
  createdAt: string;
  prompt: string;
  originalPrompt?: string;
  providerPrompt?: string;
  provider?: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  videoDuration?: number;
  costUsd?: number;
  references: string[];
}

/** Gallery index records omit reference_images and other detail-only
 * fields, so load the full record for each item and keep the index record
 * only when that load fails. */
export const MANIFEST_VERSION = 1;
/** Per-item bound on the detail load; a slow or hanging read falls back to the index record. */
export const DETAIL_LOAD_TIMEOUT_MS = 10_000;
/** Detail loads run a few at a time so a large selection does not open one request per item at once. */
export const DETAIL_LOAD_CONCURRENCY = 4;

export interface ManifestMedia { media: GeneratedMedia; source: 'record' | 'index' }

export const loadManifestMedia = async (
  ids: string[], index: GeneratedMedia[], load: (id: string) => Promise<GeneratedMedia | null>,
  { timeoutMs = DETAIL_LOAD_TIMEOUT_MS, concurrency = DETAIL_LOAD_CONCURRENCY } = {},
): Promise<ManifestMedia[]> => {
  const bounded = (id: string) => new Promise<GeneratedMedia | null>(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    load(id).then(record => resolve(record), () => resolve(null)).finally(() => clearTimeout(timer));
  });
  const results: (ManifestMedia | undefined)[] = new Array(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const position = next++;
      const id = ids[position];
      const record = await bounded(id);
      const fallback = index.find(media => media.id === id);
      results[position] = record ? { media: record, source: 'record' } : fallback ? { media: fallback, source: 'index' } : undefined;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
  return results.filter((item): item is ManifestMedia => !!item);
};

const timestamp = (value: number): string => Number.isFinite(value) ? new Date(value).toISOString() : '';

/** Describe the selected items next to their ZIP file names. Only reference
 * names are listed: media URLs are signed and never belong in an export. */
export const buildBatchManifest = (
  ids: string[], media: (GeneratedMedia | ManifestMedia)[], files: Pick<BatchDownloadFile, 'name'>[],
): string => {
  const entries = media.map(item => 'media' in item ? item : { media: item, source: 'index' as const });
  const items = ids.flatMap(id => {
    const found = entries.find(entry => entry.media.id === id);
    if (!found) return [];
    const item = found.media;
    const entry: BatchManifestEntry = {
      id,
      file: files.find(file => file.name.startsWith(`banana-${id}.`))?.name ?? null,
      source: found.source,
      mediaType: item.mediaType,
      createdAt: timestamp(item.createdAt),
      prompt: item.prompt,
      originalPrompt: item.originalPrompt,
      providerPrompt: item.imageGenerationPrompt ?? item.providerExpandedPrompt,
      provider: item.generationProvider,
      model: item.providerModel ?? item.imageModel ?? item.videoModel,
      aspectRatio: item.mediaType === 'video' ? item.videoAspectRatio : item.aspectRatio,
      resolution: item.mediaType === 'video' ? item.videoQuality : item.resolution,
      videoDuration: item.videoOutputDuration ?? item.videoDuration,
      costUsd: item.generationCost?.usd,
      references: [
        ...(item.referenceImages || []).map(reference => reference.personName || reference.id),
        ...(item.referenceVideos || []).map(reference => reference.id),
        ...(item.referenceAudios || []).map(reference => reference.name || reference.id),
      ],
    };
    return [entry];
  });
  return JSON.stringify({ version: MANIFEST_VERSION, exportedAt: new Date().toISOString(), items }, null, 2);
};
