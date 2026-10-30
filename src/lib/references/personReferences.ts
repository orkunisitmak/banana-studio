import { bindImageReferences, getStableImageTag, mapUnquotedPrompt, resolveStableImageReferences } from './referenceTokens.js';
import type { GenerationConfig, PersonGroupDefinition, ReferenceImage, SavedPerson } from '../../types.js';

/** Stable identity numbers; legacy Me/2nd flags remain readable without a migration. */
export const getPersonId = (ref: ReferenceImage): number | undefined => {
  if (ref.isFirstFrame || ref.isLastFrame) return undefined;
  if (Number.isInteger(ref.personId) && ref.personId! > 0 && ref.personId! <= 9999) return ref.personId;
  return ref.isSubjectImage ? 1 : ref.isSecondPerson ? 2 : undefined;
};

export const cleanPersonName = (name: string): string => name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 40);
export const getPersonLabel = (id: number): string => id === 1 ? 'Me' : `Person ${id}`;
export const getPersonTag = (id: number): string => id === 1 ? '@MAIN_PERSON' : id === 2 ? '@SECOND_PERSON' : `@PERSON_${id}`;
export const getPersonDescription = (id: number): string => id === 1 ? 'main person' : id === 2 ? 'second person' : `person ${id}`;

export const getPersonGroups = (references: ReferenceImage[], definitions: PersonGroupDefinition[] = []) => {
  const validDefinitions = definitions.filter(group => Number.isInteger(group.id) && group.id > 0 && group.id <= 9999);
  const ids = [...new Set([...references.map(getPersonId).filter((id): id is number => id != null), ...validDefinitions.map(group => group.id)])].sort((a, b) => a - b);
  return ids.map(id => {
    const images = references.filter(ref => getPersonId(ref) === id);
    const name = cleanPersonName(validDefinitions.find(group => group.id === id)?.name || '') || images.map(ref => cleanPersonName(ref.personName || '')).find(Boolean);
    return { id, label: name || getPersonLabel(id), tag: getPersonTag(id), images };
  });
};

export const assignReferencePerson = (ref: ReferenceImage, personId?: number, personName?: string): ReferenceImage => ({
  ...ref, personId, personName: personId ? cleanPersonName(personName || '') || undefined : undefined,
  isSubjectImage: personId === 1, isSecondPerson: personId === 2,
  isFirstFrame: false, isLastFrame: false,
});

export const mentionedPersonIds = (...prompts: (string | undefined)[]): number[] =>
  [...new Set(prompts.flatMap(prompt => [...(prompt || '').matchAll(/@PERSON_(\d+)\b/gi)].map(match => Number(match[1]))))].filter(id => id > 0 && id <= 9999);

const nextIdentityNumber = (ids: number[], prompts: (string | undefined)[]): number => {
  const used = new Set([1, 2, ...ids, ...mentionedPersonIds(...prompts)]);
  const next = Math.max(...used) + 1;
  if (next <= 9999) return next;
  for (let id = 3; id <= 9999; id++) if (!used.has(id)) return id;
  throw new Error('Kişi grubu sınırına ulaşıldı.');
};

export const nextPersonId = (references: ReferenceImage[], ...prompts: (string | undefined)[]): number =>
  nextIdentityNumber(getPersonGroups(references).map(group => group.id), prompts);

type PersonDraft = Pick<GenerationConfig, 'referenceImages' | 'personGroups' | 'prompt' | 'originalPrompt'>;
export const getPersonDefinitions = (draft: Pick<PersonDraft, 'referenceImages' | 'personGroups'>): PersonGroupDefinition[] =>
  getPersonGroups(draft.referenceImages, draft.personGroups).map(group => ({ ...draft.personGroups?.find(definition => definition.id === group.id), id: group.id, name: group.label }));

export const getSavedPersonPhotos = (references: ReferenceImage[], savedPersonId?: string): SavedPerson['photos'] =>
  references.map(({ id, data, mimeType }) => ({
    id: savedPersonId && id.startsWith(`saved-person:${savedPersonId}:`) ? id.slice(`saved-person:${savedPersonId}:`.length) : id,
    data, mimeType,
  }));

/** Existing library links win. A uniquely named legacy group is offered as an
 * explicit Update action; duplicate names must never choose an identity silently. */
