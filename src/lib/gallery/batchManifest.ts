import type { GeneratedMedia } from '../../types';
import type { BatchDownloadFile } from './batchDownload';

export interface BatchManifestEntry {
  id: string;
  file: string | null;
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
export const loadManifestMedia = async (
  ids: string[], index: GeneratedMedia[], load: (id: string) => Promise<GeneratedMedia | null>,
): Promise<GeneratedMedia[]> => {
  const records = await Promise.all(ids.map(async id => (await load(id).catch(() => null)) ?? index.find(media => media.id === id)));
  return records.filter((media): media is GeneratedMedia => !!media);
};

const timestamp = (value: number): string => Number.isFinite(value) ? new Date(value).toISOString() : '';

/** Describe the selected items next to their ZIP file names. Only reference
 * names are listed: media URLs are signed and never belong in an export. */
export const buildBatchManifest = (
  ids: string[], media: GeneratedMedia[], files: Pick<BatchDownloadFile, 'name'>[],
): string => {
  const items = ids.flatMap(id => {
    const item = media.find(entry => entry.id === id);
    if (!item) return [];
    const entry: BatchManifestEntry = {
      id,
      file: files.find(file => file.name.startsWith(`banana-${id}.`))?.name ?? null,
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
  return JSON.stringify({ exportedAt: new Date().toISOString(), items }, null, 2);
};
