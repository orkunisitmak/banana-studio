import { supabase } from './authService';
import type { KeyedProvider, LocalAgentProvider } from '../lib/providers';

export interface LocalAgentStatus { installed: boolean; version: string | null; auth: 'signed-in' | 'signed-out' | 'api-key' | 'unknown'; authMethod: string | null; available: boolean; disabled: boolean }
export interface ProviderStatus {
  local: boolean;
  keys: Record<KeyedProvider, { configured: boolean; disabled: boolean }>;
  youtube: { configured: boolean };
  agents: Partial<Record<LocalAgentProvider, LocalAgentStatus>>;
}

/** Reports which providers are connected. Key values never reach the browser. */
export async function getProviderStatus({ refresh = false, signal }: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ProviderStatus> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`/api/provider-status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
  if (!response.ok) throw new Error('Provider status could not be checked.');
  return response.json();
}
