/** Application routes, verified against the providers' catalogues on 2026-10-20.
 * Auto selects an available route BEFORE submission, never after a paid call. */
export type AIProvider = 'openai' | 'openrouter' | 'gemini' | 'fal' | 'evolink' | 'codex' | 'claude-code' | 'gemini-cli' | 'opencode';
/** Local agents run the desktop user's own CLI and subscription sign-in instead of an API key. */
export const LOCAL_AGENT_PROVIDERS = ['codex', 'claude-code', 'gemini-cli', 'opencode'] as const;
export type LocalAgentProvider = typeof LOCAL_AGENT_PROVIDERS[number];
export type KeyedProvider = Exclude<AIProvider, LocalAgentProvider>;
export const isLocalAgentProvider = (provider: unknown): provider is LocalAgentProvider => LOCAL_AGENT_PROVIDERS.includes(provider as LocalAgentProvider);
export type ProviderChoice = AIProvider | 'auto';
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', gemini: 'Google Gemini', fal: 'fal.ai', evolink: 'EvoLink', codex: 'ChatGPT plan (Codex)', 'claude-code': 'Claude plan (Claude Code)', 'gemini-cli': 'Google account (Gemini CLI)', opencode: 'OpenCode account',
};
export const PROVIDER_KEYS: Record<KeyedProvider, string> = {
  openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', fal: 'FAL_KEY', evolink: 'EVOLINK_API_KEY',
};
export const providerSetup = (provider: AIProvider): string => provider === 'codex'
  ? 'install the Codex CLI and run `codex login` with your ChatGPT account (desktop app only)'
  : provider === 'claude-code' ? 'install Claude Code and run `claude auth login` with your Claude account (desktop app only)'
  : provider === 'gemini-cli' ? 'install Gemini CLI and sign in with Google by running `gemini` once (desktop app only)'
  : provider === 'opencode' ? 'install opencode and run `opencode auth login` with your OpenCode account (desktop app only)'
  : `add your ${PROVIDER_LABELS[provider]} key in Providers`;
export const MODEL_ROUTES: Record<string, readonly AIProvider[]> = {
  'gpt-image-2.5-sunburst': ['openai', 'openrouter', 'fal', 'codex'],
  'gemini-3-pro-image-preview': ['fal', 'gemini', 'openrouter'],
  'gemini-nano-banana-2.1': ['fal', 'gemini', 'openrouter'],
  'anthropic/claude-opus-5.5': ['openrouter', 'claude-code', 'opencode'],
  'gpt-6.1-sol': ['openai', 'openrouter', 'codex', 'opencode'],
  'gemini-3.8-flash': ['gemini', 'openrouter', 'gemini-cli', 'opencode'],
  'seedance-2.0': ['evolink', 'fal', 'openrouter'],
  'seedance-2.5': ['evolink', 'fal', 'openrouter'],
  'minimax-h3': ['fal'],
};
export type ProviderAvailability = Partial<Record<AIProvider, boolean>>;
export function resolveProvider(model: string, choice: unknown, available: ProviderAvailability): AIProvider {
  const routes = MODEL_ROUTES[model];
  if (!Array.isArray(routes)) throw new Error('Unsupported model.');
  if (choice != null && choice !== 'auto') {
    if (!routes.includes(choice as AIProvider)) throw new Error('This provider does not serve the selected model.');
    if (!available[choice as AIProvider]) { const setup = providerSetup(choice as AIProvider); throw new Error(`${setup[0].toUpperCase()}${setup.slice(1)}, or choose Auto in AI settings.`); }
    return choice as AIProvider;
  }
  const selected = routes.find(provider => available[provider]);
  if (!selected) throw new Error(`This model needs ${routes.map(provider => PROVIDER_LABELS[provider]).join(' or ')}. Add one key in Providers${routes.some(isLocalAgentProvider) ? ' or connect a local agent' : ''}; the other keys are optional.`);
  return selected;
}

/** Local agents that take text only; image references are never routed to them. */
export const TEXT_ONLY_PROVIDERS: readonly AIProvider[] = ['gemini-cli'];
/** Like resolveProvider, but a request with image references skips text-only
 * routes under Auto (keeping the remaining order), and a pinned text-only route
 * fails instead of falling back to another provider. */
export function resolveProviderForContent(model: string, choice: unknown, available: ProviderAvailability, { images = false } = {}): AIProvider {
  if (!images) return resolveProvider(model, choice, available);
  if (TEXT_ONLY_PROVIDERS.includes(choice as AIProvider)) throw new Error(`${PROVIDER_LABELS[choice as AIProvider]} accepts text only. Remove the image references, or choose another provider in AI settings.`);
  return resolveProvider(model, choice, { ...available, ...Object.fromEntries(TEXT_ONLY_PROVIDERS.map(provider => [provider, false])) });
}

export const OPENROUTER_MODELS: Record<string, string> = {
  'gpt-image-2.5-sunburst': 'openai/gpt-image-2.5-sunburst',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image',
  'gemini-nano-banana-2.1': 'google/gemini-nano-banana-2.1',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol', 'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'anthropic/claude-opus-5.5': 'anthropic/claude-opus-5.5',
  'seedance-2.0': 'bytedance/seedance-2.0', 'seedance-2.5': 'bytedance/seedance-2.5',
};