export const getSavedPersonDraftGroup = (draft: PersonDraft, person: Pick<SavedPerson, 'id' | 'name'>): PersonGroupDefinition | undefined => {
  const definitions = getPersonDefinitions(draft);
  const linked = definitions.filter(group => group.savedPersonId === person.id || draft.referenceImages.some(ref => getPersonId(ref) === group.id && ref.id.startsWith(`saved-person:${person.id}:`)));
  if (linked.length > 1) throw new Error('These saved photos are assigned to different people. Check the draft before updating this person.');
  if (linked.length) return linked[0];
  const named = definitions.filter(group => !group.savedPersonId && cleanPersonName(group.name || '').toLocaleLowerCase() === cleanPersonName(person.name).toLocaleLowerCase());
  if (named.length > 1) throw new Error(`More than one draft person is named ${person.name}. Give them distinct names before updating photos.`);
  return named[0];
};

const replaceSavedPersonPhotos = <T extends PersonDraft>(draft: T, person: SavedPerson, group: PersonGroupDefinition, maxImages: number): T => {
  const definitions = getPersonDefinitions(draft);
  const first = draft.referenceImages.findIndex(ref => getPersonId(ref) === group.id);
  const reclaim = (ref: ReferenceImage) => getPersonId(ref) == null && !ref.isFirstFrame && !ref.isLastFrame && !ref.isDraftImage && !ref.isVideoContext && ref.id.startsWith(`saved-person:${person.id}:`) && person.photos.some(photo => ref.id === `saved-person:${person.id}:${photo.id}`);
  const remaining = draft.referenceImages.filter(ref => getPersonId(ref) !== group.id && !reclaim(ref));
  const photos = person.photos.filter((photo, index, all) => all.findIndex(other => other.id === photo.id || other.data === photo.data) === index);
  if (remaining.length + photos.length > maxImages) throw new Error(`This person needs ${photos.length} photo slots; ${Math.max(0, maxImages - remaining.length)} available (limit ${maxImages}).`);
  if (photos.some(photo => remaining.some(ref => ref.id === photo.id || ref.id === `saved-person:${person.id}:${photo.id}` || ref.data === photo.data))) {
    throw new Error('One of these photos already has another role. Unassign it before updating this person.');
  }
  const name = cleanPersonName(group.name || person.name);
  const images = photos.map(photo => assignReferencePerson({ id: `saved-person:${person.id}:${photo.id}`, data: photo.data, mimeType: photo.mimeType }, group.id, name));
  const insertAt = first < 0 ? remaining.length : draft.referenceImages.slice(0, first).filter(ref => getPersonId(ref) !== group.id && !reclaim(ref)).length;
  const tag = (ref: ReferenceImage) => getPersonId(ref) == null ? getStableImageTag(ref.id) : getPersonTag(getPersonId(ref)!);
  return { ...draft,
    prompt: bindImageReferences(draft.prompt, draft.referenceImages, tag),
    originalPrompt: draft.originalPrompt == null ? undefined : bindImageReferences(draft.originalPrompt, draft.referenceImages, tag),
    personGroups: definitions.map(item => item.id === group.id ? { ...item, name, savedPersonId: person.id } : item),
    referenceImages: [...remaining.slice(0, insertAt), ...images, ...remaining.slice(insertAt)],
  };
};

