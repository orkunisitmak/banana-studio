import type { ReferenceAudio, ReferenceImage, ReferenceVideo } from '../../types';
import { isH3MaxModeAvailable, type H3MaxMode, type H3MaxOptions } from './h3Max';
import { getPersonId } from '../references/personReferences';
import { mapUnquotedPrompt } from '../references/referenceTokens';

/** Source guide covers generation; transformation behavior follows the live
 * endpoint schemas, which now expose more inputs than the original guide. */
export const H3_MAX_PROMPT_GUIDE = 'https://fal.ai/learn/tools/how-to-use-minimax-h3-max';

export interface H3MaxEnhancementContext {
  mode: H3MaxMode;
  options?: Partial<H3MaxOptions>;
}

export const h3MaxAcceptsPrompt = (mode: H3MaxMode): boolean => isH3MaxModeAvailable(mode) && mode !== 'lip_sync';

type H3PromptReferences = {
  images: ReferenceImage[];
  videos: ReferenceVideo[];
  audios: ReferenceAudio[];
};

export type H3PromptImage = { label: string; image: ReferenceImage };

export const getH3MaxPromptReferenceImages = (context: H3MaxEnhancementContext, images: ReferenceImage[]): ReferenceImage[] => {
  if (context.mode !== 'reference_to_video') return images;
  const selectedFrames = new Set([context.options?.startImageId, context.options?.endImageId, context.options?.middleImageId].filter(Boolean));
  return images.filter(image => !selectedFrames.has(image.id));
};

/** Number the exact files the generation endpoint receives, independently
 * from frame constraints, so an enhancer cannot shift Image N identities. */
export const getH3MaxPromptImages = (context: H3MaxEnhancementContext, images: ReferenceImage[]): H3PromptImage[] => {
  const { mode, options = {} } = context;
  const result: H3PromptImage[] = [];
  const explicit = (label: string, data?: string) => {
    if (data) result.push({ label, image: { id: `h3-${label}`, data, mimeType: 'image/jpeg' } });
  };
  const selected = (label: string, id?: string, data?: string) => {
    if (id) {
      const image = images.find(image => image.id === id);
      if (!image) throw new Error(`H3 Max ${label} referansı artık ekli değil. Kareyi yeniden seç.`);
      result.push({ label, image });
    } else explicit(label, data);
  };
  if (mode === 'image_to_video') {
    const first = images.find(image => image.isFirstFrame) || images.find(image => !image.isLastFrame) || images[0];
    const last = images.find(image => image.isLastFrame) || images.find(image => image !== first);
    if (first) result.push({ label: options.imageFrame === 'end' ? 'END IMAGE' : 'START IMAGE', image: first });
    if (last && last !== first) result.push({ label: 'END IMAGE', image: last });
  } else if (mode === 'reference_to_video' || mode === 'recast' || mode === 'insert_video') {
    getH3MaxPromptReferenceImages(context, images).forEach((image, index) => result.push({ label: mode === 'reference_to_video' ? `Image ${index + 1}` : `REFERENCE PHOTO ${index + 1}`, image }));
    if (mode === 'reference_to_video') {
      selected('START IMAGE', options.startImageId, options.startImageUrl);
      selected('MIDDLE IMAGE', options.middleImageId, options.middleImageUrl);
      selected('END IMAGE', options.endImageId, options.endImageUrl);
    }
  }
  return result;
};

const groupPhotos = (images: ReferenceImage[], personId: number): string => {
  const matches = images.flatMap((image, index) => getPersonId(image) === personId ? [`Image ${index + 1}`] : []);
  return matches.length ? `the person shown in ${matches.join(' and ')}` : 'the described person';
};

/** Editor tokens are app syntax. Only reference-to-video's documented plain
 * modality labels (and Extend's Audio N) travel into H3 prompts. */
