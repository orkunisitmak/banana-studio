import { getPersonId } from './personReferences.js';
import type { ReferenceImage } from '../../types.js';

export type LocalReferenceFit =
  | { kept: ReferenceImage[]; skipped: ReferenceImage[]; error?: undefined }
  | { error: string; kept?: undefined; skipped?: undefined };

/** A local GPU slows sharply with every reference, so local models take a few.
 * A saved person often brings many photos of one face: keep the edit source and
 * every non-person reference, then share the rest round-robin so each person
 * keeps at least one photo. The first photos of each person win. */
export const fitLocalReferences = (references: ReferenceImage[], limit: number, label = 'This local model'): LocalReferenceFit => {
  if (references.length <= limit) return { kept: references, skipped: [] };
  const loose = references.filter(ref => getPersonId(ref) == null);
  const people = new Map<number, ReferenceImage[]>();
  for (const ref of references) {
    const id = getPersonId(ref);
    if (id != null) people.set(id, [...people.get(id) || [], ref]);
  }
  if (loose.length + people.size > limit) return { error: `${label} uses up to ${limit} reference images: one photo per person plus other references. Remove ${loose.length + people.size - limit} reference${loose.length + people.size - limit === 1 ? '' : 's'} or a person.` };
  const chosen = new Set(loose);
  for (let round = 0; chosen.size < limit; round++) {
    const before = chosen.size;
    for (const photos of people.values()) if (chosen.size < limit && photos[round]) chosen.add(photos[round]);
    if (chosen.size === before) break;
  }
  return { kept: references.filter(ref => chosen.has(ref)), skipped: references.filter(ref => !chosen.has(ref)) };
};
