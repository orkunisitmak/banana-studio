// Server-safe OpenAI definitions. Keep browser preferences and the app's types
// module out of the function's runtime dependency graph.
export const OPENAI_TEXT_MODEL = 'gpt-6.1-sol' as const;
export const OPENAI_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenAIReasoningEffort = typeof OPENAI_REASONING_EFFORTS[number];
export const DEFAULT_OPENAI_REASONING: OpenAIReasoningEffort = 'high';
export const isOpenAIReasoningEffort = (value: unknown): value is OpenAIReasoningEffort =>
  OPENAI_REASONING_EFFORTS.some(effort => effort === value);
// Pricing lives in ../usage/textUsageCost.ts with the other server-recorded text costs.
