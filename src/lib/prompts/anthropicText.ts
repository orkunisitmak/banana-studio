// Server-safe definitions for the direct Anthropic route of Claude Opus 5.5.
// https://platform.claude.com/docs/en/about-claude/models/overview
export const ANTHROPIC_MODELS: Record<string, string> = {
  'anthropic/claude-opus-5.5': 'claude-opus-5-5',
};

/** Anthropic reports cache reads/writes separately from uncached input.
 * Claude Opus 5.5 list prices per million tokens: input $4, cache write (5 min) $5,
 * cache read $0.20, output $20. Returns null when a fallback model served the turn. */
export const calculateAnthropicTextCost = (usage: any, servedModel?: string): number | null => {
  if (servedModel && servedModel !== 'claude-opus-5-5') return null;
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const writes = usage?.cache_creation_input_tokens ?? 0;
  const reads = usage?.cache_read_input_tokens ?? 0;
  if (![input, output, writes, reads].every(valid)) return null;
  return (input * 4 + writes * 5 + reads * 0.2 + output * 20) / 1_000_000;
};

export const anthropicErrorMessage = (status?: number): string => {
  if (status === 401 || status === 403) return 'Anthropic anahtarı veya model izni kontrol edilmeli. Yöneticiye başvur.';
  if (status === 402) return 'Anthropic kredisi yetersiz. Yönetici hesaba kredi eklemeli.';
  if (status === 429 || status === 503 || status === 529) return 'Metin modeli şu anda yoğun veya istek limiti doldu. Biraz sonra yeniden dene.';
  if (status === 400 || status === 413 || status === 422) return 'Anthropic bu isteği kabul edemedi. Prompt, referanslar ve hesap kredisini kontrol et.';
  return 'Metin modeli isteği tamamlanamadı. Kayıtlı kullanım durumunu kontrol edip yeniden dene.';
};
