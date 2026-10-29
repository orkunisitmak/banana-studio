import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Images, Loader2, ScanSearch, ShieldCheck, X } from 'lucide-react';
import {
  buildContactSheetHtml,
  findRecipeDuplicateGroups,
  findVisualDuplicateGroups,
  runGalleryQa,
  type GalleryQaSeverity,
  type VisualDuplicateResult,
} from '../lib/gallery/intelligence';
import type { BrandKit } from '../lib/brand/kit';
import type { GeneratedMedia } from '../types';

type Tab = 'duplicates' | 'qa' | 'export';

const severityClass = (severity: GalleryQaSeverity) => severity === 'error'
  ? 'border-red-500/30 bg-red-500/10 text-red-300'
  : 'border-amber-500/30 bg-amber-500/10 text-amber-200';

export const GalleryIntelligenceDialog = ({
  open,
  images,
  brandKit,
  onClose,
  onSelect,
}: {
  open: boolean;
  images: GeneratedMedia[];
  brandKit?: BrandKit;
  onClose: () => void;
  onSelect: (id: string) => void;
}) => {
  const [tab, setTab] = useState<Tab>('duplicates');
  const [visualGroups, setVisualGroups] = useState<VisualDuplicateResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const recipeGroups = useMemo(() => findRecipeDuplicateGroups(images), [images]);
  const issues = useMemo(() => runGalleryQa(images), [images]);
  const available = images.filter(media => !media.isLoading && media.url);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
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
    };
  }, [open]);

  if (!open) return null;

  const scan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      setVisualGroups(await findVisualDuplicateGroups(available));
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'The visual scan could not finish.');
    } finally {
      setScanning(false);
    }
  };

  const printContactSheet = () => {
    const sheet = window.open('', '_blank');
    if (!sheet) {
      setScanError('Allow pop-ups to open the contact sheet.');
      return;
    }
    sheet.opener = null;
    sheet.document.write(buildContactSheetHtml(images, `${brandKit?.name || 'Banana Studio'} contact sheet`, brandKit));
    sheet.document.close();
    sheet.focus();
    sheet.print();
  };

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      onCancel={event => { event.preventDefault(); onClose(); }}
      aria-labelledby="gallery-intelligence-title"
      className="fixed inset-0 z-[85] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/75 p-4 backdrop:bg-black/75"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-[#161b22] text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-800 p-5">
          <div>
            <h2 id="gallery-intelligence-title" className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="h-5 w-5 text-violet-400" />
              Gallery intelligence
            </h2>
            <p className="mt-1 text-xs text-gray-500">Find repeated recipes, identical outputs and missing or tiny media.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close gallery intelligence" className="text-gray-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-gray-800 px-5 pt-3">
          {([
            ['duplicates', 'Duplicates'],
            ['qa', `Quality (${issues.length})`],
            ['export', 'Contact sheet'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-t-lg px-3 py-2 text-xs font-semibold transition-colors ${tab === value ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'duplicates' && (
            <div className="space-y-5">
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Same recipe</h3>
                    <p className="text-[11px] text-gray-500">Identical prompt, model, ratio, resolution, seed and options.</p>
                  </div>
                  <span className="text-xs text-gray-500">{recipeGroups.length} group{recipeGroups.length === 1 ? '' : 's'}</span>
                </div>
                {recipeGroups.length ? recipeGroups.map(group => (
                  <div key={group[0].id} className="mb-3 rounded-xl border border-gray-700/70 bg-gray-900/40 p-3">
                    <div className="flex gap-2 overflow-x-auto">
                      {group.map(media => (
                        <button key={media.id} type="button" onClick={() => onSelect(media.id)} className="w-24 shrink-0 text-left">
                          {media.mediaType === 'video'
                            ? <div className="grid h-24 w-24 place-items-center rounded-lg bg-gray-800 text-[10px] text-gray-500">VIDEO</div>
                            : <img src={media.thumbnailUrl || media.url} alt={media.prompt.slice(0, 60)} className="h-24 w-24 rounded-lg object-cover" />}
                          <span className="mt-1 block truncate text-[10px] text-gray-500">{new Date(media.createdAt).toLocaleDateString()}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )) : <p className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">No repeated recipes found.</p>}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Identical pixels</h3>
                    <p className="text-[11px] text-gray-500">Hashes up to 120 media files. This fetches image bytes and may take a moment.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void scan()}
                    disabled={scanning || !available.length}
                    className="inline-flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20 disabled:opacity-40"
                  >
                    {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                    {scanning ? 'Scanning…' : 'Scan pixels'}
                  </button>
                </div>
                {scanError && <p className="mb-2 text-xs text-red-300">{scanError}</p>}
                {visualGroups == null
                  ? <p className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">Run a scan to compare output bytes.</p>
                  : visualGroups.groups.length
                    ? visualGroups.groups.map(group => (
                      <div key={group[0].id} className="mb-3 flex gap-2 rounded-xl border border-gray-700/70 bg-gray-900/40 p-3">
                        {group.map(media => (
                          <button key={media.id} type="button" onClick={() => onSelect(media.id)} className="w-20 shrink-0">
                            <img src={media.thumbnailUrl || media.url} alt={media.prompt.slice(0, 60)} className="h-20 w-20 rounded-lg object-cover" />
                          </button>
                        ))}
                      </div>
                    ))
                    : <p className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">No identical files found.</p>}
                {visualGroups && visualGroups.skipped > 0 && (
                  <p role="status" className="mt-1 text-[11px] text-amber-200">
                    {visualGroups.skipped} file{visualGroups.skipped === 1 ? '' : 's'} could not be scanned; results may be incomplete.
                  </p>
                )}
              </section>
            </div>
          )}

          {tab === 'qa' && (
            <div className="space-y-2">
              {issues.length === 0
                ? <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-xs text-gray-500">No quality issues in the loaded gallery.</p>
                : issues.map(issue => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => onSelect(issue.mediaId)}
                    className={`flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left text-xs ${severityClass(issue.severity)}`}
                  >
                    <span>{issue.message}</span>
                    <span className="shrink-0 uppercase opacity-70">{issue.severity}</span>
                  </button>
                ))}
            </div>
          )}

          {tab === 'export' && (
            <div className="rounded-xl border border-gray-700/70 bg-gray-900/40 p-5">
              <Images className="h-8 w-8 text-violet-300" />
              <h3 className="mt-3 text-sm font-semibold text-white">Printable contact sheet</h3>
              <p className="mt-1 max-w-lg text-xs leading-5 text-gray-500">
                Opens a print-ready A4 sheet with thumbnails, model names, prompts and tags. Choose “Save as PDF” in the print dialog.
              </p>
              {scanError && <p role="alert" className="mt-3 text-xs text-red-300">{scanError}</p>}
              <button
                type="button"
                onClick={printContactSheet}
                disabled={!available.length}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                Open contact sheet ({available.length})
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
};
