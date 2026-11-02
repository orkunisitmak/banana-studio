/** The service that holds a video's media, from its task id (H3 always runs on fal.ai). */
export const videoProviderName = (taskId: string | undefined, isH3 = false): string =>
  isH3 || taskId?.startsWith('bs_fal_') ? 'fal.ai' : taskId?.startsWith('bs_openrouter_') ? 'OpenRouter' : 'EvoLink';

/** The line a broken video card shows, so the provider is readable without hovering. H3 is always fal.ai, so it needs no task id. */
export const brokenVideoProviderLabel = (media: { mediaType?: string; taskId?: string; videoModel?: string }): string | null =>
  media.mediaType === 'video' && (media.taskId || media.videoModel === 'minimax-h3')
    ? `Held by ${videoProviderName(media.taskId, media.videoModel === 'minimax-h3')}`
    : null;
