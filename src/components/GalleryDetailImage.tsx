import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { useGalleryImageSource } from './useGalleryImageSource';
import { getImageZoomCommand } from './imageZoomKeyboard';

export const DetailImage: React.FC<{
  src: string;
  fallbackSrc?: string;
  alt: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
}> = ({ src, fallbackSrc, alt, className, onClick }) => {
  const imageSource = useGalleryImageSource(src, fallbackSrc);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef({ zoom: 1, x: 0, y: 0 });
  const [viewport, setViewport] = useState(viewportRef.current);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Cached/data images can finish before the loading effect runs. Also
    // settle them on retry when the URL itself has not changed.
    if (imageRef.current?.complete && imageRef.current.naturalWidth) imageSource.onLoad();
  }, [imageSource.url, imageSource.key]);

  const updateViewport = useCallback((next: typeof viewportRef.current) => {
    const stage = stageRef.current;
    const image = imageRef.current;
    const zoom = Math.max(1, Math.min(8, next.zoom));
    const maxX = stage && image ? Math.max(0, (image.offsetWidth * zoom - stage.clientWidth) / 2) : 0;
    const maxY = stage && image ? Math.max(0, (image.offsetHeight * zoom - stage.clientHeight) / 2) : 0;
    const value = { zoom, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    viewportRef.current = value;
    setViewport(value);
  }, []);

  const fitImage = useCallback(() => updateViewport({ zoom: 1, x: 0, y: 0 }), [updateViewport]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image?.naturalWidth) return;
    const current = viewportRef.current;
    const zoom = Math.max(1, Math.min(8, current.zoom * factor));
    const rect = stage.getBoundingClientRect();
    const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    const ratio = zoom / current.zoom;
    updateViewport({ zoom, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio });
  }, [updateViewport]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const blocked = Boolean((event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]')
        || document.querySelector('[role="dialog"]:not([data-gallery-detail-dialog]), [role="menu"], [role="listbox"], [data-control-dropdown-dismiss]'));
      const command = getImageZoomCommand(event, blocked);
      if (!command || !imageRef.current?.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();
      if (command === 'fit') fitImage();
      else zoomAt(command === 'in' ? 1.25 : 1 / 1.25);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [zoomAt, fitImage]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('button') || !event.deltaY || !imageRef.current?.naturalWidth) return;
      // React's wheel listener is passive; a local non-passive listener keeps
      // zoom from scrolling the modal or triggering browser zoom.
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
      zoomAt(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.0025), event.clientX, event.clientY);
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    const resize = new ResizeObserver(() => updateViewport(viewportRef.current));
    resize.observe(stage);
    return () => { stage.removeEventListener('wheel', wheel); resize.disconnect(); };
  }, [zoomAt, updateViewport]);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={stageRef}
      className={`relative flex w-full min-w-0 min-h-0 shrink-0 md:shrink md:h-full md:max-h-full items-center justify-center overflow-hidden ${imageSource.loading || imageSource.failed ? 'min-h-[200px]' : ''}`}
      data-gallery-image-zoom={viewport.zoom}
      style={{ cursor: viewport.zoom > 1 ? isDragging ? 'grabbing' : 'grab' : undefined }}
      onClick={event => { if (viewport.zoom > 1) event.stopPropagation(); }}
      onDoubleClick={event => { event.stopPropagation(); fitImage(); }}
      onPointerDown={event => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || viewportRef.current.zoom <= 1 || (event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: viewportRef.current.x, panY: viewportRef.current.y };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        updateViewport({ zoom: viewportRef.current.zoom, x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => { dragRef.current = null; setIsDragging(false); }}
    >
    {imageSource.url && <img
      ref={imageRef}
      src={imageSource.url}
      alt={alt}
      className={className}
      style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, userSelect: 'none' }}
      title="Scroll or +/− to zoom · Drag to pan · 0 or double-click to fit"
      onClick={onClick}
      onLoad={() => { imageSource.onLoad(); updateViewport(viewportRef.current); }}
      onError={imageSource.onError}
      loading="eager"
      fetchPriority="high"
      decoding="async"
      draggable={false}
    />}
    {imageSource.loading && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-black/30 text-sm text-white">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading image…
    </div>}
    {imageSource.failed && <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-center gap-3 rounded-lg bg-gray-900/95 p-3 text-sm text-gray-300">
      <span role="alert">{imageSource.preview ? 'Showing preview. Full image could not be loaded.' : 'Image could not be loaded.'}</span>
      <button type="button" className="rounded-lg bg-violet-600 px-3 py-2 text-white hover:bg-violet-500" onClick={event => { event.stopPropagation(); imageSource.retry(); }}>Retry loading image</button>
    </div>}
    {imageSource.url && <div role="group" aria-label="Image zoom" className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-full border border-white/15 bg-black/80 p-1 text-white shadow-lg"
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <button type="button" aria-label="Zoom image out" title="Zoom out (−)" aria-keyshortcuts="-" disabled={viewport.zoom <= 1 || imageSource.loading}
        className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-35"
        onClick={() => zoomAt(1 / 1.25)}><Minus className="h-4 w-4" /></button>
      <button type="button" aria-label="Reset image zoom" aria-description={`${Math.round(viewport.zoom * 100)}% of fitted size`} title="Fit image (0)" aria-keyshortcuts="0"
        className="h-9 min-w-14 rounded-full px-2 text-xs font-medium tabular-nums hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        onClick={fitImage}>{viewport.zoom === 1 ? 'Fit' : `${Math.round(viewport.zoom * 100)}%`}</button>
      <button type="button" aria-label="Zoom image in" title="Zoom in (+)" disabled={viewport.zoom >= 8 || imageSource.loading}
        className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-35"
        onClick={() => zoomAt(1.25)}><Plus className="h-4 w-4" /></button>
    </div>}
    </div>
  );
};
