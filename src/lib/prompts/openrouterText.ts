// Server-safe definitions. Verified against OpenRouter's live catalog 2026-10-14.
// https://openrouter.ai/anthropic/claude-opus-5.5
export const OPENROUTER_TEXT_MODEL = 'anthropic/claude-opus-5.5' as const;
export const OPENROUTER_FREE_TEXT_MODEL = 'openrouter/free' as const;
export const OPENROUTER_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenRouterReasoningEffort = typeof OPENROUTER_REASONING_EFFORTS[number];
export const DEFAULT_OPENROUTER_REASONING: OpenRouterReasoningEffort = 'medium';
export const isOpenRouterReasoningEffort = (value: unknown): value is OpenRouterReasoningEffort =>
  OPENROUTER_REASONING_EFFORTS.some(effort => effort === value);

/** Prefer OpenRouter's actual request cost, including caching/provider routing.
 * Token pricing is a fallback for responses without native cost accounting. */
export const calculateOpenRouterTextCost = (usage: any, model: string = OPENROUTER_TEXT_MODEL): number | null => {
  if (model === OPENROUTER_FREE_TEXT_MODEL) return 0;
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (usage?.cost != null) return valid(usage.cost) ? usage.cost : null;
  if (model !== OPENROUTER_TEXT_MODEL) return null;
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const writes = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
  if (![input, output, cached, writes].every(valid) || cached + writes > input) return null;
  return ((input - cached - writes) * 4 + cached * 0.2 + writes * 5 + output * 20) / 1_000_000;
};

export const openRouterErrorMessage = (status?: number): string => {
  if (status === 401 || status === 403) return 'OpenRouter anahtarı veya model izni kontrol edilmeli. Yöneticiye başvur.';
  if (status === 402) return 'OpenRouter kredisi yetersiz. Yönetici hesaba kredi eklemeli.';
  if (status === 429 || status === 503) return 'Opus 5.5 şu anda yoğun veya istek limiti doldu. Biraz sonra yeniden dene.';
  if (status === 400 || status === 422) return 'OpenRouter bu isteği kabul edemedi. Prompt ve referansları kontrol et.';
  return 'Opus 5.5 isteği tamamlanamadı. Kayıtlı kullanım durumunu kontrol edip yeniden dene.';
};
