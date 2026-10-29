import { describe, expect, it } from 'vitest';
import { EXPORT_PRESETS, getCoverRect, getExportPreset } from '../../src/lib/export/presets';

describe('export presets', () => {
  it('exposes the supported social dimensions', () => {
    expect(EXPORT_PRESETS.map(preset => preset.id)).toEqual([
      'youtube', 'shorts', 'instagram', 'x', 'thumbnail',
    ]);
    expect(getExportPreset('shorts')).toMatchObject({ width: 1080, height: 1920 });
    expect(getExportPreset('missing')).toBeUndefined();
  });

  it('cover-fits landscape and portrait sources without stretching', () => {
    expect(getCoverRect(1600, 900, 1080, 1080)).toEqual({
      x: -420,
      y: 0,
      width: 1920,
      height: 1080,
    });
    expect(getCoverRect(900, 1600, 1280, 720)).toEqual({
      x: 0,
      y: -777.7777777777778,
      width: 1280,
      height: 2275.5555555555557,
    });
  });

  it('returns the full frame for invalid source dimensions', () => {
    expect(getCoverRect(0, 0, 1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});
