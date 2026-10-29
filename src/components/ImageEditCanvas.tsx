import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, Scan, Trash2, X } from 'lucide-react';
import type { ReferenceImage } from '../types';
import { getEditRegionLayers, isValidEditRegion, MAX_EDIT_LAYERS, normalizeEditPoint, regionFromFreehand, regionFromLayers, type ImageEditLayer, type ImageEditPoint, type ImageEditRegion } from '../lib/images/imageEditRegion';

export interface ImageEditCanvasProps {
  source: ReferenceImage;
  region?: ImageEditRegion;
  onChange: (region: ImageEditRegion | undefined) => void;
  onCanvasLoad?: (canvas: { width: number; height: number }) => void;
  /** null lets a responsive imageClassName control the viewer height. */
  maxHeight?: string | null;
  imageClassName?: string;
}

type Gesture = { pointerId: number; points: ImageEditPoint[]; bounds: DOMRect; tool: ImageEditLayer['tool']; layerId: string; append: boolean; layers: ImageEditLayer[] };
type EditHistory = { region: ImageEditRegion | undefined; activeId: string | undefined; appendArmed: boolean };
const shapePoints = (shape: Pick<ImageEditLayer, 'x' | 'y' | 'width' | 'height' | 'points'>) => shape.points || [
  { x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y },
  { x: shape.x + shape.width, y: shape.y + shape.height }, { x: shape.x, y: shape.y + shape.height },
];
const svgPoints = (points: ImageEditPoint[]) => points.map(point => `${Number((point.x * 1000).toFixed(2))},${Number((point.y * 1000).toFixed(2))}`).join(' ');
const toolClass = (active: boolean) => `flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50 ${active ? 'bg-lime-400/10 text-lime-300' : 'text-gray-400 hover:bg-white/[0.04] hover:text-white'}`;
const actionClass = 'grid h-9 w-9 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50 disabled:pointer-events-none disabled:opacity-30';

