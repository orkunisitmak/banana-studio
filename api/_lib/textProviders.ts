import { LIQUID_MODELS, OPENROUTER_MODELS } from '../../src/lib/providers.js';
import { calculateOpenRouterTextCost, openRouterErrorMessage } from '../../src/lib/prompts/openrouterText.js';
import { LIQUID_CHAT_ENDPOINT, calculateLiquidTextCost, liquidErrorMessage } from '../../src/lib/prompts/liquidText.js';
import type { ChatTextProvider } from './chatCompletionsText.js';
import { missingProviderMessage } from './providerConfiguration.js';

export const openRouterTextProvider: ChatTextProvider = {
  id: 'openrouter', guard: 'OpenRouter', logTag: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  missingKeyMessage: () => 'OPENROUTER_API_KEY sunucuda tanımlı değil. Yönetici OpenRouter anahtarını eklemeli.',
  models: Object.fromEntries(['anthropic/claude-opus-5.5', 'gpt-6.1-sol', 'gemini-3.8-flash'].map(model => [model, OPENROUTER_MODELS[model]])),
  acceptsYouTube: model => model === 'gemini-3.8-flash',
  unsupportedPartMessage: 'This model accepts text and image references. YouTube footage requires Gemini.',
  headers: { 'X-OpenRouter-Title': 'Banana Studio' },
  extraBody: model => ({ provider: { require_parameters: true, allow_fallbacks: false, ...(model === 'gemini-3.8-flash' ? { only: ['google-ai-studio'] } : {}) } }),
  cost: (data, model) => calculateOpenRouterTextCost(data?.usage, model),
  usageKey: 'openrouterUsage', usage: data => data?.usage,
  errorMessage: openRouterErrorMessage,
};

/** Liquid Inference: OpenAI-compatible, accepts OpenRouter's `reasoning` and
 * `response_format` fields. The exchange never substitutes a different model;
 * an unlisted model returns 404 instead. */
export const liquidTextProvider: ChatTextProvider = {
  id: 'liquid', guard: 'Liquid Inference', logTag: 'liquid',
  endpoint: LIQUID_CHAT_ENDPOINT,
  apiKeyEnv: 'LIQUID_API_KEY',
  missingKeyMessage: () => missingProviderMessage('Liquid Inference', 'LIQUID_API_KEY'),
  models: LIQUID_MODELS,
  // YouTube footage analysis stays on Gemini direct / OpenRouter (Google AI Studio).
  acceptsYouTube: () => false,
  unsupportedPartMessage: 'Liquid Inference accepts text and image references. Use Google Gemini or OpenRouter for YouTube footage analysis.',
  headers: { 'X-Title': 'Banana Studio' },
  extraBody: () => ({}),
  cost: data => calculateLiquidTextCost(data?.exchange),
  usageKey: 'liquidUsage', usage: data => ({ ...(data?.usage ?? {}), charge: data?.exchange?.charge ?? null }),
  errorMessage: liquidErrorMessage,
};
