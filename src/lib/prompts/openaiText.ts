// Server-safe OpenAI definitions. Keep browser preferences and the app's types
// module out of the function's runtime dependency graph.
export const OPENAI_TEXT_MODEL = 'gpt-6.2-sol' as const;
export const OPENAI_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenAIReasoningEffort = typeof OPENAI_REASONING_EFFORTS[number];
export const DEFAULT_OPENAI_REASONING: OpenAIReasoningEffort = 'high';
export const isOpenAIReasoningEffort = (value: unknown): value is OpenAIReasoningEffort =>
  OPENAI_REASONING_EFFORTS.some(effort => effort === value);

// Standard prices, including reasoning tokens.
// https://developers.openai.com/api/docs/models/gpt-6.2-sol
// https://developers.openai.com/api/docs/guides/prompt-caching
export const calculateOpenAITextCost = (usage: any): number | null => {
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const writes = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  if (![input, output, cached, writes].every(valid) || cached + writes > input) return null;
  const longContext = input > 272_000;
  const inputCost = ((input - cached - writes) * 2 + cached * 0.1 + writes * 2.5) * (longContext ? 2 : 1);
  return (inputCost + output * 10 * (longContext ? 1.5 : 1)) / 1_000_000;
};