/** The same selection surface is used in the gallery and the reference editor. */
export const ImageEditCanvas: React.FC<ImageEditCanvasProps> = ({ source, region, onChange, onCanvasLoad, maxHeight = 'min(58vh, 640px)', imageClassName = '' }) => {
  const imageSrc = /^(?:data:|blob:|https?:\/\/|\/)/i.test(source.data) ? source.data : `data:${source.mimeType || 'image/png'};base64,${source.data}`;
  const [tool, setTool] = useState<'mask' | 'rectangle'>('mask');
  const [draft, setDraft] = useState<ImageEditPoint[] | undefined>();
  const [canvas, setCanvas] = useState<{ width: number; height: number }>();
  const [loadError, setLoadError] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [activeId, setActiveId] = useState<string | undefined>(() => getEditRegionLayers(region).at(-1)?.id);
  const [appendArmed, setAppendArmed] = useState(false);
  const [layerLimitReached, setLayerLimitReached] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const history = useRef<EditHistory[]>([]);
  const nextLayerNumber = useRef(1);
  const image = useRef<HTMLImageElement>(null);
  const instructionsId = useId();
  const selectionMaskId = `${instructionsId}-selection-union`;
  const layers = getEditRegionLayers(region);
  const activeLayer = appendArmed ? undefined : layers.find(layer => layer.id === activeId) || layers.at(-1);

  useEffect(() => {
    gesture.current = null;
    history.current = [];
    setDraft(undefined);
    setCanUndo(false);
    setActiveId(getEditRegionLayers(region).at(-1)?.id);
    setAppendArmed(false);
    setLayerLimitReached(false);
    setLoadError(false);
    const loadedImage = image.current;
    const size = loadedImage?.complete && loadedImage.naturalWidth ? { width: loadedImage.naturalWidth, height: loadedImage.naturalHeight } : undefined;
    setCanvas(size);
    onCanvasLoad?.(size || { width: 0, height: 0 });
  }, [source.id, imageSrc]);

  const saveLayers = (next: ImageEditLayer[], selectedId?: string) => {
    history.current.push({ region, activeId: activeLayer?.id, appendArmed });
    if (history.current.length > 20) history.current.shift();
    setCanUndo(true);
    setActiveId(selectedId || next.at(-1)?.id);
    setAppendArmed(false);
    setLayerLimitReached(false);
    onChange(regionFromLayers(next));
  };
  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    gesture.current = null;
    setDraft(undefined);
    setActiveId(previous.activeId);
    setAppendArmed(previous.appendArmed);
    setLayerLimitReached(false);
    onChange(previous.region);
    setCanUndo(history.current.length > 0);
  };
  const removeLayer = (id: string) => {
    gesture.current = null;
    setDraft(undefined);
    const index = layers.findIndex(layer => layer.id === id);
    if (index < 0) return;
    const next = layers.filter(layer => layer.id !== id);
    const nextActive = activeLayer?.id === id ? next[Math.max(0, index - 1)]?.id : activeLayer?.id;
    saveLayers(next, nextActive);
  };
  const newLayerId = () => {
    let id = `selection-${nextLayerNumber.current++}`;
    while (layers.some(layer => layer.id === id)) id = `selection-${nextLayerNumber.current++}`;
    return id;
  };
  const addPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const drawing = gesture.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    const p = normalizeEditPoint({ x: event.clientX, y: event.clientY }, drawing.bounds);
    if (drawing.tool === 'rectangle') drawing.points = [drawing.points[0], p];
    else {
      const last = drawing.points[drawing.points.length - 1];
      const distance = Math.hypot((p.x - last.x) * drawing.bounds.width, (p.y - last.y) * drawing.bounds.height);
      if (distance < 1.5) return;
      drawing.points.push(p);
      if (drawing.points.length > 4096) drawing.points = drawing.points.filter((_, index) => index % 2 === 0);
    }
    setDraft([...drawing.points]);
  };
  const cancelGesture = () => { gesture.current = null; setDraft(undefined); };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    const drawing = gesture.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    addPoint(event);
    const points = drawing.points;
    let next: ImageEditRegion | undefined;
    if (drawing.tool === 'rectangle' && points.length === 2) {
      const [start, end] = points;
      next = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      if (!isValidEditRegion(next)) next = undefined;
    } else next = regionFromFreehand(points, drawing.bounds);
    if (next && next.width * drawing.bounds.width >= 3 && next.height * drawing.bounds.height >= 3) {
      const layer: ImageEditLayer = { ...next, id: drawing.layerId, tool: drawing.tool };
      const collection = drawing.append ? [...drawing.layers, layer] : drawing.layers.map(previous => previous.id === layer.id ? layer : previous);
      saveLayers(collection, layer.id);
    }
    cancelGesture();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  let shownLayers = layers;
  const drawing = gesture.current;
  if (draft?.length && drawing) {
    const start = draft[0], end = draft[draft.length - 1];
    const layer: ImageEditLayer = drawing.tool === 'rectangle'
      ? { id: drawing.layerId, tool: 'rectangle', x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
      : { id: drawing.layerId, tool: 'mask', x: 0, y: 0, width: 1, height: 1, points: draft };
    shownLayers = drawing.append ? [...drawing.layers, layer] : drawing.layers.map(previous => previous.id === layer.id ? layer : previous);
  }
  const selected = isValidEditRegion(region);
  const shownActiveId = drawing?.layerId || activeLayer?.id;

  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label="Selection tools" className="flex items-center rounded-xl border border-white/[0.07] bg-[#171e28] p-1">
        <button type="button" aria-pressed={tool === 'mask'} className={toolClass(tool === 'mask')} onClick={() => { cancelGesture(); setTool('mask'); }} title="Draw a filled mask"><Pencil className="h-3.5 w-3.5" /><span>Mask</span></button>
        <button type="button" aria-pressed={tool === 'rectangle'} className={toolClass(tool === 'rectangle')} onClick={() => { cancelGesture(); setTool('rectangle'); }} title="Select a rectangle"><Scan className="h-3.5 w-3.5" /><span>Rectangle</span></button>
        <span className="mx-1 h-4 w-px bg-white/[0.08]" />
        <button type="button" aria-label="Undo selection" title="Undo selection (⌘/Ctrl Z)" disabled={!canUndo} onClick={undo} className={actionClass}><RotateCcw className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label="Clear selection" title="Clear all layers" disabled={!region && !draft} onClick={() => { cancelGesture(); if (region) saveLayers([]); }} className={actionClass}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <span className={`flex items-center gap-1.5 text-[11px] ${selected ? 'text-lime-300/80' : 'text-gray-500'}`} aria-live="polite">
        {selected ? <><Check className="h-3 w-3" /> {layers.length === 1 ? 'Area selected' : `${layers.length} areas selected`}</> : tool === 'mask' ? 'Draw around the area to edit' : 'Drag to select an area'}
      </span>
    </div>
    <p id={instructionsId} className="sr-only">Draw around the object and release to fill the mask. Hold Shift while drawing to add another layer. Add layer also keeps previous selections. A normal drawing replaces the selected layer. Everything outside all layers stays unchanged. Keyboard: Enter creates a central rectangle in a new layer; arrow keys move the selected rectangle, Shift and arrow keys resize it. Control or Command Z undoes; Delete removes the selected layer; Escape cancels a stroke.</p>
    <div className="flex justify-center" data-edit-image-center>
      <div role="group" aria-label="Edit mask canvas" aria-describedby={instructionsId} tabIndex={0}
        data-edit-image-frame
        className="relative w-fit max-w-full touch-none select-none overflow-hidden rounded-2xl bg-black/30 outline-none ring-1 ring-inset ring-white/[0.06] focus-visible:ring-2 focus-visible:ring-lime-400/50"
        style={{ cursor: canvas && !loadError ? 'crosshair' : 'default' }}
        onPointerDown={event => {
          if (!canvas || loadError || event.button !== 0 || gesture.current) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
          const bounds = image.current!.getBoundingClientRect();
          const start = normalizeEditPoint({ x: event.clientX, y: event.clientY }, bounds);
          const append = event.shiftKey || appendArmed || !activeLayer;
          if (append && layers.length >= MAX_EDIT_LAYERS) { setLayerLimitReached(true); return; }
          gesture.current = { pointerId: event.pointerId, points: [start], bounds, tool, layerId: append ? newLayerId() : activeLayer!.id, append, layers };
          setLayerLimitReached(false);
          setDraft([start]);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={addPoint} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); return; }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); undo(); return; }
          if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancelGesture(); return; }
          if (!canvas || loadError) return;
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); if (activeLayer) removeLayer(activeLayer.id); return; }
          if ((event.key === 'Enter' || event.key === ' ') && !activeLayer) {
            event.preventDefault(); event.stopPropagation();
            if (layers.length >= MAX_EDIT_LAYERS) { setLayerLimitReached(true); return; }
            setTool('rectangle');
            const id = newLayerId();
            saveLayers([...layers, { id, tool: 'rectangle', x: .35, y: .35, width: .3, height: .3 }], id);
            return;
          }
          if (!activeLayer || activeLayer.points || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const bounds = image.current!.getBoundingClientRect();
          const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
          const delta = (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) * 2 / (horizontal ? bounds.width : bounds.height);
          const next = { ...activeLayer };
          if (event.shiftKey) {
            const key = horizontal ? 'width' : 'height';
            // The edge limit is applied last: a minimum size must never push a layer past the image.
            // A saved layer can sit exactly on the edge (no room at all): keep its size.
            const available = 1 - (horizontal ? next.x : next.y);
            // Shrinking never grows a sliver below the minimum; growing respects the minimum and the edge.
            if (available > 0) next[key] = delta < 0 ? Math.min(next[key], Math.max(.005, next[key] + delta)) : Math.min(available, Math.max(.005, next[key] + delta));
          } else {
            const key = horizontal ? 'x' : 'y';
            next[key] = Math.max(0, Math.min(1 - (horizontal ? next.width : next.height), next[key] + delta));
          }
          saveLayers(layers.map(layer => layer.id === next.id ? next : layer), next.id);
        }}>
        <img key={imageSrc} ref={image} src={imageSrc} alt="Image to edit" draggable={false}
          className={`block h-auto max-w-full object-contain ${imageClassName}`} style={{ maxHeight: maxHeight ?? undefined }}
          onLoad={event => {
            const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
            setCanvas(next); setLoadError(false); onCanvasLoad?.(next);
          }} onError={() => { setLoadError(true); setCanvas(undefined); onCanvasLoad?.({ width: 0, height: 0 }); }} />
        {!!shownLayers.length && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <defs><mask id={selectionMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000" style={{ maskType: 'luminance' }}>
            <rect width="1000" height="1000" fill="white" />
            {shownLayers.map(layer => shapePoints(layer).length > 2 && <polygon key={layer.id} points={svgPoints(shapePoints(layer))} fill="black" fillRule="evenodd" />)}
          </mask></defs>
          <rect width="1000" height="1000" fill="rgba(0,0,0,.25)" mask={`url(#${selectionMaskId})`} />
          {shownLayers.map(layer => {
            const active = layer.id === shownActiveId;
            return <polygon key={layer.id} data-edit-layer={layer.id} data-active-layer={active || undefined} points={svgPoints(shapePoints(layer))}
              fill={active ? 'rgba(163,230,53,.22)' : 'rgba(163,230,53,.10)'} stroke={active ? '#a3e635' : '#84cc16'} strokeWidth={active ? '2' : '1.25'}
              fillRule="evenodd" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />;
          })}
        </svg>}
      </div>
    </div>
    {loadError ? <p role="alert" className="text-xs text-red-300">This image could not be loaded. Reopen it to try again.</p>
      : <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-gray-500"><span>Only the selected areas change.</span>{canvas && <span>{canvas.width} × {canvas.height}</span>}</div>}
    <p className={`px-1 text-[10px] ${layerLimitReached ? 'text-amber-300' : 'text-gray-500'}`} role={layerLimitReached ? 'status' : undefined}>
      {layerLimitReached ? `Up to ${MAX_EDIT_LAYERS} layers. Remove one to add another.` : appendArmed ? 'Draw to add a new layer.' : 'Shift + draw adds a layer. Select a layer to redraw it.'}
    </p>
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-1.5" data-edit-layer-strip>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" role="list" aria-label="Edit layers">
        {layers.map((layer, index) => {
          const active = layer.id === activeLayer?.id;
          const label = `${layer.tool === 'mask' ? 'Mask' : 'Rectangle'} ${index + 1}`;
          const Icon = layer.tool === 'mask' ? Pencil : Scan;
          return <div key={layer.id} role="listitem" className={`flex h-8 shrink-0 items-center rounded-lg border ${active ? 'border-lime-400/25 bg-lime-400/10 text-lime-300' : 'border-white/[0.07] bg-[#171e28] text-gray-400'}`}>
            <button type="button" aria-label={`Select ${label} layer`} aria-pressed={active} className="flex h-full items-center gap-1.5 rounded-l-lg px-2.5 text-[11px] font-medium transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50" onClick={() => { cancelGesture(); setActiveId(layer.id); setAppendArmed(false); setTool(layer.tool); setLayerLimitReached(false); }}><Icon className="h-3 w-3" />{label}</button>
            <button type="button" aria-label={`Remove ${label} layer`} className="grid h-7 w-6 place-items-center rounded-r-lg text-gray-500 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50" onClick={() => removeLayer(layer.id)}><X className="h-3 w-3" /></button>
          </div>;
        })}
        {!layers.length && <span className="whitespace-nowrap px-2 text-[11px] text-gray-500">No layers yet</span>}
      </div>
      <button type="button" aria-label="Add edit layer" aria-pressed={appendArmed} disabled={layers.length >= MAX_EDIT_LAYERS} onClick={() => { cancelGesture(); setActiveId(undefined); setAppendArmed(true); setLayerLimitReached(false); }} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50 ${appendArmed ? 'bg-lime-400/10 text-lime-300' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}><Plus className="h-3.5 w-3.5" />Add layer</button>
    </div>
  </div>;
};
