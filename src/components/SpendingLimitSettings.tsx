import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { SPENDING_CHANGED_EVENT } from '../lib/admin/spendingEvents';
import {
  formatUsd, loadSpendingStatus, loadWorkspaceSpending, parseLimitInput, saveAccountLimit, saveWorkspaceLimit, spendingShare,
  type AccountLimitMode, type AccountSpending, type SpendingStatus,
} from '../services/spendingService';

const SOURCE_LABELS: Record<SpendingStatus['source'], string> = {
  none: 'No limit is set.',
  workspace: 'Workspace default limit.',
  account: 'Limit set for this account.',
  exempt: 'This account is exempt from the workspace limit.',
  admin: 'Admins are not limited by the workspace default.',
};

export function SpendingMeter({ status, compact = false }: { status: SpendingStatus; compact?: boolean }) {
  const share = spendingShare(status);
  const tone = share == null ? 'bg-violet-500' : share >= 1 ? 'bg-red-500' : share >= 0.8 ? 'bg-amber-400' : 'bg-emerald-500';
  const label = status.limitUsd == null ? `${formatUsd(status.spentUsd)} this month` : `${formatUsd(status.spentUsd)} of ${formatUsd(status.limitUsd)} this month`;
  return <div className={compact ? 'min-w-0' : 'min-w-0 space-y-1.5'}>
    <p className={`text-xs ${share != null && share >= 1 ? 'text-red-300' : 'text-gray-300'}`}>{label}</p>
    {share != null && <div role="meter" aria-label="Monthly spending" aria-valuemin={0} aria-valuemax={status.limitUsd ?? 0} aria-valuenow={status.spentUsd}
      className={`${compact ? 'mt-1 h-1 w-24' : 'h-1.5 w-full'} overflow-hidden rounded-full bg-white/10`}>
      <div className={`h-full ${tone}`} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>}
  </div>;
}

