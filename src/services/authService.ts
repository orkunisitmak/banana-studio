import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { getCloudPublicConfig, getWorkspaceConfig } from '../lib/config/runtimeConfig';
import { createLocalWorkspaceClient } from '../../desktop/shared/browserClient';
import { createSessionReader, retryTransientRead } from '../lib/shared/transientRead';
import { buildAdminUsageSummary } from '../lib/admin/adminUsage';
import { AdminUsageRange, validateAdminUsageRange } from '../lib/admin/adminUsageRange';
import { UserProfile, AdminUserSummary } from '../types';

const runtime = getWorkspaceConfig();
const workspaceConfig = runtime.mode === 'cloud' ? getCloudPublicConfig() : null;
export const SUPABASE_URL = workspaceConfig?.supabaseUrl || window.location.origin;
const AUTH_STORAGE_KEY = `banana-studio:${new URL(SUPABASE_URL).host}:auth`;
const SUPABASE_ANON_KEY = workspaceConfig?.supabasePublishableKey;

// Single shared Supabase client instance
export const supabase: SupabaseClient = runtime.mode === 'local'
  ? createLocalWorkspaceClient(runtime) as unknown as SupabaseClient
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY!, { auth: { storageKey: AUTH_STORAGE_KEY } });

// --- Auth Methods ---

export const signInWithGoogle = async () => {
  // If we are on the custom domain or localhost, use that. Otherwise fallback to the origin.
  const redirectUrl = (import.meta as any).env.VITE_REDIRECT_URL || window.location.origin;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
    }
  });
  if (error) throw error;
};

export const signOut = async () => {
  const { data: { session: startingSession } } = await supabase.auth.getSession();
  const { error } = await supabase.auth.signOut();
  if (!error) return;

  // Supabase retains the browser credential when its remote logout fails.
  // Remove only this client's credential so reload cannot undo local logout.
  if (typeof localStorage === 'undefined') throw error;
  const { data: { session: currentSession } } = await supabase.auth.getSession();
  if (currentSession?.user.id !== startingSession?.user.id) throw error;
  await supabase.auth.stopAutoRefresh();
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
  localStorage.removeItem(`${AUTH_STORAGE_KEY}-user`);
  // With no stored session this performs no remote revocation and broadcasts
  // SIGNED_OUT to other tabs through Supabase's normal event mechanism.
  const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
  if (localError) throw localError;
};

export const getSession = createSessionReader(async (): Promise<Session | null> => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
});

export const getCurrentUserId = async (): Promise<string | null> => {
  const { data: { user } } = await retryTransientRead(async () => {
    const result = await supabase.auth.getUser();
    if (result.error) throw result.error;
    return result;
  });
  return user?.id || null;
};

export const getProfile = async (): Promise<UserProfile | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !data) return null;
  return data as UserProfile;
};

export const onAuthStateChange = (callback: (session: Session | null, event?: string) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session, event);
  });
};

/** Only a verified identity with an exact, active allowlist entry may enter. */
export const isUserAuthorized = async (expectedUserId?: string): Promise<boolean> => {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user?.email || !user.email_confirmed_at || (user as { is_anonymous?: boolean }).is_anonymous
        || (expectedUserId && user.id !== expectedUserId)) return false;

      // LIKE treats '_' and '%' as wildcards, both valid email characters.
      const email = user.email.trim().toLowerCase();
      const literalEmail = email.replace(/[\\%_]/g, '\\$&');
      const { data, error } = await supabase
        .from('authorized_emails')
        .select('email')
        .eq('is_active', true)
        .ilike('email', literalEmail)
        .maybeSingle();
      if (error) throw error;
      return !!data && String(data.email || '').trim().toLowerCase() === email;
    } catch {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  // Network errors and expired/revoked identities never grant access.
  return false;
};

// --- Admin Methods ---
// usage_logs rows are written only by the server routes that call each provider,
// with server-computed costs. Browsers read them; admins may reset them.

