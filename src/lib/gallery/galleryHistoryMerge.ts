import type { GeneratedMedia } from '../../types';

/** Edits made while the initial history snapshot is still paging. Store fields,
 * rather than entire cards, so late pages can still refresh URLs and job status. */
export interface GalleryHistoryMutations {
  patches: Map<string, Partial<GeneratedMedia>>;
  additions: Set<string>;
  deletedIds: Set<string>;
  discardLoaded: boolean;
}

export const createGalleryHistoryMutations = (): GalleryHistoryMutations => ({
  patches: new Map(), additions: new Set(), deletedIds: new Set(), discardLoaded: false,
});

/** Pure and replayable: React may evaluate a state updater more than once. */
export const recordGalleryHistoryMutation = (
  previous: GeneratedMedia[], next: GeneratedMedia[], mutations: GalleryHistoryMutations,
): GalleryHistoryMutations => {
  const patches = new Map(mutations.patches);
  const additions = new Set(mutations.additions);
  const deletedIds = new Set(mutations.deletedIds);
  const before = new Map(previous.map(item => [item.id, item]));
  const nextIds = new Set(next.map(item => item.id));
  for (const item of previous) if (!nextIds.has(item.id)) deletedIds.add(item.id);
  for (const item of next) {
    const old = before.get(item.id);
    if (!old) { additions.add(item.id); deletedIds.delete(item.id); continue; }
    if (old === item) continue;
    const patch = { ...patches.get(item.id) };
    for (const key of new Set([...Object.keys(old), ...Object.keys(item)]) as Set<keyof GeneratedMedia>) {
      if (!Object.is(old[key], item[key])) Object.assign(patch, { [key]: item[key] });
    }
    patches.set(item.id, patch);
  }
  return { ...mutations, patches, additions, deletedIds };
};

/** Merge a loaded history page into the current list, keeping local additions, deletions and edits. */
export const mergeLoadedGalleryHistory = (
  current: GeneratedMedia[], loaded: GeneratedMedia[], mutations: GalleryHistoryMutations,
  externalDeletedIds: ReadonlySet<string> = new Set(),
): GeneratedMedia[] => {
  /** True when the item was deleted locally or elsewhere. */
  const deleted = (id: string) => mutations.deletedIds.has(id) || externalDeletedIds.has(id);
  if (mutations.discardLoaded) return current.filter(item => !deleted(item.id));
  const additions = current.filter(item => mutations.additions.has(item.id) && !deleted(item.id));
  const addedIds = new Set(additions.map(item => item.id));
  return [...additions, ...loaded.filter(item => !deleted(item.id) && !addedIds.has(item.id))
    .map(item => ({ ...item, ...mutations.patches.get(item.id) }))];
};
