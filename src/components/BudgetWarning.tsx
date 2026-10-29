import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { BUDGET_EVENT, getDailyBudget, getTodaySpend, setDailyBudget } from '../services/budgetService';

/** Header chip: today's recorded estimates against the device's warning threshold. */
export function BudgetIndicator() {
  const [budget, setBudget] = useState(getDailyBudget);
  const [spend, setSpend] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const limit = getDailyBudget(); setBudget(limit);
      if (!limit) return;
      getTodaySpend().then(value => { if (active) setSpend(value); }).catch(() => { if (active) setSpend(null); });
    };
    refresh();
    const timer = setInterval(refresh, 120_000);
    window.addEventListener('focus', refresh); window.addEventListener(BUDGET_EVENT, refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener(BUDGET_EVENT, refresh); };
  }, []);
  if (!budget || spend == null) return null;
  const over = spend >= budget;
  return <span role={over ? 'alert' : 'status'} title={over ? 'Today’s recorded spend reached your warning limit. Providers may still bill new requests.' : 'Today’s recorded estimated spend'}
    className={`flex items-center gap-1.5 rounded-lg px-2 py-2 ${over ? 'bg-red-500/10 text-red-300' : spend >= budget * 0.8 ? 'text-amber-300' : 'text-gray-400'}`}>
    <Wallet size={14} aria-hidden="true" />${spend.toFixed(2)} / ${budget.toFixed(2)}{over && ' · limit reached'}
  </span>;
}

export function BudgetSettings() {
  const [value, setValue] = useState(() => getDailyBudget() ? String(getDailyBudget()) : '');
  return <label className="mb-6 block border-t border-white/10 pt-5 text-sm">
    <span className="flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-violet-400" aria-hidden="true" />Daily spending warning</span>
    <span className="mt-1 block text-xs leading-relaxed text-gray-400">Shows today’s recorded estimate in the header and warns at this amount (USD). It does not block requests; set hard limits in each provider’s billing settings. Leave empty to turn off.</span>
    <input type="number" min="0" step="0.5" inputMode="decimal" value={value} placeholder="e.g. 5"
      onChange={event => { setValue(event.target.value); setDailyBudget(Number(event.target.value)); }}
      className="mt-2 block w-40 rounded-xl border border-gray-700 bg-gray-900 p-2.5 text-base sm:text-sm text-white outline-none focus:border-violet-400" />
  </label>;
}