/** Own status for the header; refreshes after usage, on focus and every minute. */
export function useSpendingStatus(enabled: boolean) {
  const [status, setStatus] = useState<SpendingStatus | null>(null);
  useEffect(() => {
    if (!enabled) { setStatus(null); return; }
    let active = true;
    const refresh = () => { loadSpendingStatus().then(value => { if (active) setStatus(value); }).catch(() => { /* The meter stays hidden; the server still enforces the limit. */ }); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener(SPENDING_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener(SPENDING_CHANGED_EVENT, refresh); window.removeEventListener('focus', refresh); };
  }, [enabled]);
  return status;
}

const limitText = (value: number | null) => value == null ? '' : String(value);

function LimitForm({ initial, busy, onSave, allowEmpty, label }: { initial: number | null; busy: boolean; onSave: (value: number | null) => void; allowEmpty: boolean; label: string }) {
  const [text, setText] = useState(limitText(initial));
  useEffect(() => setText(limitText(initial)), [initial]);
  const parsed = parseLimitInput(text);
  const invalid = parsed === undefined || (!allowEmpty && parsed === null);
  return <form className="flex min-w-0 items-start gap-2" onSubmit={event => { event.preventDefault(); if (!invalid) onSave(parsed ?? null); }}>
    <label className="min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <input inputMode="decimal" value={text} onChange={event => setText(event.target.value)} placeholder={allowEmpty ? 'No limit' : 'Amount in USD'} aria-invalid={invalid}
        className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-violet-500 focus:outline-none" />
    </label>
    <button type="submit" disabled={busy || invalid} className="flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save
    </button>
  </form>;
}

function AccountRow({ account, onSaved }: { account: AccountSpending; onSaved: () => void }) {
  const initialMode: AccountLimitMode = account.source === 'account' ? 'limit' : account.source === 'exempt' ? 'exempt' : 'inherit';
  const [mode, setMode] = useState<AccountLimitMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setMode(initialMode), [initialMode]);
  const save = async (limit: number | null) => {
    setBusy(true); setError('');
    try { await saveAccountLimit(account.userId, mode, limit); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The limit could not be saved.'); }
    finally { setBusy(false); }
  };
  const name = account.displayName || account.email || 'Account';
  return <li className="space-y-2 rounded-xl border border-gray-800 bg-gray-900/40 p-3">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0"><p className="truncate text-sm text-white">{name}{account.role === 'admin' && <span className="ml-2 text-[10px] uppercase text-violet-300">Admin</span>}</p>
        {account.displayName && account.email && <p className="truncate text-xs text-gray-500">{account.email}</p>}</div>
      <SpendingMeter status={account} compact />
    </div>
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <select value={mode} onChange={event => setMode(event.target.value as AccountLimitMode)} aria-label={`Spending limit for ${name}`}
        className="rounded-lg border border-gray-800 bg-gray-950 px-2 py-2 text-xs text-gray-200">
        <option value="inherit">{account.role === 'admin' ? 'Default (unlimited for admins)' : 'Workspace default'}</option>
        <option value="limit">Custom limit</option>
        <option value="exempt">No limit</option>
      </select>
      {mode === 'limit'
        ? <div className="min-w-[12rem] flex-1"><LimitForm initial={account.source === 'account' ? account.limitUsd : null} busy={busy} allowEmpty={false} label={`Monthly limit for ${name}`} onSave={save} /></div>
        : mode !== initialMode && <button type="button" disabled={busy} onClick={() => void save(null)} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40">Save</button>}
    </div>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </li>;
}

/**
 * Monthly spending. Desktop: the person's own budget. Hosted members see
 * their status; the admin variant also edits the default and each account.
 */
export function SpendingLimitSettings({ admin = false }: { admin?: boolean }) {
  const local = isLocalWorkspace();
  const [status, setStatus] = useState<SpendingStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountSpending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    try {
      const [own, list] = await Promise.all([loadSpendingStatus(), admin && !local ? loadWorkspaceSpending() : Promise.resolve([])]);
      setStatus(own); setAccounts(list); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Spending could not be loaded.'); }
  }, [admin, local]);
  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener(SPENDING_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SPENDING_CHANGED_EVENT, refresh);
  }, [reload]);
  const saveDefault = async (limit: number | null) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await saveWorkspaceLimit(limit); await reload();
      setMessage(limit == null ? 'The monthly limit was removed.' : local ? `New generations stop once this month's spend reaches ${formatUsd(limit)}.` : `Members without their own limit stop at ${formatUsd(limit)} a month.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The limit could not be saved.'); }
    finally { setBusy(false); }
  };
  const editable = local || admin;
  return <fieldset className="mb-6 min-w-0" aria-busy={!status && !error}>
    <legend className="mb-1 flex items-center gap-2 text-sm font-semibold text-white"><Wallet className="h-4 w-4 text-emerald-400" aria-hidden="true" />Monthly spending</legend>
    <p className="mb-4 text-xs text-gray-500">
      Estimated provider cost of generations this calendar month (UTC). Once the limit is reached, new generations stop; tasks that were already accepted still finish. Providers bill you separately, so their totals can differ slightly.
    </p>
    {!status && !error && <p role="status" className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</p>}
    {status && <div className="mb-4 space-y-1"><SpendingMeter status={status} />{!local && <p className="text-xs text-gray-500">{SOURCE_LABELS[status.source]}</p>}</div>}
    {status && editable && <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-gray-300">{local ? 'Monthly budget (USD)' : 'Workspace default per member (USD)'}</p>
      <LimitForm initial={local ? status.limitUsd : status.workspaceLimitUsd} busy={busy} allowEmpty label={local ? 'Monthly budget in USD' : 'Workspace default monthly limit in USD'} onSave={value => void saveDefault(value)} />
      <p className="mt-1.5 text-xs text-gray-600">Leave empty for no limit.</p>
    </div>}
    {admin && !local && accounts.length > 0 && <div>
      <p className="mb-2 text-xs font-medium text-gray-300">Accounts</p>
      <ul className="space-y-2">{accounts.map(account => <React.Fragment key={account.userId}><AccountRow account={account} onSaved={() => void reload()} /></React.Fragment>)}</ul>
    </div>}
    {message && <p role="status" className="mt-3 text-xs text-emerald-300">{message}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
  </fieldset>;
}
