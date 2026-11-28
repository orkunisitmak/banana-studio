// Shared by native TypeScript consumers and the separately emitted server adapter.
export const FAL_SEEDANCE_MODEL = 'seedance-2.5';
export const FAL_SEEDANCE_20_MODEL = 'seedance-2.0';
export type FalSeedanceModel = typeof FAL_SEEDANCE_20_MODEL | typeof FAL_SEEDANCE_MODEL;
export const isFalSeedanceModel = (value: unknown): value is FalSeedanceModel =>
  value === FAL_SEEDANCE_20_MODEL || value === FAL_SEEDANCE_MODEL;
