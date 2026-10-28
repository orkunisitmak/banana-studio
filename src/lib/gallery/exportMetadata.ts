import type { GeneratedMedia } from '../../types';

/** Sidecar written next to a batch export so prompts stay with their files. */
export const buildExportMetadata = (media: GeneratedMedia) => ({
  id: media.id,
  type: media.mediaType,
  createdAt: new Date(media.createdAt).toISOString(),
  prompt: media.prompt,
  originalPrompt: media.originalPrompt,
  imageModel: media.imageModel,
  videoModel: media.videoModel,
  provider: media.generationProvider,
  aspectRatio: media.mediaType === 'video' ? media.videoAspectRatio || media.aspectRatio : media.aspectRatio,
  resolution: media.resolution,
  videoQuality: media.videoQuality,
  videoDuration: media.videoDuration,
  tags: media.tags || [],
  folderId: media.folderId || null,
  isFavorite: media.isFavorite === true,
  generationCost: media.generationCost,
  generationTime: media.generationTime,
});
