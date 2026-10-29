export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube', label: 'YouTube 16:9 · 1280×720', width: 1280, height: 720 },
  { id: 'shorts', label: 'Shorts / Reels 9:16 · 1080×1920', width: 1080, height: 1920 },
  { id: 'instagram', label: 'Instagram 1:1 · 1080×1080', width: 1080, height: 1080 },
  { id: 'x', label: 'X / LinkedIn 16:9 · 1600×900', width: 1600, height: 900 },
  { id: 'thumbnail', label: 'Thumbnail 16:9 · 1920×1080', width: 1920, height: 1080 },
];

export const getExportPreset = (id: string): ExportPreset | undefined =>
  EXPORT_PRESETS.find(preset => preset.id === id);

/** Cover-fit rectangle; the source is cropped, never letterboxed. */
export const getCoverRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } => {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
};
