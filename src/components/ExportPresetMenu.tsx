import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { BrandKit } from '../lib/brand/kit';
import { downloadCanvas, renderBrandedPreset } from '../lib/export/renderPreset';
import { EXPORT_PRESETS, getExportPreset } from '../lib/export/presets';
import type { GeneratedMedia } from '../types';

export const ExportPresetMenu = ({
  images,
  brandKit,
}: {
  images: GeneratedMedia[];
  brandKit: BrandKit;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportable = images.filter(media => media.mediaType === 'image' && !media.isLoading && media.url);

  const exportPreset = async (presetId: string) => {
    const preset = getExportPreset(presetId);
    if (!preset || !exportable.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      for (const media of exportable) {
        const canvas = await renderBrandedPreset({
          imageUrl: media.url,
          preset,
          brandKit,
          title: media.prompt,
        });
        await downloadCanvas(canvas, `${media.id.slice(0, 12)}-${preset.id}.png`);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The export could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      <label className="sr-only" htmlFor="export-preset">Export preset</label>
      <select
        id="export-preset"
        value=""
        disabled={busy || !exportable.length}
        onChange={event => void exportPreset(event.target.value)}
        className="h-10 rounded-xl border border-white/[0.08] bg-[#161b22] px-3 text-xs font-semibold text-gray-300 outline-none hover:border-violet-400/40 disabled:opacity-40"
      >
        <option value="" disabled>{busy ? 'Exporting…' : `Export preset (${exportable.length})`}</option>
        {EXPORT_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select>
      {busy && <Loader2 className="h-4 w-4 animate-spin text-violet-300" />}
      {error && <span role="alert" className="absolute left-0 top-12 z-10 w-64 rounded-lg border border-red-500/30 bg-[#2a1416] p-2 text-[10px] text-red-200">{error}</span>}
    </div>
  );
};
