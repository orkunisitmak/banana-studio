import type { GenerationConfig } from '../../types';
import { isFalSeedanceModel, FAL_SEEDANCE_MODEL, FAL_SEEDANCE_20_MODEL, FAL_SEEDANCE_QUALITIES, falSeedanceLimits, falSeedanceDurationError, falSeedanceReferenceError, falSeedanceReferenceDurationError, isFalSeedanceMime } from './falSeedance25';
import { seedanceConfigError, seedanceMode, type SeedanceMode } from './seedance';
import { getSeedanceFrameError } from './seedanceFrames';
import { seedanceProviderError } from './seedanceProviders';
import { getOmniConfigError, OMNI_MODEL } from './omniFlash';
import { MAGI2_MODEL } from './magi2';
import { getMagi2Error } from './magi2Config';
import { getEvoH3MaxError } from './evoH3MaxConfig';
import { getH3MaxConfigError } from './h3MaxConfig';

function falSeedanceDraftError(config: GenerationConfig, mode: SeedanceMode) {
  const images = config.referenceImages, videos = config.referenceVideos || [], audios = config.referenceAudios || [];
  const model = config.videoModel;
  if (!isFalSeedanceModel(model)) return;
  const caps = falSeedanceLimits(model);
  if (config.videoOperation === 'upscale' || (model === FAL_SEEDANCE_20_MODEL && (config.videoOperation || 'generate') !== 'generate' && config.videoOperation !== 'reference_edit')) return 'Choose a supported Seedance action.';
  if ((model === FAL_SEEDANCE_20_MODEL || mode === 'text_only') && !config.prompt.trim()) return 'Enter a prompt to generate a video.';
  if (model === FAL_SEEDANCE_20_MODEL && videos.reduce((total, video) => total + (video.size || 0), 0) >= caps.videoMB * 1024 ** 2) return `Reference videos together must be under ${caps.videoMB} MB.`;
  if (!FAL_SEEDANCE_QUALITIES.some(value => value === config.videoQuality)) return 'Choose a fal Seedance output quality.';
  if (images.some(image => !isFalSeedanceMime('images', image.mimeType))) return 'Choose a JPEG, PNG, WebP, BMP, TIFF, GIF, HEIC or HEIF image.';
  if (videos.some(video => !isFalSeedanceMime('videos', video.mimeType) || (video.size || 0) > caps.videoMB * 1024 ** 2)) return `Reference videos must be MP4 or MOV files up to ${caps.videoMB} MB.`;
  if (audios.some(audio => !isFalSeedanceMime('audios', audio.mimeType) || (audio.size || 0) > caps.audioMB * 1024 ** 2)) return `Reference audio must be MP3 or WAV files up to ${caps.audioMB} MB.`;
  if (model === FAL_SEEDANCE_MODEL && mode !== 'text_only' && mode !== 'image_to_video' && config.falSeedanceOptions?.seed != null && !Number.isSafeInteger(config.falSeedanceOptions.seed)) return 'Seed must be a whole number.';
  return getSeedanceFrameError(images, videos.length, audios.length, config.videoOperation)
    || falSeedanceDurationError(mode, config.videoDuration, model)
    || falSeedanceReferenceError(mode, images.length, videos.length, audios.length, model)
    || falSeedanceReferenceDurationError(mode, 'video', videos.map(video => video.duration), model)
    || falSeedanceReferenceDurationError(mode, 'audio', audios.map(audio => audio.duration), model);
}

/** The same validation guards the visible composer and every submission entry point. */
export function videoDraftError(config: GenerationConfig): string | null | undefined {
  const model = config.videoModel;
  if (model === MAGI2_MODEL) return getMagi2Error(config);
  if (model === OMNI_MODEL) return getOmniConfigError(config);
  if (model === 'minimax-h3') return config.videoProvider === 'evolink' ? getEvoH3MaxError(config) : getH3MaxConfigError(config);
  const images = config.referenceImages, videos = config.referenceVideos || [], audios = config.referenceAudios || [];
  const mode = seedanceMode(images, videos, audios, config.videoOperation);
  if (config.videoProvider === 'fal') return falSeedanceDraftError(config, mode);
  if (!config.prompt.trim()) return 'Enter a prompt to generate a video.';
  if (config.videoProvider === 'openrouter') return seedanceProviderError('openrouter', {
    videoModel: model, mode, duration: config.videoDuration, quality: config.videoQuality, aspectRatio: config.videoAspectRatio,
    referenceEditMode: config.videoOperation === 'reference_edit', imageUrls: images.map(ref => ref.data),
    videoUrls: videos.map(ref => ref.url), audioUrls: audios.map(ref => ref.url),
  });
  return seedanceConfigError(config);
}
