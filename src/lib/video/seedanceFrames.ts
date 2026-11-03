import type { ReferenceImage, VideoOperation } from '../../types.js';
import { mapUnquotedPrompt } from '../references/referenceTokens.ts';

/** Frame roles are endpoint constraints, not ordinary reference-image hints. */
export const getSeedanceFrameError = (
  images: ReferenceImage[],
  videoCount = 0,
  audioCount = 0,
  operation: VideoOperation = 'generate',
): string | undefined => {
  if (!images.some(image => image.isFirstFrame || image.isLastFrame)) return;
  if (operation !== 'generate') return 'First / last frames require Generate. Remove frame roles to use another action.';
  if (videoCount || audioCount || images.some(image => !image.isFirstFrame && !image.isLastFrame)) {
    return 'First / last frames accept only a start image and an optional end image. Remove other image, video and audio references, or switch to References.';
  }
  if (images.some(image => image.isFirstFrame && image.isLastFrame)) return 'A single image cannot have both frame roles. Assign a separate start and end image.';
  if (images.filter(image => image.isFirstFrame).length !== 1) return 'Choose exactly one First Frame. A Last Frame alone would be interpreted as the starting image.';
  if (images.filter(image => image.isLastFrame).length > 1) return 'Choose at most one Last Frame.';
};

export const assignSeedanceFrames = (images: ReferenceImage[]): ReferenceImage[] => {
  if (images.length < 1 || images.length > 2) throw new Error('Add one or two images before selecting First / last frames.');
  const first = images.find(image => image.isFirstFrame) || images[0];
  return images.map(image => ({
    ...image, isFirstFrame: image.id === first.id, isLastFrame: image.id !== first.id,
    isSubjectImage: false, isSecondPerson: false, personId: undefined, personName: undefined,
  }));
};

/** Preserve editor indices even when the provider array is reordered start/end. */
export const normalizeSeedanceFrameTags = (prompt: string, images: ReferenceImage[]): string => {
  const label = (index: string): string => {
    const image = images[Number(index) - 1];
    if (!image || (!image.isFirstFrame && !image.isLastFrame)) throw new Error(`Image ${index} is not an attached start/end frame.`);
    return image.isFirstFrame ? 'the provided first frame' : 'the provided last frame';
  };
  return mapUnquotedPrompt(prompt, text => text.replace(/\\_/g, '_')
    .replace(/[@#]FIRST[_ ]?FRAME\b/gi, 'the provided first frame')
    .replace(/[@#]LAST[_ ]?FRAME\b/gi, () => {
      if (!images.some(image => image.isLastFrame)) throw new Error('The prompt mentions a Last Frame, but none is attached.');
      return 'the provided last frame';
    })
    .replace(/[@#](?:REF[_ ]?)?IMAGE[_ ]?(\d+)\b/gi, (_match, index) => label(index)));
};

export const prepareSeedanceFramePrompt = (prompt: string, images: ReferenceImage[]): string => {
  const direction = images.some(image => image.isLastFrame)
    ? 'Begin at the provided first frame and finish at the provided last frame, matching their visible composition. Follow the requested camera path and action between these boundary frames. Keep movement continuous unless the user explicitly requests a cut, dissolve or transformation. Reach the final composition through the requested movement rather than an unrequested image blend, teleport or morph; decelerate into the ending instead of snapping to it.'
    : 'Begin at the provided first frame, preserving its visible composition, and follow the requested motion. Preserve subjects, environment and camera perspective unless the direction explicitly calls for a change.';
  return `${direction}\n\n${normalizeSeedanceFrameTags(prompt, images)}`.trim();
};
