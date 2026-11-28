import { getPersonId } from '../references/personReferences.ts';
import type { GenerationConfig, ImageOperation, ReferenceImage } from '../../types.js';
import { SEEDREAM_MODEL } from './seedream55.ts';

export const IMAGE_OPERATION_OPTIONS: { label: string; value: ImageOperation }[] = [
  { label: 'Generate', value: 'generate' },
  { label: 'Edit', value: 'edit' },
];

export const IMAGE_EDIT_SOURCE_REQUIRED = 'Edit needs a source image. Attach the image to edit, or switch the action to Generate.';

export const hasImageEditSelection = (ref: ReferenceImage): boolean => ref.editRegion != null || ref.editScope === 'image';

type ImageActionConfig = Pick<GenerationConfig, 'imageOperation' | 'referenceImages'> &
  Partial<Pick<GenerationConfig, 'imageModel' | 'seedreamOptions' | 'count'>>;

/** The explicit action decides. Drafts, templates and tabs saved before the
 * action existed have none: their drawn areas or chosen sources were explicit
 * edit selections, otherwise they generate. Prompt text never decides. */
export const getImageOperation = (config: ImageActionConfig): ImageOperation =>
  config.imageModel === SEEDREAM_MODEL ? (config.seedreamOptions?.mode === 'edit' || config.seedreamOptions?.mode === 'layerize' ? 'edit' : 'generate')
    : config.imageOperation === 'edit' || config.imageOperation === 'generate' ? config.imageOperation
    : (config.referenceImages || []).some(hasImageEditSelection) ? 'edit' : 'generate';

/** People photos and episode thumbnails stay references; they are never edited. */
export const canBeImageEditSource = (ref: ReferenceImage): boolean => getPersonId(ref) == null && !ref.isVideoContext;

/** Without a drawn area or chosen source, Edit uses the labeled gallery source
 * or else the first attached image that is not a person or episode photo. */
export const getDefaultImageEditSourceIndex = (references: ReferenceImage[]): number => {
  const labeled = references.findIndex(ref => ref.isEditSource && canBeImageEditSource(ref));
  return labeled >= 0 ? labeled : references.findIndex(canBeImageEditSource);
};

export const clearImageEditSelection = (references: ReferenceImage[]): ReferenceImage[] => references.map(ref =>
  ref.editRegion == null && ref.editScope == null && !ref.isEditSource ? ref
    : (({ isEditSource, editScope, editRegion, ...rest }) => rest)(ref));

/** Generate drops leftover edit areas and sources. Edit keeps an explicit area
 * or source, otherwise marks the default source for a whole-image edit. */
export const resolveImageOperation = <T extends ImageActionConfig>(config: T): T => {
  if (config.imageModel === SEEDREAM_MODEL) {
    // Seedream consumes ordered references directly, with no primary source or mask.
    // Its native num_images option is the only batch multiplier.
    const imageOperation = getImageOperation(config);
    return config.imageOperation === imageOperation && config.count === 1 ? config : { ...config, imageOperation, count: 1 };
  }
  const references = config.referenceImages || [];
  if (getImageOperation(config) === 'generate') {
    return references.some(ref => ref.editRegion != null || ref.editScope != null || ref.isEditSource)
      ? { ...config, referenceImages: clearImageEditSelection(references) } : config;
  }
  if (references.some(hasImageEditSelection)) return config;
  const sourceIndex = getDefaultImageEditSourceIndex(references);
  if (sourceIndex < 0) throw new Error(IMAGE_EDIT_SOURCE_REQUIRED);
  return { ...config, referenceImages: references.map((ref, index) => index === sourceIndex
    ? { ...ref, isEditSource: true, editScope: 'image' as const } : ref) };
};

/** Switching back to Generate clears every edit selection so nothing is edited by accident. */
export const setImageOperation = (config: GenerationConfig, imageOperation: ImageOperation): GenerationConfig => {
  const next = config.imageOperation === imageOperation ? config : { ...config, imageOperation };
  return imageOperation === 'generate' ? resolveImageOperation(next) : next;
};

/** Server form of getImageOperation; invalid values are null. */
export const getRequestedImageOperation = (value: unknown, references: ReferenceImage[]): ImageOperation | null =>
  value == null || value === 'generate' || value === 'edit' ? getImageOperation({ imageOperation: (value ?? undefined) as ImageOperation | undefined, referenceImages: references }) : null;