/** Apply a library snapshot, retaining the existing person's stable identity. */
export const addSavedPersonToDraft = <T extends PersonDraft>(draft: T, person: SavedPerson, maxImages: number): T => {
  if (!person.photos.length) throw new Error('Add at least one photo to this person first.');
  const existingGroup = getSavedPersonDraftGroup(draft, person);
  if (existingGroup) return replaceSavedPersonPhotos(draft, person, existingGroup, maxImages);
  const definitions = getPersonDefinitions(draft);
  const snapshotIds = new Set(draft.referenceImages.filter(ref => ref.id.startsWith(`saved-person:${person.id}:`)).map(getPersonId).filter((id): id is number => id != null));
  if (snapshotIds.size > 1) throw new Error('These saved photos are assigned to different people. Unassign them before adding this person.');
  const linked = definitions.find(group => group.savedPersonId === person.id)
    || definitions.find(group => snapshotIds.has(group.id));
  const meAvailable = !definitions.some(group => group.id === 1) && !/@(?:MAIN_PERSON|ME)\b/i.test(`${draft.prompt} ${draft.originalPrompt || ''}`);
  const id = linked?.id ?? (person.isMe && meAvailable ? 1 : nextIdentityNumber(definitions.map(group => group.id), [draft.prompt, draft.originalPrompt]));
  const name = linked?.name || cleanPersonName(person.name);
  const pending: ReferenceImage[] = [];
  const references = draft.referenceImages.map(ref => ({ ...ref }));
  for (const photo of person.photos) {
    const photoId = `saved-person:${person.id}:${photo.id}`;
    const existing = references.find(ref => ref.id === photoId || ref.id === photo.id || ref.data === photo.data);
    if (existing) {
      const previousPerson = getPersonId(existing);
      if (existing.isFirstFrame || existing.isLastFrame || existing.isDraftImage || existing.isVideoContext || (previousPerson != null && previousPerson !== id)) {
        throw new Error('One of these photos already has another role. Unassign it before adding this person.');
      }
      Object.assign(existing, assignReferencePerson(existing, id, name));
    } else if (!pending.some(ref => ref.id === photoId || ref.data === photo.data)) {
      pending.push(assignReferencePerson({ id: photoId, data: photo.data, mimeType: photo.mimeType }, id, name));
    }
  }
  if (references.length + pending.length > maxImages) throw new Error(`This person needs ${pending.length} more photo slots; ${Math.max(0, maxImages - references.length)} available (limit ${maxImages}).`);
  if (!linked) definitions.push({ id, name, savedPersonId: person.id });
  else linked.savedPersonId = person.id;
  return { ...draft, personGroups: definitions, referenceImages: [...references, ...pending] };
};

/** Creating an identity never moves, copies, or assigns a photo. */
export const createPersonGroup = <T extends PersonDraft>(draft: T): T => {
  const definitions = getPersonDefinitions(draft);
  const id = nextIdentityNumber(definitions.map(group => group.id), [draft.prompt, draft.originalPrompt]);
  return { ...draft, personGroups: [...definitions, { id, name: getPersonLabel(id) }] };
};

export const assignPersonToPhoto = <T extends PersonDraft>(draft: T, photoId: string, personId?: number): T => {
  const definitions = getPersonDefinitions(draft);
  if (personId != null && !definitions.some(group => group.id === personId)) definitions.push({ id: personId, name: getPersonLabel(personId) });
  return { ...draft, personGroups: definitions, referenceImages: draft.referenceImages.map(image => image.id === photoId
    ? assignReferencePerson(image, personId, definitions.find(group => group.id === personId)?.name) : image) };
};

export const renamePersonGroup = <T extends PersonDraft>(draft: T, personId: number, value: string): T => {
  const name = cleanPersonName(value) || getPersonLabel(personId);
  const definitions = getPersonDefinitions(draft);
  if (definitions.find(group => group.id === personId)?.name === name) return draft;
  if (!definitions.some(group => group.id === personId)) definitions.push({ id: personId });
  return { ...draft, personGroups: definitions.map(group => group.id === personId ? { ...group, name } : group),
    referenceImages: draft.referenceImages.map(image => getPersonId(image) === personId ? { ...image, personName: name } : image) };
};

export const removePersonGroup = <T extends PersonDraft>(draft: T, personId: number): T => ({
  ...draft, personGroups: getPersonDefinitions(draft).filter(group => group.id !== personId),
  referenceImages: draft.referenceImages.map(image => getPersonId(image) === personId ? assignReferencePerson(image) : image),
});

