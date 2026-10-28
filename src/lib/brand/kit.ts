export interface BrandKit {
  name: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  logoDataUrl?: string;
  safeMargin: number;
}

export const BRAND_FONTS = [
  'ui-sans-serif',
  'Georgia',
  'Arial',
  'Verdana',
  'Trebuchet MS',
  'Courier New',
] as const;

export const MAX_LOGO_BYTES = 500 * 1024;

export const DEFAULT_BRAND_KIT: BrandKit = {
  name: 'Banana Studio',
  primaryColor: '#161b22',
  accentColor: '#b5e92a',
  fontFamily: 'ui-sans-serif',
  safeMargin: 6,
};

const HEX = /^#[0-9a-f]{6}$/i;

export const normalizeBrandKit = (input: unknown): BrandKit => {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const name = typeof source.name === 'string' ? source.name.trim().slice(0, 60) : '';
  const logo = typeof source.logoDataUrl === 'string'
    && source.logoDataUrl.startsWith('data:image/')
    && source.logoDataUrl.length <= 700_000
    ? source.logoDataUrl
    : undefined;
  return {
    name: name || DEFAULT_BRAND_KIT.name,
    primaryColor: typeof source.primaryColor === 'string' && HEX.test(source.primaryColor)
      ? source.primaryColor
      : DEFAULT_BRAND_KIT.primaryColor,
    accentColor: typeof source.accentColor === 'string' && HEX.test(source.accentColor)
      ? source.accentColor
      : DEFAULT_BRAND_KIT.accentColor,
    fontFamily: BRAND_FONTS.includes(source.fontFamily as (typeof BRAND_FONTS)[number])
      ? source.fontFamily as string
      : DEFAULT_BRAND_KIT.fontFamily,
    logoDataUrl: logo,
    safeMargin: Number.isFinite(Number(source.safeMargin))
      ? Math.min(20, Math.max(2, Math.round(Number(source.safeMargin))))
      : DEFAULT_BRAND_KIT.safeMargin,
  };
};

const keyFor = (userId: string) => `banana:brand-kit:v1:${userId}`;

export const loadBrandKit = (userId: string): BrandKit => {
  if (!userId) return { ...DEFAULT_BRAND_KIT };
  try {
    return normalizeBrandKit(JSON.parse(localStorage.getItem(keyFor(userId)) || 'null'));
  } catch {
    return { ...DEFAULT_BRAND_KIT };
  }
};

export const saveBrandKit = (userId: string, kit: BrandKit): BrandKit => {
  const normalized = normalizeBrandKit(kit);
  if (userId) {
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(normalized));
    } catch {
      // The brand kit is a convenience; a full quota must not block generation.
    }
  }
  return normalized;
};
