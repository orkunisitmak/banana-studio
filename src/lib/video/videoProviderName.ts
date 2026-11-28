import { PROVIDER_LABELS, type AIProvider } from '../providers';

/** Encoded task identity wins over a mutable provider preference. Legacy raw
 * IDs predate provider selection: H3 used fal; Seedance used EvoLink. */
export const videoTaskProvider = (taskId?: string, saved?: AIProvider, legacyH3 = false): AIProvider | undefined =>
  taskId?.startsWith('bs_fal_') ? 'fal' : taskId?.startsWith('bs_openrouter_') ? 'openrouter'
    : taskId?.startsWith('bs_evolink_') ? 'evolink' : saved ?? (legacyH3 ? 'fal' : taskId ? 'evolink' : undefined);

export const videoProviderName = (taskId?: string, legacyH3 = false, savedProvider?: AIProvider): string =>
  PROVIDER_LABELS[videoTaskProvider(taskId, savedProvider, legacyH3) ?? 'evolink'];

type BrokenVideoMedia = { mediaType?: string; taskId?: string; videoModel?: string; generationProvider?: AIProvider };

/** Null when the row gives us no evidence of a provider. */
const brokenVideoProviderName = (media: BrokenVideoMedia): string | null => {
  if (media.taskId || media.generationProvider || media.videoModel === 'minimax-h3') return videoProviderName(media.taskId, media.videoModel === 'minimax-h3', media.generationProvider);
  return null;
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
