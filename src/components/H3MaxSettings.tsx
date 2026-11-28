import React, { useEffect, useState } from 'react';
import { Clock, Film, Wand2, Volume2, Scan } from 'lucide-react';
import type { GenerationConfig } from '../types';
import { DEFAULT_H3_MAX_OPTIONS, isH3MaxModeAvailable, resolveH3MaxMode, usesH3MaxTargetAudio, type H3MaxOptions } from '../lib/video/h3Max';
import { getH3MaxConfigError, getH3MaxDraftCapabilities, getH3MaxDurationSeconds, getH3MaxReferenceImages } from '../lib/video/h3MaxConfig';
export { getH3MaxDurationSeconds } from '../lib/video/h3MaxConfig';
import { Dropdown } from './ControlDropdown';

export const getH3MaxUIState = (config: GenerationConfig) => {
  const mode = resolveH3MaxMode(config.h3MaxMode, { images: config.referenceImages.length, videos: config.referenceVideos?.length || 0, audios: config.referenceAudios?.length || 0 });
  const expansion = config.videoPromptExpansionMode === 'quality' || config.videoPromptExpansionMode === 'disabled' ? config.videoPromptExpansionMode : 'balanced';
  const options = { ...DEFAULT_H3_MAX_OPTIONS, promptExpansionMode: expansion, ...config.h3MaxOptions };
  const keyframeIds = new Set([options.startImageId, options.endImageId, options.middleImageId].filter(id => id && config.referenceImages.some(image => image.id === id)));
  const available = isH3MaxModeAvailable(mode);
  const capabilities = getH3MaxDraftCapabilities(config);
  return { mode, available, capabilities, options, targetSoundtrack: mode === 'lip_sync' || usesH3MaxTargetAudio(mode, options.useTargetAudio), imageLimit: available ? capabilities.images.max + (mode === 'reference_to_video' ? keyframeIds.size : 0) : 0 };
};

export const getH3MaxInputError = getH3MaxConfigError;

export const getH3MaxImageLabel = (config: GenerationConfig, imageId: string): string => {
  const { mode, options } = getH3MaxUIState(config);
  if (mode === 'lip_sync') return 'TARGET';
  if (mode === 'image_to_video') {
    const ordered = getH3MaxReferenceImages(config);
    return ordered.findIndex(image => image.id === imageId) === 1 || (ordered.length === 1 && options.imageFrame === 'end') ? 'END' : 'START';
  }
  if (mode === 'reference_to_video') {
    if (options.startImageId === imageId) return 'START';
    if (options.middleImageId === imageId) return 'MIDDLE';
    if (options.endImageId === imageId) return 'END';
  }
  return `Image ${getH3MaxReferenceImages(config).findIndex(image => image.id === imageId) + 1}`;
};

export const H3MaxDuration: React.FC<{ config: GenerationConfig; onChange: React.Dispatch<React.SetStateAction<GenerationConfig>> }> = ({ config, onChange }) => {
  const { mode, capabilities, available } = getH3MaxUIState(config);
  if (!available) return null;
  if (!capabilities.duration) {
    const source = mode === 'lip_sync' ? config.referenceAudios?.[0] : config.referenceVideos?.[0];
    const seconds = source?.duration;
    return <span role="status" aria-label="Output duration" className="flex h-[42px] shrink-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-[#171e28] px-2.5 text-xs text-gray-400" title={mode === 'lip_sync' ? 'Output duration follows the target audio.' : 'Output duration follows the source video.'}><Clock className="h-3.5 w-3.5 text-gray-500" />{typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? `${Number(seconds.toFixed(2))}s · ` : ''}{mode === 'lip_sync' ? 'From audio' : 'From source'}</span>;
  }
  const min = Math.ceil(capabilities.duration.min), max = Math.floor(capabilities.duration.max);
  const options = Array.from({ length: max - min + 1 }, (_, index) => ({ label: `${min + index}s`, value: String(min + index) }));
  return <Dropdown label={mode === 'extend_video' ? 'Added duration' : 'Duration'} value={String(getH3MaxDurationSeconds(config))} options={options} onSelect={value => {
    if (!options.some(option => option.value === value)) return;
    onChange(previous => ({ ...previous, videoDuration: Number(value) }));
  }} icon={Clock} compact />;
};

