/** First route is the default. Explicit Auto chooses a configured route before
 * submission; accepted work stays pinned to its original provider. */
export type AIProvider = 'openai' | 'openrouter' | 'anthropic' | 'gemini' | 'fal' | 'evolink' | 'codex';
/** Codex uses the desktop user's own ChatGPT sign-in instead of an API key. */
export type KeyedProvider = Exclude<AIProvider, 'codex'>;
export type ProviderChoice = AIProvider | 'auto' | 'off';
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', gemini: 'Google Gemini', fal: 'fal.ai', evolink: 'EvoLink', codex: 'ChatGPT plan (Codex)',
};
export const PROVIDER_KEYS: Record<KeyedProvider, string> = {
  openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', fal: 'FAL_KEY', evolink: 'EVOLINK_API_KEY',
};
export const providerSetup = (provider: AIProvider): string => provider === 'codex'
  ? 'install the Codex CLI and run `codex login` with your ChatGPT account (desktop app only)'
  : `add your ${PROVIDER_LABELS[provider]} key in Provider keys`;
export const MODEL_ROUTES: Record<string, readonly AIProvider[]> = {
  'gpt-image-2.5-sunburst': ['fal', 'openai', 'openrouter', 'codex'],
  'gpt-image-2.6-sunburst': ['fal', 'openai'],
  'seedream-5.5': ['fal'],
  'gemini-3-pro-image-preview': ['fal', 'gemini', 'openrouter'],
  'gemini-nano-banana-2.1': ['fal', 'gemini', 'openrouter'],
  'claude-opus-5.5': ['fal', 'evolink', 'anthropic', 'openrouter'],
  'gpt-6.2-sol': ['fal', 'evolink', 'openai', 'openrouter'],
  'gemini-4-hydrogen': ['fal', 'evolink', 'gemini', 'openrouter'],
  'seedance-2.0': ['fal', 'evolink', 'openrouter'],
  'seedance-2.5': ['fal', 'evolink', 'openrouter'],
  'minimax-h3': ['fal', 'evolink'],
  'gemini-omni-1.2-flash': ['fal'],
  'magi-2': ['evolink'],
};
export const isProviderChoice = (model: string, choice: unknown): choice is ProviderChoice => (
  typeof model === 'string' && Object.hasOwn(MODEL_ROUTES, model) && (choice === 'auto' || choice === 'off' || MODEL_ROUTES[model].includes(choice as AIProvider))
);
export type ProviderPreferences = Record<string, ProviderChoice>;
export interface ProviderSettings {
  preferences: ProviderPreferences; // Effective for generation and model pickers.
  personal: ProviderPreferences;
  policy: ProviderPreferences;
  canManage: boolean;
}
export function parseHostedProviderSettings(data: unknown): ProviderSettings {
  if (!data || typeof data !== 'object' || !('canManage' in data) || typeof data.canManage !== 'boolean'
      || !('preferences' in data) || !('personal' in data) || !('policy' in data)) throw new Error('Invalid workspace provider settings.');
  const policy = parseProviderPreferences(data.policy);
  if (Object.values(policy).some(choice => choice === 'auto' || choice === 'codex')) throw new Error('Invalid workspace provider policy.');
  return { preferences:parseProviderPreferences(data.preferences),personal:parseProviderPreferences(data.personal),policy,canManage:data.canManage };
}
/** Retain a person's explicit pins when upgrading the public text catalog. */
export const upgradeModelId = (model: string): string => {
  switch (model) {
    case 'anthropic/claude-opus-5.5': return 'claude-opus-5.5';
    case 'gpt-6.1-sol': return 'gpt-6.2-sol';
    case 'gemini-3.8-flash': return 'gemini-4-hydrogen';
    default: return model;
  }
};
export function upgradeProviderPreferences(data: unknown): ProviderPreferences {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const upgraded: ProviderPreferences = {};
  for (const [id, choice] of Object.entries(data)) {
    const model = upgradeModelId(id);
    if (isProviderChoice(model, choice) && (model === id || !Object.hasOwn(upgraded, model))) upgraded[model] = choice;
  }
  return upgraded;
}
export function parseProviderPreferences(data: unknown): ProviderPreferences {
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.entries(data).some(([model, choice]) => !isProviderChoice(model, choice))) {
    throw new Error('Invalid provider preferences.');
  }
  return data as ProviderPreferences;
}
export type ProviderAvailability = Partial<Record<AIProvider, boolean>>;
export function resolveProvider(model: string, choice: unknown, available: ProviderAvailability): AIProvider {
  const routes = MODEL_ROUTES[model];
  if (!Array.isArray(routes)) throw new Error('Unsupported model.');
  if (choice === 'off') throw new Error('This model is turned off in AI settings.');
  choice ??= routes[0];
  if (choice !== 'auto') {
    if (!routes.includes(choice as AIProvider)) throw new Error('This provider does not serve the selected model.');
    if (!available[choice as AIProvider]) { const setup = providerSetup(choice as AIProvider); throw new Error(`${setup[0].toUpperCase()}${setup.slice(1)}, or choose Auto in AI settings.`); }
    return choice as AIProvider;
  }
  const selected = routes.find(provider => available[provider]);
  if (!selected) throw new Error(`This model needs ${routes.map(provider => PROVIDER_LABELS[provider]).join(' or ')}. Add one key in Provider keys${routes.includes('codex') ? ' or sign in to Codex with ChatGPT' : ''}; the other keys are optional.`);
  return selected;
}

export const OPENROUTER_MODELS: Record<string, string> = {
  'gpt-image-2.5-sunburst': 'openai/gpt-image-2.5-sunburst',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image',
  'gemini-nano-banana-2.1': 'google/gemini-nano-banana-2.1',
  'gpt-6.2-sol': 'openai/gpt-6.2-sol', 'gemini-4-hydrogen': 'google/gemini-4-hydrogen',
  'claude-opus-5.5': 'anthropic/claude-opus-5.5',
  'seedance-2.0': 'bytedance/seedance-2.0', 'seedance-2.5': 'bytedance/seedance-2.5',
};
