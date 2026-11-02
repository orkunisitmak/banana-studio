/** The service that holds a video's media, from its task id (H3 always runs on fal.ai). */
export const videoProviderName = (taskId: string | undefined, isH3 = false): string =>
  isH3 || taskId?.startsWith('bs_fal_') ? 'fal.ai' : taskId?.startsWith('bs_openrouter_') ? 'OpenRouter' : 'EvoLink';

/** The line a broken video card shows, so the provider is readable without hovering. */
export const videoProviderLabel = (taskId: string | undefined, isH3 = false): string => `Held by ${videoProviderName(taskId, isH3)}`;
