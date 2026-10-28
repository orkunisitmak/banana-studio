export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** Keeps tags stable for storage, search and duplicate suppression. */
export const normalizeTags = (tags: readonly string[] | undefined): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags || []) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
    if (normalized.length === MAX_TAGS) break;
  }
  return normalized;
};

export const addTag = (tags: readonly string[] | undefined, tag: string): string[] =>
  normalizeTags([...(tags || []), tag]);

export const removeTag = (tags: readonly string[] | undefined, tag: string): string[] =>
  normalizeTags(tags).filter(existing => existing.toLocaleLowerCase() !== tag.toLocaleLowerCase());
