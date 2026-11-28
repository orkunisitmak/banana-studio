import type { ReferenceImage } from '../../types.js';
import { getPersonGroups, getPersonId } from '../references/personReferences.js';
import { getStableImageTag } from '../references/referenceTokens.js';

/** Reviewed against the GPT Image 2.5 guide. This curated policy is included in
 * every Sunburst Brainstorm request; it is not a per-generation web fetch. */
export const SUNBURST_GUIDE_VERSION = '2026-10-20';
export const SUNBURST_GUIDE_URL = 'https://developers.openai.com/api/docs/guides/image-prompting';
export const SUNBURST_PROMPT_GUIDE = `SUNBURST PROMPTING PRINCIPLES (${SUNBURST_GUIDE_VERSION})
Describe the intended result through its subject, useful composition, visible detail and requested medium. Use the simplest readable format that carries the requirements; no word-count target or mandatory template. Detail should change the image, not praise its quality. For people, give relevant framing, relative scale, gaze, pose and interaction. Treat camera terminology as optional appearance cues. Specify exact visible wording, placement and typography without extra copy. Assign each reference a clear purpose. In edits, distinguish the requested change from the details that must remain unchanged. Keep API settings outside the image prompt.`;

/** New-image rendering guidance, including when there are no reference inputs.
 * This is a prompt policy, not an output filter or a change to provider quality.
 * Local edits must retain the source's existing tone and texture instead. */
export const SUNBURST_RENDERING_RULE = `TONE AND TEXTURE
Follow the requested medium and lighting. For photographic or live-action scenes, render a naturally exposed camera image: smooth highlight roll-off, open shadow detail, restrained local contrast, and optical detail that softens with distance. Materials have ordinary, irregular texture rather than uniformly etched microdetail. Cinematic describes framing and lighting, not an HDR or clarity treatment. Explicit visual styles and deliberate contrast in the creative brief take priority.`;

/** Attachment presence never chooses editing. Only an approved area can do so. */
export const REFERENCE_GENERATION_RULE = `REFERENCE-BASED GENERATION
Create a new complete image from the creative brief. Attached images provide only the identity, subject, object, environment, style or layout explicitly requested; none is an approved canvas for a local edit. No Edit area was selected. Do not infer a local-edit or source-preservation task from an attachment, an old source label, or a change/remove verb.
For a similar or inspired scene, develop a distinct composition, viewpoint and arrangement within the brief's constraints; do not simply reproduce the reference with small changes or a contrast/sharpness pass. Match a reference's exact framing or layout only when the brief explicitly asks for that. Follow requested identities, exact visible text, quantities and exclusions; reference content does not override them. Do not copy people into an environment-only result.
Render the requested medium and visual treatment. Do not add sharpening halos, boosted contrast or saturation, HDR processing, beauty retouching or extra texture unless requested. This is a new full-image generation, not a filtered version of the reference.`;

export const buildReferenceGenerationRule = (references: ReferenceImage[]): string =>
  references.length && !references.some(ref => ref.editRegion != null || ref.editScope === 'image') ? REFERENCE_GENERATION_RULE : '';

/** Likeness must survive a change of medium, not prevent that change. Used for
 * new scenes; local edits keep the approved source-preservation contract. */
export const IDENTITY_MEDIUM_RULE = `MEDIUM AND IDENTITY
Identity photos establish who the character is, not the output medium. The requested medium applies to the entire character, including face, hair, body and clothes, as well as the environment, unless the brief explicitly requests mixed media or different treatments. For a requested illustration, cartoon or stylized 3D render, reinterpret the recognizable person in that medium with matching shapes, materials and shading; do not retain a photographic face on a stylized body unless requested. Preserve distinctive likeness without requiring photographic skin or hair texture. Follow explicitly requested clothing, pose and expression; the reference does not lock them.`;

export const CARTOON_3D_IDENTITY_RULE = `RENDERING REQUIREMENT — STYLIZED 3D CARTOON
Create a fully non-photorealistic 3D cartoon rendering of the referenced person and the entire scene. Rebuild the face as a sculpted animated-film character: simplified rounded facial planes, deliberately stylized proportions and larger expressive eyes; smooth clay or vinyl skin, grouped sculpted hair shapes, and simplified fabric forms. This explicitly requested rendering takes priority over generic instructions to preserve photographic facial proportions or natural anatomy; retain recognizable distinguishing traits and the requested expression through stylization. Every visible face, body, garment and surrounding object must share the 3D cartoon materials and shading. No live-action people, photographic faces or hair, photorealistic CGI, human photos with cartoon props, or beauty-retouched portraits. Follow the brief's people, counts, actions and clothing.`;

/** Stable labels make repeated mentions short without losing photo bindings.
 * Person groups are identities, never inferred cast or scene positions. */
export const compactReferenceRoles = (references: ReferenceImage[], editableLabels = true, mediumRule = IDENTITY_MEDIUM_RULE): string => {
  if (!references.length) return '';
  const groups = getPersonGroups(references);
  return [buildReferenceGenerationRule(references), 'REFERENCE ROLES',
    ...groups.map(group => `${group.tag} (${JSON.stringify(group.label)}): ${group.images.map(ref => `image ${references.indexOf(ref) + 1}`).join(', ')} show the SAME SINGLE person.`),
    ...references.flatMap((ref, index) => getPersonId(ref) != null ? [] : [
      `image ${index + 1}${editableLabels ? ` / ${getStableImageTag(ref.id)}` : ''}: ${ref.editRegion != null || ref.editScope === 'image' ? 'approved source to edit; preserve unrequested details' : ref.isVideoContext ? 'published cover for episode context only; no inferred cast or events' : ref.isDraftImage ? 'draft; use its layout only when requested' : ref.isThumbnailStyle ? 'THUMBNAIL STYLE EXAMPLE; design language only, not cast, copy or episode facts' : 'visual reference; use only its brief-assigned role'}.`,
    ]),
    groups.length ? `Use each identity only for its requested character; photo count is not cast size. Keep identities distinct. For new scenes, preserve likeness while following the directed expression and action; do not freeze the reference pose. ${references.some(ref => ref.editRegion != null) ? 'Explicit expression and edit-preservation requests take priority.' : 'Follow explicitly requested expressions, framing and clothing.'}` : '',
    groups.length ? mediumRule : '',
  ].filter(Boolean).join('\n');
};
