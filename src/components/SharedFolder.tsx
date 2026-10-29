import React, { useCallback, useEffect, useRef, useState } from 'react';
import { readSharedFolderPage, type SharedFolderImage as SharedImage, type SharedFolderPage as SharedPage } from '../lib/gallery/folderShareResponse';

export function SharedFolder() {
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  const [page, setPage] = useState<SharedPage | null>(null);
  const [images, setImages] = useState<SharedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SharedImage | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const changed = () => setToken(window.location.hash.slice(1));
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const request = useCallback(async (args: { offset?: number; mediaId?: string }, signal?: AbortSignal): Promise<SharedPage> => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('This share link is unavailable or expired.');
    const response = await fetch('/api/shared-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...args }), credentials: 'omit', cache: 'no-store', signal,
    });
    return readSharedFolderPage(response);
  }, [token]);
  const load = useCallback(async (offset = 0) => {
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setBusy(true); setError(''); setOpening(null); setSelected(null);
    try {
      const result = await request({ offset }, operation.signal);
      setPage(result);
      setImages(previous => offset ? [...previous, ...result.images.filter(image => !previous.some(old => old.id === image.id))] : result.images);
    } catch (error) {
      if (!operation.signal.aborted) {
        setError(error instanceof Error ? error.message : 'Unable to load images.');
        // A failed later page keeps the images already shown so Load more can be retried.
        if (!offset) { setPage(null); setImages([]); }
        setSelected(null);
      }
    } finally { if (!operation.signal.aborted) setBusy(false); }
  }, [request]);
  useEffect(() => {
    setPage(null); setImages([]); setSelected(null); setOpening(null); setPreviewError('');
    void load(); return () => controller.current?.abort();
  }, [load]);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  const open = async (id: string) => {
    if (opening) return;
    const operation = controller.current;
    setOpening(id); setPreviewError('');
    try {
      const result = await request({ mediaId: id }, operation?.signal);
      if (!operation?.signal.aborted) setSelected(result.images[0]);
    } catch (error) {
      if (!operation?.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Unable to open image.');
    } finally { if (!operation?.signal.aborted) setOpening(null); }
  };
  return <main className="shared-shell">
    <header className="shared-header"><div><span className="shared-brand">ORK DIGITAL BANANA</span><h1>{page?.name || 'Shared folder'}</h1><p>View and download shared images</p></div>
      <button onClick={() => void load()} disabled={busy}>Refresh</button></header>
    {error && <div role="alert" className="shared-message">{error}</div>}
    {previewError && <p role="alert" className="shared-message">{previewError}</p>}
    {!busy && page && !images.length && <p className="shared-message">No completed images in this folder yet.</p>}
    <div className="shared-grid">{images.map((image, index) => <button className="shared-card" key={image.id} onClick={() => void open(image.id)} disabled={!!opening} aria-label={`Open image ${index + 1}`}>
      <img src={image.url} alt={`Shared image ${index + 1}`} referrerPolicy="no-referrer" />
      <span>{opening === image.id ? 'Opening…' : `Image ${index + 1}`}</span></button>)}</div>
    {busy && <p role="status" className="shared-message">Loading images…</p>}
    {page?.nextOffset != null && <button className="shared-more" disabled={busy} onClick={() => void load(page.nextOffset!)}>Load more</button>}
    <footer>Shared by its owner · Link access can be turned off at any time.</footer>
    {selected && <dialog ref={dialog} className="shared-preview" aria-label="Image preview" onCancel={event => { event.preventDefault(); setSelected(null); }}>
      <div className="shared-preview-actions"><a href={selected.url} target="_blank" rel="noopener noreferrer">Open original / save</a><button onClick={() => setSelected(null)} aria-label="Close image preview">Close</button></div>
      <img src={selected.url} alt="Shared image at full resolution" referrerPolicy="no-referrer" />
      <p>Open the original to save it. If access has expired, close this preview and open the image again.</p>
    </dialog>}
  </main>;
}
