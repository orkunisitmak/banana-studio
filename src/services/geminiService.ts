import { flattenPreparedImageBrief } from '../lib/prompts/promptHistory';
import { describeEditRegionPercent } from '../lib/images/imageEditRegion';
import { buildBrainstormWardrobeGuidance, buildConceptWardrobeGuidance, completeConceptWardrobe, parseBrainstormWardrobe, preserveConceptWardrobe, requestsFixedWardrobeAcrossIdeas } from '../lib/brainstorm/brainstormWardrobe';
import { applyYouTubeCameraGaze, preserveYouTubeCameraGaze, stripYouTubeCameraGaze } from '../lib/youtube/youtubeCameraGaze';
import { buildEditableReferenceGuidance, prepareEditableImagePrompt } from '../lib/references/dynamicReferences';
import { getPersonId, getPersonGroups, buildPersonIdentityContract, buildPersonSeparationRule, normalizeReferencePrompt } from '../lib/references/personReferences';
import { GeneratedMedia, GenerationConfig, ReferenceImage, ReferenceVideo, ReferenceAudio, BrainstormCategory, BrainstormIdea, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getActiveImageModel, ImageModelId, VideoModelId, VideoOperation } from "../types";
import { getGeminiClient, getOpenAITextClient, Modality, ThinkingLevel, type TextTaskOptions } from "./geminiClient";
import { createTaskDeadline, waitForTask } from '../lib/shared/asyncTask';
import { compressBase64Image } from "./imageCompression";
import { generateOpenAIImage, type ImageGenerationContext } from "./openaiImageService";
import { getSunburstReferences, SUNBURST_MODEL } from "../lib/images/openaiImage";
import { assembleSunburstBrainstormIdea, buildReferenceGenerationRule, buildSunburstGuidance, prepareImagePromptResult, buildYouTubeCameraGazeRule, buildYouTubeWardrobeRule, buildYouTubeEditorialRule, buildYouTubeStyleReferenceRule, describeSunburstReference, getSunburstEditIntent, isYouTubeChannelBannerPrompt, isYouTubeThumbnailPrompt, normalizeSunburstPrompt, preserveSunburstEditBrief, preserveSunburstSourceBrief, preserveSunburstThumbnailBrief, stripLegacyOutputCanvas, type ImagePromptSettings } from "../lib/images/imagePrompting";
import { logUsage } from "./authService";
import { refreshMediaAccessUrl } from './storageService';
import { getSeedanceFrameError, normalizeSeedanceFrameTags } from '../lib/video/seedanceFrames';
import { resolveH3MaxMode } from '../lib/video/h3Max';
import { buildH3MaxPromptGuide, getH3MaxPromptImages, h3MaxAcceptsPrompt, normalizeH3MaxPromptLanguage, type H3MaxEnhancementContext } from '../lib/video/h3MaxPromptGuide';
import { OPENAI_TEXT_MODEL, OPENROUTER_TEXT_MODEL, getTextModel, getOpenAIReasoningEffort, getGeminiThinkingLevel, resolveTextModelPreferences } from "../lib/prompts/textModels";
export { getTextModel, setTextModel } from "../lib/prompts/textModels";

type GeminiClient = ReturnType<typeof getGeminiClient>;

// Models
const IMAGE_MODEL_NAME: ImageModelId = DEFAULT_IMAGE_MODEL;
const DEFAULT_IMAGE_THINKING_LEVEL = ThinkingLevel.HIGH;

// Enhance / brainstorm / variations run on the configurable text
// model and thinking settings are captured before preparing references.
const captureTextSettings = async (options: TextTaskOptions = {}): Promise<TextTaskOptions> => {
  if (options.model && options.reasoningEffort && options.thinkingLevel) return { ...options };
  const preferences = await resolveTextModelPreferences();
  options.signal?.throwIfAborted();
  return { ...options, model: options.model || preferences.model,
    reasoningEffort: options.reasoningEffort || preferences.reasoningEffort,
    thinkingLevel: options.thinkingLevel || preferences.thinkingLevel };
};

// Reference images are sent inline as base64 and the whole request must fit
// under Vercel's ~4.5 MB serverless body limit. Keep the combined inline image
// payload comfortably below that — brainstorm can attach several references.
const TEXT_REQUEST_IMAGE_BUDGET_BYTES = 3_800_000;

// One output-language contract for every text provider and image/video target.
// Google lists English among its best-performing image prompt languages:
// https://ai.google.dev/gemini-api/docs/image-generation#limitations
const PRODUCTION_PROMPT_LANGUAGE = `OUTPUT LANGUAGE
Write the production instructions in English, even when the user's draft or creative direction is in Turkish or another language. Translate the scene, action, composition, edit and outfit descriptions faithfully; preserve the user's meaning, quantities, exclusions, reference roles and approved edit boundaries. For Brainstorm JSON, use English in every scene prompt and outfit description; keep the required schema and canonical garment names unchanged.
This language rule applies to production instructions only. Preserve exact visible text, titles, labels, captions and quoted dialogue in their original language, spelling, punctuation and characters, including Turkish characters. Keep an explicitly requested language for newly proposed on-image copy or spoken dialogue; for unspecified thumbnail copy, follow the existing episode-language rules. Do not translate proper names, brands, reference labels or any @ tokens. Do not interpret every quoted draft sentence as visible text: only text the user wants displayed or spoken is literal copy.
Return only the requested prompt or JSON, without a translation explanation or a second copy in the input language. Do not add new scene content or expand an edit beyond the selected area to translate it.`;

const isSupportedImageModel = (model: unknown): model is ImageModelId => {
  return model === 'gemini-3-pro-image-preview'
    || model === 'gemini-3.1-flash-image-preview'
    || model === 'gemini-nano-banana-2.1'
    || model === SUNBURST_MODEL;
};

/**
 * These image-generation models use fal.ai; Sunburst uses OpenAI:
 *  - Nano Banana Pro (Gemini 3 Pro Image) -> fal-ai/nano-banana-pro{,/edit}
 *  - Nano Banana 2.1 -> google/nano-banana-2.1{,/edit} (legacy 2 maps here for new requests)
 *
 * Exposed for App.tsx so the resume-on-refresh / pending-row plumbing knows
 * which generations need a fal request_id persisted up front.
 */
export const isFalImageModel = (model: ImageModelId): boolean => {
  return (
    model === 'gemini-3-pro-image-preview' ||
    model === 'gemini-3.1-flash-image-preview' ||
    model === 'gemini-nano-banana-2.1'
  );
};


