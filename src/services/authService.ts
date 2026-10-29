import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { getCloudPublicConfig, getWorkspaceConfig } from '../lib/config/runtimeConfig';
import { createLocalWorkspaceClient } from '../../desktop/shared/browserClient';
import { createSessionReader, isTransientReadError, retryTransientRead } from '../lib/shared/transientRead';
import { buildAdminUsageSummary } from '../lib/admin/adminUsage';
import { AdminUsageRange, validateAdminUsageRange } from '../lib/admin/adminUsageRange';
import { OPENAI_TEXT_MODEL, calculateOpenAITextCost } from '../lib/prompts/textModels';
import { OPENROUTER_TEXT_MODEL, calculateOpenRouterTextCost } from '../lib/prompts/openrouterText';
import { UserProfile, AdminUserSummary, Resolution, AspectRatio, VideoModelId, VideoOperation, VideoQuality, estimateImageCost, estimateVideoCost } from '../types';

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

  // No row is "no profile"; a failed read is not, and must not drop a role.
  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error('Your profile could not be loaded.');
  return (data as UserProfile) || null;
};

export const onAuthStateChange = (callback: (session: Session | null, event?: string) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session, event);
  });
};

/**
 * `unavailable` means the allowlist could not be read because of a transient
 * network failure. It never grants entry; callers only use it to keep an
 * already-verified session open instead of treating the blip as a denial.
 */
export type AuthorizationCheck = 'authorized' | 'unauthorized' | 'unavailable';

/** Only a verified identity with an exact, active allowlist entry may enter. */
export const checkUserAuthorization = async (expectedUserId?: string): Promise<AuthorizationCheck> => {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user?.email || !user.email_confirmed_at || (user as { is_anonymous?: boolean }).is_anonymous
        || (expectedUserId && user.id !== expectedUserId)) return 'unauthorized';

      // LIKE treats '_' and '%' as wildcards, both valid email characters.
      const email = user.email.trim().toLowerCase();
      const literalEmail = email.replace(/[\\%_]/g, '\\$&');
      const { data, error, status } = await supabase
        .from('authorized_emails')
        .select('email')
        .eq('is_active', true)
        .ilike('email', literalEmail)
        .maybeSingle();
      // PostgREST keeps the HTTP status beside the error; 502/503/504 are outages.
      if (error) throw Object.assign(error, { status });
      return !!data && String(data.email || '').trim().toLowerCase() === email ? 'authorized' : 'unauthorized';
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  // Expired/revoked identities and unexpected errors never grant access.
  return isTransientReadError(lastError) ? 'unavailable' : 'unauthorized';
};

export const isUserAuthorized = async (expectedUserId?: string): Promise<boolean> =>
  await checkUserAuthorization(expectedUserId) === 'authorized';

// --- Usage Logging ---

// Gemini paid-tier pricing (USD) from Google AI pricing docs.
// https://ai.google.dev/gemini-api/docs/pricing
const MODEL_PRICING = {
  // Both Nano Banana variants are now billed by fal.ai per output image at
  // a flat resolution-dependent rate (see types.ts IMAGE_COST_PER_GEN for
  // the citations). fal doesn't return token usage on these endpoints so
  // we don't bother with the old Gemini-direct token math — the per-image
  // table IS the authoritative cost.
  'gemini-3-pro-image-preview': {
    perImageByResolution: {
      '1K': 0.150,
      '2K': 0.150,
      '4K': 0.300,
    } as Record<Resolution, number>,
  },
  'gemini-3.1-flash-image-preview': {
    perImageByResolution: {
      '1K': 0.082, // $0.08 base + $0.002 high-thinking surcharge (always on)
      '2K': 0.122, // 1.5× base + thinking
      '4K': 0.162, // 2.0× base + thinking
    } as Record<Resolution, number>,
  },
};

const FALLBACK_ESTIMATED_CALL_COSTS: Record<string, number> = {
  'gemini-3.7-flash': 0.003,
  'gemini-3.8-flash': 0.003,
};

const GEMINI_FLASH_INTRO_END = Date.UTC(2027, 0, 1);

// Gemini 3.7 and 3.8 share the published standard/introductory rates.
// https://ai.google.dev/gemini-api/docs/pricing
const getGeminiFlashPricing = () => Date.now() < GEMINI_FLASH_INTRO_END
  ? { inputPer1M: 0.75, outputPer1M: 3.75 }
  : { inputPer1M: 1.50, outputPer1M: 7.50 };

type TokenDetail = {
  modality?: string;
  tokenCount?: number;
};

type UsageMetadataLike = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  openaiUsage?: unknown;
  openrouterUsage?: unknown;
  usageLogged?: boolean;
  usageLoggingPending?: boolean;
  promptTokensDetails?: TokenDetail[];
  candidatesTokensDetails?: TokenDetail[];
};

type LogUsageOptions = {
  usageMetadata?: UsageMetadataLike | null;
  resolution?: Resolution;
  referenceImageCount?: number;
  [key: string]: unknown;
};

const toNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const sumTokenDetails = (details: TokenDetail[] | undefined, modality: string): number => {
  if (!Array.isArray(details)) return 0;
  return details.reduce((sum, detail) => {
    if ((detail.modality || '').toUpperCase() !== modality) return sum;
    return sum + toNumber(detail.tokenCount);
  }, 0);
};

