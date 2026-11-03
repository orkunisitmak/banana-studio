import { getImageModelLabel, VIDEO_MODEL_OPTIONS, type Folder, type GeneratedMedia } from '../types';
import { cleanPersonName, getPersonId } from '../lib/references/personReferences';

export type SearchPeople = Record<string, string[]>;
export type SearchFilters = {
  type: 'all' | 'folder' | 'image' | 'video';
  person: string;
  model: string;
  folder: string;
  favorites: boolean;
  days: number;
  status: 'all' | 'completed' | 'running' | 'failed';
};
export const EMPTY_SEARCH_FILTERS: SearchFilters = { type: 'all', person: '', model: '', folder: '', favorites: false, days: 0, status: 'all' };
export const normalizeSearch = (value: string): string => value.toLowerCase().replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const timestamp = (value: number | string): number => typeof value === 'number' ? value : Number(value) || Date.parse(value) || 0;

// Person numbers are local to a generation, not identities across the library.
// Only explicit names on attached, assigned references become person facets.
export const getSearchPeople = (media: GeneratedMedia): string[] => [...new Set((media.referenceImages || [])
  .filter(ref => getPersonId(ref) != null && !ref.isDraftImage && !ref.isVideoContext)
  .map(ref => cleanPersonName(ref.personName || '')).filter(Boolean))];

export type GallerySearchEntry = {
  key: string;
  type: 'folder' | 'image' | 'video';
  id: string;
  title: string;
  path: string;
  ancestors: Set<string>;
  createdAt: number;
  model: string;
  modelLabel: string;
  people: string[];
  status: 'completed' | 'running' | 'failed';
  favorite: boolean;
  media?: GeneratedMedia;
  text: string;
  titleText: string;
};

export const buildGallerySearchIndex = (folders: Folder[], media: GeneratedMedia[], people: SearchPeople = {}): GallerySearchEntry[] => {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const locations = new Map<string, { path: string; ancestors: Set<string> }>();
  const locate = (id?: string | null) => {
    if (!id) return { path: 'Gallery', ancestors: new Set<string>() };
    if (locations.has(id)) return locations.get(id)!;
    const names: string[] = [], ancestors = new Set<string>();
    let current = byId.get(id);
    while (current && !ancestors.has(current.id)) {
      ancestors.add(current.id); names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const location = { path: names.length ? names.join(' / ') : 'Gallery', ancestors };
    locations.set(id, location); return location;
  };
  const folderEntries: GallerySearchEntry[] = folders.map(folder => {
    const location = locate(folder.id);
    return {
      key: `folder:${folder.id}`, type: 'folder', id: folder.id, title: folder.name, ...location,
      createdAt: timestamp(folder.createdAt), model: '', modelLabel: '', people: [], status: 'completed', favorite: false,
      titleText: normalizeSearch(folder.name), text: normalizeSearch(location.path),
    };
  });
  return [...folderEntries, ...media.map((item): GallerySearchEntry => {
    const type = item.mediaType === 'video' ? 'video' : 'image';
    const model = (type === 'video' ? item.videoModel : item.imageModel) || '';
    const modelLabel = type === 'video' ? VIDEO_MODEL_OPTIONS.find(option => option.value === model)?.label || model
      : model ? getImageModelLabel(model) : '';
    const location = locate(item.folderId);
    const names = getSearchPeople(item);
    const personNames = names.length ? names : people[item.id] || [];
    const title = (item.originalPrompt || item.prompt || '').replace(/\s+/g, ' ').trim() || (type === 'video' ? 'Untitled video' : 'Untitled image');
    return {
      key: `${type}:${item.id}`, type, id: item.id, title, ...location, createdAt: timestamp(item.createdAt), model, modelLabel,
      people: personNames, status: item.error || item.status === 'failed' ? 'failed' : item.isLoading || ['pending', 'processing'].includes(item.status || '') ? 'running' : 'completed',
      favorite: !!item.isFavorite, media: item, titleText: normalizeSearch(title),
      text: normalizeSearch([title, item.prompt, item.imageGenerationPrompt, item.providerExpandedPrompt, model, modelLabel, location.path, ...personNames].filter(Boolean).join(' ')),
    };
  })];
};

export const searchMatchScore = (text: string, query: string, title = text): number => {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  let score = 0;
  for (const word of words) {
    if (title === word) score += 100;
    else if (title.startsWith(word)) score += 70;
    else if (title.includes(word)) score += 40;
    else if (text.includes(word)) score += 15;
    else return -1;
  }
  return score;
};

export const searchGallery = (index: GallerySearchEntry[], query: string, filters: SearchFilters, now = Date.now()): GallerySearchEntry[] => {
  const mediaFilters = !!(filters.person || filters.model || filters.favorites || filters.days || filters.status !== 'all');
  const candidates = index.filter(entry => {
    if (filters.type !== 'all' && entry.type !== filters.type) return false;
    // Media-specific filters apply to generations; folders remain searchable
    // through the dedicated folder picker without suggesting false matches.
    if (entry.type === 'folder' && mediaFilters) return false;
    if (filters.folder === '__root__' ? entry.ancestors.size > 0 : filters.folder && !entry.ancestors.has(filters.folder)) return false;
    if (filters.model && entry.model !== filters.model) return false;
    if (filters.person === '__unnamed__' ? entry.people.length > 0 : filters.person && !entry.people.some(name => normalizeSearch(name) === filters.person)) return false;
    if (filters.favorites && !entry.favorite) return false;
    if (filters.days && entry.createdAt < now - filters.days * 86400_000) return false;
    if (filters.status !== 'all' && entry.status !== filters.status) return false;
    return true;
  });
  return candidates.map(entry => ({ entry, score: searchMatchScore(entry.text, query, entry.titleText) }))
    .filter(result => result.score >= 0)
    .sort((a, b) => b.score - a.score || (a.entry.type === 'folder' ? 0 : 1) - (b.entry.type === 'folder' ? 0 : 1) || b.entry.createdAt - a.entry.createdAt || a.entry.key.localeCompare(b.entry.key))
    .map(result => result.entry);
};

export const getSearchFacets = (index: GallerySearchEntry[]) => {
  const people = new Map<string, string>();
  const models = new Map<string, string>();
  for (const entry of index) {
    entry.people.forEach(name => people.set(normalizeSearch(name), name));
    if (entry.model) models.set(entry.model, entry.modelLabel);
  }
  const options = (map: Map<string, string>) => [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  return { people: options(people), models: options(models), folders: index.filter(entry => entry.type === 'folder').map(entry => ({ value: entry.id, label: entry.path })).sort((a, b) => a.label.localeCompare(b.label)) };
};
