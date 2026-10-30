import { buildEditableReferenceGuidance, prepareEditableImagePrompt } from '../references/dynamicReferences.js';
import { cleanPersonName, getPersonId, getPersonGroups, getPersonDescription, normalizeReferencePrompt, buildPersonIdentityContract, buildPersonSeparationRule } from '../references/personReferences.js';
import type { BrainstormCategory, GenerationConfig, ReferenceImage } from '../../types.js';
import { getOpenAIImageOptions, getOpenAIImageSize, getSunburstReferences, SUNBURST_MODEL } from './openaiImage.js';
import { COMPACT_SOURCE_BRIEF_FOOTER, COMPACT_THUMBNAIL_SOURCE_BRIEF_FOOTER, EPISODE_SOURCE_BRIEF_FOOTER, SOURCE_BRIEF_FOOTER, THUMBNAIL_SOURCE_BRIEF_HEADER, THUMBNAIL_SOURCE_BRIEF_FOOTER, getOriginalImagePrompt, flattenPreparedImageBrief } from '../prompts/promptHistory.js';
import { getQuotedPromptPattern, getStableImageTag, mapUnquotedPrompt, resolveStableImageReferences } from '../references/referenceTokens.js';
import { EPISODE_THUMBNAIL_GUIDANCE, hasYouTubeEpisodeContext } from '../youtube/youtubeEditorial.js';
import { buildReferenceGenerationRule, compactReferenceRoles, IDENTITY_MEDIUM_RULE, CARTOON_3D_IDENTITY_RULE, SUNBURST_PROMPT_GUIDE } from './sunburstPromptGuide.js';
export { buildReferenceGenerationRule } from './sunburstPromptGuide.js';
import { EDIT_REGION_REQUIRED, isValidEditRegion } from './imageEditRegion.js';
import { getConceptWardrobe } from '../brainstorm/brainstormWardrobe.js';
import { hasYouTubeCameraGaze, stripYouTubeCameraGaze, YOUTUBE_CAMERA_GAZE_RULE } from '../youtube/youtubeCameraGaze.js';

export type ImagePromptSettings = Pick<GenerationConfig, 'imageModel' | 'aspectRatio' | 'resolution' | 'openaiImageOptions' | 'imagePromptCategory' | 'originalPrompt'>;

// UI mentions and provider inputs use the same upload order.
// Quoted copy and ordinary prose must survive without whitespace/word rewrites.
export const normalizeSunburstPrompt = (prompt: string, references: ReferenceImage[]): string =>
  normalizeReferencePrompt(stripLegacyOutputCanvas(prompt), references, getSunburstReferences(references));

/** Check the provider's reference rules before creating cards or pending jobs.
 * Discard the normalized text so the user's editable draft stays untouched. */
export const validateImageGenerationReferences = (settings: Pick<GenerationConfig, 'prompt' | 'referenceImages' | 'imageModel' | 'originalPrompt'>): void => {
  const references = settings.referenceImages || [];
  const selectedSources = references.filter(ref => ref.editRegion != null);
  if (selectedSources.length) {
    if (selectedSources.length !== 1 || !isValidEditRegion(selectedSources[0].editRegion)
      || references.some(ref => ref !== selectedSources[0] && ref.editRegion != null)) throw new Error(EDIT_REGION_REQUIRED);
    if (getPersonId(selectedSources[0]) != null || selectedSources[0].isVideoContext) {
      throw new Error('Kişi fotoğrafı veya video bağlamı yerine düzenlemek istediğin görselde Edit area seç.');
    }
  }
  if (settings.imageModel === SUNBURST_MODEL || settings.imageModel === 'gpt-image-2-beta') {
    normalizeSunburstPrompt(settings.prompt, references);
    if (settings.originalPrompt) normalizeSunburstPrompt(settings.originalPrompt, references);
  } else {
    normalizeReferencePrompt(settings.prompt, references);
    if (settings.originalPrompt) normalizeReferencePrompt(settings.originalPrompt, references);
  }
  // Only a manually selected area activates protected editing. Text alone,
  // including an edit verb or a legacy source flag, remains reference generation.
  getSunburstEditIntent(settings.prompt, references, settings);
};

/** Old full prompts can be reused from gallery history or templates. Remove
 * only the retired app-generated section, never arbitrary dimensions or copy. */
export const stripLegacyOutputCanvas = (prompt: string): string => prompt.replace(
  /(?:^|\r?\n)[\t ]*OUTPUT CANVAS[\t ]*(?:\r?\n|[\t ]+)(?:Create the image at exactly \d+[x×]\d+ pixels, filling this canvas\. This selected output size takes precedence over conflicting dimensions or aspect ratios copied into the creative brief; do not add letterboxing to simulate another canvas\.|Choose a suitable output canvas automatically, following the brief\.)[\t ]*(?=\r?\n|$)/g,
  '',
);

/** Keep editable labels while validating the entire text-model result before
 * any image in a Brainstorm batch can be submitted. */
export const prepareImagePromptResult = (prompt: string, references: ReferenceImage[]): string => {
  const editable = prepareEditableImagePrompt(stripLegacyOutputCanvas(prompt), references);
  normalizeSunburstPrompt(editable, references);
  return editable;
};

/** Resolve references only for intent analysis; keep the user's actual copy and
 * upload order untouched. Ordinal mentions are common in pasted edit requests. */
const normalizeEditImageMentions = (brief: string): string => {
  const ordinals: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, ilk: 1, birinci: 1, ikinci: 2, 'üçüncü': 3, ucuncu: 3, 'dördüncü': 4, dorduncu: 4, 'beşinci': 5, besinci: 5 };
  return brief.toLowerCase().replace(/\u0307/g, '').replace(/(?<!\p{L})(first|second|third|fourth|fifth|ilk|birinci|ikinci|üçüncü|ucuncu|dördüncü|dorduncu|beşinci|besinci)\s+(?:image|photo|picture|görsel|gorsel|fotoğraf|fotograf|resim)/giu,
    (_, ordinal: string) => `image ${ordinals[ordinal.toLowerCase()]}`)
    .replace(/(?:photo|picture|görsel|gorsel|fotoğraf|fotograf|resim)\s*(\d+)/giu, 'image $1');
};

const withoutQuotedCopy = (prompt: string): string => prompt.replace(getQuotedPromptPattern(), '');

/** Reinforce an explicitly requested transformation, never infer a new medium
 * from the generated scene, literal printed copy or an old category. */
const identityMediumRule = (prompt: string): string => {
  const brief = withoutQuotedCopy(getOriginalImagePrompt(prompt) || prompt);
  const cartoon = /\b(?:cartoon|chibi|toon)\b|çizgi\s*(?:film|karakter)/iu.test(brief);
  const threeD = /\b3[ -]?d\b|üç\s*boyutlu/iu.test(brief);
  const avatar = /\bavatar\b/iu.test(brief);
  const conflicting = /\b(?:photorealistic|photorealism|photograph|photographic|live[ -]action|mixed[ -]media|hybrid)\b|\b(?:no|not|without|avoid)\s+(?:a\s+|any\s+)?(?:3[ -]?d\s+)?(?:cartoon|chibi|toon|3[ -]?d)\b|(?:çizgi\s*(?:film|karakter)|3d)\s*(?:olmasın|istemiyorum|değil)/iu.test(brief);
  return cartoon && threeD && avatar && !conflicting ? CARTOON_3D_IDENTITY_RULE : IDENTITY_MEDIUM_RULE;
};

