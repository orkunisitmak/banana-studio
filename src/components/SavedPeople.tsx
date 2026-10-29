import { getSavedPersonDraftGroup } from '../lib/references/personReferences';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Globe2, ImagePlus, Loader2, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { SavedVisibilityControl } from './SavedVisibilityControl';
import type { GenerationConfig, ReferenceImage, SavedPerson, SavedPersonSummary, SavedReferenceImage } from '../types';
import { getSavedPeople, getSavedPeopleCovers, getSavedPerson, removeSavedPerson, savePerson } from '../services/storageService';

export type SavedPersonSeed = { groupId: number; savedPersonId?: string; name: string; photos: SavedPerson['photos']; isMe: boolean };

const summarize = ({ photos: _photos, ...person }: SavedPerson): SavedPersonSummary => person;

export const SavedPeople: React.FC<{
  references: ReferenceImage[];
  draft?: Pick<GenerationConfig, 'referenceImages' | 'personGroups' | 'prompt' | 'originalPrompt'>;
  gallery: SavedReferenceImage[];
  seed?: SavedPersonSeed;
  addDisabled?: string;
  onAdd: (person: SavedPerson) => void;
  onSaved: (person: SavedPerson, groupId?: number) => void;
}> = ({ references, draft, gallery, seed, addDisabled, onAdd, onSaved }) => {
  const [people, setPeople] = useState<SavedPersonSummary[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [coverState, setCoverState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removed, setRemoved] = useState<SavedPerson | null>(null);
  const [editor, setEditor] = useState<{ person: SavedPerson; isNew: boolean; groupId?: number } | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<SavedPerson['photos']>([]);
  const [reload, setReload] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const lifetime = useRef<AbortSignal | undefined>(undefined);
  // Photos arrive after the click; apply them to the draft as it is by then.
  const latest = useRef({ draft, addDisabled, onAdd });
  latest.current = { draft, addDisabled, onAdd };
  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true; lifetime.current = controller.signal;
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true); setError(''); setCovers({}); setCoverState('loading');
    (async () => {
      const items = await getSavedPeople(signal);
      const existing = seed?.savedPersonId && items.some(person => person.id === seed.savedPersonId)
        ? await getSavedPerson(seed.savedPersonId, signal) : undefined;
      if (signal.aborted) return;
      setPeople(items);
      if (seed) {
        setExtraPhotos([...(existing?.photos || []), ...seed.photos]);
        setEditor({ person: existing ? { ...existing, photos: [...existing.photos] } : { ...emptyPerson(), name: seed.name, photos: seed.photos, isMe: seed.isMe }, isNew: !existing, groupId: seed.groupId });
      }
      setLoading(false);
      if (!items.length) { setCoverState('ready'); return; }
      try {
        const loaded = await getSavedPeopleCovers(items, signal);
        // Covers set by a save during this load are newer than the fetched ones.
        if (!signal.aborted) { setCovers(current => ({ ...loaded, ...current })); setCoverState('ready'); }
      } catch { if (!signal.aborted) setCoverState('failed'); }
    })().catch(reason => {
      if (!signal.aborted) { setError(reason instanceof Error ? reason.message : 'Saved people could not be loaded. Please retry.'); setLoading(false); }
    });
    return () => controller.abort();
  }, [reload, seed]);

  const emptyPerson = (): SavedPerson => ({ id: crypto.randomUUID(), name: '', photos: [], isMe: false, isShared: false, canEdit: true, createdAt: Date.now(), updatedAt: 0 });
  const update = (patch: Partial<SavedPerson>) => setEditor(current => current ? { ...current, person: { ...current.person, ...patch } } : null);
  const selectablePhotos = [...references, ...gallery, ...extraPhotos]
    .map(photo => extraPhotos.find(snapshot => snapshot.id === photo.id) || photo)
    .filter((photo, index, all) => photo.data && all.findIndex(item => item.id === photo.id || item.data === photo.data) === index);
  const togglePhoto = (photo: SavedPerson['photos'][number]) => {
    if (!editor) return;
    const selected = editor.person.photos.some(item => item.data === photo.data);
    if (!selected && editor.person.photos.length >= 16) { setError('A person can have up to 16 photos.'); return; }
    update({ photos: selected ? editor.person.photos.filter(item => item.data !== photo.data) : [...editor.person.photos, { id: photo.id, data: photo.data, mimeType: photo.mimeType }] });
    setError('');
  };
  const showSaved = (person: SavedPerson) => {
    const cover = person.photos[0]?.data;
    setPeople(items => [summarize(person), ...items.filter(item => item.id !== person.id)]);
    if (cover) setCovers(current => ({ ...current, [person.id]: cover }));
  };
  // Messages stay until the photos arrive: clearing them earlier shifts the cards under the pointer.
  const withFullPerson = async (summary: SavedPersonSummary, use: (person: SavedPerson) => void) => {
    if (busy) return;
    setBusy(true); setOpening(summary.id);
    try {
      const person = await getSavedPerson(summary.id, lifetime.current);
      if (!mounted.current) return;
      use(person);
      setError('');
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not load this person. Please retry.'); }
    finally { if (mounted.current) { setBusy(false); setOpening(null); } }
  };
  const add = (summary: SavedPersonSummary) => withFullPerson(summary, person => {
    const { draft, addDisabled, onAdd } = latest.current;
    if (addDisabled) throw new Error(addDisabled);
    const linked = !!(draft && getSavedPersonDraftGroup(draft, person));
    onAdd(person);
    setRemoved(null); // Undo belongs only to the removal notice.
    setNotice(linked ? `${person.name} photos updated; scene prompt kept` : `${person.name} added to draft`);
  });
  const edit = (summary: SavedPersonSummary) => withFullPerson(summary, person => {
    if (person.canEdit === false) throw new Error('Only the owner can edit this saved person.');
    setExtraPhotos(person.photos);
    setEditor({ person: { ...person, photos: [...person.photos] }, isNew: false });
    setNotice(''); setRemoved(null);
  });
  const save = async () => {
    if (!editor || busy) return;
    setBusy(true); setError('');
    try {
      const saved = await savePerson(editor.person, editor.isNew);
      if (!mounted.current) return;
      showSaved(saved);
      onSaved(saved, editor.groupId);
      setRemoved(null); setNotice(`${saved.name} saved`); setEditor(null);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save person. Please retry.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const remove = async () => {
    if (!editor || editor.isNew || busy) return;
    setBusy(true); setError('');
    try {
      const deleted = await removeSavedPerson(editor.person);
      if (!mounted.current) return;
      setPeople(items => items.filter(item => item.id !== deleted.id)); setRemoved(deleted); setEditor(null); setNotice('Person removed. Draft photos are kept.');
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not remove person.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const undo = async () => {
    if (!removed || busy) return;
    setBusy(true); setError('');
    try {
      const restored = await savePerson(removed);
      if (!mounted.current) return;
      showSaved(restored); setRemoved(null); setNotice('Person restored.');
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not restore person.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const upload = async (files: File[]) => {
    if (!editor || busy) return;
    setBusy(true); setError('');
    try {
      if (files.length + editor.person.photos.length > 16) throw new Error('A person can have up to 16 photos.');
      const photos = await Promise.all(files.map(async file => {
        if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('Choose image files smaller than 20 MB.');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read photo.')); reader.readAsDataURL(file);
        });
        return { id: crypto.randomUUID(), data, mimeType: file.type };
      }));
      if (mounted.current) {
        setExtraPhotos(current => [...current, ...photos]);
        update({ photos: [...editor.person.photos, ...photos].filter((photo, index, all) => all.findIndex(item => item.data === photo.data) === index) });
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not add photos.'); }
    finally { if (mounted.current) setBusy(false); }
  };

  const button = 'flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40 disabled:cursor-not-allowed';
  return <div className={editor ? 'p-3' : 'p-2'} aria-label="Saved people">
    {loading ? <div className="flex items-center justify-center gap-2 py-7 text-xs text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Loading people…</div> : <>
      {editor ? <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} aria-label="Back to saved people" className={`${button} px-1.5 text-gray-400 hover:bg-white/5`} onClick={() => { setEditor(null); setError(''); }}><ArrowLeft className="h-4 w-4" /></button>
          <h3 className="text-xs font-semibold text-gray-200">{editor.isNew ? 'New saved person' : 'Edit saved person'}</h3>
        </div>
        <label className="block text-[11px] text-gray-400">Person name
          <input aria-label="Saved person name" value={editor.person.name} maxLength={40} disabled={busy} onChange={event => update({ name: event.target.value })}
            className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#121821] px-2.5 text-xs text-gray-100 outline-none focus:border-violet-400/60" placeholder="e.g. Alex" />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-gray-300"><input type="checkbox" checked={editor.person.isMe} disabled={busy} onChange={event => update({ isMe: event.target.checked })} className="accent-violet-500" />This is me <span className="ml-auto text-[10px] text-gray-500">Use Me when available</span></label>
        <SavedVisibilityControl isShared={editor.person.isShared === true} disabled={busy} onChange={isShared => update({ isShared })} />
        <div>
          <div className="mb-2 flex items-center justify-between text-[11px]"><span className="text-gray-400">Select photos of this person</span><span className="text-violet-300">{editor.person.photos.length}/16</span></div>
          <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto p-0.5" aria-label="Person photo choices">
            {selectablePhotos.map((photo, index) => {
              const selected = editor.person.photos.some(item => item.data === photo.data);
              return <button key={`${photo.id}:${index}`} type="button" disabled={busy} aria-label={`Photo ${index + 1}`} aria-pressed={selected} onClick={() => togglePhoto(photo)} className={`relative aspect-square overflow-hidden rounded-lg border-2 ${selected ? 'border-violet-400' : 'border-transparent hover:border-gray-500'}`}>
                <img src={photo.data} alt="" className="h-full w-full object-cover" />
                {selected && <span className="absolute right-1 top-1 rounded-full bg-violet-500 p-0.5"><Check className="h-3 w-3 text-white" /></span>}
              </button>;
            })}
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-600 text-gray-400 hover:border-violet-400 hover:text-violet-300"><ImagePlus className="h-4 w-4" /><span className="text-[10px]">Upload</span></button>
          </div>
          <input type="file" ref={fileInput} accept="image/*" multiple className="hidden" onChange={(event: React.ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files || []) as File[]; event.target.value = ''; void upload(files); }} />
          <p className="mt-2 text-[10px] leading-4 text-gray-500">Save your changes, then choose Update photos to apply them to this draft. The scene prompt stays the same.</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-3">
          {!editor.isNew ? <button type="button" disabled={busy} onClick={remove} className={`${button} text-red-400 hover:bg-red-500/10`}><Trash2 className="h-3.5 w-3.5" />Remove saved person</button> : <span />}
          <button type="button" disabled={busy || !editor.person.name.trim() || !editor.person.photos.length} onClick={save} className={`${button} bg-violet-500 text-white hover:bg-violet-400`}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save person</button>
        </div>
      </div> : <>
        {(people.length > 0 || !error) && <div className="mb-2 flex items-center justify-between"><p className="text-[11px] text-gray-500">{people.length} saved {people.length === 1 ? 'person' : 'people'}</p><button type="button" disabled={busy || !!error} onClick={() => { setExtraPhotos([]); setEditor({ person: emptyPerson(), isNew: true }); setError(''); setNotice(''); setRemoved(null); }} className={`${button} text-violet-300 hover:bg-violet-500/10`}><Plus className="h-3.5 w-3.5" />New person</button></div>}
        {!people.length && !error && <div className="py-6 text-center"><Users className="mx-auto mb-2 h-6 w-6 text-gray-600" /><p className="text-xs text-gray-300">Save a person once</p><p className="mt-1 text-[11px] leading-4 text-gray-500">Add all their reference photos to any generation with one click.</p></div>}
        <div className="grid max-h-64 grid-cols-4 gap-x-1.5 gap-y-3 overflow-y-auto p-0.5 custom-scrollbar" aria-label="Saved person cards" aria-busy={coverState === 'loading'}>
          {people.map(person => {
            let linked = false, linkError = '';
            try { linked = !!(draft && getSavedPersonDraftGroup(draft, person)); }
            catch (reason) { linkError = reason instanceof Error ? reason.message : 'Check the draft person names.'; }
            const action = linked ? `Update ${person.name} photos` : `Add ${person.name}`;
            const cover = covers[person.id];
            const isOpening = opening === person.id;
            return <div key={person.id} className="group relative min-w-0">
            <button type="button" disabled={busy || !!addDisabled} aria-busy={isOpening} title={addDisabled || linkError || action} aria-label={action} onClick={() => { if (linkError) setError(linkError); else void add(person); }} className={`block w-full min-w-0 rounded-lg text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed ${isOpening ? '' : 'disabled:opacity-40'}`}>
              <span className="relative block aspect-square overflow-hidden rounded-lg bg-gray-800 transition-shadow group-hover:ring-2 group-hover:ring-violet-500">
                {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : coverState === 'loading' ? <span className="absolute inset-0 animate-pulse bg-white/5" /> : <Users className="absolute inset-0 m-auto h-6 w-6 text-gray-500" />}
                {isOpening
                  ? <span className="absolute inset-0 flex items-center justify-center bg-black/55"><Loader2 className="h-5 w-5 animate-spin text-white" /></span>
                  : <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><Plus className="h-4 w-4 text-white" /></span>}
              </span>
              <span className="mt-1.5 block truncate px-0.5 text-[11px] font-medium text-gray-200" title={person.name}>{person.name}</span>
              {person.isShared && <span className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-gray-400"><Globe2 className="h-2.5 w-2.5" />All users</span>}
              <span className="mt-0.5 block text-[10px] text-violet-300">{isOpening ? 'Loading…' : linked ? 'Update photos' : 'Add person'}</span>
            </button>
            {person.canEdit !== false && <button type="button" disabled={busy} title={`Edit ${person.name}`} aria-label={`Edit saved ${person.name}`} onClick={() => void edit(person)} className="absolute right-0.5 top-0.5 grid h-8 w-8 place-items-center rounded-lg bg-black/65 text-white transition-colors hover:bg-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>}
          </div>; })}
        </div>
        {coverState === 'failed' && <p className="mt-2 text-[10px] text-gray-500">Photos didn’t load. <button type="button" className="text-violet-300 underline" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
        {addDisabled && <p className="mt-2 text-[10px] text-amber-300">{addDisabled}</p>}
      </>}
    </>}
    {error && <div role="alert" className="mt-3 rounded-lg bg-red-500/10 p-2 text-[11px] leading-4 text-red-300">{error}{!editor && <button type="button" className="ml-2 underline" onClick={() => setReload(value => value + 1)}>Retry</button>}</div>}
    {notice && !editor && <div role="status" className="mt-2 flex items-center gap-2 text-[10px] text-gray-400"><span className="flex-1">{notice}</span>{removed && <button type="button" disabled={busy} className="text-violet-300 underline" onClick={undo}>Undo</button>}<button type="button" aria-label="Dismiss saved people message" onClick={() => { setNotice(''); setRemoved(null); }}><X className="h-3 w-3" /></button></div>}
  </div>;
};
