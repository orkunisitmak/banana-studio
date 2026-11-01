import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createUserScopedClient } from './auth.js';

export const SPENDING_LIMIT_CODE = 'SPENDING_LIMIT';

interface SpendingStatus { limitUsd?: number | string | null; spentUsd?: number | string; blocked?: boolean }
interface StatusResult { data: SpendingStatus | null; error: { code?: string; message?: string } | null }

const usd = (value: unknown) => `$${(Number(value) || 0).toFixed(2)}`;

// A deployment that has not applied the spending-limit migration yet has no
// limits to enforce; generation keeps working until the schema is updated.
const isMissingFunction = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST202' || error.code === '42883'
  || (/get_spending_status/.test(error.message || '') && /not find|does not exist/i.test(error.message || ''));

/** Null allows the request; otherwise the response that stops it. */
export function spendingDenial(result: StatusResult): { status: number; body: Record<string, unknown> } | null {
  if (result.error) {
    if (isMissingFunction(result.error)) return null;
    return { status: 503, body: { error: 'Your spending limit could not be checked. Try again shortly.', retryable: true } };
  }
  if (!result.data?.blocked) return null;
  return { status: 402, body: {
    code: SPENDING_LIMIT_CODE,
    error: `Monthly spending limit reached (${usd(result.data.spentUsd)} of ${usd(result.data.limitUsd)}). New generations resume next month or after the limit is raised.`,
    spentUsd: Number(result.data.spentUsd) || 0,
    limitUsd: Number(result.data.limitUsd) || 0,
  } };
}

/**
 * Paid submissions stop once this month's recorded spend reaches the caller's
 * limit. Status, polling and recovery routes stay available so work that was
 * already accepted can finish.
 */
export async function requireSpendingAllowance(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  let result: StatusResult;
  try { result = await createUserScopedClient(req).rpc('get_spending_status'); }
  catch { result = { data: null, error: { message: 'unavailable' } }; }
  const denial = spendingDenial(result);
  if (denial) res.status(denial.status).json(denial.body);
  return !denial;
}
