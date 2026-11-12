import React from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import type { GeneratedMedia } from '../types';
import { getEditJobProgress } from '../lib/gallery/galleryEditJobs';

export const GalleryEditResults: React.FC<{
  source: GeneratedMedia;
  jobs: GeneratedMedia[];
  selectedId?: string;
  onSelect: (id?: string) => void;
}> = ({ source, jobs, selectedId, onSelect }) => {
  if (!jobs.length) return null;
  const pending = jobs.filter(job => getEditJobProgress(job).pending);
  const failed = jobs.filter(job => getEditJobProgress(job).failed).length;
  const ready = jobs.filter(job => !getEditJobProgress(job).pending && !getEditJobProgress(job).failed && job.url).length;
  const localOnly = jobs.some(job => job.syncStatus === 'local-only');
  return <section aria-label="Edit results" className="rounded-2xl border border-white/[0.08] bg-[#161b22] p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-semibold text-gray-200">Edit results <span className="ml-1 font-normal text-gray-500">{ready} ready{failed > 0 ? ` · ${failed} failed` : ''}</span></span>
      {(pending.length > 0 || ready > 0) && <span role="status" className={pending.length ? 'flex items-center gap-1.5 text-violet-300' : 'flex items-center gap-1.5 text-lime-300'}>{pending.length ? <><Loader2 className="h-3 w-3 animate-spin" />{pending.length} generating in background</> : <><Check className="h-3 w-3" />{localOnly ? 'Available in gallery' : 'Saved in gallery'}</>}</span>}
    </div>
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Source and edited images">
      <button type="button" onClick={() => onSelect()} aria-label="View edit source" aria-pressed={!selectedId} className={`relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 ${!selectedId ? 'border-lime-400' : 'border-transparent hover:border-gray-500'}`}>
        <img src={source.thumbnailUrl || source.url} alt="Edit source" className="h-full w-full object-cover" />
        <span className="absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-[10px] font-medium text-white">Source</span>
      </button>
      {jobs.map((job, index) => {
        const progress = getEditJobProgress(job);
        const selectable = !progress.pending && !progress.failed && !!job.url;
        return <div key={job.id} className="relative h-20 w-28 shrink-0">
          <button type="button" onClick={() => selectable && onSelect(job.id)} disabled={!selectable} aria-label={`View edit result ${index + 1}`} aria-pressed={selectedId === job.id}
            title={progress.failed ? job.error || 'Image edit failed' : job.prompt}
            className={`relative h-full w-full overflow-hidden rounded-xl border-2 bg-[#202733] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 ${selectedId === job.id ? 'border-lime-400' : 'border-transparent enabled:hover:border-gray-500'}`}>
            {selectable ? <img src={job.thumbnailUrl || job.url} alt={`Edit ${index + 1}`} className="h-full w-full object-cover" /> : <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1 text-[10px] text-gray-400">{progress.pending ? <Loader2 className="h-4 w-4 animate-spin text-violet-400" /> : <AlertCircle className="h-4 w-4 text-red-400" />}{progress.failed ? 'Failed' : !progress.pending ? 'Unavailable' : progress.percent == null ? 'Generating…' : `${progress.estimated ? 'Est. ' : ''}${progress.percent}%`}</span>}
            {selectable && <span className="absolute inset-x-0 bottom-0 bg-black/75 px-2 py-1 text-[10px] font-medium text-white">Edit {index + 1}</span>}
          </button>
          {progress.pending && <div role="progressbar" aria-label={`Edit ${index + 1} ${progress.estimated ? 'estimated ' : ''}progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={progress.percent == null ? 'Generating' : `${progress.estimated ? 'Estimated ' : ''}${progress.percent}%`} title={progress.estimated ? 'Estimated progress. The provider does not report a completion percentage.' : undefined} className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full bg-violet-400 transition-[width] ${progress.percent == null ? 'animate-pulse' : ''}`} style={{ width: `${progress.percent ?? 35}%` }} /></div>}
        </div>;
      })}
    </div>
    {failed > 0 && <p className="mt-2 text-[11px] text-red-300" role="alert">{jobs.find(job => getEditJobProgress(job).failed)?.error || 'An edit failed. Your source and selections are unchanged.'}</p>}
    {localOnly && <p className="mt-2 text-[11px] text-amber-300" role="status">An image is available locally; its cloud save needs to sync. Keep this browser’s data until it has synced.</p>}
    {pending.length > 0 && <p className="mt-2 text-[11px] text-gray-500">You can keep editing or close this window. Results also appear in the gallery.</p>}
  </section>;
};
