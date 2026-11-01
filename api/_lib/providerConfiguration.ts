export const missingProviderMessage = (provider: string, variable: string): string => process.env.BANANA_RUNTIME === 'local'
  ? `Open Provider keys and add your ${provider} API key before using this feature.`
  : `${provider} is not configured. The workspace owner must add ${variable} to the server environment.`;
import { PROVIDER_KEYS, resolveProvider, type AIProvider, type ProviderAvailability } from '../../src/lib/providers.js';
import { localProviderSettings } from './localProvider.js';
import { codexAvailable } from './codexImage.js';

const IMAGE_MODELS = new Set(['gpt-image-2.5-sunburst', 'gemini-3-pro-image-preview', 'gemini-nano-banana-2.1']);
const TEXT_MODELS = new Set(['anthropic/claude-opus-5.5', 'gpt-6.1-sol', 'gemini-3.8-flash']);
export const providerAvailability = (model?: string): ProviderAvailability => ({
  ...Object.fromEntries(Object.entries(PROVIDER_KEYS).map(([provider, key]) => [provider, Boolean(process.env[key]?.trim()) && process.env[`${provider.toUpperCase()}_ENABLED`] !== 'false'])),
  codex: codexAvailable(),
  local: (() => {
    const local = localProviderSettings();
    return Boolean(local && (model == null ? local.textModel || local.imageModel
      : IMAGE_MODELS.has(model) ? local.imageModel : TEXT_MODELS.has(model) ? local.textModel : false));
  })(),
});
export const chooseProvider = (model: string, preference?: unknown) => resolveProvider(model, preference, providerAvailability(model));
export const providerKey = (provider: AIProvider): string | undefined => provider === 'codex' ? undefined : process.env[PROVIDER_KEYS[provider]];
