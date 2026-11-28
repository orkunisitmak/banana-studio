import React from 'react';
import { Clock, Film, Ratio, Scan, Volume2 } from 'lucide-react';
import { getMagi2AspectRatios, MAGI2_LIMITS, MAGI2_MODEL, type Magi2Mode } from '../lib/video/magi2';
import { getMagi2Images } from '../lib/video/magi2Config';
import type { GenerationConfig, VideoAspectRatio } from '../types';
import { Dropdown } from './ControlDropdown';

export const MAGI2_ACTIONS: { label: string; value: Magi2Mode }[] = [
  { label: 'Text to Video', value: 'text_only' },
  { label: 'Image to Video', value: 'image_to_video' },
  { label: 'Reference to Video', value: 'reference_to_video' },
];
const durations = Array.from({ length: MAGI2_LIMITS.maxDuration - MAGI2_LIMITS.minDuration + 1 }, (_, i) => {
  const seconds = i + MAGI2_LIMITS.minDuration;
  return { label: `${seconds}s`, value: String(seconds) };
});

export function selectMagi2(config: GenerationConfig): GenerationConfig {
  const images = config.referenceImages;
  const mode: Magi2Mode = config.referenceVideos?.length || config.referenceAudios?.length || images.length > 2
    ? 'reference_to_video' : images.length ? 'image_to_video' : 'text_only';
  // Frame order is positional on this endpoint. Preserve the old first/last choice
  // when switching, but never forward another model's frame or continuation roles.
  const ordered = mode === 'image_to_video' && images.length === 2 && (images[0].isLastFrame || images[1].isFirstFrame)
    ? [images[1], images[0]] : images;
  return {
    ...config, videoModel: MAGI2_MODEL, videoOperation: 'generate', magi2Mode: mode,
    h3MaxMode: undefined, h3MaxOptions: undefined, falSeedanceOptions: undefined,
    videoQuality: '1080p', videoDuration: 5, videoAspectRatio: getMagi2AspectRatios(mode)[0], audioEnabled: true,
    referenceImages: ordered.map(image => image.isFirstFrame || image.isLastFrame ? { ...image, isFirstFrame: false, isLastFrame: false } : image),
    referenceVideos: (config.referenceVideos || []).map(video => video.isContinuation ? { ...video, isContinuation: false } : video),
  };
}

export function Magi2Settings({ config, onChange }: { config: GenerationConfig; onChange: (config: GenerationConfig) => void }) {
  const mode = config.magi2Mode ?? 'text_only';
  return <>
    <Dropdown label="MAGI-2 action" value={mode} options={MAGI2_ACTIONS} icon={Film} compact onSelect={(magi2Mode: Magi2Mode) => {
      if (magi2Mode === mode) return;
      // Re-created drafts can carry explicit frame tags. Keep their displayed
      // order when changing route; tags have no meaning on reference media.
      const images = getMagi2Images(config);
      onChange({ ...config, magi2Mode, videoAspectRatio: getMagi2AspectRatios(magi2Mode)[0],
        referenceImages: images.some(image => image.isFirstFrame || image.isLastFrame)
          ? images.map(image => ({ ...image, isFirstFrame: false, isLastFrame: false })) : images,
      });
    }} />
    <Dropdown label="Ratio" value={config.videoAspectRatio} options={getMagi2AspectRatios(mode).map(value => ({ label: value === 'adaptive' ? 'Auto (first frame)' : value, value }))}
      onSelect={(videoAspectRatio: VideoAspectRatio) => onChange({ ...config, videoAspectRatio })} icon={Ratio} compact />
    <Dropdown label="Quality" value={config.videoQuality} options={[{ label: '1080p', value: '1080p' }]} onSelect={() => onChange({ ...config, videoQuality: '1080p' })} icon={Scan} compact />
    <Dropdown label="Duration" value={String(config.videoDuration)} options={durations} onSelect={value => onChange({ ...config, videoDuration: Number(value) })} icon={Clock} compact />
    <Dropdown label="Audio" value={config.audioEnabled === false ? 'off' : 'on'} options={[{ label: 'Generate audio', value: 'on' }, { label: 'Silent video', value: 'off' }]}
      onSelect={value => onChange({ ...config, audioEnabled: value === 'on' })} icon={Volume2} compact />
  </>;
}
