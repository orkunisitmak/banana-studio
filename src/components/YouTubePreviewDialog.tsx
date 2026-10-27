import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Monitor, Smartphone, Sun, Moon, Menu, Search, Mic, Bell, Home, PlaySquare, Compass, MoreVertical, Shuffle, Crosshair, Youtube, CheckCircle2, History, ChevronLeft, ChevronRight, Grid } from 'lucide-react';
import type { GeneratedMedia } from '../types';
import { DESKTOP_PREVIEW_WIDTHS, MOBILE_PREVIEW_WIDTHS, PREVIEW_EXAMPLES, getPreviewLayout, type PreviewDevice } from './youtubePreview';
import { youtubePreviewStyles } from './youtubePreviewStyles';
import { YouTubeSafeZoneOverlay } from './YouTubeSafeZoneOverlay';

interface Props {
  media: GeneratedMedia;
  initialTitle: string;
  channelName?: string;
  currentIndex: number;
  totalImages: number;
  favoritesOnly: boolean;
  onNavigate: (direction: -1 | 1) => void;
  onClose: () => void;
  refreshSource: (media: GeneratedMedia) => Promise<string>;
}

function ChannelThumbnail({ index }: { index: number }) {
  const sample = PREVIEW_EXAMPLES[index];
  const [failed, setFailed] = useState(false);
  return failed ? <div className="ytp-image-status" role="status">{sample.channel} thumbnail unavailable</div>
    : <img src={`/youtube-preview/${sample.image}`} alt={`${sample.channel}: ${sample.title}`} className="ytp-channel-thumbnail" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

const PreviewImage: React.FC<{ media: GeneratedMedia; refreshSource: Props['refreshSource'] }> = ({ media, refreshSource }) => {
  const [source, setSource] = useState(media.url);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const refreshed = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const retry = async () => {
    if (!media) return;
    const token = ++request.current;
    refreshed.current = true; setStatus('loading');
    try {
      const url = await refreshSource(media);
      if (alive.current && token === request.current) { setSource(url); setAttempt(value => value + 1); }
    } catch { if (alive.current && token === request.current) setStatus('error'); }
  };
  return <>
    <img key={`${source}:${attempt}`} src={source} alt="Your thumbnail in the YouTube feed" draggable={false} referrerPolicy="no-referrer" loading="eager" decoding="async"
      style={{ opacity: status === 'ready' ? 1 : 0 }} onLoad={() => setStatus('ready')}
      onError={() => {
        if (!refreshed.current) void retry();
        else setStatus('error');
      }} />
    {status !== 'ready' && <div className="ytp-image-status" role="status">{status === 'loading' ? 'Loading image…' : <>Image unavailable <button type="button" onClick={() => void retry()}>Retry image</button></>}</div>}
  </>;
};

export const YouTubePreviewDialog: React.FC<Props> = ({ media, initialTitle, channelName, currentIndex, totalImages, favoritesOnly, onNavigate, onClose, refreshSource }) => {
  const [device, setDevice] = useState<PreviewDevice>(() => window.innerWidth < 768 ? 'mobile' : 'desktop');
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [desktopWidth, setDesktopWidth] = useState(0);
  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [mobileWidth, setMobileWidth] = useState(() => window.innerWidth < 390 ? (window.innerWidth < 360 ? 320 : 360) : 390);
  const [dark, setDark] = useState(false);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [titleEdit, setTitleEdit] = useState<{ source: string; value: string } | null>(null);
  const title = titleEdit?.source === initialTitle ? titleEdit.value : initialTitle || 'Your next video';
  const [channel, setChannel] = useState(channelName || 'Your channel');
  const [position, setPosition] = useState(() => window.innerWidth < 768 ? 0 : 1);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const selectedCard = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < totalImages - 1;
  const navigationRef = useRef({ onNavigate, hasPrevious, hasNext });
  navigationRef.current = { onNavigate, hasPrevious, hasNext };
  const width = device === 'desktop' ? desktopWidth || (windowWidth >= 1024 ? windowWidth : 1440) : mobileWidth;
  const layout = getPreviewLayout(device, width);
  const reveal = () => {
    const container = scroll.current; const card = selectedCard.current;
    if (!container || !card) return;
    const outer = container.getBoundingClientRect(); const inner = card.getBoundingClientRect();
    container.scrollTo({ left: container.scrollLeft + inner.left - outer.left - (container.clientWidth - inner.width) / 2,
      top: Math.max(0, container.scrollTop + inner.top - outer.top - (device === 'mobile' ? 145 : 170)) });
  };
  useEffect(() => { reveal(); }, [device, width, position]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const siblings = [...document.body.children].filter(node => node instanceof HTMLElement && node !== dialog.current) as HTMLElement[];
    const inert = siblings.map(node => node.inert);
    siblings.forEach(node => { node.inert = true; });
    document.body.style.overflow = 'hidden'; close.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.defaultPrevented &&
        !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const target = event.target;
        const editing = target instanceof HTMLElement && (target.isContentEditable ||
          target.closest('input, textarea, select, [role="slider"], [role="combobox"], [role="textbox"]'));
        if (!editing) {
          event.preventDefault(); event.stopPropagation();
          const navigation = navigationRef.current;
          if (event.key === 'ArrowLeft' ? navigation.hasPrevious : navigation.hasNext) {
            navigation.onNavigate(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
        const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      siblings.forEach((node, index) => { node.inert = inert[index]; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  let neighborIndex = 0;
  return createPortal(<div className="ytp-dialog" role="dialog" aria-modal="true" aria-labelledby="ytp-title" aria-describedby="ytp-description" ref={dialog}>
    <style>{youtubePreviewStyles}</style>
    <header className="ytp-header"><div><h2 id="ytp-title"><Youtube size={22} /> YouTube preview</h2><p id="ytp-description">See how your thumbnail reads in the feed.</p></div>
      <button type="button" ref={close} onClick={onClose} className="ytp-icon-button" aria-label="Close YouTube preview"><X /></button></header>
    <div className="ytp-controls">
      <div className="ytp-navigation" role="group" aria-label="Browse gallery images">
        <button type="button" className="ytp-icon-button" aria-label="Previous preview image" aria-keyshortcuts="ArrowLeft" title="Previous image (←)" disabled={!hasPrevious} onClick={() => onNavigate(-1)}><ChevronLeft size={20} /></button>
        <span className="ytp-navigation-status" role="status">{currentIndex >= 0 ? `${currentIndex + 1} / ${totalImages}` : 'Current image'}<small>{favoritesOnly ? 'Favorites' : 'Gallery'} · ← →</small></span>
        <button type="button" className="ytp-icon-button" aria-label="Next preview image" aria-keyshortcuts="ArrowRight" title="Next image (→)" disabled={!hasNext} onClick={() => onNavigate(1)}><ChevronRight size={20} /></button>
      </div>
      <div className="ytp-switch" aria-label="Preview device">{(['desktop', 'mobile'] as const).map(value => <button type="button" key={value} aria-pressed={device === value} onClick={() => { if (device !== value) { setDevice(value); setPosition(value === 'mobile' ? 0 : 1); } }}>{value === 'desktop' ? <Monitor size={17} /> : <Smartphone size={17} />}{value === 'desktop' ? 'Desktop' : 'Mobile web'}</button>)}</div>
      <label className="ytp-size-label"><span className="ytp-sr-only">Preview viewport width</span><select aria-label="Preview viewport width" value={device === 'desktop' ? desktopWidth : mobileWidth} onChange={event => device === 'desktop' ? setDesktopWidth(Number(event.target.value)) : setMobileWidth(Number(event.target.value))}>
        {device === 'desktop' && <option value={0}>{windowWidth >= 1024 ? 'Current window' : 'Desktop reference'} · {windowWidth >= 1024 ? windowWidth : 1440}px</option>}
        {(device === 'desktop' ? DESKTOP_PREVIEW_WIDTHS : MOBILE_PREVIEW_WIDTHS).map(value => <option key={value} value={value}>{`${value}px ${device === 'desktop' ? 'window' : 'phone'}`}</option>)}
      </select></label>
      <button type="button" className="ytp-icon-button" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(value => !value)}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
      <button type="button" className="ytp-action" onClick={() => setPosition(value => (value + 1) % 6)}><Shuffle size={16} />Move thumbnail</button>
      <button type="button" className="ytp-action" onClick={reveal}><Crosshair size={16} />Find mine</button>
      <button
        type="button"
        className="ytp-action"
        style={showSafeZones ? { background: 'rgba(234, 179, 8, 0.25)', color: '#facc15', borderColor: 'rgba(234, 179, 8, 0.5)' } : undefined}
        onClick={() => setShowSafeZones(value => !value)}
        title="Toggle YouTube Safe Zones & Rule of Thirds"
      >
        <Grid size={16} />
        {showSafeZones ? 'Safe Zones ON' : 'Safe Zones'}
      </button>
      <span className="ytp-dimensions" role="status">{Math.round(layout.thumbnailWidth)} × {Math.round(layout.thumbnailHeight)} px <span>· 100% size</span></span>
    </div>
    <details className="ytp-edit"><summary>Edit preview title &amp; channel</summary><div>
      <label>Video title<input value={title} maxLength={100} onChange={event => setTitleEdit({ source: initialTitle, value: event.target.value })} /></label>
      <label>Channel<input value={channel} maxLength={60} onChange={event => setChannel(event.target.value)} /></label>
    </div></details>
    <div className="ytp-scroll" ref={scroll} tabIndex={0} aria-label="YouTube homepage mockup; scroll to explore at actual display size">
      <div className="ytp-canvas" data-device={device} data-sidebar={layout.sidebar === 240 ? 'expanded' : 'mini'} data-theme={dark ? 'dark' : 'light'} style={{ width, '--ytp-columns': layout.columns, '--ytp-sidebar': `${layout.sidebar}px`, '--ytp-padding': `${layout.padding}px`, '--ytp-gap': `${layout.gap}px`, '--ytp-feed-width': `${layout.feedWidth}px` } as React.CSSProperties}>
        <div className="ytp-masthead" aria-hidden="true"><Menu size={22} /><span className="ytp-logo"><Youtube fill="#ff0033" stroke="white" size={32} /><b>YouTube</b></span>{device === 'desktop' && <><span className="ytp-search">Search<Search size={21} /></span><Mic size={21} /></>}<span className="ytp-masthead-end"><Search size={21} /><Bell size={21} /><span className="ytp-account">Y</span></span></div>
        {device === 'desktop' && <aside className="ytp-sidebar" aria-hidden="true"><span><Home /><span>Home</span></span><span><Compass /><span>Shorts</span></span><span><PlaySquare /><span>Subscriptions</span></span><span><span className="ytp-account">Y</span><span>You</span></span>{layout.sidebar === 240 && <><span><History /><span>History</span></span><hr /><strong>Explore</strong><span><Compass /><span>Trending</span></span><span><PlaySquare /><span>Music</span></span><span><PlaySquare /><span>Gaming</span></span></>}</aside>}
        <div className="ytp-main"><div className="ytp-chips" aria-hidden="true">{['All', 'Entertainment', 'Travel', 'Food', 'Recently uploaded', 'Watched', 'New to you'].map((chip, index) => <span key={chip} data-active={index === 0}>{chip}</span>)}</div>
          <div className="ytp-grid">{Array.from({ length: PREVIEW_EXAMPLES.length + 1 }, (_, index) => {
            const isSelected = index === position;
            const sampleIndex = isSelected ? 0 : neighborIndex++;
            const sample = PREVIEW_EXAMPLES[sampleIndex];
            const cardTitle = isSelected ? title || 'Your next video' : sample.title;
            const cardChannel = isSelected ? channel || 'Your channel' : sample.channel;
            return <article className="ytp-card" key={isSelected ? 'selected-preview' : `context-${sampleIndex}`} ref={isSelected ? selectedCard : undefined} data-selected-thumbnail={isSelected || undefined} aria-label={isSelected ? 'Your video preview' : 'Sample video'}>
              <div className="ytp-thumbnail" style={{ position: 'relative' }}>{isSelected ? <><PreviewImage key={`${media.id}:${media.url}`} media={media} refreshSource={refreshSource} /><YouTubeSafeZoneOverlay isVisible={showSafeZones} /></> : <ChannelThumbnail index={sampleIndex} />}<span className="ytp-duration">{isSelected ? '12:48' : sample.duration}</span></div>
              <div className="ytp-card-details"><span className="ytp-avatar" style={{ background: '#6d43c0' }} aria-hidden="true">{isSelected ? cardChannel.charAt(0).toUpperCase() : <img src={`/youtube-preview/${sample.avatar}`} alt="" loading="lazy" />}</span><div className="ytp-card-copy"><h3>{cardTitle}</h3><p className="ytp-metadata"><span>{cardChannel}</span>{!isSelected && <CheckCircle2 size={13} aria-label="Verified channel" />}<span>▷ {isSelected ? '128K' : sample.views}</span><span>{isSelected ? '1d ago' : sample.age}</span></p></div><MoreVertical size={20} aria-hidden="true" /></div>
            </article>;
          })}</div>
        </div>
      </div>
    </div>
    <footer className="ytp-footer">YouTube web layout measured Sep 25, 2026 · Airrack, MrBeast &amp; Ryan Trahan examples from the same date · Your video's stats are placeholders. Layouts vary by account; use 100% browser zoom.</footer>
  </div>, document.body);
};