const resolveEditSource = (brief: string, inputs: ReferenceImage[], selectedSource: number): number | undefined => {
  const mentions = [...brief.matchAll(/\bimage\s*(\d+)(?:['’]?([a-zçğıöşü]+))?/giu)].flatMap(match => {
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= inputs.length) return [];
    const before = brief.slice(0, match.index).split(/[.!?;\n]/).at(-1) || '';
    const after = brief.slice(match.index! + match[0].length);
    const suffix = (match[2] || '').toLowerCase();
    const direct = /\b(?:edit|retouch|modify|upscale)\s+(?:the\s+)?$/i.test(before)
      || /^\s+(?:as|is)\s+(?:the\s+)?(?:base|source|image to edit)\b/i.test(after);
    const donor = /\b(?:from|using|with|based on)\s+(?:the\s+)?$/i.test(before) || /^(?:deki|daki|teki|taki|den|dan|ten|tan)$/i.test(suffix);
    const destination = !donor && (
      /\b(?:to|onto|into|on)\s+(?:the\s+)?$/i.test(before)
      || /\b(?:bottom|top)[ -](?:left|right)(?:\s+corner)?\s+(?:of|in|on)\s+(?:the\s+)?$/i.test(before)
      || (/\bin\s+(?:the\s+)?$/i.test(before) && /\b(?:replace|remove|erase|change|swap|add|insert|put|place)\b/i.test(before) && !/\b(?:from|using|with)\b/i.test(before))
      || /^(?:e|a|ye|ya|de|da|te|ta)$/i.test(suffix)
    );
    return [{ index, direct, donor, destination }];
  });
  const unique = (values: number[]) => [...new Set(values)];
  // A donor often appears first: "add the bar FROM image 2 TO image 1".
  // Explicit edit/base roles win over incidental references inside the edit.
  const direct = unique(mentions.filter(mention => mention.direct).map(mention => mention.index));
  if (direct.length) return direct.length === 1 ? direct[0] : undefined;
  const destinations = unique(mentions.filter(mention => mention.destination).map(mention => mention.index));
  if (destinations.length) return destinations.length === 1 ? destinations[0] : undefined;
  return selectedSource;
};

/** Local editing is an explicit area selection, never inferred from the prompt.
 * The original brief is used only to catch a conflicting named edit destination. */
export const getSunburstEditIntent = (prompt: string, references: ReferenceImage[], settings: Pick<ImagePromptSettings, 'originalPrompt'> = {}): { sourceIndex: number } | undefined => {
  const inputs = getSunburstReferences(references);
  const selected = inputs.flatMap((ref, index) => ref.editRegion != null ? [index] : []);
  if (!selected.length) return undefined;
  if (selected.length > 1) throw new Error('Düzenlenecek kaynak olarak tek bir görsel seç.');
  if (selected.some(index => inputs[index].isVideoContext || getPersonId(inputs[index]) != null)) throw new Error('Düzenleme için kapak görselinde Edit area ile alan seç; People fotoğrafı veya video bağlamı kaynak olamaz.');
  if (!isValidEditRegion(inputs[selected[0]].editRegion)) throw new Error(EDIT_REGION_REQUIRED);
  const brief = withoutQuotedCopy(normalizeEditImageMentions(normalizeSunburstPrompt(settings.originalPrompt?.trim() || prompt, references)));
  const inferredSource = resolveEditSource(brief, inputs, selected[0]);
  if (inferredSource != null && inferredSource !== selected[0]) throw new Error('Prompttaki kaynak ile alan seçimi farklı. Düzenlenecek görseli eşleştir.');
  return { sourceIndex: selected[0] };
};

const LOCAL_EDIT_PRESERVATION = 'Change only what the user requested. Do not change anything else. Keep unaffected people, clothing, objects, labels and arrows intact, with the original framing, camera angle, lighting, saturation, contrast, texture and sharpness. Match any replacement to the existing scene. Do not restyle, retouch or enhance the whole image unless explicitly requested.';
const LOCAL_EDIT_FACE_PRESERVATION = "For every face not explicitly targeted by the user's requested edit, preserve the face already present in the SOURCE: exact facial proportions, expression, gaze, age, hair, facial hair, skin tone and skin texture, including pores, fine lines and existing imperfections. Do not beautify, smooth, denoise, sharpen, relight or reconstruct those faces. Keeping a recognizable identity is not permission to redraw a face. Existing SOURCE faces take precedence over separate People/identity photos; those photos authorize a face change only when the user explicitly requests it. An object, phone, clothing, text or background correction must not retouch a person. Explicitly requested face or expression changes apply only to the targeted person; preserve all other faces.";

const buildSunburstEditContract = (references: ReferenceImage[], intent: { sourceIndex?: number }, preservation = true): string => {
  const inputs = getSunburstReferences(references);
  const identities = getPersonGroups(inputs).map(group => {
    const labels = inputs.flatMap((ref, index) => getPersonId(ref) === group.id ? [`image ${index + 1}`] : []);
    return `${labels.join(' and ')} depict the SAME SINGLE ${getPersonDescription(group.id)} (label ${JSON.stringify(group.label)}). Use these photos only for the identity requested in the edit; do not copy their clothes, pose or background unless requested.`;
  });
  return [
    'LOCAL IMAGE EDIT',
    intent.sourceIndex != null ? `SOURCE: IMAGE ${intent.sourceIndex + 1} is the image to edit. Other inputs are references only, not replacement compositions. Copy only the requested element or identity from a donor reference; do not import its overall style, lighting, colors, background or unrelated people.`
      : 'Edit the source image identified by the user brief. Use the other inputs only for their stated reference purpose.',
    ...identities,
    preservation ? LOCAL_EDIT_PRESERVATION : '',
    preservation ? LOCAL_EDIT_FACE_PRESERVATION : '',
  ].filter(Boolean).join('\n');
};

/** Keep the edit intent after a text model rewrites the request, including
 * Brainstorm prompts which no longer carry config.originalPrompt. */
export const preserveSunburstEditBrief = (idea: string, brief: string, references: ReferenceImage[], settings: Pick<ImagePromptSettings, 'originalPrompt'> = {}): string => {
  const normalizedIdea = prepareImagePromptResult(stripYouTubeCameraGaze(idea), references);
  const source = prepareImagePromptResult(stripYouTubeCameraGaze(settings.originalPrompt?.trim() || brief), references).trim();
  return `${normalizedIdea}\n\nRequested edit: ${source}\nThe user's requested edit defines the permitted changes; prompt expansion must not add retouching.\n${LOCAL_EDIT_FACE_PRESERVATION}\nDo not change anything else.`;
};

/** A text model can omit exclusions while expanding a thumbnail idea. Keep the
 * user's brief in the actual, editable production prompt rather than relying
 * on the text model to restate every constraint. */
export const preserveSunburstThumbnailBrief = (idea: string, brief: string, references: ReferenceImage[], customInstructions?: string): string => {
  return preserveSunburstSourceBrief(idea, brief, references, customInstructions, true);
};

export const preserveSunburstSourceBrief = (idea: string, brief: string, references: ReferenceImage[], customInstructions?: string, thumbnailWardrobe = false): string => {
  const source = [brief.trim(), customInstructions?.trim()].filter(Boolean).join('\n\n');
  const normalizedIdea = prepareImagePromptResult(idea, references);
  if (!source) return normalizedIdea;
  const footer = thumbnailWardrobe
    ? hasYouTubeEpisodeContext(source, references) ? EPISODE_SOURCE_BRIEF_FOOTER : THUMBNAIL_SOURCE_BRIEF_FOOTER
    : SOURCE_BRIEF_FOOTER;
  return `${normalizedIdea}\n\n${THUMBNAIL_SOURCE_BRIEF_HEADER}\n${prepareImagePromptResult(source, references)}\n\n${footer}`;
};

/** Keep the original requirements exactly once without relying on the model to
 * remember an exclusion. Only exact application-owned blocks are deduplicated. */
export const assembleSunburstBrainstormIdea = (idea: string, brief: string, references: ReferenceImage[], customInstructions?: string, thumbnailWardrobe = false): string => {
  const source = [...new Set([brief, customInstructions || ''].map(value => prepareImagePromptResult(flattenPreparedImageBrief(value), references).trim()).filter(Boolean))].join('\n\n');
  let scene = prepareImagePromptResult(idea, references).trim();
  if (!source || scene === source) return scene;
  // A saved prepared brief can return through Brainstorm. Unwrap only a known
  // suffix that repeats this exact source; never remove arbitrary quoted copy.
  if (getOriginalImagePrompt(scene) === source) scene = scene.slice(0, scene.lastIndexOf(`\n\n${THUMBNAIL_SOURCE_BRIEF_HEADER}\n`)).trimEnd();
  const footer = thumbnailWardrobe ? COMPACT_THUMBNAIL_SOURCE_BRIEF_FOOTER : COMPACT_SOURCE_BRIEF_FOOTER;
  return `${scene}\n\n${THUMBNAIL_SOURCE_BRIEF_HEADER}\n${source}\n\n${footer}`;
};

export const describeSunburstReference = (ref: ReferenceImage, index: number): string => {
  if (ref.editRegion != null) return `IMAGE ${index + 1}: approved SOURCE image to edit; its existing faces, texture and composition are authoritative. Change only the user's requested elements.`;
  if (ref.isVideoContext) return `IMAGE ${index + 1}: original video thumbnail for VIDEO CONTEXT only; use it as episode evidence, not a style reference, layout template or image to edit. Develop a different visual hook and composition. Do not copy its people, clothing, text or graphic elements unless the brief explicitly requests them. Dedicated person photos determine the selected cast's identities. The cover alone is not evidence that an event or outcome happened in the video.`;
  const personName = cleanPersonName(ref.personName || '');
  const roles = [
    getPersonId(ref) != null && `${getPersonDescription(getPersonId(ref)!)} identity${personName ? ` (label ${JSON.stringify(personName)})` : ''} (all photos in this group depict the same person)`,
    ref.isDraftImage && 'draft / visual concept; retain its layout when the brief requests an edit or faithful rendering',
    getPersonId(ref) == null && !ref.isDraftImage && ref.isThumbnailStyle && 'THUMBNAIL STYLE EXAMPLE; requested cover design language, not a source of identities, visible copy or episode facts',
  ].filter(Boolean);
  return `IMAGE ${index + 1}: ${roles.join('; ') || 'general reference; use the brief to determine subject, product, style, clothing or background role, not automatically all of them'}`;
};

/** Repeat identity grouping at generation time; the image model never sees the text-model instructions. */
export const buildSunburstReferenceContract = (references: ReferenceImage[], replaceWardrobe = false, prompt = ''): string => {
  const inputs = getSunburstReferences(references);
  if (!inputs.length) return '';
  const roles = `REFERENCE ROLES (numbered in the actual input order)\n${inputs.map(describeSunburstReference).join('\n')}`;
  const generation = buildReferenceGenerationRule(inputs);
  if (!getPersonGroups(inputs).length) return `${generation}\n${roles}\nUse each reference only for the purpose requested in the brief. Do not add people or text unless requested.`;
  return `${generation}\n${roles}\n${buildPersonIdentityContract(inputs)}\n${identityMediumRule(prompt)}\nReference count is not the number of people to depict. Keep main, second and all additional person identities separate; never blend or swap their faces. Person group numbers are stable identities, not positions in the scene. Only include the people and roles required by the brief. Dedicated identity photos take precedence over that same person's face in an old video thumbnail; ${replaceWardrobe ? 'preserve facial identity and explicitly requested hair or facial-hair styling, while replacing reference clothing under the required wardrobe rule.' : 'use explicitly requested current styling.'}\nUse each reference only for its stated purpose.`;
};

/** Explicit channel art takes precedence over a category inherited from history.
 * A thumbnail about a banner is still a thumbnail: the first stated use wins. */
export const isYouTubeChannelBannerPrompt = (prompt: string): boolean => {
  const brief = withoutQuotedCopy(prompt);
  const banner = /\b(?:youtube\s+(?:channel\s+)?banner|channel\s+(?:banner|art))\b|(?<!\p{L})(?:youtube\s+)?kanal\s+(?:banner[ıi]?|kapa[ğg][ıi])(?!\p{L})/iu.exec(brief);
  const thumbnail = /\bthumbnail\b|\bvideo\s+cover\b|(?<!\p{L})video\s+kapa[ğg][ıi](?!\p{L})/iu.exec(brief);
  return !!banner && (!thumbnail || banner.index < thumbnail.index);
};

/** A category retained from history is not permission to restyle a new draft.
 * Require current thumbnail intent, imported episode context, or a prepared
 * thumbnail brief with its intact app-generated source envelope. */
export const isYouTubeThumbnailPrompt = (prompt: string, references: ReferenceImage[], settings: Pick<ImagePromptSettings, 'imagePromptCategory'> = {}): boolean =>
  !isYouTubeChannelBannerPrompt(prompt) && (/(?:^|\n)EPISODE SUMMARY\r?\n/.test(prompt)
    || /youtube\s*(thumbnail|cover|kapak)|\bthumbnail\b|\bvideo\s+cover\b|(?:video|youtube)\s*kapa[ğk][ıi]?|kapak\s*(foto[ğg]raf[ıi]|g[oö]rseli)|(?:yeni|bir)\s+kapak\b|kapak\s+(?:oluştur|tasarla)/iu.test(withoutQuotedCopy(prompt))
    || ((!settings.imagePromptCategory || settings.imagePromptCategory === 'youtube_thumbnail') && references.some(ref => ref.isVideoContext))
    || (settings.imagePromptCategory === 'youtube_thumbnail' && (getOriginalImagePrompt(prompt) !== undefined || !!getConceptWardrobe(prompt))));

/** A new general draft must not inherit an old thumbnail's category or intent.
 * Edits that remain within a prepared thumbnail retain their Revert history. */
export const updateImageDraftPrompt = (config: GenerationConfig, prompt: string): GenerationConfig => {
  const leavesThumbnail = config.mode === 'image' && config.imagePromptCategory === 'youtube_thumbnail'
    && !isYouTubeThumbnailPrompt(prompt, config.referenceImages, config);
  // A new correction is a new task. A retained creation brief would otherwise
  // override it during Enhance and on the server, especially with a YT cover.
  let startsEdit = false;
  if (config.mode === 'image' && config.originalPrompt != null) {
    try {
      const previousEdit = getSunburstEditIntent(config.originalPrompt, config.referenceImages);
      startsEdit = !!getSunburstEditIntent(prompt, config.referenceImages)
        && (!previousEdit || !prompt.includes(config.originalPrompt.trim()));
    } catch {
      // Editing a partial @ mention must remain possible. Submission validates
      // complete references; intent inference must not break the text field.
    }
  }
  return { ...config, prompt, ...(leavesThumbnail || startsEdit ? {
    imagePromptCategory: undefined, originalPrompt: undefined,
    enhancedForMode: undefined, enhancedForImageModel: undefined, enhancedForImageContextKey: undefined,
  } : {}) };
};

export const buildYouTubeEditorialRule = (prompt: string, references: ReferenceImage[], settings: Pick<ImagePromptSettings, 'originalPrompt'> = {}): string =>
  !isYouTubeChannelBannerPrompt(prompt) && hasYouTubeEpisodeContext(prompt, references) && !getSunburstEditIntent(prompt, references, settings)
    ? EPISODE_THUMBNAIL_GUIDANCE : '';

/** Brainstorm introduces the rule; subsequent text tasks retain it only for
 * those concepts. Ordinary drafts, banners and explicit area edits keep scope. */
export const buildYouTubeCameraGazeRule = (
  prompt: string, references: ReferenceImage[], settings: Pick<ImagePromptSettings, 'originalPrompt'> = {},
  thumbnailBrainstorm = hasYouTubeCameraGaze(prompt),
): string => thumbnailBrainstorm && !isYouTubeChannelBannerPrompt(prompt) && !getSunburstEditIntent(prompt, references, settings)
  ? YOUTUBE_CAMERA_GAZE_RULE : '';

/** Shared by text planning and actual image generation, including raw prompts.
 * Known channel imports have an explicit role; old/manual uploads are interpreted
 * visually in the same request, without a separate classifier or paid call. */
export const buildYouTubeStyleReferenceRule = (
  prompt: string, references: ReferenceImage[], settings: Pick<ImagePromptSettings, 'imagePromptCategory' | 'originalPrompt'> = {},
  thumbnail = isYouTubeThumbnailPrompt(prompt, references, settings),
  localEdit = !!getSunburstEditIntent(prompt, references, settings),
): string => {
  if (!thumbnail || isYouTubeChannelBannerPrompt(prompt) || localEdit) return '';
  const examples = references.filter(ref => getPersonId(ref) == null && !ref.isDraftImage && !ref.isVideoContext && ref.editRegion == null);
  if (!examples.length) return '';
  return `THUMBNAIL STYLE EXAMPLES
Inspect the attached images, not just their labels. Marked thumbnail style examples are requested design references. For unassigned uploads, a finished designed video cover also supplies the desired thumbnail style unless the brief assigns it another role. An isolated product or ordinary photo is not automatically a style example: use only its brief-assigned object, color, background or other role. Identity photos supply likeness; the published VIDEO CONTEXT cover supplies episode context only; drafts follow their requested purpose.
Extract concrete design traits from the example covers: focal hierarchy, face/object scale, composition grammar, palette and contrast, lighting treatment, typography and text placement, and readability at mobile size. Describe the relevant traits in each production prompt and apply that channel language to the current brief. With multiple examples, use their shared design language without combining them into a collage or cloning one layout across all brainstorm concepts.
The current brief determines the topic, objects, facts, exact copy or no-text request; dedicated People photos determine identity. Do not import example-cover cast, outfits, products, prices, headlines or outcomes unless explicitly requested. Keep natural skin texture; visual style does not authorize face smoothing or heavy retouching. Preserve distinct concept wardrobe plans. Explicit user instructions take priority over inferred style. Treat these as preferred examples, not proof of click-through performance.`;
};

/** The user's thumbnail wardrobe requirement applies independently of the chosen model. */
export const buildYouTubeWardrobeRule = (prompt: string, references: ReferenceImage[], settings: Pick<ImagePromptSettings, 'imagePromptCategory'> = {}): string => {
  if (!isYouTubeThumbnailPrompt(prompt, references, settings)) return '';
  return buildYouTubePersonWardrobe(references);
};

const buildYouTubePersonWardrobe = (references: ReferenceImage[]): string => {
  const people = getPersonGroups(references).map(group => group.id === 1 ? 'MAIN PERSON (the main/first person)' : group.id === 2 ? 'SECOND PERSON (the second person)' : `PERSON ${group.id} (${group.label})`);
  if (!people.length) return '';
  return `REQUIRED YOUTUBE PERSON WARDROBE\nApplies to ${people.join(' and ')} whenever depicted. Preserve each person's recognizable face, hair, age, skin tone and natural anatomy; clothing is not part of the identity lock.
Never reproduce any outfit visible in ANY of the person identity reference photos. Dress each depicted person in visibly different, scene-appropriate clothing. Specify the new garments, colors and cut or material in every production prompt. Choose a different outfit design, not merely a recolor of the same garment; do not copy reference garment logos, prints or distinctive details, and do not swap reference outfits between people.
An explicitly designed new outfit or a validated CONCEPT WARDROBE plan already satisfies this replacement requirement: keep its assigned garments, colors, cut and materials. Do not replace it with a default outfit or change it during Enhance or image variations. Different concepts must use different garment combinations; repeated appearances and variations of ONE concept keep that concept's assigned outfit. An intentional user uniform/costume takes priority over unrequested wardrobe variation.
Apply this to every appearance of the same person, including split scenes and triptychs. The required wardrobe replacement takes precedence over copied brief phrases such as "same clothes", "current styling" or "preserve all source details". Keep other requested scene details and exact visible text. Do not add a person just to demonstrate an outfit.`;
};

// Based on the user's successful thumbnail briefs. This default is scoped to
// YouTube work; explicit medium, no-text and edit instructions still win.
const VIDEO_COVER_DIRECTION = 'Use the original video thumbnail for episode context, participant roles and explicitly specified hairstyle, facial hair or glasses, not a composition to copy by default.';
export const YOUTUBE_THUMBNAIL_DIRECTION = `Create ONE finished premium photorealistic YouTube thumbnail: an editorial photographic composite, not an ordinary scene snapshot. Follow an explicitly requested different medium or local edit instead of replacing it with this default.
Choose one clear visual question or contrast grounded in the episode. Use large recognizable faces with believable expressive emotion, crisp eyes, natural skin texture and anatomy. Build 2–3 major visual masses, a simple readable hierarchy, deliberate lighting and strong subject-background separation. The hook, faces and any text must remain legible at 320x180; simplify distracting small props and scenery. Use a full-bleed canvas without borders, letterboxing, a contact sheet or YouTube UI. An intentional split scene or seamlessly blended triptych is allowed when the concept requires it; all repeated host appearances remain the SAME identity.
If text is requested, preserve the exact quoted Turkish wording and characters, with very bold clean sans serif lettering and clear negative space. For an open thumbnail concept with no specified copy, propose a short Turkish hook grounded only in the supplied premise; if the brief requests no text or no new slogans, add none. Do not invent guest quotes. Keep eyes and text safely inset 5%, and keep the bottom-right 15% free of critical content for the duration overlay.
${VIDEO_COVER_DIRECTION} Separate the host, guests, judges, contestants and anonymous figures; preserve supplied counts, prices and stakes. Do not invent identifiable participants, winners, outcomes, awards, injuries or scandal. Promotional concepts illustrate the episode premise without claiming an unverified event happened. Do not invent names or physical identity details absent from the brief and references.
Identity photos supply likeness, not a mandatory pose. For a new concept, give each person a specific natural head angle, expression and gesture that serve this concept, following the required camera-gaze rule when present. Do not repeatedly copy a hand-on-chin pose or freeze the reference expression across different ideas. Preserve explicitly requested hairstyle, facial hair and glasses. When the required person wardrobe rule applies, give those people new outfits and preserve other unrequested source details in local edits.
For a guessing game, keep candidate options equally plausible: no "clearly faking" contestant, winner arrow, green check, unequal winner spotlight or confident reveal. Do not invent headphones, blindfolds, recording-booth rules or other mechanics absent from the brief. If the participant count is unspecified, do not invent a numbered lineup or claim a total; use host reactions and one symbolic object, or a clearly partial unnumbered glimpse. Anonymous figures must not imply a particular identifiable guest through distinctive costumes or silhouettes. General style references do not supply extra cast members or episode facts.`;

/** Final server-side prompt reinforces reference roles. Size stays in the API parameter. */
const composeSunburstGenerationPrompt = (prompt: string, references: ReferenceImage[], settings: ImagePromptSettings, edit: ReturnType<typeof getSunburstEditIntent>, episodeContext = hasYouTubeEpisodeContext(prompt, references), thumbnail = isYouTubeThumbnailPrompt(prompt, references, settings)): string => {
  if (!edit) {
    // Normalize/validate first, then collapse the historical long identity
    // expansion. Stable @ labels bind to the single legend instead of repeating
    // the same photo list at every action, gaze and source-brief mention.
    const canonical = prepareImagePromptResult(prompt, references);
    const creative = resolveStableImageReferences(canonical, references);
    const wardrobe = thumbnail && getPersonGroups(references).length
      ? 'REQUIRED YOUTUBE PERSON WARDROBE\nApplies to depicted reference people: use specific new scene-appropriate outfits, not copied, recolored or swapped reference clothes. Preserve their likeness and explicitly requested hair or facial hair. This wardrobe rule overrides copied clothing instructions. Keep an explicitly designed new outfit and the validated CONCEPT WARDROBE unchanged; it already satisfies the replacement rule. Never collapse different concept plans into one default outfit. Repeated appearances and variations of one concept use that same concept outfit; an intentional user uniform/costume wins.' : '';
    return [
      compactReferenceRoles(references, false, identityMediumRule(prompt)),
      buildYouTubeStyleReferenceRule(prompt, references, settings, thumbnail, !!edit),
      thumbnail ? `YOUTUBE THUMBNAIL DIRECTION\nUse the requested medium and composition. For an open brief, create a readable photographic cover with a clear focal hierarchy and a short Turkish headline or no text. Respect exact copy and no-text requests.${episodeContext ? ' Advertise the whole episode promise; supporting details must not become a different headline or dominant topic.' : ''} Do not invent cast, events or claims.` : '',
      wardrobe,
      `CREATIVE BRIEF\n${creative}`,
    ].filter(Boolean).join('\n\n');
  }
  // Intent and context were resolved before unused episode covers were removed.
  // Do not resolve originalPrompt against the now-shorter reference list again.
  return [
    buildSunburstEditContract(references, edit, false),
    `REQUESTED EDIT\n${normalizeSunburstPrompt(stripYouTubeCameraGaze(prompt), references)}`,
    settings.originalPrompt?.trim() && settings.originalPrompt.trim() !== prompt.trim() ? `USER EDIT SCOPE\n${normalizeSunburstPrompt(stripYouTubeCameraGaze(settings.originalPrompt), references)}\nThe user's original edit request defines the permitted changes. Prompt expansion cannot authorize extra retouching or face reconstruction.` : '',
    buildPersonSeparationRule(getSunburstReferences(references)),
    `SOURCE PRESERVATION\n${LOCAL_EDIT_PRESERVATION}\n${LOCAL_EDIT_FACE_PRESERVATION}`,
  ].filter(Boolean).join('\n\n');
};

export const buildSunburstGenerationPrompt = (prompt: string, references: ReferenceImage[], settings: ImagePromptSettings): string =>
  composeSunburstGenerationPrompt(prompt, references, settings, getSunburstEditIntent(prompt, references, settings));

/** Compile the prompt and its actual image inputs together. Episode covers remain
 * available to Brainstorm/Enhance and in history, but their faces must not compete
 * with dedicated identity photos in a new multi-person thumbnail. Local edits
 * and ordinary visual references retain their original inputs. */
export const prepareSunburstGeneration = (prompt: string, references: ReferenceImage[], settings: ImagePromptSettings): { prompt: string; referenceImages: ReferenceImage[] } => {
  normalizeSunburstPrompt(prompt, references);
  if (settings.originalPrompt) normalizeSunburstPrompt(settings.originalPrompt, references);
  const edit = getSunburstEditIntent(prompt, references, settings);
  const thumbnail = isYouTubeThumbnailPrompt(prompt, references, settings);
  const contextOnly = !edit && thumbnail && getPersonGroups(references).length > 1
    ? references.filter(ref => ref.isVideoContext && getPersonId(ref) == null && !ref.isDraftImage) : [];
  if (!contextOnly.length) return { prompt: composeSunburstGenerationPrompt(prompt, references, settings, edit), referenceImages: references };
  if (references.some(ref => !ref.id) || new Set(references.map(ref => ref.id)).size !== references.length) {
    throw new Error('Görsel referanslarının kimlikleri eksik veya tekrarlanıyor. Referansları yeniden ekleyip tekrar dene.');
  }

  // Bind against the original snapshot BEFORE removing any inputs, including
  // already-expanded prompts from older tabs. Never reinterpret shifted indices.
  const contextTags = new Set(contextOnly.map(ref => getStableImageTag(ref.id)));
  const creative = mapUnquotedPrompt(prepareEditableImagePrompt(prompt, references), text => text.replace(/@REFERENCE\[[^\]\n]*\]/g, token =>
    contextTags.has(token) ? 'the published cover (written episode context only; not an attached generation image)' : token));
  const inputs = references.filter(ref => !contextOnly.includes(ref));
  // Keep the intent resolved against the original snapshot: factual verbs in a
  // source brief must not become a local edit after the context cover is removed.
  return { prompt: composeSunburstGenerationPrompt(creative, inputs, { ...settings, imagePromptCategory: 'youtube_thumbnail' }, edit, hasYouTubeEpisodeContext(prompt, references), thumbnail), referenceImages: inputs };
};

