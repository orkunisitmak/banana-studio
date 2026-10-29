export const missingProviderMessage = (provider: string, variable: string): string => process.env.BANANA_RUNTIME === 'local'
  ? `Open Providers and add your ${provider} API key before using this feature.`
  : `${provider} is not configured. The workspace owner must add ${variable} to the server environment.`;
import { LOCAL_AGENT_PROVIDERS, PROVIDER_KEYS, isLocalAgentProvider, resolveProvider, type AIProvider, type ProviderAvailability } from '../../src/lib/providers.js';
import { localAgentAvailable } from './localAgents.js';

export const providerAvailability = (): ProviderAvailability => ({
  ...Object.fromEntries(Object.entries(PROVIDER_KEYS).map(([provider, key]) => [provider, Boolean(process.env[key]?.trim()) && process.env[`${provider.toUpperCase()}_ENABLED`] !== 'false'])),
  ...Object.fromEntries(LOCAL_AGENT_PROVIDERS.map(agent => [agent, localAgentAvailable(agent)])),
});
export const chooseProvider = (model: string, preference?: unknown) => resolveProvider(model, preference, providerAvailability());
export const providerKey = (provider: AIProvider): string | undefined => isLocalAgentProvider(provider) ? undefined : process.env[PROVIDER_KEYS[provider]];
