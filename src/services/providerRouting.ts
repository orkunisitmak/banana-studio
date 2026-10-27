import { supabase } from './authService';
import { resolveProvider, sanitizeProviderPreferences, type ProviderAvailability, type ProviderChoice } from '../lib/providers';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';

// Preferences contain only route names. Credentials stay in the native vault/server.
const storageKey = (userId: string) => `banana-provider-routes-v1:${userId}`;
export async function getProviderPreferences(): Promise<Record<string, ProviderChoice>> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user.id) return {};
  if (isLocalWorkspace()) {
    const result = await supabase.rpc('get_provider_preferences');
    if (result.error) throw new Error('Provider preferences could not be loaded.');
    return sanitizeProviderPreferences(result.data);
  }
  try { return sanitizeProviderPreferences(JSON.parse(localStorage.getItem(storageKey(data.session.user.id)) || '{}')); } catch { return {}; }
}
export async function saveProviderPreference(model: string, value: ProviderChoice) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user.id) throw new Error('Sign in before saving settings.');
  if (isLocalWorkspace()) {
    const result = await supabase.rpc('save_provider_preference',{p_model:model,p_provider:value});
    if (result.error) throw new Error('Provider preferences could not be saved.');
    return;
  }
  const preferences = await getProviderPreferences();
  localStorage.setItem(storageKey(data.session.user.id), JSON.stringify({ ...preferences, [model]: value }));
}
export async function getProviderAvailability(signal?: AbortSignal): Promise<ProviderAvailability> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch('/api/gemini-status', { cache: 'no-store', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
  if (!response.ok) throw new Error('Provider availability could not be checked. No generation was submitted.');
  return (await response.json()).providers || {};
}
export async function selectProvider(model: string, signal?: AbortSignal) {
  const [preferences, available] = await Promise.all([getProviderPreferences(), getProviderAvailability(signal)]);
  return resolveProvider(model, preferences[model], available);
}