const estimateUsageCost = (
  model: string,
  imageCount: number,
  options: LogUsageOptions
): number | null => {
  const metadata = options.usageMetadata;
  const normalizedImageCount = Math.max(0, imageCount);
  if (options.estimatedCost === null) return null;
  const providedEstimatedCost = toNumber(options.estimatedCost);
  if (providedEstimatedCost > 0) return providedEstimatedCost;

  // 2.1 is token-billed and fal's queue provides no final usage. Preserve
  // unknown totals instead of reporting the retired model's fixed price.
  if (model === 'gemini-nano-banana-2.1') return null;

  if (model === 'gemini-3-pro-image-preview' || model === 'gemini-3.1-flash-image-preview') {
    // Nano Banana Pro / Nano Banana 2 are now billed by fal.ai at a flat
    // per-image rate that depends only on resolution. fal doesn't expose
    // token counts on these endpoints, so the old Gemini-direct token
    // math (which previously over-estimated by ~2.6×) is gone — we just
    // multiply the published per-image price by the image count.
    const pricing = model === 'gemini-3.1-flash-image-preview'
      ? MODEL_PRICING['gemini-3.1-flash-image-preview']
      : MODEL_PRICING['gemini-3-pro-image-preview'];
    const resolution = options.resolution || '1K';
    const perImage = pricing.perImageByResolution[resolution]
      ?? pricing.perImageByResolution['1K'];
    return perImage * normalizedImageCount;
  }

  if (metadata?.openrouterUsage) return calculateOpenRouterTextCost(metadata.openrouterUsage, model);
  if (model === OPENAI_TEXT_MODEL) return calculateOpenAITextCost(metadata?.openaiUsage);
  if (model === OPENROUTER_TEXT_MODEL) return calculateOpenRouterTextCost(metadata?.openrouterUsage);

  if (model === 'gemini-3.7-flash' || model === 'gemini-3.8-flash') {
    const pricing = getGeminiFlashPricing();
    const inputTokens = toNumber(metadata?.promptTokenCount);
    const candidateTokens = toNumber(metadata?.candidatesTokenCount);
    const thoughtsTokens = toNumber(metadata?.thoughtsTokenCount);
    const totalTokens = toNumber(metadata?.totalTokenCount);
    const fallbackOutputTokens = Math.max(0, totalTokens - inputTokens);
    const outputTokens = Math.max(candidateTokens + thoughtsTokens, fallbackOutputTokens);
    const cachedTokens = Math.min(inputTokens, Math.max(0, toNumber(metadata?.cachedContentTokenCount)));
    const tokenBasedCost = ((inputTokens - cachedTokens) * pricing.inputPer1M + cachedTokens * pricing.inputPer1M * 0.1 + outputTokens * pricing.outputPer1M) / 1_000_000;
    if (tokenBasedCost > 0) return tokenBasedCost;
    return FALLBACK_ESTIMATED_CALL_COSTS[model];
  }

  if (model === 'gpt-image-2-beta') {
    const ar = (options.aspectRatio as AspectRatio) || '1:1';
    const res = (options.resolution as Resolution) || '1K';
    return estimateImageCost(
      'gpt-image-2-beta',
      res,
      normalizedImageCount,
      ar,
      toNumber(options.referenceImageCount) > 0,
    ) ?? 0;
  }

  if (model.startsWith('seedance-2.0') || model.startsWith('seedance-2.5') || model.startsWith('minimax-h3')) {
    const videoModel: VideoModelId = model.startsWith('seedance-2.0')
      ? 'seedance-2.0'
      : model.startsWith('minimax-h3')
        ? 'minimax-h3'
        : 'seedance-2.5';
    const quality = ((options.videoQuality as string) || (videoModel === 'minimax-h3' ? '2K' : '720p')) as VideoQuality;
    const duration = options.videoDuration === -1 ? -1 : (toNumber(options.videoDuration) || 5);
    const hasVideoInput = !!options.referenceVideoCount;
    const referenceVideoDuration = hasVideoInput ? toNumber(options.referenceVideoDuration) : 0;
    const primaryVideoDuration = hasVideoInput ? toNumber(options.primaryVideoDuration) : 0;
    const operation = ((options.videoOperation as string) || 'generate') as VideoOperation;
    const h3Mode = model.endsWith('-text-only')
      ? 'text_only' as const
      : model.endsWith('-image-to-video')
        ? 'image_to_video' as const
        : model.endsWith('-reference-to-video')
          ? 'reference_to_video' as const
          : undefined;
    return estimateVideoCost(
      videoModel,
      quality,
      duration,
      hasVideoInput,
      referenceVideoDuration,
      operation,
      primaryVideoDuration,
      toNumber(options.referenceImageCount),
      h3Mode,
    ).usd * normalizedImageCount;
  }

  // Unknown model fallback.
  return 0.01 * normalizedImageCount;
};

export const logUsage = async (
  action: 'generate' | 'enhance' | 'brainstorm' | 'variation' | 'video_generate' | 'video_enhance',
  model: string,
  prompt: string,
  imageCount: number = 1,
  options: LogUsageOptions = {}
) => {
  if (options.usageMetadata?.usageLogged || options.usageMetadata?.usageLoggingPending) return;
  try {
    const startingSession = await getSession();
    const userId = await getCurrentUserId();
    if (!userId || startingSession?.user.id !== userId) return;
    const currentSession = await getSession();
    if (currentSession?.user.id !== userId) return;

    const normalizedImageCount = Math.max(0, imageCount);
    const estimatedCost = estimateUsageCost(model, normalizedImageCount, options);

    await supabase.from('usage_logs').insert({
      user_id: userId,
      action,
      model,
      prompt: prompt.substring(0, 500),
      image_count: normalizedImageCount,
      estimated_cost: estimatedCost
    });
  } catch (e) {
    console.warn('Failed to log usage:', e);
  }
};

// --- Admin Methods ---

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
  // RLS turns a disallowed delete into a successful delete of zero rows.
  const { data, error } = await supabase
    .from('authorized_emails')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data?.length) throw new Error('This email still has access. Refresh the list; you may no longer be an admin.');
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
