import type { GenerationConfig, ReferenceImage, ReferenceVideo } from '../../types';

export const isH3MetadataOnlyUpdate = (before: GenerationConfig, after: GenerationConfig): boolean => {
  const { referenceImages: beforeImages, referenceVideos: beforeVideos, ...beforeDraft } = before;
  const { referenceImages: afterImages, referenceVideos: afterVideos, ...afterDraft } = after;
  const oldValues = beforeDraft as unknown as Record<string, unknown>, newValues = afterDraft as unknown as Record<string, unknown>;
  if (Object.keys({ ...oldValues, ...newValues }).some(key => oldValues[key] !== newValues[key])) return false;
  const sameReferences = (oldReferences: (ReferenceImage | ReferenceVideo)[], newReferences: (ReferenceImage | ReferenceVideo)[]) => oldReferences.length === newReferences.length && oldReferences.every((reference, index) => {
    const oldReference = reference as unknown as Record<string, unknown>, newReference = newReferences[index] as unknown as Record<string, unknown>;
    return Object.keys({ ...oldReference, ...newReference }).filter(key => key !== 'width' && key !== 'height').every(key => oldReference[key] === newReference[key]);
  });
  return sameReferences(beforeImages, afterImages) && sameReferences(beforeVideos || [], afterVideos || []);
};
