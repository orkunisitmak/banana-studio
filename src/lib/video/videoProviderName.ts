import { PROVIDER_LABELS, type AIProvider } from '../providers';

/** The service that holds a video's media, from its task id (H3 always runs on fal.ai). */
export const videoProviderName = (taskId: string | undefined, isH3 = false): string =>
  isH3 || taskId?.startsWith('bs_fal_') ? 'fal.ai' : taskId?.startsWith('bs_openrouter_') ? 'OpenRouter' : 'EvoLink';

type BrokenVideoMedia = { mediaType?: string; taskId?: string; videoModel?: string; generationProvider?: AIProvider };

/** The provider a broken video's row can name. H3 is always fal.ai, so it needs no task id; a saved provider covers a row whose
 * task id was never written. Null when the row says nothing, so no provider is made up. */
const brokenVideoProviderName = (media: BrokenVideoMedia): string | null => {
  if (media.taskId || media.videoModel === 'minimax-h3') return videoProviderName(media.taskId, media.videoModel === 'minimax-h3');
  return media.generationProvider ? PROVIDER_LABELS[media.generationProvider] : null;
};

/** The line a broken video card shows, so the provider is readable without hovering. */
export const brokenVideoProviderLabel = (media: BrokenVideoMedia): string | null => {
  if (media.mediaType !== 'video') return null;
  const provider = brokenVideoProviderName(media);
  return provider ? `Held by ${provider}` : null;
};

/** The sentence a broken video's detail panel shows when the row has no saved error. */
export const brokenVideoExpiryText = (media: BrokenVideoMedia): string => {
  const provider = brokenVideoProviderName(media);
  return `The source URL is no longer accessible. ${provider ? `${provider} media URLs` : 'Media URLs'} expire after a period of time and the file was not cached locally.`;
};
