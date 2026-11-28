import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createUserScopedClient } from './auth.js';
import { MODEL_ROUTES, PROVIDER_KEYS, parseHostedProviderSettings, parseProviderPreferences, resolveProvider, type AIProvider, type ProviderAvailability, type ProviderPreferences } from '../../src/lib/providers.js';
import { codexAvailable } from './codexImage.js';
export const missingProviderMessage = (provider: string, variable: string): string => process.env.BANANA_RUNTIME === 'local'
  ? `Open Provider keys and add your ${provider} API key before using this feature.`
  : `${provider} is not configured. The workspace owner must add ${variable} to the server environment.`;

export const providerAvailability = (): ProviderAvailability => ({
  ...Object.fromEntries(Object.entries(PROVIDER_KEYS).map(([provider, key]) => [provider, Boolean(process.env[key]?.trim()) && process.env[`${provider.toUpperCase()}_ENABLED`] !== 'false'])),
  codex: codexAvailable(),
});
export const chooseProvider = (model: string, preference?: unknown) => resolveProvider(model, preference, providerAvailability());
export const providerKey = (provider: AIProvider): string | undefined => provider === 'codex' ? undefined : process.env[PROVIDER_KEYS[provider]];

function rejectAdmission(res: VercelResponse, status: number, error: string): null {
  res.status(status).json({ code: 'PROVIDER_ADMISSION_REJECTED', providerRequestSent: false, error });
  return null;
}

/** New paid work only: reject disabled models and stale/mismatched provider
 * selections. Task polling and recovery must use the stored task identity. */
export async function admitProvider(req: VercelRequest, res: VercelResponse, model: string, requested?: unknown, operation?: 'youtube' | 'fal-scale'): Promise<AIProvider | null> {
  if (typeof model !== 'string' || !Object.hasOwn(MODEL_ROUTES, model)) {
    return rejectAdmission(res, 400, 'Unsupported model.');
  }
  let preferences: ProviderPreferences, policy: ProviderPreferences = {};
  const readPolicy = operation === 'youtube';
  try {
    const { data, error } = await createUserScopedClient(req).rpc('get_provider_preferences',readPolicy ? {p_include_policy:true} : {}).abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    if (readPolicy) ({ preferences,policy } = parseHostedProviderSettings(data));
    else preferences = parseProviderPreferences(data);
  } catch {
    return rejectAdmission(res, 503, 'Provider preferences could not be loaded. No generation was submitted.');
  }
  const choice = preferences[model];
  if (choice === 'off') {
    return rejectAdmission(res, 403, 'This model is turned off in AI settings.');
  }
  // Native YouTube analysis uses a Gemini file URI which other routes cannot
  // consume. Only the endpoint that has validated that operation opts into it.
  const nativeYoutube = operation === 'youtube' && model === 'gemini-4-hydrogen' && requested === 'gemini' && !policy[model];
  try {
    const availability = providerAvailability();
    const selected = resolveProvider(model, nativeYoutube ? 'gemini' : choice, availability);
    if (requested != null && requested !== 'auto' && requested !== selected) {
      return rejectAdmission(res, 409, 'The selected provider does not match AI settings. Refresh and try again.');
    }
    if (operation === 'fal-scale' && !availability.fal) {
      return rejectAdmission(res, 503, 'Video preprocessing requires fal.ai to be enabled and configured.');
    }
    return selected;
  } catch (error) {
    return rejectAdmission(res, 503, (error as Error).message);
  }
}