const CATEGORY_DIRECTION: Record<BrainstormCategory, string> = {
  youtube_thumbnail: 'Explore distinct premium YouTube thumbnail concepts, not generic scene descriptions. Vary the visual hook, hierarchy, framing and staging; color changes alone are not a new concept.',
  product_shot: 'Explore commercial product presentations while keeping the supplied product, packaging geometry and branding recognizable.',
  portrait: 'Explore portrait framing and visual storytelling within the identity and appearance constraints.',
  social_media: 'Explore distinct social compositions suitable for the intended audience and selected canvas.',
  custom: 'Follow the custom creative direction and user brief.',
  simple: 'Explore distinct visual directions for the brief or the draft concept.',
};

const CHANNEL_BANNER_DIRECTION = 'Create channel banner concepts following the stated brief and selected canvas. An old banner used as an example supplies only the roles requested by the brief; replacing it does not require preserving its text treatment, reflections, layout or colors. Include every required experience or scene in each complete concept, rather than choosing a subset. If the same person appears in multiple adventures, keep the same identity in every appearance. Do not apply video-thumbnail duration-overlay clearance or invent a video hook or slogan.';

const getImagePromptTargetName = (settings: ImagePromptSettings): string => settings.imageModel === 'gpt-image-2.5-sunburst'
  ? 'GPT Image 2.5 Sunburst' : settings.imageModel === 'gemini-nano-banana-2.1' ? 'Nano Banana 2.1'
    : settings.imageModel === 'gemini-3.1-flash-image-preview' ? 'Nano Banana 2' : 'Nano Banana Pro';

