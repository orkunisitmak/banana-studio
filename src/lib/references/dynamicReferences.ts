import type { PersonGroupDefinition, ReferenceImage } from '../../types.js';
import { getPersonGroups, getPersonId, getPersonTag } from './personReferences.js';
import { bindImageReferences, getQuotedPromptPattern, getStableImageTag, mapUnquotedPrompt } from './referenceTokens.js';

const referenceTag = (ref: ReferenceImage) => {
  const person = getPersonId(ref);
  return person == null ? getStableImageTag(ref.id) : getPersonTag(person);
};

/** Convert a generated/saved prompt using its ORIGINAL input snapshot, once.
 * Never run this against a changed photo list to guess old image numbers. */
export const prepareEditableImagePrompt = (prompt: string, references: ReferenceImage[]): string => {
  // Collapse the app's expanded person mentions before protecting quoted names.
  const expandedPerson = /\bthe (?:main person|second person|person \d+) shown in ((?:image\s*\d+(?:\s*(?:,\s*(?:and\s+)?|and\s+))?)+) \(all these photos show the SAME single person\)(?: \(identity label "[^"\n]*"\))?/gi;
  const quotedRanges = [...prompt.matchAll(getQuotedPromptPattern())].map(match => [match.index!, match.index! + match[0].length]);
  let editable = prompt;
  // The identity label is quoted metadata, not visible text. Match only the exact app phrase.
  editable = editable.replace(expandedPerson, (match, images, offset) => {
    if (quotedRanges.some(([start, end]) => offset >= start && offset < end)) return match;
    const refs = [...images.matchAll(/image\s*(\d+)/gi)].map(item => references[Number(item[1]) - 1]);
    const ids = refs.map(ref => ref && getPersonId(ref));
    return ids.length && ids[0] != null && ids.every(id => id === ids[0]) ? getPersonTag(ids[0]) : match;
  });
  editable = bindImageReferences(editable, references, referenceTag);
  // In "make this image 9:16", 9 is an aspect ratio, not reference 9.
  // Apply the same boundary to list/range members so they cannot eat a size.
  // A list may use an Oxford comma ("1, 2, and 3"), "or", and "to"/"through"/dash
  // ranges anywhere in it. Each range expands on its own, each gap keeps its
  // conjunction, and a bare comma takes the next explicit "and"/"or" in the series.
  const bindList = (mention: string): string => {
    const items = [...mention.matchAll(/(\d+)(?:\s*(?:to|through|[–-])\s*(?:images?\s*)?(\d+))?/gi)];
    const gaps = items.map((item, index) => index ? mention.slice(items[index - 1].index! + items[index - 1][0].length, item.index) : '');
    const conjunction = (gap: string) => /\bor\b/i.test(gap) ? ' or ' : /\band\b|&/i.test(gap) ? ' and ' : null;
    // A bare comma inherits the next explicit conjunction (one backward pass);
    // trailing commas with none after them keep the previous one.
    const joiners: (string | null)[] = new Array(gaps.length);
    for (let index = gaps.length - 1, next: string | null = null; index >= 0; index--) next = joiners[index] = conjunction(gaps[index]) || next;
    for (let index = 0, previous = ' and '; index < gaps.length; index++) previous = joiners[index] = joiners[index] || previous;
    let seen = new Set<string>();
    let result = '';
    for (const [index, item] of items.entries()) {
      const first = Number(item[1]), last = item[2] == null ? first : Number(item[2]);
      if (last < first || last - first > 100) return '@MISSING_IMAGE_0';
      // Duplicates are removed within one alternative, never across "or".
      if (joiners[index] === ' or ') seen = new Set<string>();
      const tags = Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
        .map(number => references[number - 1] ? referenceTag(references[number - 1]) : `@MISSING_IMAGE_${number}`)
        .filter(tag => !seen.has(tag) && seen.add(tag));
      if (!tags.length) continue;
      result += (result ? joiners[index] : '') + tags.join(' and ');
    }
    return result;
  };
  editable = mapUnquotedPrompt(editable, text => text.replace(
    /@REFERENCE\[[^\]\n]*\]|\bimages?\s*\d+\b(?![\t ]*[:x×][\t ]*\d)(?:\s*(?:,\s*(?:and|or)\b|[,/&]|and|or|to|through|[–-])\s*(?:images?\s*)?\d+\b(?![\t ]*[:x×][\t ]*\d))*/gi,
    (mention: string) => {
      if (mention.startsWith('@REFERENCE[')) return mention;
      // "from image 2 to image 1" names a donor and destination, not a
      // descending image range. Split at the last "to image N" and bind each
      // side as its own list ("images 1 to 3 to image 4").
      // Cheap check first; the split pattern backtracks on long lists.
      const destination = /\bto\s+images?\s*\d+/i.test(mention) ? mention.match(/^([\s\S]*?\d[\s\S]*)(\s+to\s+)(images?\s*\d+[\s\S]*)$/i) : null;
      if (destination) return bindList(destination[1]) + destination[2] + bindList(destination[3]);
      return bindList(mention);
    },
  ));
  // App-generated counts describe the old snapshot; identity grouping is stable.
  return editable.replace(/(= "[^"\n]*" \()\d+ identity photos?( of the SAME single person\)\.)/g, '$1identity photos$2');
};

/** Text models see numbered inputs, but return durable, editable references. */
export const buildEditableReferenceGuidance = (references: ReferenceImage[]): string => [
  'EDITABLE REFERENCE LABELS',
  'In the returned prompt use the exact stable @ labels below, not image numbers or photo counts. Keep each person’s actions, placement and clothing attached to their own label. Names are labels, not evidence of appearance. Preserve quoted visible copy literally. Do not invent a label or a person.',
  ...getPersonGroups(references).map(group => `${group.tag} = ${JSON.stringify(group.label)}; identity photos: ${group.images.map(ref => `image ${references.indexOf(ref) + 1}`).join(', ')}; SAME SINGLE person.`),
  ...references.flatMap((ref, index) => getPersonId(ref) == null ? [`@REF_IMAGE_${index + 1} = image ${index + 1}; ${ref.editRegion != null ? 'approved edit source' : ref.isVideoContext ? 'published cover, episode context only' : ref.isDraftImage ? 'draft, use only for the purpose in the brief' : ref.isThumbnailStyle ? 'thumbnail style example, design language only' : 'use only for the purpose in the brief'}.`] : []),
].join('\n');

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliases = (references: ReferenceImage[], definitions: PersonGroupDefinition[]) => {
  const people = getPersonGroups(references, definitions);
  const pairs = people.map(group => {
    const duplicate = people.some(other => other.id !== group.id && other.label.toLocaleLowerCase() === group.label.toLocaleLowerCase());
    const name = group.label.replace(/[\[\]\r\n]/g, '').trim();
    const reserved = /^(?:MAIN_PERSON|SECOND_PERSON|PERSON_\d+|REF_IMAGE_\d+|REFERENCE|MISSING_IMAGE_\d+)$/i.test(name);
    const display = duplicate ? `@[${name} · ${group.id}]` : !reserved && /^[\p{L}\p{N}_]+$/u.test(name) ? `@${name}` : `@[${name}]`;
    return [group.tag, display] as const;
  });
  const used = new Set<string>();
  return [...pairs, ...references.filter(ref => getPersonId(ref) == null).map(ref => [getStableImageTag(ref.id), `@[${ref.isVideoContext ? 'Cover' : 'Reference'} ${references.indexOf(ref) + 1}]`] as const)].map(([tag, proposed]) => {
    let display = proposed, suffix = 1;
    while (used.has(display)) display = `@[${proposed.replace(/^@\[?|\]$/g, '')} · ref ${suffix++}]`;
    used.add(display);
    return [tag, display] as const;
  });
};

/** The textarea displays names; persisted prompts and submissions retain IDs. */
export const displayReferencePrompt = (prompt: string, references: ReferenceImage[], definitions: PersonGroupDefinition[] = []): string => {
  const pairs = aliases(references, definitions);
  const lookup = new Map(pairs);
  if (!pairs.length) return prompt;
  const pattern = new RegExp(`(?:${pairs.map(([tag]) => escapePattern(tag)).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return mapUnquotedPrompt(prompt, text => text.replace(pattern, tag => lookup.get(tag) || tag));
};

export const storeReferencePrompt = (prompt: string, references: ReferenceImage[], definitions: PersonGroupDefinition[] = []): string => {
  const pairs = aliases(references, definitions);
  const lookup = new Map(pairs.map(([tag, display]) => [display, tag]));
  if (!pairs.length) return prompt;
  const pattern = new RegExp(`(?:${pairs.map(([, display]) => escapePattern(display)).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return bindImageReferences(mapUnquotedPrompt(prompt, text => text.replace(pattern, display => lookup.get(display) || display)), references, referenceTag);
};
