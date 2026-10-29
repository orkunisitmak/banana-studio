import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Columns2, Grid2X2, SlidersHorizontal, X, Minus, Plus, Maximize, Heart, Info, ChevronLeft, ChevronRight, Link, Unlink, Keyboard } from 'lucide-react';
import { getImageModelLabel, type GeneratedMedia } from '../types';
import { getGalleryAspectRatio } from './galleryPresentation';
import { clampViewport, FIT_VIEWPORT, resolveComparePair, zoomViewport, type CompareView, type CompareViewport } from './imageComparison';
import { imageCompareStyles } from './imageCompareStyles';
import { CompareStage, type Dimensions, type RefreshComparisonSource, type ViewportSetter } from './ImageComparisonStage';

interface ImageCompareDialogProps {
  images: GeneratedMedia[];
  onClose: (message?: string) => void;
  onToggleFavorite?: (media: GeneratedMedia) => void;
  isReadOnly?: boolean;
  loadDetails: (id: string) => Promise<GeneratedMedia | null>;
  refreshSource: RefreshComparisonSource;
}
const SHORTCUTS = [
  ['1 / 2', 'Gallery / Slider'], ['G', 'Toggle Grid / Strip'],
  ['L', 'Sync / independent zoom and pan'], ['A / B', 'Adjust reference A / candidate B'],
  ['+ / −', 'Zoom active image (all images when synced)'], ['0', 'Fit active image'], ['Shift + 0', 'Fit all images'],
  ['Shift + arrows', 'Pan active image'], ['← / →', 'Previous / next candidate B'],
  ['[ / ]', 'Move slider divider'],
  ['I', 'Image information'], ['F', 'Toggle favorite (editable galleries)'],
  ['?', 'Show / hide shortcuts'], ['Esc', 'Close panel, then comparison'],
];

