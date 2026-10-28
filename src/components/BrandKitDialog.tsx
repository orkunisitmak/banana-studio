import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, RotateCcw, X } from 'lucide-react';
import { BRAND_FONTS, DEFAULT_BRAND_KIT, MAX_LOGO_BYTES, type BrandKit } from '../lib/brand/kit';

export const BrandKitDialog = ({
  kit,
  onClose,
  onSave,
}: {
  kit: BrandKit;
  onClose: () => void;
  onSave: (kit: BrandKit) => void;
}) => {
  const [draft, setDraft] = useState<BrandKit>(kit);
  const [logoError, setLogoError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      if (dialog?.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      previousFocus.current?.focus();
    };
  }, []);

  const readLogo = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('Choose a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('The logo must be 500 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft(current => ({ ...current, logoDataUrl: String(reader.result || '') }));
    reader.onerror = () => setLogoError('The logo could not be read.');
    reader.readAsDataURL(file);
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      onCancel={event => { event.preventDefault(); onClose(); }}
      aria-labelledby="brand-kit-title"
      className="w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-gray-700 bg-[#161b22] p-0 text-white shadow-2xl backdrop:bg-black/70"
    >
      <form
        className="p-5"
        onSubmit={event => {
          event.preventDefault();
          onSave(draft);
          onClose();
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="brand-kit-title" className="text-sm font-semibold">Brand kit</h2>
            <p className="mt-1 text-[11px] text-gray-500">Used by contact sheets and export presets. Stored on this device.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close brand kit" className="text-gray-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-400">Brand name</span>
            <input
              value={draft.name}
              maxLength={60}
              onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
              className="w-full rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500/60"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-400">Primary color</span>
              <div className="flex items-center gap-2">
                <input type="color" value={draft.primaryColor} onChange={event => setDraft(current => ({ ...current, primaryColor: event.target.value }))} aria-label="Primary color" className="h-9 w-10 rounded border border-gray-700 bg-transparent" />
                <input value={draft.primaryColor} onChange={event => setDraft(current => ({ ...current, primaryColor: event.target.value }))} className="w-full rounded-lg border border-gray-700 bg-gray-900/70 px-2 py-2 text-xs text-gray-100 outline-none" />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-400">Accent color</span>
              <div className="flex items-center gap-2">
                <input type="color" value={draft.accentColor} onChange={event => setDraft(current => ({ ...current, accentColor: event.target.value }))} aria-label="Accent color" className="h-9 w-10 rounded border border-gray-700 bg-transparent" />
                <input value={draft.accentColor} onChange={event => setDraft(current => ({ ...current, accentColor: event.target.value }))} className="w-full rounded-lg border border-gray-700 bg-gray-900/70 px-2 py-2 text-xs text-gray-100 outline-none" />
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-400">Font</span>
              <select value={draft.fontFamily} onChange={event => setDraft(current => ({ ...current, fontFamily: event.target.value }))} className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-gray-200">
                {BRAND_FONTS.map(font => <option key={font} value={font}>{font}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-400">Safe margin: {draft.safeMargin}%</span>
              <input type="range" min={2} max={20} step={1} value={draft.safeMargin} onChange={event => setDraft(current => ({ ...current, safeMargin: Number(event.target.value) }))} aria-label="Safe margin" className="mt-3 w-full accent-violet-500" />
            </label>
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-medium text-gray-400">Logo (optional, PNG/JPG/WebP up to 500 KB)</span>
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2 text-xs text-gray-300 hover:border-violet-500/50">
                <ImagePlus className="h-4 w-4" />
                Choose logo
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => readLogo(event.target.files?.[0])} />
              </label>
              {draft.logoDataUrl && (
                <>
                  <img src={draft.logoDataUrl} alt="Logo preview" className="h-9 w-9 rounded object-contain bg-black/30" />
                  <button type="button" onClick={() => setDraft(current => ({ ...current, logoDataUrl: undefined }))} className="text-[11px] text-gray-500 hover:text-red-300">Remove</button>
                </>
              )}
            </div>
            {logoError && <p role="alert" className="mt-2 text-[11px] text-red-300">{logoError}</p>}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => { setDraft(DEFAULT_BRAND_KIT); setLogoError(null); }} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold text-gray-500 hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-400 hover:text-white">Cancel</button>
            <button type="submit" className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500">Save brand kit</button>
          </div>
        </div>
      </form>
    </dialog>,
    document.body,
  );
};