/** Simple is a brief-led brainstorm, including when a Nano Banana model is
 * selected. Keep one policy so the legacy narrative template cannot override
 * the user's medium, wardrobe, reference roles or local-edit scope.
 * https://developers.openai.com/api/docs/guides/image-prompting */
export const buildSimpleBrainstormGuidance = (
  references: ReferenceImage[], settings: ImagePromptSettings, count: number, prompt = '',
): string => {
  const target = getImagePromptTargetName(settings);
  const edit = getSunburstEditIntent(prompt, references, settings);
  const thumbnail = isYouTubeThumbnailPrompt(prompt, references, { ...settings, imagePromptCategory: 'simple' });
  const canvas = settings.imageModel === 'gpt-image-2.5-sunburst' ? getOpenAIImageSize(settings) : settings.aspectRatio;
  return `Prepare exactly ${count} independently usable image prompts for ${target}.

SIMPLE BRAINSTORM
${settings.imageModel === SUNBURST_MODEL ? SUNBURST_PROMPT_GUIDE : ''}
${thumbnail ? buildYouTubeEditorialRule(prompt, references, settings) : ''}
${buildYouTubeStyleReferenceRule(prompt, references, settings, thumbnail)}
${buildYouTubeCameraGazeRule(prompt, references, settings, thumbnail)}
The user's brief and additional creative direction define the task. Keep the same intended use, subject, facts, requested medium, people and quantities, exact text and exclusions in every idea. Do not invent a different premise or turn a logo, diagram, illustration or product image into a photographic thumbnail. Additional creative direction supplements these rules; it does not replace the brief.

${edit ? `${buildSunburstEditContract(references, edit)}
Return alternative executions of only the requested edit. Preserve the approved source, including unrequested clothing, expressions, objects, text, layout, lighting and colors. Do not propose a new scene or visual style. If the change is already fully specified, repeat a faithful edit instruction rather than invent extra changes to make the ideas different.
Write a short edit instruction: identify the source and donor with their stable reference labels, say what changes and what stays fixed, and finish with "Do not change anything else." Do not add scene inventories, global retouching, quality boosters or a separate constraints section.`
    : `CREATIVE RANGE
${isYouTubeChannelBannerPrompt(prompt) ? `${CHANNEL_BANNER_DIRECTION}\n` : ''}
Find meaningfully different ways to communicate the same concept. Vary the visual hook, staging, layout, subject scale, viewpoint or interaction only where the brief leaves room. A different adjective or color alone is not a new idea. Preserve any specified palette, framing, pose or background. Explore different visual media only when the user leaves the medium open or explicitly requests that range; do not force one photorealistic, one 3D and one watercolor result.
For a simple request, a few clear sentences are enough. Add detail only when it changes the intended result; there is no word-count target or mandatory template. Start with the intended image and subject, then explain its focal point and composition. Add visible materials, light, color or medium when relevant. For people, specify useful framing, relative scale, gaze, pose and interaction. Use photographic language only for photographs; camera and lens specifications are optional. Avoid decorative effects, cinematic adjectives and heavy retouching unless requested.
For a short stylized avatar brief, keep each scene to a few purposeful elements and make the character's rendering concrete: shapes, materials, hair and face shading must visibly match the requested medium. Use stable identity labels rather than guessing eye color or inventorying photographic facial features. Do not fill every studio with generic clutter or invented slogans. Do not convert an open clothing choice into mandatory reference-photo clothing.
For required text, preserve the exact wording (including Turkish characters) in quotes and specify its placement, typography and number of appearances. Do not translate visible copy or invent slogans, captions or labels. Respect a no-text request. For diagrams, keep supplied labels, relationships and facts accurate; do not invent data.

${buildSunburstReferenceContract(references, false, prompt) || 'No image inputs are attached. Never invent numbered image references.'}
A draft can supply a concept without requiring a literal edit. A general reference is not automatically a style, layout and subject reference all at once: use only its requested role. Identity photos preserve a person's face, not a requirement to copy their background or include them in every idea. Keep explicitly requested clothes or styling; do not automatically change outfits. Do not add other people just because their photos are attached.`}

REFERENCES
Read the input numbers in their supplied order; use the stable reference labels below in the returned prompt. Carry the SAME SINGLE person grouping and stable identity labels into each relevant prompt. Reference-photo count is not the cast size. Never blend identities or infer a person's position from their group number. Use the provided @ labels for identities and references; preserve exact quoted visible text literally.
${buildEditableReferenceGuidance(references)}

OUTPUT SETTINGS
Canvas: ${canvas || 'automatic'}. This is composition context only; size and quality are supplied separately by the app. Do not repeat pixel dimensions, resolution, aspect-ratio commands, model names, file formats, quality levels or API assignments in returned prompts. Preserve dimensions when they are exact visible copy requested by the user. Do not claim to change application settings.

FINAL CHECK
Check every prompt against the original brief and additional direction: same subject and facts, correct people/count/identity grouping, correct input numbers, requested medium, exact text, exclusions and edit boundaries. Resolve conflicting instructions and remove near-duplicate new-scene ideas without changing locked details. Each string describes one complete output, not a contact sheet or a list of alternatives; use multiple panels only when the brief requests them. Do not mention other ideas or rely on their context.
${settings.imageModel === SUNBURST_MODEL ? 'ASSEMBLY CONTRACT\nThe app attaches the original brief and additional direction once with priority over conflicting scene details. Return the useful scene-specific execution, including concrete medium cues, without copying full source paragraphs, reference-photo lists, identity rules, section headers or API settings. Refer to exact supplied copy as "the requested text" and describe its placement; the app preserves the wording.' : ''}
Return only a valid JSON array of exactly ${count} nonempty strings, one ready-to-use image prompt per string. No commentary or idea titles outside the array.`;
};

/** One text call produces scene directions; source requirements and reference
 * bindings are assembled once by the app, not re-authored in every scene. */
const buildCompactSunburstBrainstormGuidance = (
  references: ReferenceImage[], settings: ImagePromptSettings, category: BrainstormCategory, count: number, prompt: string,
): string => {
  const edit = getSunburstEditIntent(prompt, references, settings);
  const banner = isYouTubeChannelBannerPrompt(prompt);
  const thumbnail = !banner && (category === 'youtube_thumbnail' || isYouTubeThumbnailPrompt(prompt, references, settings));
  const wardrobe = thumbnail && !edit && getPersonGroups(references).length;
  return [
    `Prepare ${count} distinct image directions for GPT Image 2.5 Sunburst.`,
    SUNBURST_PROMPT_GUIDE,
    edit ? `${buildSunburstEditContract(references, edit)}\nVary only the requested local change. Keep an already precise edit concise; preserve unrequested details and finish with "Do not change anything else."`
      : `${banner ? CHANNEL_BANNER_DIRECTION : CATEGORY_DIRECTION[category]} Keep the same intended use, subject, facts, people, quantities, medium, exact copy and exclusions. Vary the visual hook, layout, framing or interaction only where the brief leaves room. Do not turn a logo, diagram or product brief into a thumbnail. Each idea is one complete output; no alternative contact sheets unless requested.`,
    !edit && thumbnail ? 'THUMBNAIL SCOPE\nAdvertise the whole video promise. Use supporting moments as evidence, not as a different headline or dominant topic. Preserve participant roles, units and uncertainty; do not invent events, outcomes or cast from a published cover. Use a clear focal hierarchy and scene-appropriate actions and expressions, with every person looking into the camera. When unspecified, choose a short Turkish headline or no text; an exact-copy or no-text request wins.' : '',
    buildYouTubeCameraGazeRule(prompt, references, settings, thumbnail),
    wardrobe ? 'For depicted reference people, choose specific new scene-appropriate outfits, not copied, recolored or swapped reference clothes; preserve likeness and requested hair or facial hair. This wardrobe requirement takes precedence over copied clothing instructions. Preserve explicitly requested new garments/colors/materials or an intentional uniform/costume. Give different concepts different allowed garment combinations; a previous concept outfit is not the default for all ideas.' : '',
    compactReferenceRoles(references, true, edit ? '' : identityMediumRule(prompt)) || 'No images are attached; do not invent reference labels.',
    buildYouTubeStyleReferenceRule(prompt, references, settings, thumbnail),
    'Use the supplied stable @ labels for people and images. Keep quoted visible copy literal. Never infer cast size or screen positions from reference numbers.',
    `Composition context: canvas ${getOpenAIImageSize(settings)}, background ${getOpenAIImageOptions(settings.openaiImageOptions).background}. These settings are supplied separately to the image model.`,
    'ASSEMBLY CONTRACT\nThe app will attach the original brief and additional creative direction once, unchanged, with priority over conflicting scene details. Return only the useful scene-specific execution to add to those requirements. Do not restate the initial idea, copy full source paragraphs, reference-photo lists, generic identity rules or this guide. Refer to supplied exact wording as "the requested text" and describe its placement rather than quoting it again. New thumbnail wording may be quoted when none was supplied. Add no section headers, API settings, research links, timestamps or quality boilerplate.',
    `Before returning, check that every direction fits the same brief and that new-scene ideas are meaningfully different without changing locked details. Return only a valid JSON array of exactly ${count} nonempty strings. No commentary or extra model calls.`,
  ].filter(Boolean).join('\n\n');
};

/** Adapted for this app from the GPT Image 2.5 guide, reviewed 2026-09-11:
 * https://developers.openai.com/api/docs/guides/image-prompting
 * https://developers.openai.com/api/docs/guides/image-generation
 */
export const buildSunburstGuidance = (
  task: 'enhance' | 'brainstorm' | 'variation',
  references: ReferenceImage[],
  settings: ImagePromptSettings,
  category: BrainstormCategory | undefined = undefined,
  count = 5,
  prompt = '',
): string => {
  category ??= isYouTubeThumbnailPrompt(prompt, references, settings) ? 'youtube_thumbnail'
    : settings.imagePromptCategory === 'youtube_thumbnail' ? 'simple' : settings.imagePromptCategory || 'simple';
  // Simple has its own brief-led policy for medium, style and reference roles.
  // Selecting Sunburst must not bypass it through the generic compact template.
  if (task === 'brainstorm' && category === 'simple') return buildSimpleBrainstormGuidance(references, settings, count, prompt);
  if (task === 'brainstorm' && settings.imageModel === SUNBURST_MODEL) return buildCompactSunburstBrainstormGuidance(references, settings, category, count, prompt);
  const inputs = getSunburstReferences(references);
  const target = getImagePromptTargetName(settings);
  const options = getOpenAIImageOptions(settings.openaiImageOptions);
  const size = settings.imageModel === 'gpt-image-2.5-sunburst' ? getOpenAIImageSize(settings) : settings.aspectRatio;
  const edit = getSunburstEditIntent(prompt, references, settings);
  if (edit) return `Prepare ${task === 'brainstorm' ? `${count} local-edit prompts` : 'one local-edit prompt'} for ${target}.

${buildSunburstEditContract(references, edit)}

Clarify only the requested changes with the minimum useful additions. ${task === 'enhance' ? 'Do not invent alternative changes.' : 'Vary only the requested edit, keeping the rest of the source fixed; do not propose new scenes, framing or visual styles.'}
Write a short, directly usable edit instruction: identify the source image, describe the requested change, name the important unaffected details, and finish with "Do not change anything else." Keep an already precise request concise. Do not write a production brief, scene inventory, section headings or a separate constraints section. Do not add global quality, lighting, color-grading or sharpening instructions. Do not automatically change outfits.
For a local correction, explicitly retain the existing camera angle, saturation and contrast, plus nearby objects, arrows or labels relevant to that correction. A replacement must fit the source lighting and perspective. Treat the current input as the approved version; do not rebuild earlier edits or introduce another change to improve it.
Keep exact wording (including Turkish characters), requested positions and expressions. For identity replacement, carry the SAME SINGLE person grouping and stable person label into the prompt. Keep the source person's body, clothing, scale and placement unless the request changes them. Do not infer other edits from the reference photos.
${buildEditableReferenceGuidance(references)}
Use the provided stable @ labels in the returned prompt; quoted visible copy stays literal. Do not regroup or renumber images by person.

OUTPUT SETTINGS (already sent separately by the app)
Canvas: ${size === 'auto' ? 'automatic' : size}. This is composition context only. Preserve source framing. Do not repeat pixel dimensions, size-priority instructions, model names, quality levels, file formats or other API assignments in the returned prompt. Preserve dimensions only when they are literal visible text requested by the user.

RETURN FORMAT
${task === 'brainstorm' ? `Return only a valid JSON array of exactly ${count} nonempty strings, one local-edit prompt per string.` : 'Return only the finished prompt, without commentary or code fences.'}`;
  const banner = isYouTubeChannelBannerPrompt(prompt);
  const youtube = category === 'youtube_thumbnail' && !banner;
  const cameraGaze = buildYouTubeCameraGazeRule(prompt, references, settings,
    task === 'brainstorm' ? youtube || isYouTubeThumbnailPrompt(prompt, references, settings) : hasYouTubeCameraGaze(prompt));
  const episodeEditorial = buildYouTubeEditorialRule(prompt, references, settings);
  const wardrobe = youtube ? buildYouTubePersonWardrobe(inputs) : buildYouTubeWardrobeRule(prompt, inputs, { imagePromptCategory: category });
  return `Prepare ${task === 'brainstorm' ? `${count} image ideas` : 'one image prompt'} for ${target}.

USER INTENT
${task === 'variation' ? 'Create one distinct execution of the same concept. Preserve the episode facts, identities, roles, exact copy and output canvas. Vary the hook staging, framing or visual hierarchy without inventing a different premise.' : task === 'enhance'
    ? 'Clarify the existing request with the minimum useful additions. Keep an already precise request concise. Keep reference-based generation as a new complete image; do not rewrite it as a source-preserving local edit.'
    : `${banner ? CHANNEL_BANNER_DIRECTION : CATEGORY_DIRECTION[category]} Each idea must be independently usable, with a different execution inside the allowed creative scope.`}
Keep the requested medium, exact wording (including Turkish characters), quantities, and explicit exclusions. Do not translate visible text. ${youtube ? 'Follow the thumbnail text rules below for unspecified copy.' : 'Do not invent slogans.'} Preserve requested text in quotes with its placement, typography and intended number of appearances; avoid extra text. ${wardrobe ? 'Replace identity-reference outfits with specific new clothing as required below.' : 'Do not automatically change outfits.'}
${task === 'enhance' ? 'Do not invent mood, people, props, logos or scenery beyond what the request calls for.' : 'For new-scene ideas, vary setting, visual treatment, framing and staging where the brief leaves them open. Keep specified subjects and constraints fixed.'}

PROMPT FORM
Use plain language and scale detail to the request, with no word-count target or mandatory template. Start with the intended image and subject. Add useful framing, relative scale, gaze, pose and interaction, then the visible materials, light, color and medium needed for the result. Prefer concrete appearance over quality buzzwords. Use headings only when complexity warrants them. Camera details are optional appearance cues, not guarantees of optical simulation. Explicitly request a photograph when that is the intended medium; retain natural texture without adding heavy retouching.
${youtube ? `\nYOUTUBE THUMBNAILS\n${YOUTUBE_THUMBNAIL_DIRECTION}\n${episodeEditorial}\nMake each thumbnail prompt independently usable. Include the visual hook, composition, relevant identity grouping and episode facts, with text placement or the user's no-text requirement. Add lighting and color details only where they explain the intended appearance. Keep supplied facts distinguishable from invented staging without forcing a separate "Episode facts" section. A precise short request can stay short; do not expand it into a long production brief. Different concepts are separate images, not a collage of alternative thumbnails.
${task === 'brainstorm' ? 'Across the set, change the visual idea as well as the layout. For five or more ideas, use at least three distinct composition families, such as a dominant symbolic object, a camera-facing interaction, an asymmetrical reaction portrait, or a clean graphic comparison when the premise supports it. Avoid five versions of two faces flanking the same background lineup. Vary each person\'s action, expression, head tilt and body pose while every person keeps direct eye contact with the camera and their identity stays fixed.' : ''}
${inputs.some(ref => ref.isVideoContext) ? 'PUBLISHED VIDEO: The episode summary and moments supply the facts; the original cover supplies context only. Create alternative thumbnail concepts for this same episode, not cosmetic edits of the existing cover. Preserve supported participants, roles, prices, units, challenge rules and uncertainty. Separate a creative visual metaphor or staged reaction from claims about real events: do not invent an injury, winner, result, quote, scandal or event absent from the evidence. Do not mistake a price for earnings or taking part in an activity for merely observing it. Keep every selected cast identity explicitly requested by the brief, regardless of which people appeared on the old cover. Reference-photo count is not cast size; episode names must not override the selected reference faces. An evidenced comparison may repeat the SAME selected person without creating additional cast members. Use the episode language for unspecified short thumbnail copy unless the user asks otherwise. Source links, timestamps and analysis instructions are research metadata; do not copy them into returned image prompts.' : ''}
Before returning, check each production brief against the user brief for identity grouping, participant roles/counts, exact Turkish copy, selected canvas, invented mechanics and accidental winner clues. Resolve contradictions and replace near-duplicate concepts before returning only the requested output.` : ''}

${!youtube ? episodeEditorial : ''}
${cameraGaze}
REFERENCE USE
${buildYouTubeStyleReferenceRule(prompt, references, settings, youtube || isYouTubeThumbnailPrompt(prompt, references, settings))}
${buildSunburstReferenceContract(references, !!wardrobe, prompt) || 'No image inputs are attached. Never invent numbered image references.'}
Use image numbers to understand the inputs; use stable labels in the returned editable prompt as specified below. Role labels describe inputs, not permission to copy every element. User instructions override inferred roles. Do not regroup or renumber images by person.
Carry the SAME SINGLE person grouping into every returned prompt. Never shorten several identity photos to a list that could be read as several people (for example, "the man from image 1, image 2 and image 3").
${buildEditableReferenceGuidance(references)}
No Edit area is selected in this branch. Describe the requested complete result using each reference for its assigned role. Do not infer an edit mode from the wording, add a SOURCE image to edit, or append "Do not change anything else" unless that is an explicit constraint in the user's own brief. A similar-scene request needs a new scene, not a retouch of the attachment.
${wardrobe ? `\n${wardrobe}\nBefore returning each prompt, verify that every depicted identity group keeps its face but none of the reference outfits. State the new clothing explicitly instead of leaving the image model to choose the reference outfit.` : ''}

OUTPUT SETTINGS (already sent separately by the app)
Canvas: ${size === 'auto' ? 'automatic; do not invent a fixed ratio' : size}.
Background: ${options.background}.
This is composition context only. Do not repeat pixel dimensions, size-priority instructions, model names, quality levels, file formats, compression or other API assignments in the returned prompt. Do not add a default aspect ratio or copy old resolution instructions into the prompt. Preserve quoted visible text exactly even when it contains dimensions. Do not claim you changed the app settings.
${options.background === 'transparent' ? 'For a transparent asset, describe an isolated subject with clean edges; do not invent a solid backdrop or checkerboard.' : options.background === 'opaque' ? 'Do not introduce transparency unless the user explicitly requests it.' : 'Do not introduce a transparent background unless the user requests one.'}

RETURN FORMAT
${task !== 'brainstorm' ? 'Return only the finished prompt, without commentary or code fences.' : `Return only a valid JSON array of exactly ${count} nonempty strings, one complete image prompt per string. Do not include analysis or idea titles outside the array.`}`;
};