export function ImageCompareDialog({ images, onClose, onToggleFavorite, isReadOnly = false, loadDetails, refreshSource }: ImageCompareDialogProps) {
  const [view, setView] = useState<CompareView>('gallery');
  const [layout, setLayout] = useState<'grid' | 'strip'>('grid');
  const [aId, setAId] = useState(images[0]?.id || '');
  const [bId, setBId] = useState(images[1]?.id || '');
  const [zoomState, setZoomState] = useState<{ synced: boolean; shared: CompareViewport; individual: Record<string, CompareViewport> }>({ synced: true, shared: FIT_VIEWPORT, individual: {} });
  const [activeId, setActiveId] = useState(images[0]?.id || '');
  const [split, setSplit] = useState(50);
  const [dimensions, setDimensions] = useState<Record<string, Dimensions>>({});
  const [infoId, setInfoId] = useState<string | null>(null);
  const [details, setDetails] = useState<GeneratedMedia | null>(null);
  const [detailStatus, setDetailStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsPanel = useRef<HTMLDivElement>(null);
  const shortcutsClose = useRef<HTMLButtonElement>(null);
  const shortcutsTrigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const infoCloseButton = useRef<HTMLButtonElement>(null);
  const infoTrigger = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const pair = resolveComparePair(images.map(item => item.id), aId, bId);
  const a = images.find(item => item.id === pair[0]);
  const b = images.find(item => item.id === pair[1]);
  const targetId = (view === 'gallery' ? images.some(item => item.id === activeId) : pair.includes(activeId)) ? activeId : pair[0];
  const viewportFor = (id: string) => zoomState.synced ? zoomState.shared : zoomState.individual[id] || zoomState.shared;
  const viewport = viewportFor(targetId);
  const updateViewport = useCallback((id: string, action: React.SetStateAction<CompareViewport>) => setZoomState(state => {
    const current = state.synced ? state.shared : state.individual[id] || state.shared;
    const next = typeof action === 'function' ? action(current) : action;
    return state.synced ? { ...state, shared: next } : { ...state, individual: { ...state.individual, [id]: next } };
  }), []);
  const setViewport: ViewportSetter = useCallback(action => updateViewport(targetId, action), [updateViewport, targetId]);
  const fitAll = useCallback(() => setZoomState(state => ({ ...state, shared: FIT_VIEWPORT, individual: {} })), []);
  const toggleSync = () => setZoomState(state => state.synced
    ? { ...state, synced: false, individual: Object.fromEntries(images.map(item => [item.id, state.shared])) }
    : { synced: true, shared: state.individual[targetId] || state.shared, individual: {} });
  const activate = (id: string) => setActiveId(id);
  const referenceId = a?.id;
  useEffect(() => { fitAll(); }, [referenceId, fitAll]);
  useEffect(() => {
    if (images.length < 2) onClose('Comparison ended: fewer than two available images remain.');
    if (pair[0] !== aId) setAId(pair[0]);
    if (pair[1] !== bId) setBId(pair[1]);
    if (infoId && !images.some(item => item.id === infoId)) setInfoId(null);
    setZoomState(state => Object.keys(state.individual).some(id => !images.some(item => item.id === id))
      ? { ...state, individual: Object.fromEntries(Object.entries(state.individual).filter(([id]) => images.some(item => item.id === id))) } : state);
  }, [images, aId, bId, infoId, onClose, pair[0], pair[1]]);
  const navigate = useCallback((direction: number) => {
    const candidates = images.filter(item => item.id !== pair[0]);
    const index = candidates.findIndex(item => item.id === pair[1]);
    const next = candidates[(index + direction + candidates.length) % candidates.length];
    if (next) { setBId(next.id); setActiveId(next.id); }
  }, [images, pair[0], pair[1]]);
  const keyboardHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const returnFocus = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const siblings = [...document.body.children].filter(node => node instanceof HTMLElement && node !== dialog.current) as HTMLElement[];
    const previousInert = siblings.map(node => node.inert);
    siblings.forEach(node => { node.inert = true; });
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => keyboardHandler.current(event);
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = oldOverflow;
      siblings.forEach((node, index) => { node.inert = previousInert[index]; });
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    let active = true;
    setDetails(null);
    if (!infoId) return;
    infoCloseButton.current?.focus(); setDetailStatus('loading');
    loadDetails(infoId).then(value => { if (active) { setDetails(value); setDetailStatus(value ? 'ready' : 'error'); } })
      .catch(() => { if (active) setDetailStatus('error'); });
    return () => { active = false; };
  }, [infoId, loadDetails]);
  const onDimensions = useCallback((id: string, value: Dimensions) => {
    if (value.width <= 0 || value.height <= 0) return;
    setDimensions(previous => previous[id]?.width === value.width && previous[id]?.height === value.height && previous[id]?.source === value.source ? previous : { ...previous, [id]: value });
  }, []);
  const setReference = (id: string) => { if (id !== pair[0]) { setAId(id); if (id === pair[1]) setBId(pair[0]); setActiveId(id); fitAll(); } };
  const number = (id: string) => images.findIndex(item => item.id === id) + 1;
  const openInfo = (id: string, target: HTMLElement) => { infoTrigger.current = target; setInfoId(id); setActiveId(id); };
  const closeInfo = () => { setInfoId(null); infoTrigger.current?.focus(); };
  const closeShortcuts = () => { setShortcutsOpen(false); shortcutsTrigger.current?.focus(); };
  const toggleShortcuts = () => {
    if (shortcutsOpen) closeShortcuts();
    else { shortcutsTrigger.current = document.activeElement as HTMLElement | null; setShortcutsOpen(true); }
  };
  useEffect(() => { if (shortcutsOpen) shortcutsClose.current?.focus(); }, [shortcutsOpen]);
  keyboardHandler.current = event => {
    if (event.isComposing) return;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === 'Escape') {
      handled(); if (shortcutsOpen) closeShortcuts(); else if (infoId) closeInfo(); else closeRef.current(); return;
    }
    if (event.key === 'Tab') {
      const scope = shortcutsOpen ? shortcutsPanel.current : dialog.current;
      const nodes = [...(scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])]
        .filter(node => node.getClientRects().length && !node.closest('[aria-hidden="true"]'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !scope?.contains(document.activeElement))) { handled(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !scope?.contains(document.activeElement))) { handled(); first?.focus(); }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (event.altKey || event.ctrlKey || event.metaKey || target?.closest('input, textarea, select, [role="slider"], [contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === '?') { handled(); if (!event.repeat) toggleShortcuts(); return; }
    if (shortcutsOpen) return;
    const key = event.key.toLowerCase();
    if (event.repeat && ['l', 'g', 'i'].includes(key)) { handled(); return; }
    if (key === '1' || key === '2') setView(key === '1' ? 'gallery' : 'slider');
    else if (key === 'g') { setView('gallery'); setLayout(value => value === 'grid' ? 'strip' : 'grid'); }
    else if (key === 'l') toggleSync();
    else if (key === 'a' || key === 'b') activate(pair[key === 'a' ? 0 : 1]);
    // Shift+0 types '=' on Turkish and German layouts; check the physical key before zoom.
    else if (key === '0' || event.code === 'Digit0') { if (event.shiftKey) fitAll(); else setViewport(FIT_VIEWPORT); }
    else if (key === '+' || key === '=' || key === '-' || key === '_') setViewport(value => zoomViewport(value, value.zoom * (key === '+' || key === '=' ? 1.25 : 1 / 1.25)));
    else if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      setViewport(value => clampViewport({ ...value, x: value.x + (event.key === 'ArrowLeft' ? .05 : event.key === 'ArrowRight' ? -.05 : 0), y: value.y + (event.key === 'ArrowUp' ? .05 : event.key === 'ArrowDown' ? -.05 : 0) }));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') navigate(event.key === 'ArrowLeft' ? -1 : 1);
    else if ((key === '[' || key === ']') && view === 'slider') setSplit(value => Math.max(0, Math.min(100, value + (key === '[' ? -5 : 5))));
    else if (key === 'i') { if (infoId === targetId) closeInfo(); else openInfo(targetId, document.activeElement as HTMLElement); }
    else if (key === 'f' && !isReadOnly && onToggleFavorite) { const media = images.find(item => item.id === targetId); if (media && !event.repeat) onToggleFavorite(media); }
    else return;
    handled();
  };
  const imageLabel = (media: GeneratedMedia) => <>
    <button type="button" className="cmp-image-target" aria-label={`Adjust image ${number(media.id)}`} aria-pressed={targetId === media.id}
      title="Select this image for zoom, pan and keyboard shortcuts" onClick={() => activate(media.id)}>Image {number(media.id)}</button>
    {!zoomState.synced && <span className="cmp-image-zoom">{viewportFor(media.id).zoom.toFixed(1)}×</span>}
  </>;
  const imageActions = (media: GeneratedMedia) => <div className="cmp-image-actions">
    {!isReadOnly && onToggleFavorite && <button type="button" className="cmp-btn cmp-icon" aria-label={`Favorite image ${number(media.id)}`} aria-pressed={!!media.isFavorite} onClick={() => onToggleFavorite(media)}><Heart style={{ fill: media.isFavorite ? 'currentColor' : 'none' }} /></button>}
    <button type="button" className="cmp-btn cmp-icon" aria-label={`Information for image ${number(media.id)}`} onClick={event => openInfo(media.id, event.currentTarget)}><Info /></button>
  </div>;
  const roleBadge = (id: string) => id === pair[0] ? <span className="cmp-badge">A</span> : id === pair[1] ? <span className="cmp-badge cmp-badge-b">B</span> : null;
  const infoMedia = images.find(item => item.id === infoId);
  const info = details?.id === infoId ? details : infoMedia;
  const infoDimensions = infoId ? dimensions[infoId] : undefined;
  const ratio = a ? getGalleryAspectRatio(a, dimensions[a.id] ? dimensions[a.id].width / dimensions[a.id].height : undefined) : 1;
  if (!a || !b) return null;
  return createPortal(<div ref={dialog} className="cmp" role="dialog" aria-modal="true" aria-labelledby="compare-title">
    <style>{imageCompareStyles}</style>
    <header className="cmp-header">
      <div className="cmp-title"><span className="cmp-logo"><Columns2 /></span><div><strong id="compare-title">Compare images</strong><div className="cmp-muted">{images.length} images selected</div></div></div>
      <div className="cmp-controls">
        <div className="cmp-tabs" role="group" aria-label="Comparison view">
          <button type="button" className="cmp-btn" aria-pressed={view === 'gallery'} title="Gallery (1)" aria-keyshortcuts="1" onClick={() => setView('gallery')}><Grid2X2 /> Gallery</button>
          <button type="button" className="cmp-btn" aria-pressed={view === 'slider'} title="Slider (2)" aria-keyshortcuts="2" onClick={() => setView('slider')}><SlidersHorizontal /> Slider</button>
        </div>
        <div className="cmp-controls cmp-zoom-controls" role="group" aria-label={zoomState.synced ? 'Synchronized zoom' : `Zoom image ${number(targetId)}`}>
          <button type="button" className="cmp-btn cmp-sync" aria-label="Sync zoom and pan" aria-pressed={zoomState.synced} aria-keyshortcuts="L" title="Toggle sync (L). Turning sync on aligns all images to the active image." onClick={toggleSync}>{zoomState.synced ? <Link /> : <Unlink />}{zoomState.synced ? 'Sync' : 'Independent'}</button>
          <button type="button" className="cmp-btn cmp-icon" aria-label="Zoom out" title="Zoom out (−)" aria-keyshortcuts="-" disabled={viewport.zoom <= 1} onClick={() => setViewport(value => zoomViewport(value, value.zoom / 1.25))}><Minus /></button>
          <output className="cmp-zoom" aria-label="Zoom level">{viewport.zoom.toFixed(1)}×</output>
          <button type="button" className="cmp-btn cmp-icon" aria-label="Zoom in" title="Zoom in (+)" aria-keyshortcuts="+" disabled={viewport.zoom >= 8} onClick={() => setViewport(value => zoomViewport(value, value.zoom * 1.25))}><Plus /></button>
          <button type="button" className="cmp-btn" title={zoomState.synced ? 'Fit all images (0)' : 'Fit active image (0). Shift+0 fits all images.'} aria-keyshortcuts="0" onClick={() => setViewport(FIT_VIEWPORT)}><Maximize /> Fit</button>
        </div>
      </div>
      <button type="button" className="cmp-btn cmp-icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" aria-keyshortcuts="Shift+/" aria-expanded={shortcutsOpen} onClick={toggleShortcuts}><Keyboard /></button>
      <button ref={closeButton} type="button" className="cmp-btn cmp-icon cmp-close" aria-label="Close comparison" title="Close comparison (Esc)" onClick={() => onClose()}><X /></button>
    </header>
    <div className="cmp-subbar">
      {view === 'gallery' ? <div className="cmp-tabs" role="group" aria-label="Gallery layout">
        <button type="button" className="cmp-btn" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>Grid</button>
        <button type="button" className="cmp-btn" aria-pressed={layout === 'strip'} onClick={() => setLayout('strip')}>Strip</button>
      </div> : <div className="cmp-controls">
        <span className="cmp-muted">Reference A · Image {number(a.id)}</span>
        <button type="button" className="cmp-btn cmp-icon" aria-label="Previous candidate" disabled={images.length < 3} onClick={() => navigate(-1)}><ChevronLeft /></button>
        <span className="cmp-muted" aria-live="polite">B · Image {number(b.id)}</span>
        <button type="button" className="cmp-btn cmp-icon" aria-label="Next candidate" disabled={images.length < 3} onClick={() => navigate(1)}><ChevronRight /></button>
      </div>}
      {!zoomState.synced && <span className="cmp-active-label" role="status">Adjusting Image {number(targetId)} · Select an image to adjust it</span>}
      <span className="cmp-hint">{view === 'slider' ? 'Drag the divider to reveal · ' : ''}Scroll to zoom · Drag to pan · {zoomState.synced ? 'Synced across images' : 'Independent per image'}</span>
    </div>
    <div className="cmp-body"><main className="cmp-workspace">
      {view === 'gallery' ? <div className={layout === 'grid' ? 'cmp-grid' : 'cmp-strip'}>
        {images.map(media => <article key={media.id} className="cmp-card" data-reference={media.id === a.id} data-candidate={media.id === b.id} data-active={!zoomState.synced && targetId === media.id}>
          <div className="cmp-card-head">{roleBadge(media.id)}{imageLabel(media)}{imageActions(media)}</div>
          <div className="cmp-canvas" style={{ aspectRatio: ratio }}><CompareStage media={[media]} ratio={ratio} viewport={viewportFor(media.id)} setViewport={action => updateViewport(media.id, action)} onActivate={() => setActiveId(media.id)} canvasLabel={`Image ${number(media.id)} canvas`} scrollAxis={layout === 'strip' ? 'x' : 'y'} onDimensions={onDimensions} refreshSource={refreshSource} /></div>
        </article>)}
      </div> : <div className="cmp-pair">
        <div className="cmp-pair-head">{[b, a].map(media => <div key={media.id} className="cmp-card-head" data-active={!zoomState.synced && targetId === media.id}>{roleBadge(media.id)}{imageLabel(media)}{imageActions(media)}</div>)}</div>
        <div className="cmp-pair-view"><CompareStage media={[a, b]} ratio={ratio} viewport={viewport} setViewport={setViewport} viewports={zoomState.synced ? undefined : { [a.id]: viewportFor(a.id), [b.id]: viewportFor(b.id) }} canvasLabel={`Adjust image ${number(targetId)}`} view={view} split={split} setSplit={setSplit} onDimensions={onDimensions} refreshSource={refreshSource} /></div>
      </div>}
    </main>
      {info && <aside className="cmp-info" aria-label="Image information">
        <div className="cmp-info-head"><strong>Image {number(info.id)} · Details</strong><button ref={infoCloseButton} type="button" className="cmp-btn cmp-icon" aria-label="Close image information" onClick={closeInfo}><X /></button></div>
        {detailStatus === 'loading' && <p className="cmp-muted" role="status">Loading details…</p>}
        {detailStatus === 'error' && <p className="cmp-info-error" role="status">Full details unavailable. Showing available information.</p>}
        <dl><dt>Model</dt><dd>{info.imageModel ? getImageModelLabel(info.imageModel) : 'Unavailable'}</dd>
          <dt>Actual dimensions</dt><dd>{infoDimensions ? `${infoDimensions.width} × ${infoDimensions.height} px` : info.imageOutputSize || 'Unavailable'}</dd>
          <dt>{info.imageGenerationPrompt ? 'Generation prompt' : 'Prompt'}</dt><dd className="cmp-prompt">{info.imageGenerationPrompt || info.prompt || 'Unavailable'}</dd></dl>
      </aside>}
    </div>
    <footer className="cmp-footer"><div className="cmp-footer-title"><span>Selected images</span><span>Choose B · Pin a reference with Set as A</span></div>
      <div className="cmp-filmstrip" aria-label="Comparison candidates">{images.map(media => <div key={media.id} className="cmp-thumb" data-reference={media.id === a.id} data-candidate={media.id === b.id}>
        <button type="button" className="cmp-thumb-select" aria-label={`Compare image ${number(media.id)} as B`} aria-pressed={media.id === b.id} disabled={media.id === a.id} onClick={() => { setBId(media.id); setActiveId(media.id); }}>
          <ComparisonThumbnail media={media} loadedSource={dimensions[media.id]?.source} number={number(media.id)} />{roleBadge(media.id)}
        </button>
        <div className="cmp-thumb-row"><span>#{number(media.id)}</span><button type="button" disabled={media.id === a.id} aria-label={`Set image ${number(media.id)} as A`} onClick={() => setReference(media.id)}>{media.id === a.id ? 'Pinned A' : 'Set as A'}</button></div>
      </div>)}</div>
    </footer>
    {shortcutsOpen && <div className="cmp-shortcuts-backdrop" onClick={event => { if (event.target === event.currentTarget) closeShortcuts(); }}>
      <div ref={shortcutsPanel} className="cmp-shortcuts" role="dialog" aria-modal="true" aria-labelledby="compare-shortcuts-title">
        <div className="cmp-info-head"><strong id="compare-shortcuts-title">Compare shortcuts</strong><button ref={shortcutsClose} type="button" className="cmp-btn cmp-icon" aria-label="Close keyboard shortcuts" onClick={closeShortcuts}><X /></button></div>
        <p>With Sync off, click an image or its name to choose which image to adjust. Turning Sync on aligns all images to that image.</p>
        <dl>{SHORTCUTS.map(([keys, description]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{description}</dd></div>)}</dl>
        <p className="cmp-muted">Shortcuts pause while typing or adjusting the slider with its arrow keys. In the gallery, select 2+ images and press C to compare.</p>
      </div>
    </div>}
  </div>, document.body);
}

function ComparisonThumbnail({ media, loadedSource, number }: { media: GeneratedMedia; loadedSource?: string; number: number }) {
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const source = [media.thumbnailUrl, loadedSource].find(url => url && !failedSources.has(url));
  return source ? <img src={source} alt={`Image ${number}`} loading="lazy" onError={() => setFailedSources(previous => new Set([...previous, source]))} /> : <>Image {number}</>;
}