/** Edit fractional times locally so an intermediate decimal never resets the input. */
export const H3MaxTimeControl: React.FC<{ label: string; name: string; value: number; min: number; max: number; onCommit: (value: number) => void }> = ({ label, name, value, min, max, onCommit }) => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = draft.trim() === '' ? value : Number(draft);
    const corrected = Number.isFinite(parsed) ? Math.max(min, Math.min(Math.max(min, max), parsed)) : value;
    setDraft(String(corrected)); onCommit(corrected);
  };
  return <label className="flex h-[42px] shrink-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-[#171e28] px-2.5 text-xs text-gray-400" title={`${label} in seconds`}><Clock className="h-3.5 w-3.5 text-gray-500" /><span>{label}</span><input aria-label={name} type="number" inputMode="decimal" step="any" min={min} max={max} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }} className="w-12 bg-transparent font-semibold text-gray-200 outline-none" /><span>s</span></label>;
};

/** Model options use the same inline controls as the rest of the generation bar. */
export const H3MaxSettings: React.FC<{ config: GenerationConfig; onChange: React.Dispatch<React.SetStateAction<GenerationConfig>> }> = ({ config, onChange }) => {
  const { mode, options, available } = getH3MaxUIState(config);
  if (!available) return null;
  const update = (patch: Partial<H3MaxOptions>) => onChange(current => ({ ...current, h3MaxOptions: { ...current.h3MaxOptions, ...patch }, ...(patch.promptExpansionMode ? { videoPromptExpansionMode: patch.promptExpansionMode } : {}) }));
  return <>
    {['text_to_video', 'image_to_video', 'reference_to_video'].includes(mode) && <Dropdown label="H3 Max prompt expansion" value={options.promptExpansionMode} options={[{ label: 'Balanced prompt', value: 'balanced' }, { label: 'Prompt as written', value: 'disabled' }, { label: 'Quality prompt', value: 'quality' }]} onSelect={value => update({ promptExpansionMode: value })} icon={Wand2} compact />}
    {mode === 'extend_video' && <Dropdown label="Expand prompt using source video" value={options.enablePromptExpansion ? 'on' : 'off'} options={[{ label: 'Expand prompt', value: 'on' }, { label: 'Prompt as written', value: 'off' }]} onSelect={value => update({ enablePromptExpansion: value === 'on' })} icon={Wand2} compact />}
    {mode === 'reference_to_video' && <Dropdown label="H3 Max audio role" value={options.useTargetAudio ? 'target' : 'reference'} options={[{ label: 'Audio references', value: 'reference' }, { label: 'Target soundtrack', value: 'target' }]} onSelect={value => update({ useTargetAudio: value === 'target' })} icon={Volume2} compact />}

    {mode === 'reference_to_video' && options.middleImageId && <H3MaxTimeControl label="Middle" name="H3 Max middle frame time" value={options.middleFrameTime ?? config.videoDuration / 2} min={1 / 24} max={config.videoDuration - 1 / 24} onCommit={middleFrameTime => update({ middleFrameTime })} />}
    {mode === 'extend_video' && <Dropdown label="H3 Max extend output" value={options.output} options={[{ label: 'Source + continuation', value: 'extended' }, { label: 'Continuation only', value: 'continuation' }]} onSelect={output => update({ output })} icon={Film} compact />}
    {mode === 'lip_sync' && <Dropdown label="Transcribe target audio" value={options.enableTranscription ? 'on' : 'off'} options={[{ label: 'Transcription off', value: 'off' }, { label: 'Transcription on', value: 'on' }]} onSelect={value => update({ enableTranscription: value === 'on' })} icon={Volume2} compact />}
    {mode === 'recast' && <Dropdown label="Enhance skin texture and blending" value={options.enhanceRealism ? 'on' : 'off'} options={[{ label: 'Realism off', value: 'off' }, { label: 'Realism on', value: 'on' }]} onSelect={value => update({ enhanceRealism: value === 'on' })} icon={Scan} compact />}
  </>;
};
