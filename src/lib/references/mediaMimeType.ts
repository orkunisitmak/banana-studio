export const getMediaMimeType = (file: Pick<Blob, 'type'>, name?: string): string => {
  // Pickers may report recognized media as generic binary. Infer those files
  // from their known extension before sending MIME-restricted Storage uploads.
  const type = file.type?.split(';', 1)[0].trim().toLowerCase();
  // Ogg audio pickers can report the container type instead of audio/ogg.
  // Only normalize known audio extensions; do not relabel video/unknown Ogg.
  if (type === 'application/ogg' && /\.(ogg|oga)$/i.test(name || '')) return 'audio/ogg';
  if (type && type !== 'application/octet-stream') return type;
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'webp': return 'image/webp';
        case 'avif': return 'image/avif';
        case 'bmp': return 'image/bmp';
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
