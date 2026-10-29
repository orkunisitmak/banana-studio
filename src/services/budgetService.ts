import { supabase } from './authService';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';

const KEY = 'banana-daily-budget-usd';
export const BUDGET_EVENT = 'banana-budget-changed';
/** A device-level warning threshold, not a provider spending limit. 0 = off. */
export const getDailyBudget = (): number => {
  try { const value = Number(localStorage.getItem(KEY)); return Number.isFinite(value) && value > 0 ? value : 0; } catch { return 0; }
};
export const setDailyBudget = (value: number): void => {
  try { if (Number.isFinite(value) && value > 0) localStorage.setItem(KEY, String(Math.round(value * 100) / 100)); else localStorage.removeItem(KEY); } catch { /* Best effort. */ }
  window.dispatchEvent(new Event(BUDGET_EVENT));
};

export type UsageRow = { model: string; action: string; image_count: number | null; estimated_cost: number | string | null };
/** The signed-in user's own usage rows since a moment (RLS limits reads to the owner). */
export async function getMyUsage(since: Date): Promise<UsageRow[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const rows: UsageRow[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    // Pages need a stable order; LIMIT/OFFSET without one can repeat or skip rows.
    const { data, error } = await supabase.from('usage_logs').select('model,action,image_count,estimated_cost')
      .eq('user_id', session.user.id).gte('created_at', isLocalWorkspace() ? since.getTime() : since.toISOString())
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error('Usage could not be loaded.');
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
export const usageCost = (row: UsageRow): number => { const cost = Number(row.estimated_cost); return Number.isFinite(cost) && cost > 0 ? cost : 0; };
/** Sum of today's recorded estimates. Unknown costs count as 0. */
export async function getTodaySpend(): Promise<number> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return (await getMyUsage(start)).reduce((total, row) => total + usageCost(row), 0);
}