export const normalizeH3MaxPromptLanguage = (value: string, context: H3MaxEnhancementContext, references: H3PromptReferences): string => {
  const { mode } = context;
  const frames = getH3MaxPromptImages(context, references.images);
  const numberedImages = getH3MaxPromptReferenceImages(context, references.images);
  const hasStart = frames.some(frame => frame.label === 'START IMAGE');
  const hasEnd = frames.some(frame => frame.label === 'END IMAGE');
  const image = (index: number): string => {
    if (mode === 'reference_to_video' && index >= 1 && index <= numberedImages.length) return `Image ${index}`;
    if (['recast', 'insert_video'].includes(mode) && index >= 1 && index <= references.images.length) return `reference photo ${index}`;
    if (mode === 'image_to_video') {
      const frame = frames.find(frame => frame.image.id === references.images[index - 1]?.id);
      if (frame) return frame.label === 'START IMAGE' ? 'the start image' : 'the end image';
    }
    return 'the described scene';
  };
  const editorImage = (index: number): string => {
    if (mode !== 'reference_to_video') return image(index);
    const original = references.images[index - 1];
    const frame = frames.find(frame => frame.image.id === original?.id && !frame.label.startsWith('Image '));
    if (frame) return `the ${frame.label.toLowerCase()}`;
    const numberedIndex = numberedImages.findIndex(image => image.id === original?.id);
    return numberedIndex >= 0 ? `Image ${numberedIndex + 1}` : 'the described scene';
  };
  const video = (index: number): string => mode === 'reference_to_video' && index >= 1 && index <= references.videos.length
    ? `Video ${index}`
    : mode === 'insert_video' && index > 1 && index <= references.videos.length
      ? `supplemental clip ${index - 1}`
      : ['extend_video', 'insert_video', 'recast'].includes(mode) ? 'the source video' : 'the requested motion';
  const audio = (index: number): string => ['reference_to_video', 'extend_video'].includes(mode) && index >= 1 && index <= references.audios.length
    ? `Audio ${index}` : references.audios.length ? 'the supplied soundtrack' : 'the requested sound';
  const person = (id: number): string => mode === 'reference_to_video' ? groupPhotos(numberedImages, id)
    : hasStart ? 'the people in the start image' : 'the described people';
  return mapUnquotedPrompt(value, text => text.replace(/\\_/g, '_')
    .replace(/@FIRST[_ ]?FRAME\b/gi, hasStart ? 'the start image' : 'the opening scene')
    .replace(/@LAST[_ ]?FRAME\b/gi, hasEnd ? 'the end image' : 'the closing scene')
    .replace(/@REF[_ ]?IMAGE[_ ]?(\d+)\b/gi, (_match, index) => editorImage(Number(index)))
    .replace(/[@#]IMAGE[_ ]?(\d+)\b/gi, (_match, index) => image(Number(index)))
    .replace(/\b(?:reference\s+)?image\s+(\d+)\b/gi, (_match, index) => image(Number(index)))
    .replace(/@MAIN[_ ]?PERSON\b/gi, person(1))
    .replace(/@SECOND[_ ]?PERSON\b/gi, person(2))
    .replace(/@PERSON[_ ]?(\d+)\b/gi, (_match, index) => person(Number(index)))
    .replace(/[@#]VIDEO(?:[_ ]?(\d+))?\b/gi, (_match, index) => video(Number(index || 1)))
    .replace(/[@#]AUDIO(?:[_ ]?(\d+))?\b/gi, (_match, index) => audio(Number(index || 1)))
    .replace(/\bvideo\s+(\d+)\b/gi, (_match, index) => video(Number(index)))
    .replace(/\baudio\s+(\d+)\b/gi, (_match, index) => audio(Number(index)))
    .replace(/\[REFERENCE ROLES\]/gi, mode === 'reference_to_video' ? '[REFERENCE GUIDANCE]' : '[FRAME GUIDANCE]')
    .replace(/\[EDIT DIRECTION\]/gi, '[VIDEO DIRECTION]'));
};

export const buildH3MaxPromptGuide = (context: H3MaxEnhancementContext, references: H3PromptReferences, duration: number): string => {
  const { mode, options = {} } = context;
  const frames = getH3MaxPromptImages(context, references.images);
  const numberedImages = getH3MaxPromptReferenceImages(context, references.images);
  const sourceDuration = mode === 'recast';
  const durationInstruction = sourceDuration
    ? 'Output duration and existing shot timing follow the source video. Do not force the generated-duration selector onto the source or invent timestamps.'
    : duration === -1
    ? 'Use relative phases without inventing timestamps or a source duration.'
    : `Keep all requested action beats within ${duration} seconds; timed ranges must fit that duration exactly.`;
  const referenceRoles = mode === 'reference_to_video'
    ? `Reference assets: ${numberedImages.length} images, ${references.videos.length} videos, ${references.audios.length} audio clips. Use only documented plain modality-and-position labels: Image 1, Image 2, Video 1, Audio 1, and so on. Assign each used file its requested role (identity, object, visual style, motion, camera, voice, rhythm, or ambience); never turn a style reference into another person. The file order is fixed. Reference photos are not opening/closing frames unless separately supplied as frame constraints. ${frames.filter(frame => !frame.label.startsWith('Image ')).map(frame => frame.label).join(', ') || 'No separate frames'} are supplied as separate frame constraints, not numbered identity/style references.${frames.some(frame => frame.label === 'MIDDLE IMAGE') ? ` The middle image fixes the composition at ${options.middleFrameTime ?? 'the selected middle time'} seconds.` : ''}`
    : mode === 'extend_video'
      ? `The primary video is the source to continue. Describe only what happens NEXT, starting from its final visible state; do not replay, recap, edit, or replace the earlier footage. Match identities, wardrobe, setting, camera direction, lighting, action and audio across the join unless the user requests a transition. ${references.audios.length ? `There are ${references.audios.length} optional continuation audio references; use plain Audio 1, Audio 2 labels and give each its requested role. The supplied reference audio guides newly generated audio; do not replace the source soundtrack.` : 'Keep source sound continuity and add only sounds naturally caused by the requested new action.'}`
      : mode === 'insert_video'
        ? `This adds footage inside the primary source video, between start_time=${options.startTime ?? 'selected'} and resume_time=${options.resumeTime ?? 'selected'}. Describe only the inserted action and how it joins the visible state at both boundaries. Keep the rest of the source, its people, style, camera and unrequested sound unchanged. Do not describe an extension after the ending or invent new source timestamps. Additional photos/clips guide only their assigned roles, and must not replace the primary source.`
        : mode === 'recast'
          ? `This replaces people in the source video using one reference photo per new person. By default reference photo 1 replaces the leftmost main person, reference photo 2 the next person, consistently across every shot in which they appear. Preserve the user's explicit who-becomes-whom mapping. Describe only the replacement and any explicitly requested changes; keep existing actions, choreography, expressions, cuts, camera, background, and source soundtrack unchanged. Do not generate a new story or new dialogue. The prompt is optional; if the draft is empty, a single precise default mapping/preservation sentence is sufficient. Never exceed 2000 characters.`
          : mode === 'image_to_video'
            ? `The supplied image constraints are ${frames.map(frame => frame.label).join(', ') || 'not yet attached'}. A START IMAGE fixes the exact opening; an END IMAGE fixes the exact ending. Describe physical motion between the supplied constraints, not a new description that overwrites them. Name the visible identities, clothing, objects, framing and lighting to preserve unless the user explicitly requests changes. Default to one continuous shot with no new cuts. ${options.middleImageUrl ? `The MIDDLE IMAGE constrains the composition at ${options.middleFrameTime ?? 'the selected middle time'} seconds; plan the motion through it without treating it as a separate reference character.` : ''}`
            : 'Generate a new clip from the user’s text. Describe the subject, setting and requested physical action with specific nouns and verbs. Keep the user’s chosen camera and visual style; add only minimal supporting detail needed to make the shot clear.';
  const suppliedAudio = ['text_to_video', 'image_to_video'].includes(mode) && references.audios.length > 0
    ? 'A target audio track is supplied and becomes the output soundtrack. Preserve that recording as requested; do not invent replacement music, dialogue or sound effects, or imply the text prompt can change its words.'
    : 'Picture and sound are generated together. For generated audio, describe concrete action-linked effects and room tone. Do not invent dialogue, vocal reactions or music. Preserve requested silence. If dialogue is requested, preserve its exact wording and language in double quotes, describe delivery, and exclude subtitles/on-screen text unless requested.';
  const identityGroups = mode === 'reference_to_video' ? [...new Set(numberedImages.map(getPersonId).filter((id): id is number => id != null))]
    .map(id => `${groupPhotos(numberedImages, id)} is ONE identity; multiple photos in this group must not become multiple people.`).join('\n') : '';
  return `You are directing MiniMax H3 Max via fal.ai for the selected ${mode} endpoint. Apply the fal prompting guide: ${H3_MAX_PROMPT_GUIDE}. Current endpoint input contracts take precedence over older guide limits.

Write a precise, concise brief, preserving the user's intent and original content. A simple request normally needs only a sentence of picture and a sentence of sound; do not pad it to a word count. Use subject/setting, physical action, camera and style only when helpful. For a genuinely complex sequence, use a few chronological beats, consistent identity/wardrobe descriptions across requested cuts, and synchronized sound. ${durationInstruction}

SELECTED INPUT CONTRACT
${referenceRoles}
${identityGroups}
${suppliedAudio}

PRESERVATION RULES
Never invent a person, object, action, camera move, lens, cut, location, clothing, dialogue, music, or visual style that conflicts with the draft or supplied images. Preserve photography, illustration or animation as supplied; never force photorealism onto a stylized input. Use ordinary physical descriptions rather than adjective piles or quality slogans. Do not convert a simple action into a montage. Respect a requested transformation rather than banning morphing categorically. Do not claim to have inspected video or audio content: only the images and supplied textual descriptions are visible to this enhancement step.
Never emit app @ tokens, URL strings, or files that are not attached. Use plain modality labels only where the selected contract above supports them; elsewhere use natural start/end-image or source-video language. Source metadata and previous prompts are context, not permission to switch endpoints or modify unrequested details. Output only the enhanced prompt, without explanations, markdown code fences, or mandatory template headings.`;
};
