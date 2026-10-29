import type { VercelResponse } from '@vercel/node';

/**
 * Opt-in per-user daily generation quota. Zero/unset keeps the existing
 * behaviour; a positive integer reserves a slot atomically through the
 * reserve_generation_quota RPC.
 */
export const dailyGenerationLimit = (): number => {
  const value = Number(process.env.BANANA_DAILY_GENERATION_LIMIT || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

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
    return true;
  } catch (error) {
    console.warn('Accepted generation usage could not be recorded', error);
    return false;
  }
};

const rejectQuota = (res: VercelResponse, limit: number): false => {
  res.status(429).json({
    code: 'DAILY_GENERATION_LIMIT',
    error: `Daily generation limit reached (${limit}). Try again tomorrow.`,
  });
  return false;
};

export const enforceDailyGenerationQuota = async (
  db: any,
  userId: string,
  res: VercelResponse,
): Promise<boolean> => {
  const limit = dailyGenerationLimit();
  if (!limit) return true;

  // A quota without an atomic reservation is a spending bypass. Fail closed
  // when the RPC is unavailable instead of falling back to a racy count.
  if (typeof db?.rpc !== 'function') {
    res.status(503).json({ error: 'Usage quota could not be verified. Try again shortly.' });
    return false;
  }
  const { data, error } = await db.rpc('reserve_generation_quota', { p_limit: limit });
  if (error) {
    res.status(503).json({ error: 'Usage quota could not be verified. Try again shortly.' });
    return false;
  }
  return data === true ? true : rejectQuota(res, limit);
};
