import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Folder, Image, Film, UserRound, Cpu, Heart, Clock, SlidersHorizontal, ChevronDown, ArrowLeft, CornerDownLeft, Loader2, Check, AlertTriangle } from 'lucide-react';
import type { Folder as GalleryFolder, GeneratedMedia } from '../types';
import { getGallerySearchPeople } from '../services/gallerySearchService';
import { buildGallerySearchIndex, EMPTY_SEARCH_FILTERS, getSearchFacets, normalizeSearch, searchGallery, searchMatchScore, type GallerySearchEntry, type SearchFilters, type SearchPeople } from './gallerySearch';

type Picker = 'type' | 'person' | 'model' | 'folder' | 'days' | 'status';
type Option = { value: string; label: string };
interface Props {
  images: GeneratedMedia[];
  folders: GalleryFolder[];
  ownerId?: string | null;
  isLoading?: boolean;
  loadError?: string | null;
  onClose: () => void;
  onSelect: (entry: GallerySearchEntry) => void;
}
const PAGE_SIZE = 60;
const TYPE_OPTIONS: Option[] = [{ value: 'all', label: 'Everything' }, { value: 'folder', label: 'Folders' }, { value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' }];
const DATE_OPTIONS: Option[] = [{ value: '0', label: 'Any date' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }];
const STATUS_OPTIONS: Option[] = [{ value: 'all', label: 'Any status' }, { value: 'completed', label: 'Completed' }, { value: 'running', label: 'Generating' }, { value: 'failed', label: 'Failed' }];
const PICKER_LABELS: Record<Picker, string> = { type: 'Type', person: 'Person', model: 'Model', folder: 'Folder', days: 'Date', status: 'Status' };

const SearchPreview: React.FC<{ entry: GallerySearchEntry }> = ({ entry }) => {
  const sources = entry.type === 'image' ? [entry.media?.thumbnailUrl, entry.media?.url].filter(Boolean) : [entry.media?.thumbnailUrl].filter(Boolean);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [entry.media?.thumbnailUrl, entry.media?.url]);
  const Icon = entry.type === 'folder' ? Folder : entry.type === 'video' ? Film : Image;
  return <span className={`gs-preview ${entry.type === 'folder' ? 'gs-folder' : ''}`}>
    <Icon size={20} />
    {sources[attempt] && <img src={sources[attempt]} alt="" loading="lazy" onError={() => setAttempt(value => value + 1)} />}
  </span>;
};

export const GallerySearchDialog: React.FC<Props> = ({ images, folders, ownerId, isLoading, loadError, onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({ ...EMPTY_SEARCH_FILTERS });
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [people, setPeople] = useState<SearchPeople>({});
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLDivElement>(null);
  const index = useMemo(() => buildGallerySearchIndex(folders, images, people), [folders, images, people]);
  const facets = useMemo(() => getSearchFacets(index), [index]);
  const personFilterUnavailable = !!filters.person && (peopleLoading || !!peopleError);
  const results = useMemo(() => personFilterUnavailable ? [] : searchGallery(index, query, filters), [index, query, filters, personFilterUnavailable]);
  const choices: Record<Picker, Option[]> = useMemo(() => ({
    type: TYPE_OPTIONS, days: DATE_OPTIONS, status: STATUS_OPTIONS,
    person: [{ value: '', label: 'Anyone' }, ...facets.people, { value: '__unnamed__', label: 'No named person' }],
    model: [{ value: '', label: 'All models' }, ...facets.models],
    folder: [{ value: '', label: 'All folders' }, { value: '__root__', label: 'Unfiled media' }, ...facets.folders],
  }), [facets]);
  const options = useMemo(() => picker ? choices[picker].filter(option => searchMatchScore(normalizeSearch(option.label), pickerQuery) >= 0) : [], [picker, choices, pickerQuery]);
  const count = picker ? options.length : results.length;
  const activeIndex = Math.min(active, Math.max(0, count - 1));
  const visibleCount = Math.max(limit, activeIndex + 1);
  const hasFilters = Object.keys(EMPTY_SEARCH_FILTERS).some(key => filters[key as keyof SearchFilters] !== EMPTY_SEARCH_FILTERS[key as keyof SearchFilters]);

  useEffect(() => {
    const controller = new AbortController();
    setPeople({}); setPeopleLoading(true); setPeopleError(null);
    getGallerySearchPeople(ownerId, controller.signal).then(names => {
      if (!controller.signal.aborted) setPeople(names);
    }).catch(error => {
      if (!controller.signal.aborted) setPeopleError(error.message || 'Person filters could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setPeopleLoading(false); });
    return () => controller.abort();
  }, [ownerId, retry]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== root.current);
    const inert = siblings.map(node => node.inert);
    siblings.forEach(node => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    input.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      siblings.forEach((node, i) => { node.inert = inert[i]; });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => root.current?.style.setProperty('--gs-height', `${viewport?.height || window.innerHeight}px`);
    resize();
    viewport?.addEventListener('resize', resize);
    return () => viewport?.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    setActive(0); setLimit(PAGE_SIZE);
    if (resultsList.current) resultsList.current.scrollTop = 0;
  }, [query, filters, picker, pickerQuery]);
  useEffect(() => {
    resultsList.current?.querySelector(`[data-search-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const openPicker = (next: Picker) => { setPicker(current => current === next ? null : next); setPickerQuery(''); input.current?.focus(); };
  const leavePicker = useCallback(() => { setPicker(null); setPickerQuery(''); input.current?.focus(); }, []);
  const choose = useCallback((position: number) => {
    if (!picker) {
      if (results[position]) onSelect(results[position]);
      return;
    }
    const option = options[position];
    if (!option) return;
    setFilters(previous => {
      const next = { ...previous, [picker]: picker === 'days' ? Number(option.value) : option.value };
      // Selecting a media filter leaves the mutually exclusive folders-only view.
      if (picker !== 'type' && picker !== 'folder' && next.type === 'folder') next.type = 'all';
      if (picker === 'type' && option.value === 'folder') return { ...EMPTY_SEARCH_FILTERS, type: 'folder', folder: previous.folder };
      return next;
    });
    leavePicker();
  }, [picker, results, options, onSelect, leavePicker]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault(); event.stopPropagation();
        if (picker && event.key === 'Escape') leavePicker(); else onClose();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = (Array.from(root.current?.querySelectorAll('button:not(:disabled), input, [tabindex="0"]') || []) as HTMLElement[]).filter(node => node.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.target !== input.current) return;
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Enter') choose(activeIndex);
        else setActive(value => Math.max(0, Math.min(count - 1, Math.min(value, count - 1) + (event.key === 'ArrowDown' ? 1 : -1))));
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [picker, leavePicker, onClose, choose, activeIndex, count]);

  const chip = (key: Picker, Icon: typeof Search, fallback: string) => {
    const value = String(filters[key]);
    const selected = value !== String(EMPTY_SEARCH_FILTERS[key]);
    const label = selected ? choices[key].find(option => option.value === value)?.label || fallback : fallback;
    const unavailable = key === 'person' && (peopleLoading || !!peopleError);
    return <button key={key} type="button" disabled={unavailable} className={`gs-chip ${selected || picker === key ? 'gs-chip-on' : ''}`} aria-label={`Filter by ${PICKER_LABELS[key].toLowerCase()}: ${label}`} aria-expanded={picker === key} onClick={() => openPicker(key)} title={unavailable ? peopleError || 'Loading person filters…' : label}>
      <Icon size={14} /><span>{label}</span><ChevronDown size={12} />
    </button>;
  };

  return createPortal(<div ref={root} className="gs-overlay" role="dialog" aria-modal="true" aria-labelledby="gallery-search-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <style>{SEARCH_STYLES}</style>
    <section className="gs-dialog">
      <h2 id="gallery-search-title" className="sr-only">Search gallery</h2>
      <div className="gs-input-row">
        {picker ? <button className="gs-icon-button" aria-label="Back to search results" onClick={leavePicker}><ArrowLeft size={20} /></button> : <Search className="gs-search-icon" size={22} />}
        <input ref={input} role="combobox" aria-label={picker ? `Find ${PICKER_LABELS[picker].toLowerCase()}` : 'Search all folders and generations'} aria-expanded="true" aria-controls="gallery-search-results" aria-autocomplete="list" aria-activedescendant={count ? `gallery-search-option-${activeIndex}` : undefined}
          autoComplete="off" spellCheck={false} value={picker ? pickerQuery : query} onChange={event => picker ? setPickerQuery(event.target.value) : setQuery(event.target.value)}
          placeholder={picker ? `Find ${PICKER_LABELS[picker].toLowerCase()}…` : 'Search folders, prompts, people…'} />
        <button className="gs-icon-button" aria-label="Close search" title="Close search (Esc)" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="gs-filters" aria-label="Search filters">
        {chip('type', SlidersHorizontal, 'Type')}{chip('person', UserRound, 'Person')}{chip('model', Cpu, 'Model')}{chip('folder', Folder, 'Folder')}
        <button className={`gs-chip ${filters.favorites ? 'gs-chip-on' : ''}`} aria-pressed={filters.favorites} onClick={() => { setFilters(previous => ({ ...previous, favorites: !previous.favorites, type: previous.type === 'folder' ? 'all' : previous.type })); leavePicker(); }}><Heart size={14} />Favorites</button>
        {chip('days', Clock, 'Date')}{chip('status', SlidersHorizontal, 'Status')}
        {hasFilters && <button className="gs-clear" onClick={() => { setFilters({ ...EMPTY_SEARCH_FILTERS }); leavePicker(); }}>Clear filters</button>}
      </div>
      {(loadError || peopleError) && <div className="gs-notice" role="status"><AlertTriangle size={15} /><span>{loadError || peopleError} {peopleError && 'Other search results are still available.'}</span>{peopleError && <button onClick={() => { setRetry(value => value + 1); input.current?.focus(); }}>Retry</button>}</div>}
      <div className="gs-section-label">
        <span>{picker ? `${PICKER_LABELS[picker]}${picker === 'folder' ? ' · includes subfolders' : picker === 'person' ? ' · saved reference labels' : ''}` : query || hasFilters ? 'Results across your gallery' : 'Folders & recent generations'}</span>
        {(isLoading || peopleLoading) && <span className="gs-loading"><Loader2 size={12} />{isLoading ? 'Loading gallery…' : 'Loading people…'}</span>}
      </div>
      <div ref={resultsList} id="gallery-search-results" className="gs-results" role="listbox" aria-label={picker ? `${PICKER_LABELS[picker]} options` : 'Search results'} aria-busy={!!isLoading || (!!picker && picker === 'person' && peopleLoading)}>
        {picker ? options.slice(0, visibleCount).map((option, i) => <div key={option.value} id={`gallery-search-option-${i}`} role="option" aria-selected={i === activeIndex} data-search-index={i} className={`gs-option gs-filter-option ${i === activeIndex ? 'gs-active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={event => event.preventDefault()} onClick={() => choose(i)}>
          <span>{option.label}</span>{String(filters[picker]) === option.value && <Check size={16} />}
        </div>) : results.slice(0, visibleCount).map((entry, i) => <div key={entry.key} id={`gallery-search-option-${i}`} role="option" aria-selected={i === activeIndex} data-search-index={i} className={`gs-option ${i === activeIndex ? 'gs-active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={event => event.preventDefault()} onClick={() => choose(i)}>
          <SearchPreview entry={entry} />
          <div className="gs-result-copy"><div className="gs-result-title">{entry.title}</div><div className="gs-result-path">{entry.type === 'folder' ? 'Folder · ' : ''}{entry.path}</div>
            {entry.type !== 'folder' && <div className="gs-meta"><span>{entry.type === 'video' ? 'Video' : 'Image'}</span>{entry.modelLabel && <span>{entry.modelLabel}</span>}{entry.people.length > 0 && <span>{entry.people.join(', ')}</span>}{entry.createdAt > 0 && <span>{new Date(entry.createdAt).toLocaleDateString()}</span>}{entry.status !== 'completed' && <span className={entry.status === 'failed' ? 'gs-failed' : ''}>{entry.status === 'running' ? 'Generating' : 'Failed'}</span>}</div>}
          </div>
          {entry.favorite && <Heart size={14} className="gs-favorite" />}<CornerDownLeft size={15} className="gs-enter" />
        </div>)}
        {!count && <div className="gs-empty"><Search size={28} /><strong>{personFilterUnavailable && peopleError ? 'Person filter unavailable' : isLoading || personFilterUnavailable || picker === 'person' && peopleLoading ? 'Still loading…' : 'No matches found'}</strong><span>{personFilterUnavailable && peopleError ? 'Retry loading people or clear this filter.' : picker ? 'Try another name.' : 'Try fewer words or clear a filter.'}</span></div>}
      </div>
      {count > visibleCount && <button className="gs-more" onClick={() => { setLimit(value => Math.max(value, visibleCount) + PAGE_SIZE); setActive(visibleCount); input.current?.focus(); }}>Show more ({count - visibleCount})</button>}
      <footer className="gs-footer"><span aria-live="polite">{count.toLocaleString()} {picker ? 'options' : 'results'}</span><span className="gs-key-hints"><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open <kbd>esc</kbd> {picker ? 'back' : 'close'}</span></footer>
    </section>
  </div>, document.body);
};

const SEARCH_STYLES = `
.gs-overlay{position:fixed;inset:0;z-index:180;background:#030609aa;backdrop-filter:blur(7px);display:flex;align-items:flex-start;justify-content:center;padding:clamp(16px,10vh,100px) 20px 20px;color:#e8e9ed}
.gs-dialog{width:760px;max-width:100%;max-height:min(780px,80dvh);display:flex;flex-direction:column;overflow:hidden;background:#15181e;border:1px solid #ffffff22;border-radius:18px;box-shadow:0 30px 100px #0009;font-size:13px}
.gs-input-row{display:flex;align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid #ffffff0d;flex-shrink:0}
.gs-search-icon{flex-shrink:0;color:#a8a0bf}.gs-input-row input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:#fff;font-size:17px;height:30px}.gs-input-row input::placeholder{color:#727783}
.gs-icon-button{display:grid;place-items:center;flex-shrink:0;width:32px;height:32px;border-radius:7px;color:#9398a5}.gs-icon-button:hover{background:#ffffff10;color:white}
.gs-filters{display:flex;flex-wrap:wrap;gap:7px;padding:12px 18px;flex-shrink:0;border-bottom:1px solid #ffffff0b}
.gs-chip{display:flex;align-items:center;gap:6px;padding:6px 9px;max-width:210px;background:#ffffff04;border:1px solid #ffffff10;border-radius:7px;color:#a5aab6;font-size:12px;line-height:18px}.gs-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gs-chip svg{flex-shrink:0}.gs-chip:hover{background:#ffffff0b;color:white}.gs-chip-on{color:#d3c2ff;background:#8b5cf61a;border-color:#a78bfa50}.gs-clear{padding:4px;color:#b5a1ed;font-size:12px}
.gs-section-label{padding:12px 20px 8px;font-size:11px;color:#818794;display:flex;flex-wrap:wrap;gap:6px;justify-content:space-between;flex-shrink:0}.gs-loading{display:flex;align-items:center;gap:5px}.gs-loading svg{animation:gs-spin 1s linear infinite}@keyframes gs-spin{to{transform:rotate(360deg)}}
.gs-results{overflow:auto;overscroll-behavior:contain;min-height:100px;padding:0 8px 8px;scroll-padding:8px;flex:1}.gs-option{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer;border:1px solid transparent;margin:2px 0}.gs-active{background:#a78bfa12;border-color:#a78bfa27}.gs-filter-option{min-height:44px;justify-content:space-between;overflow-wrap:anywhere}.gs-result-copy{flex:1;min-width:0}.gs-result-title{font-size:14px;font-weight:500;color:#f0f0f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gs-result-path{color:#9399a5;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.gs-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;color:#838998;font-size:10px;margin-top:5px;max-height:30px;overflow:hidden}.gs-meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.gs-meta .gs-failed{color:#f89898}
.gs-preview{position:relative;width:48px;height:44px;border-radius:8px;flex-shrink:0;display:grid;place-items:center;overflow:hidden;background:#ffffff06;color:#77808e}.gs-preview img{position:absolute;width:100%;height:100%;object-fit:cover}.gs-folder{background:#8b5cf618;color:#b8a0ee}.gs-favorite{flex-shrink:0;color:#e799bc}.gs-enter{color:#b0a1d1;opacity:0;flex-shrink:0}.gs-active .gs-enter{opacity:1}
.gs-empty{min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:#727989}.gs-empty strong{color:#c2c6ce;font-weight:500}.gs-empty svg{margin-bottom:5px;color:#58516d}
.gs-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 18px;background:#11141a;border-top:1px solid #ffffff0c;color:#818795;font-size:11px;flex-shrink:0}.gs-key-hints{display:flex;align-items:center;gap:5px}.gs-footer kbd{background:#ffffff07;border:1px solid #ffffff10;border-radius:4px;padding:1px 4px;line-height:17px;color:#bbc0cb}.gs-more{font-size:12px;color:#b7a4e8;padding:7px;border-top:1px solid #ffffff08;flex-shrink:0}.gs-notice{display:flex;align-items:center;gap:8px;padding:9px 18px;background:#e3ab3910;color:#dfba79;font-size:12px;flex-shrink:0}.gs-notice svg{flex-shrink:0}.gs-notice span{flex:1}.gs-notice button{text-decoration:underline}
.gs-dialog button:focus-visible,.gs-option:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}.gs-chip:disabled{opacity:.5;cursor:wait}
@media(max-width:600px){.gs-overlay{padding:12px 8px;padding-top:max(12px,env(safe-area-inset-top));padding-bottom:max(12px,env(safe-area-inset-bottom))}.gs-dialog{max-height:calc(var(--gs-height,100dvh) - 32px);border-radius:14px}.gs-input-row{padding:12px;gap:8px}.gs-input-row input{font-size:16px}.gs-filters{padding:10px 12px;gap:6px}.gs-chip{max-width:155px;min-height:34px;font-size:11px;gap:4px;padding:6px}.gs-section-label{padding-left:14px;padding-right:14px}.gs-option{gap:10px;padding:10px 8px}.gs-preview{width:40px;height:40px}.gs-enter{display:none}.gs-result-title{font-size:13px}.gs-footer{padding:10px 12px}.gs-key-hints{display:none}}
`;