export const getAdminUsageSummary = async (range?: AdminUsageRange): Promise<AdminUserSummary[]> => {
  validateAdminUsageRange(range);
  const [profilesResult, authorizedResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, display_name, avatar_url, role'),
    supabase
      .from('authorized_emails')
      .select('email')
      .eq('is_active', true),
  ]);

  if (profilesResult.error || !profilesResult.data) throw new Error('Could not load users. Try again.');
  if (authorizedResult.error || !authorizedResult.data) {
    // Fail closed: the admin usage table must never fall back to displaying
    // every OAuth-created profile when the authorization list is unavailable.
    console.warn('Failed to load the active authorization list:', authorizedResult.error);
    throw new Error('Could not load authorized users. Try again.');
  }

  const authorizedEmails = new Set(
    authorizedResult.data
      .map(entry => String(entry.email || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const profiles = profilesResult.data.filter(profile =>
    authorizedEmails.has(String(profile.email || '').trim().toLowerCase())
  );

  const { data: logs, error: logsError } = await (async () => {
    let allLogs: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      let query = supabase
        .from('usage_logs')
        .select('user_id, model, action, image_count, estimated_cost');
      if (range) query = query.gte('created_at', range.start).lt('created_at', range.end);
      const { data, error } = await query
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return { data: null, error };
      if (!data || data.length === 0) break;
      allLogs.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return { data: allLogs, error: null };
  })();

  if (logsError) throw new Error('Could not load usage for this time range. Try again.');

  return buildAdminUsageSummary(profiles, logs || []);
};

// Admin: Get recent usage logs with user info
export const getAdminRecentLogs = async (limit = 100) => {
  const { data, error } = await supabase
    .from('usage_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
};

// Admin: Get total generation count across all users
export const getAdminTotalGenerations = async () => {
  const { count: usageCount, error: usageError } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .in('action', ['generate', 'video_generate']);

  if (!usageError) return usageCount || 0;

  const { count, error } = await supabase
    .from('generations')
    .select('*', { count: 'exact', head: true });

  if (error) return 0;
  return count || 0;
};

export interface ProviderUsageSummary {
  evolink: null | {
    usedCredits: number | null;
    remainingCredits: number | null;
    usedUsdApprox: number | null;
    remainingUsdApprox: number | null;
    creditsPerUsd: number;
    tokenUsedCredits: number | null;
  };
  fal: null | {
    actualCostUsd: number;
    imageActualCostUsd: number;
    videoActualCostUsd: number;
    quantity: number | null;
    quantityUnit?: string | null;
    start: string;
    end?: string;
    scope?: 'workspace_endpoints';
    byEndpoint: Array<{ endpoint: string; costUsd: number; quantity: number | null; unit?: string | null }>;
  };
  falStatus?: ProviderUsageStatus;
  openai?: null | {
    actualCostUsd: number;
    start: string;
    end: string;
    scope: 'project' | 'organization';
    byLineItem: Array<{ lineItem: string; costUsd: number }>;
  };
  openaiStatus?: ProviderUsageStatus;
  warnings: string[];
}
type ProviderUsageStatus = 'ok' | 'needs_admin_key' | 'forbidden' | 'invalid_key' | 'unavailable';

// Admin-only provider reconciliation. Unlike usage_logs, this reads aggregate
// billing directly from EvoLink and, when their Admin keys are configured, fal.ai and OpenAI.
export const getProviderUsageSummary = async (): Promise<ProviderUsageSummary> => {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) throw new Error('No authenticated session');

  const response = await fetch('/api/provider-usage', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Provider usage is unavailable');
  return data as ProviderUsageSummary;
};

// --- Authorized Emails Management ---

export interface AuthorizedEmail {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

export const getAuthorizedEmails = async (): Promise<AuthorizedEmail[]> => {
  const { data, error } = await supabase
    .from('authorized_emails')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Failed to fetch authorized emails:', error);
    return [];
  }
  return (data || []) as AuthorizedEmail[];
};

export const addAuthorizedEmail = async (email: string): Promise<void> => {
  const { error } = await supabase
    .from('authorized_emails')
    .insert({ email: email.toLowerCase().trim() });

  if (error) throw error;
};

export const removeAuthorizedEmail = async (id: string): Promise<void> => {
  const { error } = await supabase
    .from('authorized_emails')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

// Admin: Reset all usage logs (clears estimated costs and counts)
export const resetUsageLogs = async (): Promise<number> => {
  // Use returning to know exactly how many rows were affected. If RLS quietly
  // rejects the delete (no DELETE policy), this returns 0 and we surface a
  // clearer error than the original silent success.
  const { data, error } = await supabase
    .from('usage_logs')
    .delete()
    .gte('id', '00000000-0000-0000-0000-000000000000')
    .select('id');

  if (error) throw new Error(`Failed to reset usage logs: ${error.message}`);
  return data?.length || 0;
};
