import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FolderOpen, Globe2, Loader2, Pencil, Plus, X } from 'lucide-react';
import type { SavedReferenceImage } from '../types';
import { saveReferenceImage } from '../services/storageService';
import { SavedVisibilityControl } from './SavedVisibilityControl';

export const SavedReferenceImages: React.FC<{
  images: SavedReferenceImage[];
  onAdd: (image: SavedReferenceImage) => void;
  onSaved: (image: SavedReferenceImage) => void;
  onRemove: (id: string) => Promise<void>;
  onDragStart: (event: React.DragEvent, image: SavedReferenceImage) => void;
  onDragEnd: (event: React.DragEvent) => void;
}> = ({ images, onAdd, onSaved, onRemove, onDragStart, onDragEnd }) => {
  const [editing, setEditing] = useState<SavedReferenceImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async () => {
    if (!editing || busy) return;
    setBusy(true); setError('');
    try {
      const saved = await saveReferenceImage(editing);
      if (mounted.current) { onSaved(saved); setEditing(null); }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save reference.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onRemove(id); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not remove reference.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="p-3" aria-label="Saved reference images">
    {editing ? <div className="space-y-3">
      <div className="flex items-center gap-2"><button type="button" aria-label="Back to saved images" disabled={busy} onClick={() => { setEditing(null); setError(''); }} className="rounded p-1.5 text-gray-400 hover:bg-white/5"><ArrowLeft className="h-4 w-4" /></button><h3 className="text-xs font-semibold text-gray-200">Edit saved reference</h3></div>
      <img src={editing.data} alt="Saved reference" className="mx-auto h-24 w-24 rounded-lg object-cover" />
      <label className="block text-[11px] text-gray-400">Name<input aria-label="Saved reference name" value={editing.name || ''} maxLength={80} disabled={busy} onChange={event => setEditing({ ...editing, name: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#121821] px-2 text-xs text-gray-100" /></label>
      <SavedVisibilityControl isShared={editing.isShared === true} disabled={busy} onChange={isShared => setEditing({ ...editing, isShared })} />
      <button type="button" disabled={busy} onClick={() => void save()} className="ml-auto flex min-h-8 items-center gap-1.5 rounded-lg bg-violet-500 px-3 text-xs text-white disabled:opacity-40">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save reference</button>
    </div> : images.length === 0 ? <div className="py-4 text-center text-gray-500"><FolderOpen className="mx-auto mb-2 h-8 w-8 opacity-50" /><p className="text-xs">Drag reference images here to save them</p></div> : <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto p-0.5 custom-scrollbar">
      {images.map((image, index) => <div key={image.id} className="group relative min-w-0">
        <button type="button" disabled={busy} aria-label={`Add saved reference ${image.name || index + 1}`} onClick={() => onAdd(image)} draggable onDragStart={event => onDragStart(event, image)} onDragEnd={onDragEnd} className="relative block aspect-square w-full overflow-hidden rounded-lg bg-gray-800 hover:ring-2 hover:ring-violet-500 focus-visible:ring-2 focus-visible:ring-violet-400">
          <img src={image.data} alt="" className="h-full w-full object-cover" /><span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100"><Plus className="h-4 w-4 text-white" /></span>
        </button>
        {image.isShared && <span title="All users" className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/70 p-0.5 text-violet-200"><Globe2 className="h-3 w-3" /></span>}
        {image.canEdit !== false && <>
          <button type="button" disabled={busy} aria-label={`Edit saved reference ${image.name || index + 1}`} onClick={() => { setEditing({ ...image }); setError(''); }} className="absolute right-0.5 top-0.5 grid h-7 w-7 place-items-center rounded bg-black/70 text-white hover:bg-violet-600"><Pencil className="h-3 w-3" /></button>
          <button type="button" disabled={busy} aria-label={`Remove saved reference ${image.name || index + 1}`} onClick={() => void remove(image.id)} className="absolute bottom-0.5 right-0.5 grid h-6 w-6 place-items-center rounded bg-black/70 text-red-300 hover:bg-red-600 hover:text-white"><X className="h-3 w-3" /></button>
        </>}
      </div>)}
    </div>}
    {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
    {!editing && <p className="mt-3 text-center text-[10px] text-gray-500">Drag images from refs to save</p>}
  </div>;
};