export const findPersonMentions = (references: ReferenceImage[], query: string) => getPersonGroups(references)
  .filter(group => `${group.tag} ${group.label} ${getPersonLabel(group.id)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

/** Never renumber inputs by person. Quoted output text is literal, not a reference. */
export const normalizeReferencePrompt = (prompt: string, references: ReferenceImage[], inputs = references): string => {
  const label = (ref?: ReferenceImage) => {
    const index = ref ? inputs.indexOf(ref) : -1;
    if (index < 0) throw new Error('Prompttaki referans bu üretime ekli değil. Ekli referansları kontrol et.');
    return `image ${index + 1}`;
  };
  return mapUnquotedPrompt(resolveStableImageReferences(prompt, inputs), text => text.replace(/@REF_IMAGE_(\d+)\b|@MAIN_PERSON\b|@SECOND_PERSON\b|@ME\b|@PERSON_(\d+)\b/gi,
    (token, imageIndex, personIndex) => {
      if (imageIndex) return label(references[Number(imageIndex) - 1]);
      const id = personIndex ? Number(personIndex) : token.toUpperCase() === '@SECOND_PERSON' ? 2 : 1;
      const group = getPersonGroups(inputs).find(person => person.id === id);
      if (!group) throw new Error(`${getPersonLabel(id)} için bu üretime ekli kişi referansı yok. Kişiye fotoğraf ata veya prompttaki etiketi kaldır.`);
      const name = group.images.map(ref => cleanPersonName(ref.personName || '')).find(Boolean);
      return `the ${getPersonDescription(id)} shown in ${group.images.map(label).join(' and ')} (all these photos show the SAME single person)${name ? ` (identity label ${JSON.stringify(name)})` : ''}`;
    }));
};

/** List identities in upload order without renumbering either people or photos. */
const orderedPersonGroups = (references: ReferenceImage[]) => getPersonGroups(references)
  .sort((a, b) => references.indexOf(a.images[0]) - references.indexOf(b.images[0]));

export const PERSON_PROMPT_BINDING_RULE = 'For each requested person, keep their stable person label, supplied name and exact identity image numbers together at the first mention in every returned prompt. Use that same person label for later actions, placement and clothing; do not replace distinct labels with ambiguous "the man", "the other man" or a shared list of both people\'s photos. Never invent appearance details or infer a real name from a face. Names are labels; the assigned photos determine appearance.';

/** Keep exclusive bindings next to long creative briefs as a final reminder. */
export const buildPersonSeparationRule = (references: ReferenceImage[]): string => {
  const groups = orderedPersonGroups(references);
  if (groups.length < 2) return '';
  const bindings = groups.map(group => `${getPersonDescription(group.id)} (label ${JSON.stringify(group.label)}) = ${group.images.map(ref => `image ${references.indexOf(ref) + 1}`).join(', ')} ONLY`);
  return `IDENTITY SEPARATION\n${bindings.join('\n')}\nThese are ${groups.length} different reference identities, not interchangeable versions of one face. For each person requested in the brief, use only that person's assigned photos for their face; do not average, blend or transfer facial features between groups, and do not replace one requested person with a second copy of another. Preserve each person's facial proportions, eyes, nose, jaw and hairline while applying the requested expression, pose, clothing and style. In a shared scene, keep the requested people visually distinct even when their lighting or expressions match. A phone photo, reflection or repeated panel showing a requested person must use that same binding. Follow the requested cast and repetitions; attached photos do not require extra people.`;
};

export const buildPersonIdentityContract = (references: ReferenceImage[], imageLabel = (index: number) => `image ${index + 1}`): string => {
  const groups = orderedPersonGroups(references);
  if (!groups.length) return '';
  return `PERSON IDENTITIES — ${groups.length} distinct reference identities, not ${references.length} people. Only depict the people requested in the brief.\n${groups.map(group => {
    const labels = group.images.map(ref => imageLabel(references.indexOf(ref)));
    return `${getPersonDescription(group.id).toUpperCase()} (label ${JSON.stringify(group.label)}): ${labels.join(', ')} ${labels.length === 1 ? 'is an identity reference' : 'are different reference photos'} of the SAME SINGLE ${getPersonDescription(group.id)}${labels.length > 1 ? `, not ${labels.length} separate cast members` : ''}. PRIMARY IDENTITY ANCHOR: ${labels[0]}. ${labels.length > 1 ? `Supporting views: ${labels.slice(1).join(', ')}; use them for additional angles and detail of this same person. If a supporting view is blurry, stylized or inconsistent, retain the primary anchor's facial structure instead of averaging the photos. ` : ''}Use only these photos for this person's identity, never another group's photos. Preserve that person's recognizable face, age, hair and natural anatomy. Render this person once unless the brief explicitly requests repeated appearances (such as the SAME person in a split scene or triptych). Reference outfits and poses are not additional people.`;
  }).join('\n')}\nGive every requested identity equal preservation priority, regardless of input order or prominence in the scene. Keep every person's identity separate; never blend or swap their faces. Preserve the primary anchor's facial proportions when changing expression or head angle; do not exaggerate an expression into a different facial structure. A person's number identifies them, not their position in the composition. Follow the brief for positions, actions and person count. Never substitute a second copy of one person for another requested person.`;
};

/** Template and current draft use independent namespaces. Never merge guests by number alone. */
export const mergePersonReferenceInputs = (primary: ReferenceImage[], secondary: ReferenceImage[], primaryPrompt: string, secondaryPrompt: string, primaryDefinitions: PersonGroupDefinition[] = [], secondaryDefinitions: PersonGroupDefinition[] = []) => {
  // Validate each namespace before merging; a missing token must not bind to the other draft.
  const validate = (prompt: string, refs: ReferenceImage[], definitions: PersonGroupDefinition[]) => {
    const ids = new Set(getPersonGroups(refs, definitions).map(group => group.id));
    mapUnquotedPrompt(prompt, text => text.replace(/@REF_IMAGE_(\d+)\b|@MAIN_PERSON\b|@SECOND_PERSON\b|@ME\b|@PERSON_(\d+)\b/gi, (token, imageIndex, personIndex) => {
      if (imageIndex) { if (!refs[Number(imageIndex) - 1]) throw new Error('Şablon birleştirilirken prompttaki referans bulunamadı.'); }
      else {
        const id = personIndex ? Number(personIndex) : token.toUpperCase() === '@SECOND_PERSON' ? 2 : 1;
        if (!ids.has(id)) throw new Error(`${getPersonLabel(id)} için kişi referansı yok.`);
      }
      return token;
    }));
  };
  validate(primaryPrompt, primary, primaryDefinitions);
  validate(secondaryPrompt, secondary, secondaryDefinitions);
  const references = [...primary];
  const primaryGroups = getPersonGroups(primary, primaryDefinitions);
  const secondaryGroups = getPersonGroups(secondary, secondaryDefinitions);
  const personGroups: PersonGroupDefinition[] = primaryGroups.map(group => ({ ...primaryDefinitions.find(definition => definition.id === group.id), id: group.id, name: group.label }));
  const personMap = new Map<number, number>();
  const reserved = new Set([...primaryGroups, ...secondaryGroups].map(group => group.id));
  for (const group of secondaryGroups) {
    const sharedImages = primary.filter(ref => group.images.some(image => image.id === ref.id));
    const sharedIds = new Set(sharedImages.map(getPersonId));
    if (sharedIds.size > 1 || sharedIds.has(undefined)) throw new Error('Aynı fotoğraf şablonda farklı bir role atanmış. Birleştirmeden önce kişi rollerini eşleştir.');
    const shared = sharedImages[0];
    let id = shared ? getPersonId(shared)! : group.id;
    if (!shared && id !== 1 && primaryGroups.some(person => person.id === id)) {
      id = nextIdentityNumber([...reserved], [primaryPrompt, secondaryPrompt]);
      reserved.add(id);
    }
    personMap.set(group.id, id);
    if (!personGroups.some(person => person.id === id)) personGroups.push({ ...secondaryDefinitions.find(definition => definition.id === group.id), id, name: group.label === getPersonLabel(group.id) ? getPersonLabel(id) : group.label });
  }
  for (const ref of secondary) {
    if (references.some(image => image.id === ref.id)) continue;
    const id = getPersonId(ref);
    const mapped = id == null ? undefined : personMap.get(id);
    references.push(mapped == null ? ref : assignReferencePerson(ref, mapped, personGroups.find(group => group.id === mapped)?.name));
  }
  const prompt = mapUnquotedPrompt(secondaryPrompt, text => text.replace(/@REF_IMAGE_(\d+)\b|@MAIN_PERSON\b|@SECOND_PERSON\b|@ME\b|@PERSON_(\d+)\b/gi, (token, imageIndex, personIndex) => {
    if (imageIndex) {
      const ref = secondary[Number(imageIndex) - 1];
      if (!ref) throw new Error('Şablon birleştirilirken prompttaki referans bulunamadı.');
      return `@REF_IMAGE_${references.findIndex(image => image.id === ref.id) + 1}`;
    }
    const id = personIndex ? Number(personIndex) : token.toUpperCase() === '@SECOND_PERSON' ? 2 : 1;
    if (!personMap.has(id)) throw new Error(`${getPersonLabel(id)} için mevcut taslakta kişi referansı yok.`);
    return getPersonTag(personMap.get(id)!);
  }));
  return { references, personGroups, prompt: `${primaryPrompt} ${prompt}`.trim() };
};
