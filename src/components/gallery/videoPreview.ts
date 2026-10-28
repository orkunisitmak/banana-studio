export const getVideoPreviewSrc = (src: string): string => {
  if (!src || /#t=/i.test(src)) return src;
  const hashIndex = src.indexOf('#');
  const base = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
  // iOS Safari often leaves a controls-free video black until playback. A
  // media fragment makes it decode and paint an actual frame while paused.
  return `${base}#t=0.1`;
};

export const formatPlaybackTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};
