import React from 'react';
import { Clock, Film, Ratio, Scan } from 'lucide-react';
import { EVO_H3_CAPABILITIES as caps, EVO_H3_MODEL } from '../lib/video/evoH3Max';
import type { EvoH3DraftMode } from '../lib/video/evoH3MaxConfig';
import type { GenerationConfig, VideoAspectRatio, VideoQuality } from '../types';
import { Dropdown } from './ControlDropdown';

export const EVO_H3_ACTIONS: { label: string; value: EvoH3DraftMode }[] = [
  { label: 'Text to Video', value: 'text_to_video' },
  { label: 'Image to Video', value: 'image_to_video' },
  { label: 'Reference to Video', value: 'reference_to_video' },
];
const qualities = caps.qualities.map(value => ({ label: value, value }));
const durations = caps.durations.map(value => ({ label: `${value}s`, value: String(value) }));
const textRatios = caps.textAspectRatios.map(value => ({ label: value, value }));
const referenceRatios = caps.referenceAspectRatios.map(value => ({ label: value === 'adaptive' ? 'Adaptive' : value, value }));

export function selectEvoH3Max(config: GenerationConfig): GenerationConfig {
  // Keep the user's media, but never carry continuation or other providers' frame roles across vendors.
  const images = config.referenceImages;
  const h3MaxMode: EvoH3DraftMode = config.referenceVideos?.length || config.referenceAudios?.length || images.length > 2
    ? 'reference_to_video' : images.length ? 'image_to_video' : 'text_to_video';
  const referenceImages = h3MaxMode === 'image_to_video' && images.length === 2 && (images[0].isLastFrame || images[1].isFirstFrame)
    ? [images[1], images[0]] : images;
  return {
    ...config, videoModel: EVO_H3_MODEL, videoOperation: 'generate', h3MaxMode, h3MaxOptions: undefined,
    videoQuality: '768p', videoDuration: 5, videoAspectRatio: h3MaxMode === 'text_to_video' ? '16:9' : 'adaptive',
    referenceImages: referenceImages.map(img => img.isFirstFrame || img.isLastFrame ? { ...img, isFirstFrame: false, isLastFrame: false } : img),
    referenceVideos: (config.referenceVideos || []).map(video => video.isContinuation ? { ...video, isContinuation: false } : video),
  };
}

export function getEvoH3Limits(config: GenerationConfig) {
  if (config.h3MaxMode === 'image_to_video') return { images: 2, videos: 0, audios: 0 };
  if (config.h3MaxMode !== 'reference_to_video') return { images: 0, videos: 0, audios: 0 };
  const images = config.referenceImages.length, videos = config.referenceVideos?.length || 0, audios = config.referenceAudios?.length || 0;
  return {
    images: Math.max(0, Math.min(caps.maxImages, caps.maxReferences - videos - audios)),
    videos: Math.max(0, Math.min(caps.maxVideos, caps.maxReferences - images - audios)),
    audios: Math.max(0, Math.min(caps.maxAudio, caps.maxReferences - images - videos)),
  };
}

export function EvoH3MaxSettings({ config, onChange }: { config: GenerationConfig; onChange: (config: GenerationConfig) => void }) {
  const action = config.h3MaxMode ?? 'text_to_video';
  return <>
    <Dropdown label="H3 Max action" value={action} options={EVO_H3_ACTIONS} onSelect={(h3MaxMode: EvoH3DraftMode) => onChange({
      ...config, h3MaxMode, videoAspectRatio: h3MaxMode === 'text_to_video' ? '16:9' : 'adaptive',
    })} icon={Film} compact />
    {action !== 'image_to_video' && <Dropdown label="Ratio" value={config.videoAspectRatio} options={action === 'reference_to_video' ? referenceRatios : textRatios}
      onSelect={(videoAspectRatio: VideoAspectRatio) => onChange({ ...config, videoAspectRatio })} icon={Ratio} compact />}
    <Dropdown label="Quality" value={config.videoQuality} options={qualities} onSelect={(videoQuality: VideoQuality) => onChange({ ...config, videoQuality })} icon={Scan} compact />
    <Dropdown label="Duration" value={String(config.videoDuration)} options={durations} onSelect={value => onChange({ ...config, videoDuration: Number(value) })} icon={Clock} compact />
  </>;
}
