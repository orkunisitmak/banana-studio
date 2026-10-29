import type { VercelResponse } from '@vercel/node';

type QuotaAlert = {
  scope: 'global' | 'provider';
  userId: string;
  provider?: string;
  limit: number;
};

/**
 * Optional operator alert. It is deliberately fire-and-forget: a webhook
 * outage must never turn a quota rejection into a generation failure.
 */
export const sendQuotaAlert = async (alert: QuotaAlert): Promise<boolean> => {
  const webhook = process.env.BANANA_QUOTA_ALERT_WEBHOOK?.trim();
  if (!webhook || !/^https:\/\//i.test(webhook)) return false;
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'generation_quota_rejected',
        scope: alert.scope,
        user_id: alert.userId,
        provider: alert.provider || null,
        limit: alert.limit,
        at: new Date().toISOString(),
      }),
    });
    if (!response.ok) console.warn('Quota alert webhook rejected the event', response.status);
    return response.ok;
  } catch (error) {
    console.warn('Quota alert webhook failed', error);
    return false;
  }
};

/**
 * Opt-in per-user daily generation quota. Zero/unset keeps the existing
 * behaviour; a positive integer reserves a slot atomically through the
 * reserve_generation_quota RPC.
 */
export const dailyGenerationLimit = (): number => {
  const value = Number(process.env.BANANA_DAILY_GENERATION_LIMIT || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

/** Optional JSON map, for example {"openai":50,"fal":100}. */
export const providerDailyLimits = (): Record<string, number> => {
  try {
    const parsed = JSON.parse(process.env.BANANA_DAILY_PROVIDER_LIMITS || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([provider, value]) => /^[a-z0-9_-]{1,40}$/.test(provider) && Number.isFinite(Number(value)) && Number(value) > 0)
      .map(([provider, value]) => [provider, Math.floor(Number(value))]));
  } catch {
    return {};
  }
};

export const providerDailyLimit = (provider: string | undefined): number =>
  provider ? providerDailyLimits()[provider] || 0 : 0;

/** Records a provider-accepted request so the quota sees every billable path. */
export const recordAcceptedUsage = async (
  db: any,
  input: {
    userId: string;
    action: string;
    model: string;
    prompt?: string;
    imageCount?: number;
    estimatedCost?: number | null;
  },
): Promise<boolean> => {
  try {
    const { error } = await db.from('usage_logs').insert({
      user_id: input.userId,
      action: input.action,
      model: input.model,
      prompt: String(input.prompt || '').slice(0, 500),
      image_count: input.imageCount ?? 1,
      estimated_cost: input.estimatedCost ?? null,
    });
    if (error) {
      console.warn('Accepted generation usage could not be recorded', error.message);
      return false;
    }
    try {
      const { error: auditError } = await db.from('audit_events').insert({
        user_id: input.userId,
        action: 'generation.accepted',
        target_type: 'generation',
        metadata: { model: input.model, action: input.action, imageCount: input.imageCount ?? 1 },
      });
      if (auditError) console.warn('Accepted generation audit event could not be recorded', auditError.message);
    } catch (auditError) {
      console.warn('Accepted generation audit event could not be recorded', auditError);
    }
    return true;
  } catch (error) {
    console.warn('Accepted generation usage could not be recorded', error);
    return false;
  }
};

const alertedKeys = new Set<string>();
const shouldAlert = (key: string): boolean => {
  if (alertedKeys.size > 1_000) alertedKeys.clear();
  if (alertedKeys.has(key)) return false;
  alertedKeys.add(key);
  return true;
};

const rejectQuota = (res: VercelResponse, limit: number): false => {
  res.status(429).json({
    code: 'DAILY_GENERATION_LIMIT',
    error: `Daily generation limit reached (${limit}). Try again tomorrow.`,
  });
  return false;
};

const rejectProviderQuota = (res: VercelResponse, provider: string, limit: number): false => {
  res.status(429).json({
    code: 'DAILY_PROVIDER_LIMIT',
    error: `Daily ${provider} generation limit reached (${limit}). Try again tomorrow or choose another provider.`,
  });
  return false;
};

export const releaseGenerationQuotas = async (db: any, userId: string, provider?: string): Promise<void> => {
  if (!userId || typeof db?.rpc !== 'function') return;
  try {
    const { error } = await db.rpc('release_generation_quota', { p_user_id: userId });
    if (error) console.warn('Generation quota release failed', error.message);
  } catch (error) {
    console.warn('Generation quota release failed', error);
  }
  if (provider) {
    try {
      const { error } = await db.rpc('release_generation_provider_quota', { p_user_id: userId, p_provider: provider });
      if (error) console.warn('Provider quota release failed', error.message);
    } catch (error) {
      console.warn('Provider quota release failed', error);
    }
  }
};

export const enforceDailyGenerationQuota = async (
  db: any,
  userId: string,
  res: VercelResponse,
  provider?: string,
  releaseDb: any = db,
): Promise<boolean> => {
  const globalLimit = dailyGenerationLimit();
  const providerLimit = providerDailyLimit(provider);
  if (!globalLimit && !providerLimit) return true;

  // A quota without an atomic reservation is a spending bypass. Fail closed
  // when the RPC is unavailable instead of falling back to a racy count.
  if (typeof db?.rpc !== 'function') {
    res.status(503).json({ error: 'Usage quota could not be verified. Try again shortly.' });
    return false;
  }

  let reservedGlobal = false;
  if (globalLimit) {
    const { data, error } = await db.rpc('reserve_generation_quota', { p_limit: globalLimit });
    if (error) {
      res.status(503).json({ error: 'Usage quota could not be verified. Try again shortly.' });
      return false;
    }
    if (data !== true) {
      if (shouldAlert(`global:${userId}:${new Date().toISOString().slice(0, 10)}`)) {
        await sendQuotaAlert({ scope: 'global', userId, limit: globalLimit });
      }
      return rejectQuota(res, globalLimit);
    }
    reservedGlobal = true;
  }

  if (providerLimit && provider) {
    const { data, error } = await db.rpc('reserve_generation_provider_quota', { p_provider: provider, p_limit: providerLimit });
    if (error) {
      if (reservedGlobal) await releaseGenerationQuotas(releaseDb, userId);
      res.status(503).json({ error: 'Provider quota could not be verified. Try again shortly.' });
      return false;
    }
    if (data !== true) {
      if (shouldAlert(`provider:${userId}:${provider}:${new Date().toISOString().slice(0, 10)}`)) {
        await sendQuotaAlert({ scope: 'provider', userId, provider, limit: providerLimit });
      }
      if (reservedGlobal) await releaseGenerationQuotas(releaseDb, userId);
      return rejectProviderQuota(res, provider, providerLimit);
    }
  }

  return true;
};
