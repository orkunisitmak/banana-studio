import type { GeneratedMedia } from '../../types';

/** Pagination is a snapshot taken before the composer becomes interactive.
 * Jobs submitted since then must survive late pages, even if they have already
 * completed or the snapshot still contains their older processing row.
 * `delivered` holds IDs from earlier pages: rows still shown keep the user's
 * edits, and rows removed since then are not brought back by a later page. */
export const mergeLoadedGalleryHistory = (current: GeneratedMedia[], loaded: GeneratedMedia[], startedAt: number,
  delivered: ReadonlySet<string> = new Set()): GeneratedMedia[] => {
  const recent = current.filter(item => item.createdAt >= startedAt);
  const ids = new Set(recent.map(item => item.id));
  const shown = new Map(current.map(item => [item.id, item]));
  return [...recent, ...loaded.filter(item => !ids.has(item.id) && (shown.has(item.id) || !delivered.has(item.id)))
    .map(item => {
      const visible = shown.get(item.id);
      if (!visible) return item;
      // Later pages re-sign the same stored file (15-minute URLs) or fill a URL that was
      // missing. Take that URL; keep the user's edits and any row whose file changed.
      const sameFile = !visible.url || (!!visible.storagePath && visible.storagePath === item.storagePath);
      return item.url && item.url !== visible.url && sameFile ? { ...visible, url: item.url } : visible;
    })];
};
