/** Image models served by a ComfyUI instance the workspace owner runs.
 * No provider account is billed; the owner's own GPU does the work. */
export const LOCAL_FLUX_MODEL = 'flux2-klein-local' as const;
/** FLUX 3 Image Klein distilled: better text, identity and multi-reference work, slower. */
export const LOCAL_FLUX3_MODEL = 'flux3-klein-local' as const;
export const LOCAL_IMAGE_MODELS: readonly string[] = [LOCAL_FLUX_MODEL, LOCAL_FLUX3_MODEL];
export const isLocalImageModel = (model: unknown): boolean => LOCAL_IMAGE_MODELS.includes(model as string);
/** Reference conditioning grows with every image; 8 GB cards stay usable at six. */
export const LOCAL_FLUX_REFERENCE_LIMIT = 6;
