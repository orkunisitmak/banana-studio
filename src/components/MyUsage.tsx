import React, { useEffect, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { getMyUsage, usageCost, type UsageRow } from '../services/budgetService';
import { getImageModelLabel, getTextModelLabel, VIDEO_MODEL_OPTIONS } from '../types';

const RANGES = [{ label: 'Today', days: 0 }, { label: '7 days', days: 7 }, { label: '30 days', days: 30 }] as const;
const modelLabel = (model: string) => VIDEO_MODEL_OPTIONS.find(option => option.value === model)?.label
  || (getTextModelLabel(model) !== model ? getTextModelLabel(model) : getImageModelLabel(model));

/** Personal view of recorded usage; admins keep the workspace-wide report. Estimates, not invoices. */
export function MyUsage() {
  const [days, setDays] = useState<number>(0);
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - days);
    setRows(null); setError('');
    getMyUsage(since).then(value => { if (active) setRows(value); }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Usage could not be loaded.'); });
    return () => { active = false; };
  }, [days]);
  const byModel = new Map<string, { requests: number; images: number; cost: number }>();
  for (const row of rows || []) {
    const entry = byModel.get(row.model) || { requests: 0, images: 0, cost: 0 };
    entry.requests += 1; entry.images += Number(row.image_count) || 0; entry.cost += usageCost(row);
    byModel.set(row.model, entry);
  }
  const total = [...byModel.values()].reduce((sum, entry) => sum + entry.cost, 0);
  return <section className="mb-6 border-t border-white/10 pt-5" aria-labelledby="my-usage-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="my-usage-title" className="flex items-center gap-2 font-semibold"><BarChart3 className="h-4 w-4 text-violet-400" aria-hidden="true" />My usage</h3>
      <div role="group" aria-label="Usage range" className="flex gap-1 text-xs">
        {RANGES.map(range => <button key={range.days} type="button" aria-pressed={days === range.days} onClick={() => setDays(range.days)}
          className={`rounded-lg px-2.5 py-1 ${days === range.days ? 'bg-violet-600 text-white' : 'border border-gray-700 text-gray-300 hover:border-gray-600'}`}>{range.label}</button>)}
      </div>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-gray-400">Recorded estimates for your account. Providers bill separately; check their dashboards for invoices.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : !rows ? <p role="status" className="mt-3 flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Loading usage…</p> : <>
      <p className="mt-3 text-2xl font-semibold text-white">${total.toFixed(2)} <span className="text-sm font-normal text-gray-400">· {rows.length} request{rows.length === 1 ? '' : 's'}</span></p>
      {byModel.size > 0 ? <table aria-labelledby="my-usage-title" className="mt-3 w-full text-left text-xs">
        <thead className="text-gray-500"><tr><th className="py-1 font-medium">Model</th><th className="py-1 text-right font-medium">Requests</th><th className="py-1 text-right font-medium">Images</th><th className="py-1 text-right font-medium">Cost</th></tr></thead>
        <tbody className="text-gray-300">{[...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost || b[1].requests - a[1].requests).map(([model, entry]) =>
          <tr key={model} className="border-t border-white/5"><td className="py-1.5 pr-2 break-all">{modelLabel(model)}</td><td className="py-1.5 text-right tabular-nums">{entry.requests}</td>
            <td className="py-1.5 text-right tabular-nums">{entry.images}</td><td className="py-1.5 text-right tabular-nums">${entry.cost.toFixed(entry.cost && entry.cost < 0.01 ? 4 : 2)}</td></tr>)}</tbody>
      </table> : <p className="mt-2 text-sm text-gray-400">No usage recorded in this range.</p>}
    </>}
  </section>;
}
