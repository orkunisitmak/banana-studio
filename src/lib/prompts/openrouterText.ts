// Server-safe definitions. Verified against OpenRouter's live catalog 2026-10-14.
// https://openrouter.ai/anthropic/claude-opus-5.5
export const OPENROUTER_TEXT_MODEL = 'anthropic/claude-opus-5.5' as const;
export const OPENROUTER_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenRouterReasoningEffort = typeof OPENROUTER_REASONING_EFFORTS[number];
export const DEFAULT_OPENROUTER_REASONING: OpenRouterReasoningEffort = 'medium';
export const isOpenRouterReasoningEffort = (value: unknown): value is OpenRouterReasoningEffort =>
  OPENROUTER_REASONING_EFFORTS.some(effort => effort === value);

export const openRouterErrorMessage = (status?: number): string => {
  if (status === 401 || status === 403) return 'OpenRouter anahtarı veya model izni kontrol edilmeli. Yöneticiye başvur.';
  if (status === 402) return 'OpenRouter kredisi yetersiz. Yönetici hesaba kredi eklemeli.';
  if (status === 429 || status === 503) return 'Opus 5.5 şu anda yoğun veya istek limiti doldu. Biraz sonra yeniden dene.';
  if (status === 400 || status === 422) return 'OpenRouter bu isteği kabul edemedi. Prompt ve referansları kontrol et.';
  return 'Opus 5.5 isteği tamamlanamadı. Kayıtlı kullanım durumunu kontrol edip yeniden dene.';
};
