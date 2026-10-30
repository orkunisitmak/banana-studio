import { supabase } from './authService';
import { notifySpendingChanged } from '../lib/admin/spendingEvents';

export type SpendingSource = 'none' | 'workspace' | 'account' | 'exempt' | 'admin';
export type AccountLimitMode = 'inherit' | 'limit' | 'exempt';

export interface SpendingStatus {
  userId: string;
  limitUsd: number | null;
  spentUsd: number;
  source: SpendingSource;
  workspaceLimitUsd: number | null;
  periodStart: string;
  blocked: boolean;
}

export interface AccountSpending extends SpendingStatus { email: string | null; displayName: string | null; role: string }

const amount = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export const normalizeSpendingStatus = (value: unknown): SpendingStatus => {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const source = ['none', 'workspace', 'account', 'exempt', 'admin'].includes(row.source as string) ? row.source as SpendingSource : 'none';
  const limitUsd = amount(row.limitUsd), spentUsd = amount(row.spentUsd) ?? 0;
  return {
    userId: typeof row.userId === 'string' ? row.userId : '',
    limitUsd, spentUsd, source,
    workspaceLimitUsd: amount(row.workspaceLimitUsd),
    periodStart: typeof row.periodStart === 'string' ? row.periodStart : '',
    blocked: limitUsd != null && spentUsd >= limitUsd,
  };
};

/** 0–1 share of the limit used, or null when the account is unlimited. */
export const spendingShare = (status: Pick<SpendingStatus, 'limitUsd' | 'spentUsd'>): number | null =>
  status.limitUsd == null ? null : status.limitUsd === 0 ? 1 : Math.min(1, status.spentUsd / status.limitUsd);

export const formatUsd = (value: number) => `$${value.toFixed(2)}`;

const failure = (error: { code?: string } | null, fallback: string) =>
  new Error(error?.code === '42501' ? 'You do not have permission to change spending limits.' : error?.code === '22023' ? 'Enter a limit between $0 and $1,000,000.' : fallback);

export async function loadSpendingStatus(): Promise<SpendingStatus> {
  const { data, error } = await supabase.rpc('get_spending_status');
  if (error) throw failure(error, 'Spending could not be loaded. Try again.');
  return normalizeSpendingStatus(data);
}

export async function loadWorkspaceSpending(): Promise<AccountSpending[]> {
  const { data, error } = await supabase.rpc('get_workspace_spending');
  if (error) throw failure(error, 'Account spending could not be loaded. Try again.');
  return (Array.isArray(data) ? data : []).map(row => ({
    ...normalizeSpendingStatus(row),
    email: typeof row?.email === 'string' ? row.email : null,
    displayName: typeof row?.displayName === 'string' ? row.displayName : null,
    role: typeof row?.role === 'string' ? row.role : 'user',
  }));
}

async function setLimit(args: { p_scope: 'workspace' | 'account'; p_user_id: string | null; p_mode: string; p_limit_usd: number | null }) {
  const { data, error } = await supabase.rpc('set_spending_limit', args);
  if (error) throw failure(error, 'The spending limit could not be saved. Try again.');
  notifySpendingChanged();
  return normalizeSpendingStatus(data);
}

/** The workspace default; on the desktop app this is the personal monthly budget. */
export const saveWorkspaceLimit = (limitUsd: number | null) =>
  setLimit({ p_scope: 'workspace', p_user_id: null, p_mode: limitUsd == null ? 'none' : 'limit', p_limit_usd: limitUsd });

export const saveAccountLimit = (userId: string, mode: AccountLimitMode, limitUsd: number | null) =>
  setLimit({ p_scope: 'account', p_user_id: userId, p_mode: mode, p_limit_usd: mode === 'limit' ? limitUsd : null });

/** Parses a dollar amount typed by a person; empty means no limit. */
export const parseLimitInput = (text: string): number | null | undefined => {
  const trimmed = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value <= 1_000_000 ? value : undefined;
};