const fetchAsBase64 = async (img: ReferenceImage, signal?: AbortSignal): Promise<string> => {
  if (!img.data) return '';
  if (img.data.startsWith('http')) {
    try {
      const url = await refreshMediaAccessUrl(img.data, false);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Reference download failed (${res.status})`);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.includes('base64,') ? result.split('base64,')[1] : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      console.error('Failed to fetch reference image data', e);
      return '';
    }
  }
  return img.data.includes('base64,') ? img.data.split('base64,')[1] : img.data;
};

/**
 * Returns base64 for a reference image, downscaled and re-encoded as JPEG so
 * the combined payload stays under Vercel's 4.5 MB serverless function body
 * limit even when several references are bundled into a single request. The
 * mime type for every successful return is always `image/jpeg`, which is why
 * the call sites below hard-code that string instead of using `img.mimeType`.
 */
const resolveReferenceImageData = async (img: ReferenceImage, signal?: AbortSignal): Promise<string> => {
  const task = createTaskDeadline(20_000, signal, 'Referans görsel hazırlanamadı. Bağlantıyı kontrol edip referansı yeniden ekle.');
  try {
    task.signal.throwIfAborted();
    const raw = await waitForTask(fetchAsBase64(img, task.signal), task.signal);
    if (!raw) return '';
    const compressed = await waitForTask(compressBase64Image(raw, img.mimeType || 'image/jpeg'), task.signal);
    return compressed.data;
  } finally { task.dispose(); }
};

/**
 * Text models need the stable editor labels, not the long human-readable
 * expansion used in the final provider envelope. Expanding @MAIN_PERSON
 * before Brainstorm/Enhance lets the model copy that sentence and nest it in
 * its answer ("identity from the main person shown ..."), which weakens the
 * identity binding on the actual generation. Validate against the current
 * inputs, but keep the editable tokens until the final image/video request.
 */
const prepareTextStagePrompt = (prompt: string, references: ReferenceImage[]): string => {
  const prepared = prepareEditableImagePrompt(stripLegacyOutputCanvas(prompt), references);
  normalizeSunburstPrompt(prepared, references);
  return prepared;
};

const buildTextStageRoleCheck = (prompt: string, references: ReferenceImage[]): string => {
  if (!references.length || !prompt.trim()) return '';
  // Keep one human-readable mapping available for the text model's internal
  // check, while the editable brief itself stays on stable @ labels. The
  // model is explicitly told not to copy this legacy wording into its answer.
  const expanded = normalizeReferencePrompt(stripLegacyOutputCanvas(prompt), references, references);
  return `REFERENCE ROLE CHECK (understand the mapping; do not copy this expanded wording into the returned prompt):\n${expanded}`;
};

const supportsThinkingError = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (!message.includes('thinking')) return false;
  return (
    message.includes('unsupported') ||
    message.includes('not support') ||
    message.includes('not available') ||
    message.includes('invalid') ||
    message.includes('not enabled')
  );
};

// Reference images are already downscaled to ~1568px when attached, but a
// brainstorm with several of them can still blow past Vercel's body limit and
// return 413. Progressively shrink the inline images until the combined base64
// payload fits — text reasoning doesn't need full-resolution references.
const shrinkInlineImagesToBudget = async (parts: any[], signal?: AbortSignal): Promise<void> => {
  const inlineParts = parts.filter(
    (p) => p && p.inlineData && typeof p.inlineData.data === 'string',
  );
  if (inlineParts.length === 0) return;

  const totalBytes = () =>
    inlineParts.reduce((sum, p) => sum + (p.inlineData.data.length || 0), 0);

  if (totalBytes() <= TEXT_REQUEST_IMAGE_BUDGET_BYTES) return;

  for (const maxDimension of [1280, 1024, 768, 640, 512]) {
    for (const part of inlineParts) {
      signal?.throwIfAborted();
      const compression = compressBase64Image(
        part.inlineData.data,
        part.inlineData.mimeType || 'image/jpeg',
        { maxDimension, quality: 0.7 },
      );
      const { data, mimeType } = await (signal ? waitForTask(compression, signal) : compression);
      part.inlineData.data = data;
      part.inlineData.mimeType = mimeType;
    }
    if (totalBytes() <= TEXT_REQUEST_IMAGE_BUDGET_BYTES) break;
  }
};
// All text features share provider selection; image/video generation stays separate.
// Capture the selected model before awaiting so usage is attributed correctly
// even when Settings changes while a request is running.
const generateTextContent = async (
  ai: GeminiClient, parts: any[],
  action: 'enhance' | 'video_enhance' | 'brainstorm' | 'variation', prompt: string,
  options: TextTaskOptions = {},
  brainstormFormat?: 'wardrobe',
  brainstormCount?: number,
) => {
  const model = options.model || getTextModel();
  const reasoningEffort = options.reasoningEffort || getOpenAIReasoningEffort();
  const thinkingLevel = options.thinkingLevel || getGeminiThinkingLevel();
  await shrinkInlineImagesToBudget(parts, options.signal);
  options.signal?.throwIfAborted();
  // Place this after the draft and model-specific guidance so mirroring the
  // draft language cannot override the shared production-language policy.
  const productionParts = [...parts, { text: PRODUCTION_PROMPT_LANGUAGE }];
  options.onStage?.('connecting');
  if (model === OPENAI_TEXT_MODEL || model === OPENROUTER_TEXT_MODEL) {
    const response = await getOpenAITextClient().models.generateContent({ model, reasoningEffort, contents: { parts: productionParts }, usageContext: { action, prompt }, ...(brainstormFormat ? { brainstormFormat } : {}), ...(brainstormCount != null ? { brainstormCount } : {}) }, options);
    return { ...response, model };
  }
  const response = await ai.models.generateContent({
    model, contents: { parts: productionParts },
    usageContext: { action, prompt }, ...(brainstormFormat ? { brainstormFormat } : {}), ...(brainstormCount != null ? { brainstormCount } : {}),
    config: { thinkingConfig: { thinkingLevel } },
  }, options);
  return { ...response, model };
};

const buildImageGenerationConfig = (
  config: GenerationConfig,
  includeThinking: boolean
) => ({
  responseModalities: [Modality.IMAGE],
  imageConfig: {
    // Keep the same resolution + aspect ratio behavior for all image models.
    aspectRatio: config.aspectRatio,
    imageSize: config.resolution,
  },
  ...(includeThinking ? { thinkingConfig: { thinkingLevel: DEFAULT_IMAGE_THINKING_LEVEL } } : {}),
});

const runImagePromptTask = async (
  task: 'enhance' | 'brainstorm' | 'variation', prompt: string, references: ReferenceImage[], settings: ImagePromptSettings,
  category: BrainstormCategory = isYouTubeThumbnailPrompt(prompt, references, settings) ? 'youtube_thumbnail'
    : settings.imagePromptCategory === 'youtube_thumbnail' ? 'simple' : settings.imagePromptCategory || 'simple', count = 5, customInstructions?: string,
  options: TextTaskOptions = {},
): Promise<string> => {
  options = await captureTextSettings(options);
  if (getSunburstEditIntent(prompt, references, settings)) {
    prompt = stripYouTubeCameraGaze(prompt);
    if (customInstructions) customInstructions = stripYouTubeCameraGaze(customInstructions);
  }
  const compactBrainstorm = task === 'brainstorm' && settings.imageModel === SUNBURST_MODEL;
  if (compactBrainstorm) {
    prompt = flattenPreparedImageBrief(prompt);
    if (customInstructions) customInstructions = flattenPreparedImageBrief(customInstructions);
    if (customInstructions?.trim() === prompt.trim()) customInstructions = undefined;
  }
  const roleChecks = (compactBrainstorm ? [] : [customInstructions, prompt])
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => buildTextStageRoleCheck(value, references))
    .filter(Boolean)
    .join('\n\n');
  const brief = [prompt, customInstructions].filter(Boolean).join('\n\n');
  const guidance = buildSunburstGuidance(task, references, settings, category, count, brief);
  const wardrobeRequired = task === 'brainstorm' && needsBrainstormWardrobe(brief, references, settings, category, count);
  const parts: any[] = [{ text: wardrobeRequired
    ? buildBrainstormWardrobeGuidance(guidance, references, count) : guidance }];
  if (task !== 'brainstorm' && !getSunburstEditIntent(prompt, references, settings)) {
    const wardrobe = buildConceptWardrobeGuidance(prompt);
    if (wardrobe) parts.push({ text: wardrobe });
  }
  if (roleChecks) parts.push({ text: roleChecks });
  const inputs = getSunburstReferences(references);
  for (const [index, ref] of inputs.entries()) {
    const data = await resolveReferenceImageData(ref, options.signal);
    // Silently skipping one input would shift the numbered reference contract.
    if (!data) throw new Error(`Referans görsel ${index + 1} okunamadı. Yeniden ekleyip tekrar dene.`);
    parts.push({ text: describeSunburstReference(ref, index) }, { inlineData: { data, mimeType: 'image/jpeg' } });
  }
  parts.push({ text: `${customInstructions ? `USER CREATIVE DIRECTION:\n${prepareTextStagePrompt(customInstructions, references)}\n\n` : ''}USER BRIEF:\n${prepareTextStagePrompt(prompt, references) || 'Use the attached visual concept and the selected reference roles.'}` });
  const response = await generateTextContent(getGeminiClient(), parts, task, prompt, options, wardrobeRequired ? 'wardrobe' : undefined, task === 'brainstorm' ? count : undefined);
  options.onStage?.('finishing');
  await finishTextUsage(logUsage(task, response.model, prompt || `[${task}-empty-prompt]`, 0, {
    usageMetadata: response.usageMetadata as any, referenceImageCount: inputs.length,
    targetImageModel: settings.imageModel,
  }));
  if (task === 'brainstorm') return response.text || '[]';
  const result = prepareImagePromptResult(response.text?.trim() || prompt, references);
  if (getSunburstEditIntent(prompt, references, settings)) return preserveSunburstEditBrief(result, prompt, references, settings);
  const prepared = task === 'enhance' && isYouTubeThumbnailPrompt(prompt, references, settings) ? completeConceptWardrobe(result, prompt, references)
    : preserveConceptWardrobe(result, prompt);
  return preserveYouTubeCameraGaze(prepared, prompt);
};

export const enhancePrompt = async (
  prompt: string,
  referenceImages: ReferenceImage[] = [],
  settings?: ImagePromptSettings,
  taskOptions: TextTaskOptions = {},
): Promise<string> => {
  const options = await captureTextSettings(taskOptions);
  options.onStage?.('preparing');
  if (settings?.imageModel === SUNBURST_MODEL) {
    return runImagePromptTask('enhance', prompt, referenceImages, settings, undefined, undefined, undefined, options);
  }
  const ai = getGeminiClient();

  const parts: any[] = [];
  const localEdit = getSunburstEditIntent(prompt, referenceImages, settings);
  if (localEdit) prompt = stripYouTubeCameraGaze(prompt);
  const conceptWardrobe = !localEdit ? buildConceptWardrobeGuidance(prompt) : '';

  for (const [index, img] of referenceImages.entries()) {
    const base64Data = await resolveReferenceImageData(img);
    if (!base64Data) throw new Error(`Referans ${index + 1} okunamadı; kişi eşleşmesini korumak için işlem durduruldu.`);
    parts.push({ text: describeSunburstReference(img, index) }, { inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
  }

  let imageContext = buildPersonIdentityContract(referenceImages) + '\n' + buildEditableReferenceGuidance(referenceImages);
  if (!localEdit) imageContext += '\n\n' + buildReferenceGenerationRule(referenceImages);

  imageContext += `\n\n${buildYouTubeStyleReferenceRule(prompt, referenceImages, settings)}\nUse each visual reference only for its brief-assigned role. A product reference does not set the overall style, composition or color grading.${localEdit ? " In local edits, donor references supply only the requested replacement; keep the source's existing visual treatment." : ''}`;

  if (getPersonGroups(referenceImages).length > 0) {
    imageContext += `\n\n## REQUESTED PEOPLE:
For every person requested in the brief, preserve their stable @ identity label above, including the SAME SINGLE person grouping across their photos.
Preserve their exact facial features, hair and skin tone. ${localEdit ? 'Keep existing clothing unchanged unless the user explicitly edits it.' : conceptWardrobe ? 'Keep the validated concept wardrobe unchanged; it already supplies the specific new clothing.' : 'Preserve explicitly requested clothes. For a new thumbnail whose wardrobe is unspecified, describe specific new clothing for each depicted person; do not copy identity-reference clothing.'}
Attached identity photos do not require every person to appear. Follow the user's requested people, counts, exclusions and positions equally for main, second and additional people.
Use the stable reference labels in the returned prompt; preserve exact quoted visible text.`;
  }

  const systemInstruction = `You are an expert prompt engineer for Nano Banana Pro (Gemini 3 Pro Image Preview) and Nano Banana 2.1 (Gemini Nano Banana 2.1). Your task is to transform the user's draft into an optimal image generation prompt.${imageContext}

## CORE PRINCIPLE
Describe the scene as a narrative paragraph—NOT a list of keywords. The model excels at understanding rich, descriptive language.

## PROMPT STRUCTURE BY TYPE

### For Photorealistic Images:
Use this structure: "A photorealistic [shot type] of [subject], [action or expression], set in [environment]. The scene is illuminated by [lighting description], creating a [mood] atmosphere. Captured with a [camera/lens details], emphasizing [key textures and details]."
- Include: camera angles (wide-angle, close-up, low-angle, macro), lens types (85mm portrait lens, 24mm wide-angle), lighting (three-point softbox setup, golden hour backlighting, dramatic chiaroscuro)
- Be hyper-specific: Instead of "fantasy armor" say "ornate elven plate armor, etched with silver leaf patterns, with a high collar and pauldrons shaped like falcon wings"

### For Stylized Illustrations & Stickers:
Use: "A [style] sticker/illustration of a [subject], featuring [key characteristics] and a [color palette]. The design has [line style] and [shading style]. The background is transparent/[color]."
- Explicitly state the art style (kawaii, line art, watercolor, vector, pixel art)
- For stickers: always mention "transparent background" or "die-cut with white border"

### For Text in Images:
Use: "Create a [image type] for [brand/concept] with the text "[exact text]" in a [font style description]. The design should be [style], with a [color scheme]."
- Be explicit about the exact text in quotes
- Describe font style descriptively (bold sans-serif, elegant script, retro block letters)
- For professional text assets, keep typography intent explicit and concrete

### For Product Photography:
Use: "A high-resolution, studio-lit product photograph of a [product] on a [background/surface]. The lighting is [setup] to [purpose]. The camera angle is [angle] to showcase [feature]. Ultra-realistic, with sharp focus on [detail]."

### For Minimalist/Negative Space:
Use: "A minimalist composition featuring a single [subject] positioned in the [location] of the frame. The background is a vast, empty [color] canvas, creating significant negative space. Soft, subtle lighting."

### For Sequential Art (Comic Panel / Storyboard):
Use: "Make a [panel count] panel comic in a [style]. Put the character in a [scene type], keep character design consistent across all panels, and show clear visual progression from panel to panel."
- If dialogue or captions are needed, quote exact text
- Describe each panel's key action and camera framing

## WHEN REFERENCE IMAGES ARE PROVIDED:
${localEdit ? '- For editing: "Using the provided image of [subject], please [add/remove/modify] [element]. Ensure the change [integration description]."\n- For local edits: "Using the provided image, change only the [specific element] to [new element]. Keep everything else exactly the same, preserving the original style, lighting, and composition."' : '- No Edit area was selected. Describe a new complete image using the attached references for their assigned roles; do not convert the brief into a local edit.'}
- For style transfer: Render the referenced subject in the requested artistic style. Preserve composition only when explicitly requested.
- For combining images: "Create a new image by combining elements from the provided images. Take the [element from image 1] and place it with [element from image 2]. The final image should be [description]."
- For character consistency: "A [shot type] of the person from the provided image wearing [NEW clothing appropriate for scene], against [background], [pose/angle]. Preserve their exact facial features, hair, skin tone, and any tattoos while placing them in the new context."
- For requested identity or product fidelity: Describe the critical face or logo details relevant to the result.

## BEST PRACTICES:
1. Use semantic positive descriptions (describe what you want, not what to avoid)
2. For complex scenes, use step-by-step: "First, create [background]. Then, in the foreground, add [element]. Finally, place [focal point]."
3. Always include mood/atmosphere descriptors
4. Control composition with cinematic language (rule of thirds, leading lines, depth of field)
5. Provide context and intent (what this image is for, and what feeling it should evoke)
6. If the user implies a negative constraint, translate it into a positive target outcome when possible
    
Return ONLY the enhanced prompt—no explanations, no markdown formatting.`;

  parts.push({ 
    text: `${systemInstruction}\n\nUser Draft: ${prepareTextStagePrompt(prompt, referenceImages) || "Generate a detailed creative work based on the attached reference(s)."}${buildTextStageRoleCheck(prompt, referenceImages) ? `\n\n${buildTextStageRoleCheck(prompt, referenceImages)}` : ''}\n\n${buildYouTubeWardrobeRule(prompt, referenceImages, settings)}\n\n${buildYouTubeEditorialRule(prompt, referenceImages, settings)}\n\n${buildYouTubeCameraGazeRule(prompt, referenceImages, settings)}${conceptWardrobe ? `\n\n${conceptWardrobe}` : ''}`
  });

  try {
    const response = await generateTextContent(ai, parts, 'enhance', prompt, options);
    await finishTextUsage(logUsage('enhance', response.model, prompt || '[enhance-empty-prompt]', 0, {
      usageMetadata: response.usageMetadata as any,
      referenceImageCount: referenceImages.length,
    }));
    const result = prepareImagePromptResult(response.text || prompt, referenceImages);
    if (localEdit) return preserveSunburstEditBrief(result, prompt, referenceImages, settings);
    const prepared = isYouTubeThumbnailPrompt(prompt, referenceImages, settings) ? completeConceptWardrobe(result, prompt, referenceImages)
      : preserveConceptWardrobe(result, prompt);
    return preserveYouTubeCameraGaze(prepared, prompt);
  } catch (error) {
    console.error("Enhance prompt error:", error);
    throw error;
  }
};

export const enhanceVideoPrompt = async (
  prompt: string,
  referenceImages: ReferenceImage[] = [],
  duration: number = 10,
  videoModel: VideoModelId = DEFAULT_VIDEO_MODEL,
  videoOperation: VideoOperation = 'generate',
  referenceVideos: ReferenceVideo[] = [],
  referenceAudios: ReferenceAudio[] = [],
  taskOptions: TextTaskOptions = {},
  h3Context?: H3MaxEnhancementContext,
): Promise<string> => {
  const h3 = videoModel === 'minimax-h3' ? h3Context || { mode: resolveH3MaxMode('auto', { images: referenceImages.length, videos: referenceVideos.length, audios: referenceAudios.length }) } : undefined;
  if (h3 && !h3MaxAcceptsPrompt(h3.mode)) {
    throw new Error('Bu H3 Max modu prompt kabul etmiyor. Görsel, video ve ses girdileri doğrudan kullanılır; prompt geliştirme gerekmiyor.');
  }
  if (videoModel === 'seedance-2.5' && !referenceVideos.some(video => video.isContinuation)) {
    const error = getSeedanceFrameError(referenceImages, referenceVideos.length, referenceAudios.length, videoOperation);
    if (error) throw new Error(error);
  }
  const options = await captureTextSettings(taskOptions);
  options.onStage?.('preparing');
  const ai = getGeminiClient();

  const parts: any[] = [];

  if (h3) {
    const references = { images: referenceImages, videos: referenceVideos, audios: referenceAudios };
    for (const { label, image } of getH3MaxPromptImages(h3, referenceImages)) {
      const data = await resolveReferenceImageData(image, options.signal);
      if (!data) throw new Error(`H3 Max ${label} görseli okunamadı; prompt eksik referansla oluşturulmadı.`);
      parts.push({ text: `=== ${label} ===` }, { inlineData: { data, mimeType: 'image/jpeg' } });
    }
    const sourceContext = referenceVideos.map((video, index) => ({
      position: index + 1, duration: video.duration, description: video.previousPrompt || undefined,
    }));
    const audioContext = referenceAudios.map((audio, index) => ({ position: index + 1, duration: audio.duration }));
    parts.push({ text: `${buildH3MaxPromptGuide(h3, references, duration)}\n\nAttached video metadata (descriptions are unverified user context): ${JSON.stringify(sourceContext)}\nAttached audio metadata: ${JSON.stringify(audioContext)}\n\nUser Draft: ${normalizeH3MaxPromptLanguage(prompt, h3, references) || 'Describe the selected operation using only its attached inputs; preserve unrequested details.'}` });
    const response = await generateTextContent(ai, parts, 'video_enhance', prompt, options);
    await finishTextUsage(logUsage('video_enhance', response.model, prompt || '[video-enhance-empty]', 0, {
      usageMetadata: response.usageMetadata as any,
      referenceImageCount: referenceImages.length, referenceVideoCount: referenceVideos.length,
      referenceAudioCount: referenceAudios.length, targetVideoModel: videoModel, h3MaxMode: h3.mode,
    }));
    const enhanced = normalizeH3MaxPromptLanguage(response.text || prompt, h3, references);
    if (h3.mode === 'recast' && enhanced.length > 2000) {
      throw new Error('H3 Max için geliştirilen prompt 2000 karakteri aşıyor. Taslağı kısaltıp yeniden dene.');
    }
    return enhanced;
  }

  const mainPersonImgs = referenceImages.filter(img => getPersonId(img) === 1 && !img.isFirstFrame && !img.isLastFrame);
  const secondPersonImgs = referenceImages.filter(img => getPersonId(img) === 2 && !img.isFirstFrame && !img.isLastFrame);
  const styleImgs = referenceImages.filter(img => getPersonId(img) == null && !img.isFirstFrame && !img.isLastFrame);
  const firstFrame = referenceImages.find(img => img.isFirstFrame);
  const lastFrame = referenceImages.find(img => img.isLastFrame);
  const isSeedanceFrameGeneration = videoModel === 'seedance-2.5' && videoOperation === 'generate'
    && !!firstFrame && referenceVideos.length === 0 && referenceAudios.length === 0
    && referenceImages.every(image => image.isFirstFrame || image.isLastFrame);
  const isSeedance20ReferenceEdit = videoModel === 'seedance-2.0' && videoOperation === 'reference_edit';
  const isSourceEdit = videoOperation === 'edit' || videoOperation === 'reference_edit';
  const continuationReferenceIndex = referenceVideos.findIndex(ref => ref.isContinuation);
  const isContinuation = (videoOperation === 'extend'
    || (videoOperation === 'generate' && continuationReferenceIndex !== -1));
  const isReferenceGeneration = videoOperation === 'generate'
    && referenceVideos.length > 0 && !isContinuation;
  const isSeedance25ReferenceGeneration = videoModel === 'seedance-2.5'
    && isReferenceGeneration;
  // Seedance keeps the editor's canonical @ tokens.
  const videoReferenceTags = referenceVideos.map((_, index) => `@VIDEO_${index + 1}`);
  // Explicit Edit/Extend operate on the first source video. The per-reference
  // Continue role is used only by Generate, which can mark any attached clip.
  const sourceVideoIndex = videoOperation === 'generate' && isContinuation
    && continuationReferenceIndex !== -1 ? continuationReferenceIndex : 0;
  const sourceVideoTag = videoReferenceTags[sourceVideoIndex] || '@VIDEO_1';

  // MAIN_PERSON group
  if (mainPersonImgs.length > 0) {
    parts.push({ text: `=== @MAIN_PERSON (${mainPersonImgs.length} photo(s) of the first/main character) ===` });
    for (const img of mainPersonImgs) {
      const base64Data = await resolveReferenceImageData(img);
      if (!base64Data) throw new Error('Ana kişi referansı okunamadı; kişi eşleşmesini korumak için işlem durduruldu.');
      parts.push({ inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
    }
  }

  // SECOND_PERSON group
  if (secondPersonImgs.length > 0) {
    parts.push({ text: `=== @SECOND_PERSON (${secondPersonImgs.length} photo(s) of the second character) ===` });
    for (const img of secondPersonImgs) {
      const base64Data = await resolveReferenceImageData(img);
      if (!base64Data) throw new Error('İkinci kişi referansı okunamadı; kişi eşleşmesini korumak için işlem durduruldu.');
      parts.push({ inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
    }
  }

  const additionalPeople = getPersonGroups(referenceImages).filter(group => group.id > 2);
  for (const group of additionalPeople) {
    parts.push({ text: `=== ${group.tag} (${group.images.length} photos of the SAME SINGLE person; label ${JSON.stringify(group.label)}) ===` });
    for (const img of group.images) {
      const base64Data = await resolveReferenceImageData(img);
      if (!base64Data) throw new Error('Kişi referansı okunamadı.');
      parts.push({ inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
    }
  }

  // Remaining style/object references numbered using their original index in the full list
  // so @REF_IMAGE_N indices match what the user sees in the reference strip.
  for (let i = 0; i < referenceImages.length; i++) {
    const img = referenceImages[i];
    if (img.isFirstFrame || img.isLastFrame || getPersonId(img) != null) continue;
    parts.push({ text: `=== @REF_IMAGE_${i + 1} ===` });
    const base64Data = await resolveReferenceImageData(img);
    if (!base64Data) throw new Error(`Referans görsel ${i + 1} okunamadı; video promptu eksik kimlikle oluşturulmadı.`);
    parts.push({ inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
  }

  if (firstFrame) {
    parts.push({ text: "=== FIRST FRAME (video starts with this image) ===" });
    const base64Data = await resolveReferenceImageData(firstFrame);
    if (!base64Data) throw new Error('İlk kare referansı okunamadı; video promptu eksik kareyle oluşturulmadı.');
    parts.push({ inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
  }

  if (lastFrame) {
    parts.push({ text: "=== LAST FRAME (video ends with this image) ===" });
    const base64Data = await resolveReferenceImageData(lastFrame);
    if (!base64Data) throw new Error('Son kare referansı okunamadı; video promptu eksik kareyle oluşturulmadı.');
    parts.push({ inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
  }

  let imageContext = additionalPeople.map(group => `\n${group.tag}: ${group.images.length} photos of the SAME person, separate from every other group. Use ${group.tag} verbatim whenever this person is requested. Never expand this tag to individual photos or treat these photos as different people.`).join('');
  if (mainPersonImgs.length > 0) {
    imageContext += `\n\n## @MAIN_PERSON GROUP:\n${mainPersonImgs.length} photo(s) of the first/main character are attached above under the @MAIN_PERSON header. ALWAYS refer to this character in the enhanced prompt using the exact token @MAIN_PERSON. NEVER expand it into individual @REF_IMAGE_N tags, and never wrap it in parentheses or lists.`;
  }
  if (secondPersonImgs.length > 0) {
    imageContext += `\n\n## @SECOND_PERSON GROUP:\n${secondPersonImgs.length} photo(s) of the second character are attached above under the @SECOND_PERSON header. ALWAYS refer to this character in the enhanced prompt using the exact token @SECOND_PERSON. NEVER expand it into individual @REF_IMAGE_N tags.`;
  }
  if (styleImgs.length > 0) {
    const styleIndices = referenceImages
      .map((img, i) => (getPersonId(img) == null && !img.isFirstFrame && !img.isLastFrame) ? i + 1 : null)
      .filter((n): n is number => n !== null);
    imageContext += `\n\n## REFERENCE IMAGES:\n${styleImgs.length} style/object reference image(s) are attached, tagged as ${styleIndices.map(n => `@REF_IMAGE_${n}`).join(', ')}. Keep these tags verbatim in your output. Use them for objects, environments, or style references — not for the main or second character.`;
  }
  if (firstFrame) {
    imageContext += `\n\nA FIRST FRAME image is provided. The video will start from this exact image. Describe the opening scene to match it.`;
  }
  if (lastFrame) {
    imageContext += `\n\nA LAST FRAME image is provided. The video will end at this exact image. Structure the action timeline to arrive at this final frame.`;
  }
  if (referenceVideos.length > 0) {
    imageContext += `\n\n## REFERENCE VIDEOS:\n${referenceVideos.length} video reference(s) are attached, tagged as ${videoReferenceTags.join(', ')}. Keep these tags verbatim and assign an explicit job to each reference.`;
    imageContext += isReferenceGeneration
      ? ` This is pure reference generation of a separate new shot. Assign each reference a positive role such as subject identity, setting, visual style, motion, camera language, timing, or lighting. Describe the desired result as a new scene, not as an alteration or continuation of source footage.${isSeedance25ReferenceGeneration ? ' Never use these provider task-trigger words in the output: edit, extend, continue, add, insert, remove, delete, change, modify, replace, or sequel.' : ''}`
      : isContinuation
        ? ` ${sourceVideoTag} is the continuation source selected by the user. Begin the new footage at its final visible state; preserve its people, setting, lighting, camera, movement direction, and sound continuity unless the user explicitly requests a transition. Other attached videos are supplemental references, not alternate starting points.`
        : ` ${sourceVideoTag} is the primary source footage to edit. Cite it when describing the requested changes and the source details that must remain unchanged. Other attached videos are supplemental references, not replacement source footage.${isSeedance20ReferenceEdit ? ` Cite ${sourceVideoTag} explicitly for style, identity, environment, camera, and motion.` : ''}`;
  }
  if (referenceAudios.length > 0) {
    imageContext += `\n\n## REFERENCE AUDIO:\n${referenceAudios.length} audio reference(s) are attached, tagged as ${referenceAudios.map((_, index) => `@AUDIO_${index + 1}`).join(', ')}. Keep these tags verbatim and state whether each controls voice, rhythm, ambience, effects, or music.`;
  }

  const operationInstruction = videoOperation === 'reference_edit'
    ? 'This is a Seedance 2.0 Ref Edit: use reference-to-video as a source-anchored edit, not as a generic inspiration clip or a next shot. Use the exact editor token @VIDEO_1 throughout. Describe only the requested changes and preserve the people, identity, hair, clothing, setting, lighting, camera language, and existing action from @VIDEO_1 unless the user explicitly changes them. The runtime will convert @VIDEO_1 to the provider syntax. The requested output ratio and duration may differ from the source; this does not imply a story continuation.'
    : videoOperation === 'edit'
    ? 'This prompt will edit @VIDEO_1. Use that exact editor token, describe only the requested changes, and explicitly preserve everything else that should remain unchanged. Do not describe a next shot or additional footage after the source ends. The output length and aspect ratio follow the source video. The runtime converts @VIDEO_1 to the provider syntax.'
    : isContinuation
      ? `This prompt will continue ${sourceVideoTag} with seamless new footage. Use that exact editor token and describe only what happens NEXT, beginning from the final visible state of ${sourceVideoTag}. Maintain the source action, camera, lighting, identities, and sound continuity. Do not replay or edit earlier footage, and do not treat the source as generic inspiration. The runtime converts the editor token to the provider syntax.`
      : isReferenceGeneration
        ? `This prompt will generate a separate new video from reference material. Describe only what the new shot positively contains and how the references guide it. Avoid all editing or extension intent.${isSeedance25ReferenceGeneration ? ' Such intent can lock Seedance to the source ratio.' : ''}`
        : 'This prompt will generate a new video.';
  const durationLabel = duration === -1 ? 'automatically selected' : `${duration}-second`;
  const actionPlanInstruction = videoOperation === 'edit'
    ? 'Describe the requested edits and the source details that must be preserved. Use timestamp ranges only when the user supplied them; do not invent a source-video length.'
    : videoOperation === 'reference_edit'
      ? `Describe the requested changes within the ${durationLabel} source-anchored result. Distinguish preserved details from @VIDEO_1 from the requested changes. Preserve the existing action and camera unless the user requests otherwise; do not invent a continuation after the source ends. Use timestamps only when supplied by the user.`
      : isContinuation
        ? `Plan only the new ${durationLabel} footage, starting at 00:00 from the final visible state of ${sourceVideoTag}. Describe seamless motion and only what happens next; never recap the source footage. For each action beat:`
        : `Break the ${durationLabel} new video into timed shots. For each shot:`;
  const timingPractice = videoOperation === 'edit'
    ? 'Preserve the source video timing and avoid changing unrequested sections'
    : videoOperation === 'reference_edit'
      ? 'Use @VIDEO_1 as the visual source of truth; preserve existing action and unrequested details while reframing only as required by the selected output ratio'
      : isContinuation
        ? `Use ${sourceVideoTag} as the terminal-state source of truth; fit only the next action beats into the ${durationLabel} duration`
        : `Time the action beats to fit the ${durationLabel} duration`;

  const seedanceFrameInstruction = `You are a video director writing Seedance 2.5 image-to-video directions. The attached images are endpoint constraints, not generic style references. The FIRST FRAME is the exact opening composition.${lastFrame ? ' The LAST FRAME is the exact ending composition.' : ' There is no last frame; do not invent an attached ending image.'} Interpret the visible images and describe only the requested movement${lastFrame ? ' that connects these two compositions' : ' beginning from the first image'} within the ${durationLabel} clip.

## FRAME TRANSITION RULES
- Preserve the user's requested camera path, action and transformation. Work out a coherent opening, middle and arrival; do not replace the brief with a different transition.
- Default to one continuous shot. Do not invent cuts, shot changes, dissolves, zooms, drone flights, morphs or extra actions. Use them only when explicitly requested in the draft.
- For a requested camera transition, describe camera travel, direction, speed, occlusion and the final deceleration. Move through the space rather than blending two still pictures or teleporting between them. For an explicitly requested morph, preserve that transformation and describe its progression.
- Keep people, props and architecture coherent while they remain visible. Preserve the input framing, visible text, clothing and lighting unless the requested transition changes them. Do not invent unseen geographic details or claim a route that the frames cannot establish.
- ${lastFrame ? 'Finish in the last-frame composition by the end of the clip. Leave time to arrive and settle rather than snapping to the ending after unrelated action.' : 'Keep the motion grounded in the opening image; do not claim a supplied last frame.'}
- With a fixed duration, keep all timing within ${duration} seconds. With automatic duration, use relative phases without invented timestamps or a made-up length.
- No decorative style boosters, contradictory camera directives, extra music or dialogue. State only sounds caused by the requested action; obey a request for silence.
- Use natural language: "the first frame"${lastFrame ? ' and "the last frame"' : ''}. Never output @ tags or reference-image numbers. The runtime sends the images in start/end order. Editor indices in the draft refer to ${referenceImages.map((image, index) => `@REF_IMAGE_${index + 1} = ${image.isFirstFrame ? 'FIRST' : 'LAST'} FRAME`).join('; ')}.

## OUTPUT
Keep the prompt concise, normally 120-250 words. Use [FRAME GUIDANCE], [MOTION AND TRANSITION], [TIMING] with at most three chronological action phases, and [AUDIO] only when useful. Do not describe the phases as separate shots. Return only the prompt, without explanations or markdown code fences.`;

  const systemInstruction = isSeedanceFrameGeneration
      ? seedanceFrameInstruction
    : `You are an expert video prompt engineer for ${videoModel === 'seedance-2.0' ? 'Seedance 2.0' : 'Seedance 2.5'} (via EvoLink API). ${operationInstruction} Your task is to transform the user's simple video concept into a detailed, cinematic video prompt.${imageContext}

## CRITICAL RULE: PRESERVE GROUP AND REF TAGS
Keep every @MAIN_PERSON, @SECOND_PERSON, @PERSON_N, @REF_IMAGE_N, @VIDEO_1, @VIDEO_N, and @AUDIO_N token from the user's draft verbatim in your output.
- NEVER expand @MAIN_PERSON or @SECOND_PERSON into lists like "(@REF_IMAGE_1, @REF_IMAGE_2, @REF_IMAGE_3)".
- NEVER convert a group tag into a description of multiple individual references.
- NEVER mix @MAIN_PERSON / @SECOND_PERSON with @REF_IMAGE_N for the same character.
- Use @PERSON_N for additional attached identity groups. Use @REF_IMAGE_N ONLY for the remaining style/object reference images listed above.
- If the user's draft does NOT mention a group tag but a group is attached, still use the exact token @MAIN_PERSON or @SECOND_PERSON for that character throughout the enhanced prompt.
- Use every attached video tag listed under REFERENCE VIDEOS at least once even when the user's draft omitted it.${isSourceEdit || isContinuation ? ` Explicitly use ${sourceVideoTag} as the ${isContinuation ? 'continuation source' : 'footage being edited'}; never assign this source role to a different reference.` : ''}
${isSeedance20ReferenceEdit ? `- This is Ref Edit. The enhanced prompt MUST use the exact editor token @VIDEO_1 in [STYLE], [CHARACTER / SUBJECT], [ACTION TIMELINE], and [STYLE BOOSTERS], even if the user draft omitted it. ${mainPersonImgs.length > 0 ? 'Bind @MAIN_PERSON to the corresponding visible person in @VIDEO_1.' : 'Describe the visible people through @VIDEO_1; do not invent an unattached character group tag or a generic replacement subject.'}` : ''}

## CURRENT ACTION IS AUTHORITATIVE
The selected action above determines the output intent. Treat any old enhanced-prompt wording or [PREVIOUS SHOT CONTEXT: ...] in the draft as background context, not permission to switch actions. Rewrite conflicting draft language to match the selected action while preserving the user's requested subject and changes.
${isContinuation ? `
## CONTINUATION SHOTS
${sourceVideoTag} is the selected previous shot. Any [PREVIOUS SHOT CONTEXT: ...] describes that source, not a new scene to repeat. Your enhanced prompt MUST:
- Maintain the SAME style, characters, environment, and mood from ${sourceVideoTag}
- Start the action exactly where ${sourceVideoTag} ended, with matching positions, motion direction, camera, lighting, and sound
- Keep all @REF_IMAGE_N tags for character consistency
- Do NOT repeat the previous shot's content -- only describe what happens NEXT
` : ''}

## PROMPT STRUCTURE
Use these sections in your enhanced prompt:

[STYLE]
${isSourceEdit || isContinuation ? `Preserve the visible visual style and rendering approach of ${sourceVideoTag} unless explicitly changed by the user. Do not invent a new aesthetic.` : 'Animation/visual style, aesthetic, rendering approach (e.g., "Cinematic live-action style, photorealistic lighting, 24fps film grain" or "Rick and Morty cartoon style, vibrant cel shading, 2D animation")'}

[SCENE]
${isSourceEdit || isContinuation ? `Preserve the environment, atmosphere, lighting, and time of day from ${sourceVideoTag} unless the user explicitly requests a change.` : 'Environment and setting description with atmosphere, lighting, time of day.'}

[CHARACTER / SUBJECT]
Who or what is in the scene. Use @MAIN_PERSON, @SECOND_PERSON and @PERSON_N for attached person groups. Use @REF_IMAGE_N only for remaining style/object references. Describe roles and positions.${isSeedance20ReferenceEdit ? ' Bind every preserved person and source detail explicitly to @VIDEO_1.' : ''}

[CAMERA SYSTEM]
${isSourceEdit || isContinuation ? `Preserve the camera language and movement from ${sourceVideoTag} unless the user requests a change. Do not invent cuts, lenses, or new camera moves.` : 'Camera movement style, aspect ratio, shot types (e.g., "Dynamic handheld tracking shots with occasional push-ins, slight camera shake during impacts")'}

[ACTION TIMELINE]
${actionPlanInstruction}
${isSourceEdit ? '- Requested change, the source element it applies to, and the details that remain unchanged' : '- Time range (e.g., [00:00-00:05])\n- Shot name'}
- Visuals: What is seen, referencing @MAIN_PERSON / @SECOND_PERSON / @REF_IMAGE_N as applicable
- Action: What happens, movements, interactions
- Camera: Camera movement for this shot
- Key details: Important visual elements, effects, particles

[SOUND DESIGN]
${isSourceEdit || isContinuation ? `Preserve the sound character and ambience of ${sourceVideoTag}. Describe only requested audio changes and sounds naturally caused by the requested action; do not invent music or dialogue.` : 'Music style, sound effects, ambient audio, and how they sync with the action.'}

[STYLE BOOSTERS]
Bullet list of quality/consistency directives:
- consistent character identity for referenced images
- smooth motion with no distortion or flicker
- ${isSourceEdit || isContinuation ? `lighting, texture, and visual style matched to ${sourceVideoTag}` : 'cinematic lighting with dramatic shadows'}
- ${isSourceEdit || isContinuation ? 'preserve existing source details, including on-screen text, unless the user requests a change' : 'clean frame, no on-screen text (unless requested)'}

## BEST PRACTICES:
1. Be HYPER-SPECIFIC about motion, camera movement, and timing
2. Keep character references consistent using @REF_IMAGE tags throughout
3. ${timingPractice}
4. ${isSourceEdit ? 'Preserve the source sequence and cuts unless the user requests a change' : isContinuation ? 'Keep the first new frame and subsequent action continuous with the source ending; do not invent a cut' : 'Describe transitions between shots'}
5. ${isSourceEdit || isContinuation ? 'Keep source lighting unless the user requested a lighting change' : 'Include specific lighting cues that follow the action'}
6. Sound design should sync with visual beats

Return ONLY the enhanced prompt with the sections above. No explanations, no markdown code blocks.`;

  const fallbackDraft = isSourceEdit
      ? `Preserve ${sourceVideoTag}; describe only changes explicitly requested by the user.`
      : isContinuation
        ? `Describe the next footage beginning exactly where ${sourceVideoTag} ends.`
        : 'Generate a detailed cinematic video based on the attached reference(s).';
  parts.push({ text: `${systemInstruction}\n\nUser Draft: ${prompt || fallbackDraft}` });

  try {
    const response = await generateTextContent(ai, parts, 'video_enhance', prompt, options);
    await finishTextUsage(logUsage('video_enhance', response.model, prompt || '[video-enhance-empty]', 0, {
      usageMetadata: response.usageMetadata as any,
      referenceImageCount: referenceImages.length,
      referenceVideoCount: referenceVideos.length,
      referenceAudioCount: referenceAudios.length,
      targetVideoModel: videoModel,
    }));
    let enhancedPrompt = response.text || prompt;
    if (isSeedanceFrameGeneration) return normalizeSeedanceFrameTags(enhancedPrompt, referenceImages);
    if (videoReferenceTags.length > 0) {
      // Keep the editor-facing syntax deterministic even if the text model
      // echoes a provider alias or forgets an attached reference. The request
      // layer converts these canonical tokens for Seedance later.
      enhancedPrompt = enhancedPrompt
        .replace(/\\_/g, '_')
        .replace(/@video[_ ]?(\d+)/gi, (_match, index) => `@VIDEO_${Number(index)}`)
        .replace(/@video\b(?![_ ]?\d)/gi, sourceVideoTag);

      const emittedVideoTags = new Set(enhancedPrompt.match(/@VIDEO_\d+\b/g) || []);
      const missingReferences = videoReferenceTags
        .map((tag, index) => ({ tag, index }))
        .filter(({ tag }) => !emittedVideoTags.has(tag));
      if (missingReferences.length > 0) {
        const referenceRoles = missingReferences.map(({ tag, index }) => {
          if (isReferenceGeneration) {
            return `${tag} guides the new shot only in its assigned reference role (identity, setting, style, motion, camera, timing, or lighting).`;
          }
          if (index !== sourceVideoIndex) {
            return `${tag} is a supplemental reference; use only its assigned role, without replacing the source footage.`;
          }
          return isContinuation
            ? `${tag} is the continuation source; begin the next footage at its final visible state with matching people, setting, lighting, camera, movement, and sound. Do not repeat the source action.`
            : `${tag} is the primary source footage; apply only the requested edits and preserve its visible people, setting, lighting, camera, motion, and unrequested details.`;
        });
        enhancedPrompt = `[REFERENCE VIDEO]\n${referenceRoles.join('\n')}\n\n${enhancedPrompt}`;
      }
    }
    return enhancedPrompt;
  } catch (error) {
    console.error("Video enhance prompt error:", error);
    throw error;
  }
};

// Generate a variation of an existing prompt while maintaining the core theme
export const generatePromptVariation = async (
  originalPrompt: string,
  referenceImages: ReferenceImage[] = [],
  settings?: ImagePromptSettings,
  taskOptions: TextTaskOptions = {},
): Promise<string> => {
  const options = await captureTextSettings(taskOptions);
  options.onStage?.('preparing');
  if (settings?.imageModel === SUNBURST_MODEL) {
    return runImagePromptTask('variation', originalPrompt, referenceImages, settings, undefined, undefined, undefined, options);
  }
  const ai = getGeminiClient();

  const parts: any[] = [];
  const localEdit = getSunburstEditIntent(originalPrompt, referenceImages, settings);
  if (localEdit) originalPrompt = stripYouTubeCameraGaze(originalPrompt);
  const wardrobe = buildYouTubeWardrobeRule(originalPrompt, referenceImages, settings);

  // All input roles matter, including an episode cover without any cast photos.
  if (referenceImages.length > 0) {
    for (const [index, img] of referenceImages.entries()) {
      const base64Data = await resolveReferenceImageData(img);
      if (!base64Data) throw new Error(`Referans ${index + 1} okunamadı; kişi eşleşmesini korumak için işlem durduruldu.`);
      parts.push({ text: describeSunburstReference(img, index) }, { inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
    }
  }

  const systemInstruction = `You are an expert prompt engineer creating VARIATIONS of image generation prompts.
${!localEdit ? buildReferenceGenerationRule(referenceImages) : ''}

## YOUR TASK
Given the original prompt below, create ONE creative variation that:
1. MAINTAINS the core concept, theme, subject, and overall intent
2. CHANGES some specific details to create visual variety

## WHAT TO CHANGE (pick 2-3):
- Camera angle or shot type (close-up → wide shot, low angle → eye level)
- Lighting conditions (golden hour → blue hour, studio → natural)
- Background or environment details
- Pose, expression, or gesture of subjects
- Color palette or mood
- Specific props or accessories
- Time of day or weather conditions
- Art style nuances (if stylized)

## WHAT TO PRESERVE:
- The main subject(s) and their identity/appearance
- The core concept and theme
- The overall quality and detail level
- Any text content that should appear
- Person references: preserve each person's stable @ label and supplied name

## RULES:
- The variation should feel like a "sibling" of the original — recognizably related but distinctly different
- Keep the same level of detail and specificity
- Keep each requested person's actions and placement bound to that person's own reference group
- Use the stable reference labels provided below for people and other inputs
- Don't make it a completely different scene — subtle to moderate changes only

## FORMAT:
Return ONLY the varied prompt. No explanations, no markdown, no quotes around it.`;

  parts.push({ 
    text: `${systemInstruction}\n\n${buildPersonIdentityContract(referenceImages)}\n${buildEditableReferenceGuidance(referenceImages)}\n\n=== ORIGINAL PROMPT ===\n${prepareTextStagePrompt(originalPrompt, referenceImages)}\n\n${buildTextStageRoleCheck(originalPrompt, referenceImages)}\n\n${wardrobe}\n\n${buildYouTubeEditorialRule(originalPrompt, referenceImages, settings)}\n\n${buildYouTubeCameraGazeRule(originalPrompt, referenceImages, settings)}\n\n${buildConceptWardrobeGuidance(originalPrompt)}`
  });

  try {
    const response = await generateTextContent(ai, parts, 'variation', originalPrompt, options);
    await finishTextUsage(logUsage('variation', response.model, originalPrompt, 0, {
      usageMetadata: response.usageMetadata as any,
      referenceImageCount: referenceImages.length,
    }));
    const prepared = preserveConceptWardrobe(prepareImagePromptResult(response.text?.trim() || originalPrompt, referenceImages), originalPrompt);
    return localEdit
      ? stripYouTubeCameraGaze(prepared) : preserveYouTubeCameraGaze(prepared, originalPrompt);
  } catch (error) {
    console.error("Generate variation error:", error);
    throw error;
  }
};

const generateSingleImageContent = async (
  prompt: string,
  config: GenerationConfig,
  client: GeminiClient,
  imageModel: ImageModelId
): Promise<{ url: string | null; usageMetadata?: any; error?: string }> => {
  try {
    const parts: any[] = [];

    const refs = config.referenceImages || [];
    parts.push({ text: [normalizeReferencePrompt(prompt, refs), buildPersonIdentityContract(refs), buildYouTubeEditorialRule(prompt, refs, config), buildYouTubeWardrobeRule(prompt, refs, config), buildPersonSeparationRule(refs)].filter(Boolean).join('\n\n') });
    for (const [index, img] of refs.entries()) {
      const base64Data = await resolveReferenceImageData(img);
      if (!base64Data) throw new Error(`Referans ${index + 1} okunamadı.`);
      parts.push({ text: describeSunburstReference(img, index) }, { inlineData: { data: base64Data, mimeType: img.mimeType || 'image/jpeg' } });
    }

    let response;
    try {
      response = await client.models.generateContent({
        model: imageModel,
        contents: { role: 'user', parts },
        config: buildImageGenerationConfig(config, true),
      });
    } catch (error) {
      if (!supportsThinkingError(error)) {
        throw error;
      }
      response = await client.models.generateContent({
        model: imageModel,
        contents: { role: 'user', parts },
        config: buildImageGenerationConfig(config, false),
      });
    }

    const usageMetadata = (response as any).usageMetadata;

    if (!response.candidates || response.candidates.length === 0) {
      return { url: null, usageMetadata, error: "No candidates returned from API. The request may have been blocked." };
    }

    const candidate = response.candidates[0];

    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      console.warn("Generation finish reason:", candidate.finishReason);
      if (candidate.finishReason === 'SAFETY') {
        return { url: null, usageMetadata, error: "Generation blocked by safety filters. Please try modifying your prompt." };
      }
    }

    const content = candidate.content;
    if (content && content.parts) {
        for (const part of content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return {
              url: `data:image/png;base64,${part.inlineData.data}`,
              usageMetadata,
            };
          }
        }
        
        const textPart = content.parts.find((p: any) => p.text);
        if (textPart && textPart.text) {
            return { url: null, usageMetadata, error: `Model Refusal: ${textPart.text}` };
        }
    }

    if (candidate.finishReason) {
       return { url: null, usageMetadata, error: `Generation failed with reason: ${candidate.finishReason}` };
    }

    return { url: null, usageMetadata };
  } catch (error) {
    console.error("Error generating image:", error);
    throw error;
  }
};

export const generateMedia = async (
  config: GenerationConfig,
  onProgress?: (progress: number) => void,
  onTaskCreated?: (requestId: string, endpoint: string) => void | Promise<void>,
  context?: ImageGenerationContext,
): Promise<GeneratedMedia> => {
  // Upgrade retired image selections for new work; keep historical rows intact.
  const activeImageModel = getActiveImageModel(config.imageModel);
  if (activeImageModel !== config.imageModel) config = { ...config, imageModel: activeImageModel };
  const selectedImageModel = isSupportedImageModel(config.imageModel) ? config.imageModel : IMAGE_MODEL_NAME;

  const requestPrompt = config.prompt.trim() || (selectedImageModel !== SUNBURST_MODEL && config.referenceImages?.length
    ? 'Create a new image using the attached references.' : config.prompt);
  return generateOpenAIImage({ ...config, imageModel: selectedImageModel }, normalizeSunburstPrompt(requestPrompt, config.referenceImages || []), context, onProgress);
};

// Category-specific brainstorm prompts - optimized for Nano Banana image models
const BRAINSTORM_PROMPTS: Record<Exclude<BrainstormCategory, 'simple'>, string> = {
  youtube_thumbnail: `You are an expert YouTube thumbnail designer who creates viral, click-worthy thumbnails.

Analyze the provided reference thumbnails. Study their:
- Composition patterns (rule of thirds, focal points, visual hierarchy)
- Color psychology (high contrast, complementary colors, saturation levels)
- Typography placement and style (bold text, positioning, readability)
- Facial expressions and body language (exaggerated emotions, eye contact, gestures)
- Background treatment (blur, gradients, depth separation)
- Curiosity hooks and emotional triggers

Generate 5 UNIQUE thumbnail ideas as COMPLETE, NARRATIVE PROMPTS ready for Nano Banana Pro or Nano Banana 2.1.

Each idea must follow this structure:
"A photorealistic [shot type] YouTube thumbnail of [subject with specific description], [their expression/action], set against [background]. The scene is illuminated by [lighting], creating a [mood] atmosphere. [If text needed: The text "[EXACT TEXT]" appears in [position] using [font style description].] The composition uses [technique] to draw the eye to [focal point]. Captured with a [lens type] emphasizing [details]. 16:9 aspect ratio."

Be HYPER-SPECIFIC:
- Instead of "surprised face" → "eyes wide open, mouth forming an 'O' shape, eyebrows raised high, head tilted slightly back"
- Instead of "colorful background" → "electric blue gradient fading to deep purple with subtle particle effects"
- Instead of "bold text" → "chunky 3D block letters with yellow fill and black outline, slight drop shadow"`,

  product_shot: `You are a professional e-commerce product photographer creating commercial-grade imagery.

Analyze the provided reference product shots. Study their:
- Lighting setups (softbox arrangements, rim lighting, reflectors)
- Surface and background choices (seamless paper, marble, lifestyle settings)
- Camera angles (hero shot, 45-degree, flat lay, detail macro)
- Shadow quality (soft diffused, dramatic hard, floating effect)
- Color grading and mood (clean and bright, warm and luxurious, cool and minimal)
- Negative space usage and composition balance

Generate 5 UNIQUE product shot ideas as COMPLETE, NARRATIVE PROMPTS ready for Nano Banana Pro or Nano Banana 2.1.

Each idea must follow this structure:
"A high-resolution, studio-lit product photograph of a [specific product description with materials, colors, details] positioned [placement] on a [surface/background description]. The lighting is a [specific setup, e.g., three-point softbox setup with rim light] to [purpose: highlight texture/create depth/emphasize form]. The camera angle is a [specific angle] to showcase [specific feature]. Ultra-realistic with sharp focus on [key detail]. [Props if any]. The mood is [atmosphere description]."

Be HYPER-SPECIFIC:
- Instead of "white background" → "pristine white seamless paper with subtle gradient shadow beneath the product"
- Instead of "good lighting" → "key light from upper left at 45 degrees, fill card on right reducing shadows to 2:1 ratio, hair light creating subtle rim separation"`,

  portrait: `You are an expert portrait photographer with mastery of lighting, posing, and emotional storytelling.

Analyze the provided reference portraits. Study their:
- Lighting patterns (Rembrandt, butterfly, split, broad, short)
- Pose dynamics (body angle, hand placement, head tilt, weight distribution)
- Expression nuances (micro-expressions, eye engagement, authentic emotion)
- Background relationship (environmental, studio, bokeh depth)
- Color palette and grading (skin tones, mood colors, contrast levels)
- Framing and cropping (headshot, three-quarter, environmental)

Generate 5 UNIQUE portrait concepts as COMPLETE, NARRATIVE PROMPTS ready for Nano Banana Pro or Nano Banana 2.1.

Each idea must follow this structure:
"A photorealistic [shot type: close-up/three-quarter/full-body] portrait of [subject description], [their expression in detail], [pose description with body language]. Set in/against [environment/background]. The scene is illuminated by [specific lighting: e.g., soft Rembrandt lighting from a large octabox at camera left, with a subtle fill from a silver reflector]. Creating a [mood] atmosphere that conveys [emotion/story]. Captured with an [lens: e.g., 85mm f/1.4] creating [depth of field effect]. Sharp focus on [focal point, usually eyes]. [Color/tone description]."

Be HYPER-SPECIFIC:
- Instead of "happy expression" → "genuine smile reaching the eyes, slight crow's feet, relaxed brow, head tilted 15 degrees right"
- Instead of "nice lighting" → "golden hour sunlight streaming through a window at camera left, creating warm highlights on the cheekbones and a soft halo effect in the hair"`,

  social_media: `You are a viral social media content creator who understands platform-specific visual optimization.

Analyze the provided reference images. Study their:
- Scroll-stopping hooks (bold visuals, pattern interrupts, curiosity gaps)
- Mobile-first composition (vertical framing, central focus, thumb-zone text)
- Color trends (platform aesthetics, seasonal palettes, brand consistency)
- Text integration (overlay styles, hierarchy, readability on small screens)
- Emotional resonance (relatability, aspiration, humor, controversy)
- Trend alignment (current aesthetics, meme formats, cultural moments)

Generate 5 UNIQUE social media post ideas as COMPLETE, NARRATIVE PROMPTS ready for Nano Banana Pro or Nano Banana 2.1.

Each idea must follow this structure:
"A [style: photorealistic/stylized/graphic] social media image showing [subject/scene in detail], [action/composition]. The scene features [key visual elements]. [If text: The text "[EXACT TEXT]" is displayed in [position] using [font style] that [readability note].] The color palette is [specific colors] creating a [mood] that [emotional purpose]. The composition is optimized for [platform: Instagram/TikTok/etc.] with [framing technique]. [Lighting/style details]. [Aspect ratio]."

Be HYPER-SPECIFIC:
- Instead of "aesthetic photo" → "soft dreamy atmosphere with lifted blacks, muted highlights, and a subtle pink-orange color grade"
- Instead of "catchy text" → "bold Impact-style white text with black stroke positioned in the lower third, reading 'POV: [relatable scenario]'"`,

  custom: `You are a creative director with expertise across photography, illustration, design, and visual storytelling.

Carefully analyze the provided reference images. Extract and study:
- Core visual language (style consistency, aesthetic DNA, signature elements)
- Technical execution (lighting, composition, color, detail level)
- Mood and atmosphere (emotional tone, energy level, narrative feeling)
- Unique differentiators (what makes these images stand out and work)
- Compositional patterns (layout principles, focal points, visual flow)

Generate 5 UNIQUE creative ideas as COMPLETE, NARRATIVE PROMPTS ready for Nano Banana Pro or Nano Banana 2.1.

Each idea must be a DESCRIPTIVE PARAGRAPH (not keywords) following this principle:
"Describe the scene narratively. A [medium/style] [shot type] of [subject with rich detail], [action/state], [environment/context]. [Lighting description creating mood]. [Key visual elements and their relationships]. [Atmosphere and emotional tone]. [Technical details: camera angle, lens effect if photorealistic, or artistic style elements if illustrated]. [Composition technique]. [Color palette and grading]."

CRITICAL GUIDELINES:
- Write in flowing narrative sentences, NOT comma-separated keyword lists
- Be hyper-specific: Instead of "beautiful landscape" → "a sweeping vista of rolling Tuscan hills at golden hour, rows of dark cypress trees creating leading lines toward a distant terracotta villa"
- Include context and intent: Explain what the image is FOR and what feeling it should evoke
- Use step-by-step for complex scenes: "First, establish [background]. Then, in the midground, place [element]. Finally, the foreground features [focal point]."
- Use semantic positive language: Describe what you WANT, not what to avoid`,

};

const withIdeaCount = (prompt: string, ideaCount: number): string => {
  return prompt.replace(/Generate 5 UNIQUE/g, `Generate ${ideaCount} UNIQUE`);
};

const needsBrainstormWardrobe = (brief: string, references: ReferenceImage[], settings: ImagePromptSettings, category: BrainstormCategory, count: number): boolean =>
  count > 0 && getPersonGroups(references).length > 0 && !isYouTubeChannelBannerPrompt(brief)
  && !requestsFixedWardrobeAcrossIdeas(brief)
  && !getSunburstEditIntent(brief, references, settings)
  && (category === 'youtube_thumbnail' || isYouTubeThumbnailPrompt(brief, references, settings));

const parseBrainstormIdeas = (text: string, count: number, wardrobeReferences?: ReferenceImage[], wardrobeBrief = ''): BrainstormIdea[] => {
  const jsonText = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || text;
  const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No valid JSON array found in response');
  const value: unknown = JSON.parse(jsonMatch[0]);
  const ideas: unknown = wardrobeReferences ? parseBrainstormWardrobe(value, wardrobeReferences, count, wardrobeBrief) : value;
  if (!Array.isArray(ideas) || ideas.some(idea => typeof idea !== 'string')) throw new Error('Brainstorm must return an array of prompt strings');
  return ideas.map(idea => idea.trim()).filter(Boolean).slice(0, count).map((text, index) => ({
    id: `idea-${Date.now()}-${index}`, text, isUsed: false,
  }));
};

const finishTextUsage = async (pending: Promise<unknown>) => {
  // Accounting must not hide a finished model response. The original write may
  // finish later; it is never submitted a second time here.
  const task = createTaskDeadline(3_000);
  try { await waitForTask(pending, task.signal); }
  catch { console.warn('Text result ready; usage recording did not finish in time.'); }
  finally { task.dispose(); }
};

export const brainstormIdeas = async (
  referenceImages: ReferenceImage[], category: BrainstormCategory = 'youtube_thumbnail',
  userBrief?: string, customInstructions?: string, ideaCount: number = 5,
  settings?: ImagePromptSettings, options: TextTaskOptions = {},
): Promise<BrainstormIdea[]> => {
  const task = createTaskDeadline(330_000, options.signal, 'Brainstorm zaman sınırını aştı. İstek otomatik olarak tekrarlanmadı.');
  try {
    task.signal.throwIfAborted();
    options.onStage?.('preparing');
    return await waitForTask(brainstormIdeasInternal(referenceImages, category, userBrief, customInstructions, ideaCount, settings,
      await captureTextSettings({ ...options, signal: task.signal })), task.signal);
  } finally { task.dispose(); }
};

const brainstormIdeasInternal = async (
  referenceImages: ReferenceImage[],
  category: BrainstormCategory = 'youtube_thumbnail',
  userBrief?: string,
  customInstructions?: string,
  ideaCount: number = 5,
  settings?: ImagePromptSettings,
  options: TextTaskOptions = {},
): Promise<BrainstormIdea[]> => {
  const ai = getGeminiClient();
  const parsedIdeaCount = Number.isFinite(ideaCount) ? Math.floor(ideaCount) : 5;
  const normalizedIdeaCount = Math.max(1, Math.min(20, parsedIdeaCount));
  const targetSettings: ImagePromptSettings = settings || { imageModel: DEFAULT_IMAGE_MODEL, aspectRatio: '1:1', resolution: '1K' };
  const combinedBrief = [userBrief, customInstructions].filter(Boolean).join('\n\n');
  const wardrobeRequired = needsBrainstormWardrobe(combinedBrief, referenceImages, targetSettings, category, normalizedIdeaCount);
  const cameraGaze = buildYouTubeCameraGazeRule(combinedBrief, referenceImages, targetSettings,
    category === 'youtube_thumbnail' || isYouTubeThumbnailPrompt(combinedBrief, referenceImages, targetSettings));
  if (settings?.imageModel === SUNBURST_MODEL || category === 'simple' || category === 'youtube_thumbnail') {
    const response = await runImagePromptTask('brainstorm', userBrief || '', referenceImages, targetSettings, category, normalizedIdeaCount, customInstructions, options);
    const brief = [userBrief, customInstructions].filter(Boolean).join('\n\n');
    return parseBrainstormIdeas(response, normalizedIdeaCount,
      wardrobeRequired ? referenceImages : undefined, brief)
      .map(idea => {
        const text = getSunburstEditIntent(brief, referenceImages, settings)
        ? preserveSunburstEditBrief(idea.text, brief, referenceImages, settings)
        : settings?.imageModel === SUNBURST_MODEL
        ? assembleSunburstBrainstormIdea(idea.text, userBrief || '', referenceImages, customInstructions, !isYouTubeChannelBannerPrompt(brief) && (category === 'youtube_thumbnail' || isYouTubeThumbnailPrompt(brief, referenceImages, settings)))
        : isYouTubeChannelBannerPrompt(brief)
        ? preserveSunburstSourceBrief(idea.text, userBrief || '', referenceImages, customInstructions)
        : category === 'youtube_thumbnail' || buildYouTubeEditorialRule(brief, referenceImages, settings)
        ? preserveSunburstThumbnailBrief(idea.text, userBrief || '', referenceImages, customInstructions)
        : prepareImagePromptResult(idea.text, referenceImages);
        return { ...idea, text: cameraGaze ? applyYouTubeCameraGaze(text) : text };
      });
  }
  
  const parts: any[] = [];
  
  // Separate images by type
  const draftImages = referenceImages.filter(img => img.isDraftImage && !img.isVideoContext);
  const styleReferenceImages = referenceImages.filter(img => getPersonId(img) == null && !img.isDraftImage && !img.isVideoContext);
  
  for (const [index, img] of referenceImages.entries()) {
    const base64Data = await resolveReferenceImageData(img, options.signal);
    if (!base64Data) throw new Error(`Referans ${index + 1} okunamadı; kişi eşleşmesini korumak için işlem durduruldu.`);
    parts.push({ text: describeSunburstReference(img, index) }, { inlineData: { data: base64Data, mimeType: 'image/jpeg' } });
  }

  if (userBrief) userBrief = prepareTextStagePrompt(userBrief, referenceImages);

  // Build the system prompt
  const basePrompt = customInstructions ? prepareTextStagePrompt(customInstructions, referenceImages) : withIdeaCount(BRAINSTORM_PROMPTS[category], normalizedIdeaCount);
  
  let contextInfo = '';
  
  if (draftImages.length > 0) {
    contextInfo += `\n\n## 🎯 DRAFT IMAGE - EXTRACT THE CONCEPT:
The attached draft image${draftImages.length > 1 ? 's' : ''} should be analyzed for the concept.

YOUR TASK:
1. ANALYZE the draft image to understand the CORE CONCEPT/IDEA (e.g., "person disgusted by bad restaurant food", "unboxing a mystery product", "reaction to shocking news")
2. Extract the THEME and STORY from the draft
3. Generate ${normalizedIdeaCount} DIFFERENT CREATIVE IDEAS that explore this SAME CONCEPT in DIFFERENT WAYS

Think of the draft image as a "concept brief in visual form" - understand WHAT the image is about, then brainstorm ${normalizedIdeaCount} unique thumbnail/image ideas for that same topic.

For example, if the draft shows "person eating disgusting food at a restaurant":
- Idea 1: Extreme close-up of horrified face with food on fork, text "0/10 RATING"
- Idea 2: Person spitting food dramatically with exaggerated disgust expression
- Idea 3: Split screen - excited anticipation vs. horrified reaction after tasting
- Idea 4: Person in hazmat suit entering the restaurant kitchen
- Idea 5: Dramatic confrontation with chef, pointing at the terrible dish

Each idea is DIFFERENT but explores the SAME CONCEPT from the draft.`;
  }
  
  if (styleReferenceImages.length > 0) {
    contextInfo += `\n\nThe ${styleReferenceImages.length} STYLE REFERENCE IMAGE${styleReferenceImages.length > 1 ? 'S' : ''} provided should be analyzed for style, composition, and visual approach. Generated prompts must describe outputs that closely match their aesthetic.`;
  }
  
  if (getPersonGroups(referenceImages).length > 0) {
    contextInfo += `\n\n## REQUESTED PEOPLE:
In every idea, preserve the requested people's stable @ identity labels and SAME SINGLE person grouping across photos. Preserve each person's exact facial features, hair and skin tone.
Attached identity photos do not require every person to appear. Follow the user's requested people, counts, exclusions and positions equally for main, second and additional people.
Describe specific new clothing for each depicted person in every idea. Use the stable reference labels in the returned prompt; preserve exact quoted visible text.`;
  }
  
  // Add user's brief/concept if provided.
  if (userBrief && userBrief.trim()) {
    if (draftImages.length > 0) {
      // COMBINATION MODE: Draft image provides the concept, text brief provides modifications/details
      contextInfo += `\n\n## 📝 ADDITIONAL INSTRUCTIONS FROM USER:
"${userBrief.trim()}"

IMPORTANT: COMBINE the concept from the DRAFT IMAGE with these additional instructions.
- The DRAFT IMAGE defines the BASE CONCEPT
- The TEXT ABOVE provides MODIFICATIONS or SPECIFIC REQUIREMENTS to apply to that concept
- Generate ${normalizedIdeaCount} ideas that follow the draft's concept BUT incorporate the user's text instructions

Examples of how to combine:
- Draft shows "person with food" + Text says "no text" → Generate ideas without any text overlays
- Draft shows "indoor kitchen" + Text says "outdoor setting" → Same concept but in outdoor locations
- Draft shows "one person" + Text says "add a second person reacting" → Include the second person in ideas`;
    } else {
      // TEXT ONLY MODE: Text brief is the main concept
      contextInfo += `\n\n## USER'S CONCEPT/BRIEF:\n"${userBrief.trim()}"\n\nIMPORTANT: All ${normalizedIdeaCount} ideas MUST be variations and expansions of this user concept. Do NOT ignore this brief - it defines the core idea. Generate different creative interpretations, angles, and executions of THIS specific concept while matching the style of the reference images.`;
    }
  }

  const genericRoleChecks = [customInstructions, userBrief]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => buildTextStageRoleCheck(value, referenceImages))
    .filter(Boolean)
    .join('\n\n');
  const fullPrompt = `${basePrompt}${contextInfo}\n\n${buildPersonIdentityContract(referenceImages)}\n${buildEditableReferenceGuidance(referenceImages)}\nPreserve each requested identity and count using the stable labels above.${genericRoleChecks ? `\n\n${genericRoleChecks}` : ''}

## OUTPUT REQUIREMENTS

Each idea must be a COMPLETE NARRATIVE PROMPT ready for Nano Banana Pro or Nano Banana 2.1. Follow these rules:

1. NARRATIVE FLOW: Write descriptive paragraphs, NOT comma-separated keyword lists. The model understands rich language.

2. BE HYPER-SPECIFIC: 
   - BAD: "person looking surprised with colorful background"
   - GOOD: "A photorealistic close-up of a person with wide eyes and raised eyebrows, mouth slightly open in genuine amazement, set against a vibrant gradient transitioning from electric cyan to magenta with subtle bokeh light particles"

3. INCLUDE ALL DETAILS:
   - Shot type and framing (close-up, wide-angle, three-quarter)
   - Subject description with specific features
   - Expression/pose with body language details
   - Environment/background with atmosphere
   - Lighting setup and mood it creates
   - Any text in "quotes" with font style description
   - Camera/lens details for photorealistic shots
   - Color palette and grading notes

4. USE PHOTOGRAPHY/CINEMATIC LANGUAGE: wide-angle shot, 85mm lens, shallow depth of field, three-point lighting, golden hour, Rembrandt lighting, rule of thirds

5. FOR COMPLEX SCENES USE STEPS: "First, the background shows [X]. In the midground, [Y]. The foreground features [Z] as the focal point."

6. PROVIDE CONTEXT AND INTENT: Mention what the image is for and what emotion or outcome it should drive.

7. USE SEMANTIC POSITIVE FRAMING: Prefer describing the desired scene positively rather than listing what to avoid.

${getPersonGroups(referenceImages).length > 0 ? `
🚨 MANDATORY CLOTHING RULE:
For EVERY idea with a person from a reference image:
- You MUST describe SPECIFIC NEW CLOTHING (e.g., "wearing a tailored charcoal blazer over a white v-neck tee" NOT "in their outfit")
- The clothing MUST be DIFFERENT from what they wear in the reference
- NEVER say "same clothes", "similar outfit", or leave clothing unspecified
- Each of the 5 ideas should have DIFFERENT clothing descriptions
` : ''}
${draftImages.length > 0 ? `
⚠️ FINAL REMINDER - DRAFT IMAGE${userBrief && userBrief.trim() ? ' + TEXT INSTRUCTIONS' : ''}:
1. First, identify the CORE CONCEPT from the draft image (in one sentence)
${userBrief && userBrief.trim() ? `2. Apply the user's text instructions: "${userBrief.trim()}"
3. Generate ${normalizedIdeaCount} DIFFERENT creative ideas that combine the draft concept WITH the text modifications` : `2. Generate ${normalizedIdeaCount} DIFFERENT creative ideas that all explore that same concept in unique ways`}
Each idea should be distinctly different from the others.
` : ''}
Return ONLY a valid JSON array of exactly ${normalizedIdeaCount} strings. Each string is one complete, detailed narrative prompt.
Format: ["Detailed narrative prompt 1...", "Detailed narrative prompt 2...", ...]`;

  const guidance = [fullPrompt, buildYouTubeWardrobeRule(userBrief || '', referenceImages, { imagePromptCategory: category }), cameraGaze].filter(Boolean).join('\n\n');
  parts.push({ text: wardrobeRequired ? buildBrainstormWardrobeGuidance(guidance, referenceImages, normalizedIdeaCount) : guidance });

  try {
    const response = await generateTextContent(ai, parts, 'brainstorm', userBrief?.trim() || `[${category}] brainstorm`, options, wardrobeRequired ? 'wardrobe' : undefined, normalizedIdeaCount);
    options.onStage?.('finishing');
    await finishTextUsage(logUsage('brainstorm', response.model, userBrief?.trim() || `[${category}] brainstorm`, 0, {
      usageMetadata: response.usageMetadata as any,
      referenceImageCount: referenceImages.length,
    }));
    
    return parseBrainstormIdeas(response.text || '[]', normalizedIdeaCount, wardrobeRequired ? referenceImages : undefined, combinedBrief)
      .map(idea => {
        const text = prepareImagePromptResult(idea.text, referenceImages);
        return { ...idea, text: cameraGaze ? applyYouTubeCameraGaze(text) : text };
      });
  } catch (error) {
    console.error("Brainstorm error:", error);
    throw error;
  }
};
