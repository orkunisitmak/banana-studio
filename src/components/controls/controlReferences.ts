import type { ReferenceVideo } from '../../types';
import { uploadVideoBlobToPublicUrl } from '../../services/storageService';
import { MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_MB } from '../../lib/references/mediaUploadLimits';

export const getMimeType = (file: File | Blob, name?: string): string => {
  if (file.type) return file.type;
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg': 
        case 'jpeg': return 'image/jpeg';
        case 'webp': return 'image/webp';
        case 'heic': return 'image/heic';
        case 'heif': return 'image/heif';
        case 'mp4': return 'video/mp4';
        case 'mov': return 'video/quicktime';
        case 'webm': return 'video/webm';
        case 'ogg':
        case 'oga': return 'audio/ogg';
        case 'aac': return 'audio/aac';
        case 'm4a': return 'audio/mp4';
        case 'mp3': return 'audio/mpeg';
        case 'wav': return 'audio/wav';
        case 'flac': return 'audio/flac';
        case 'aif':
        case 'aiff': return 'audio/aiff';
    }
  }
  return 'application/octet-stream';
};

export const readFileAsBase64 = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const readMediaDuration = (url: string, kind: 'video' | 'audio'): Promise<number | undefined> => {
  return new Promise(resolve => {
    const media = document.createElement(kind);
    let settled = false;
    let timeout = 0;
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      resolve(duration);
    };
    timeout = window.setTimeout(() => finish(), 5000);
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(
      Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined
    );
    media.onerror = () => finish();
    media.src = url;
  });
};

export const readVideoDuration = (url: string): Promise<number | undefined> => readMediaDuration(url, 'video');
export const readAudioDuration = (url: string): Promise<number | undefined> => readMediaDuration(url, 'audio');

export const uploadReferenceVideo = async (file: File, allowNativeWebm = false): Promise<ReferenceVideo> => {
  const mimeType = getMimeType(file, file.name);
  const normalizedMime = mimeType.toLowerCase();
  if (!normalizedMime.includes('mp4') && !normalizedMime.includes('quicktime') && !normalizedMime.includes('mov') && !(allowNativeWebm && normalizedMime === 'video/webm')) {
    throw new Error(`${file.name || 'Video'} must be an MP4, MOV${allowNativeWebm ? ', or WebM' : ''} file.`);
  }
  if (file.size === 0) {
    throw new Error(`${file.name || 'Video'} is empty or could not be read.`);
  }
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(`${file.name || 'Video'} is larger than the ${MAX_VIDEO_UPLOAD_MB} MB limit.`);
  }

  // iOS can invalidate a picker-backed File after an async boundary. Convert
  // it to a plain Blob and start the upload while the change event is active,
  // then keep only the durable HTTPS URL in React state.
  const uploadBlob = file.slice(0, file.size, mimeType);
  const previewUrl = URL.createObjectURL(uploadBlob);
  const uploadPromise = uploadVideoBlobToPublicUrl(
    uploadBlob,
    mimeType,
    'vref_video',
    normalizedMime === 'video/webm' ? 'webm' : normalizedMime.includes('quicktime') || normalizedMime.includes('mov') ? 'mov' : 'mp4',
  );
  const durationPromise = readVideoDuration(previewUrl);

  try {
    const [publicUrl, duration] = await Promise.all([uploadPromise, durationPromise]);
    if (!publicUrl) {
      throw new Error(`${file.name || 'Video'} could not be uploaded. Check your connection and try again.`);
    }
    return {
      id: Math.random().toString(36).substr(2, 9),
      url: publicUrl,
      mimeType,
      duration,
      size: file.size,
    };
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
};
