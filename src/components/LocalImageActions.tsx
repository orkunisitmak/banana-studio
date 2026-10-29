import React, { useState } from 'react';
import { Loader2, Maximize2 } from 'lucide-react';
import type { GeneratedMedia, GenerationConfig } from '../types';
import { buildGalleryUpscaleConfig } from './galleryImageEdit';

/** Gallery detail: recorded local seed / negative prompt, and 2x / 4x upscaling on the local server. */
export function LocalImageActions({ media, onEditGenerate }: { media: GeneratedMedia; onEditGenerate?: (config: GenerationConfig) => Promise<string[]> }) {
  const [busy, setBusy] = useState<2 | 4 | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const upscale = async (scale: 2 | 4) => {
    if (!onEditGenerate || busy) return;
    setBusy(scale); setMessage(null);
    try { await onEditGenerate(buildGalleryUpscaleConfig(media, scale)); setMessage({ error: false, text: `${scale}x upscale queued. The result appears in the gallery.` }); }
    catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : 'Upscale could not start.' }); }
    finally { setBusy(null); }
  };
  return <div className="mb-4 space-y-3">
    {(media.localSeed != null || media.localNegativePrompt || media.localUpscale) && <div className="rounded-xl border border-gray-700/50 bg-gray-800/30 p-3 text-sm">
      {media.localUpscale && <p className="text-white">Upscaled {media.localUpscale}x locally</p>}
      {media.localSeed != null && <p className="text-white"><span className="text-[10px] font-bold uppercase text-gray-500">Seed </span>{media.localSeed}
        <span className="ml-2 text-xs text-gray-500">Re-create repeats this seed.</span></p>}
      {media.localNegativePrompt && <p className="mt-1 break-words text-xs text-gray-400"><span className="text-[10px] font-bold uppercase text-gray-500">Negative </span>{media.localNegativePrompt}</p>}
    </div>}
    {onEditGenerate && <div>
      <div className="grid grid-cols-2 gap-3">
        {([2, 4] as const).map(scale => <button key={scale} type="button" disabled={!!busy} onClick={() => void upscale(scale)}
          title="Upscale on your Stable Diffusion WebUI or ComfyUI server (no credits)"
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-700 bg-gray-800 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50">
          {busy === scale ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4 text-emerald-400" />} Upscale {scale}x
        </button>)}
      </div>
      {message && <p role={message.error ? 'alert' : 'status'} className={`mt-2 text-xs ${message.error ? 'text-red-300' : 'text-green-300'}`}>{message.text}</p>}
    </div>}
  </div>;
}

const MAX_SEED = 2 ** 32 - 1;
/** Composer row for the local image model: negative prompt and a fixed seed (empty = random). */
export function LocalImageComposerOptions({ config, update }: { config: GenerationConfig; update: <K extends keyof GenerationConfig>(key: K, value: GenerationConfig[K]) => void }) {
  const field = 'h-8 rounded-lg border border-white/[0.07] bg-[#171e28] px-2.5 text-xs text-gray-200 placeholder:text-gray-500 outline-none focus:border-violet-400';
  return <>
    <input type="text" aria-label="Negative prompt" placeholder="Negative prompt" maxLength={2000} value={config.localNegativePrompt || ''}
      onChange={event => update('localNegativePrompt', event.target.value || undefined)} className={`${field} w-40 min-w-0`} />
    <span className="flex items-center gap-1">
      <input type="number" aria-label="Seed" placeholder="Seed · random" min={0} max={MAX_SEED} step={1} value={config.localSeed ?? ''}
        onChange={event => { const value = Number(event.target.value); update('localSeed', event.target.value === '' || !Number.isSafeInteger(value) ? undefined : Math.min(MAX_SEED, Math.max(0, value))); }}
        title={config.count > 1 && config.localSeed != null ? 'A fixed seed makes every image in the batch the same; leave empty for variety.' : 'Leave empty for a random seed. Re-create reuses a saved seed.'}
        className={`${field} w-32`} />
      {config.localSeed != null && <button type="button" onClick={() => update('localSeed', undefined)} aria-label="Use a random seed" className="rounded px-1.5 text-xs text-gray-400 hover:text-white">×</button>}
    </span>
  </>;
}
