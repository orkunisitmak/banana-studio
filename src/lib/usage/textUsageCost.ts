// Server-safe text pricing. Routes record usage_logs rows with these costs;
// browsers only name the feature through usageContext and never write rows.
import { OPENROUTER_TEXT_MODEL } from '../prompts/openrouterText.js';

export const TEXT_USAGE_ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'] as const;
export type TextUsageAction = typeof TEXT_USAGE_ACTIONS[number];
export type TextUsageContext = { action: TextUsageAction; prompt: string };
export const isTextUsageContext = (value: any): value is TextUsageContext =>
  TEXT_USAGE_ACTIONS.some(action => action === value?.action) && typeof value.prompt === 'string';

const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Standard prices verified 2026-10-09. Output includes reasoning tokens.
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/guides/prompt-caching
export const calculateOpenAITextCost = (usage: any): number | null => {
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const writes = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  if (![input, output, cached, writes].every(valid) || cached + writes > input) return null;
  const longContext = input > 272_000;
  const inputCost = ((input - cached - writes) * 2 + cached * 0.1 + writes * 2.5) * (longContext ? 2 : 1);
  return (inputCost + output * 10 * (longContext ? 1.5 : 1)) / 1_000_000;
};

/** Prefer OpenRouter's actual request cost, including caching/provider routing.
 * Token pricing is a fallback for responses without native cost accounting. */
export const calculateOpenRouterTextCost = (usage: any, model: string = OPENROUTER_TEXT_MODEL): number | null => {
  if (usage?.cost != null) return valid(usage.cost) ? usage.cost : null;
  if (model !== OPENROUTER_TEXT_MODEL) return null;
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const writes = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
  if (![input, output, cached, writes].every(valid) || cached + writes > input) return null;
  return ((input - cached - writes) * 4 + cached * 0.2 + writes * 5 + output * 20) / 1_000_000;
};

// Gemini 3.7 and 3.8 share the published standard/introductory rates.
// https://ai.google.dev/gemini-api/docs/pricing
const GEMINI_FLASH_INTRO_END = Date.UTC(2027, 0, 1);
export const GEMINI_FLASH_FALLBACK_CALL_COST = 0.003;
export const getGeminiFlashPricing = (now = Date.now()) => now < GEMINI_FLASH_INTRO_END
  ? { inputPer1M: 0.75, outputPer1M: 3.75 }
  : { inputPer1M: 1.50, outputPer1M: 7.50 };

/** Gemini Flash usageMetadata cost. Cached input bills at 10%; thoughts bill as
 * output. A call without usable token counts records the flat fallback. */
export const calculateGeminiTextCost = (metadata: any, now = Date.now()): number => {
  const count = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };
  const pricing = getGeminiFlashPricing(now);
  const input = count(metadata?.promptTokenCount);
  const output = Math.max(count(metadata?.candidatesTokenCount) + count(metadata?.thoughtsTokenCount), Math.max(0, count(metadata?.totalTokenCount) - input));
  const cached = Math.min(input, count(metadata?.cachedContentTokenCount));
  const cost = ((input - cached) * pricing.inputPer1M + cached * pricing.inputPer1M * 0.1 + output * pricing.outputPer1M) / 1_000_000;
  return cost > 0 ? cost : GEMINI_FLASH_FALLBACK_CALL_COST;
};
