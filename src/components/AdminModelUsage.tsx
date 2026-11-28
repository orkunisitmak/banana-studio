import React from 'react';
import type { AdminModelUsageSummary, AdminUserSummary } from '../types';
import type { ProviderUsageSummary } from '../services/authService';

export const aggregateAdminModelUsage = (users: AdminUserSummary[]): AdminModelUsageSummary[] => {
  const models = new Map<string, AdminModelUsageSummary>();
  for (const user of users) for (const row of user.model_usage || []) {
    const current = models.get(row.model);
    if (!current) {
      models.set(row.model, { ...row });
      continue;
    }
    for (const field of ['requests', 'images', 'videos', 'text_requests', 'enhance_requests', 'brainstorm_requests', 'variation_requests', 'total_cost', 'unknown_cost_requests'] as const) {
      current[field] += row[field];
    }
  }
  return [...models.values()].sort((a, b) => b.total_cost - a.total_cost || b.requests - a.requests || a.model.localeCompare(b.model));
};

const money = (value: number | null | undefined) => value == null ? 'Unknown' : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const textBreakdown = (row: AdminModelUsageSummary) => [
  row.enhance_requests > 0 && `${row.enhance_requests.toLocaleString()} enhance`,
  row.brainstorm_requests > 0 && `${row.brainstorm_requests.toLocaleString()} brainstorm`,
  row.variation_requests > 0 && `${row.variation_requests.toLocaleString()} variation`,
].filter(Boolean).join(' · ');

const ModelCost = ({ row }: { row: AdminModelUsageSummary }) => <>
  <span className="font-mono text-green-300">{row.requests > 0 && row.unknown_cost_requests === row.requests ? 'Unknown' : money(row.total_cost)}</span>
  {row.unknown_cost_requests > 0 && <span className="mt-1 block text-[10px] text-amber-300">+ {row.unknown_cost_requests.toLocaleString()} unknown cost</span>}
</>;

export const AdminModelUsage = ({ rows, label = 'Model usage' }: { rows: AdminModelUsageSummary[]; label?: string }) => {
  if (!rows.length) return <p className="py-3 text-xs text-gray-500">No model usage logged.</p>;
  return <div role="region" aria-label={label}>
    <div className="space-y-2 sm:hidden">
      {rows.map(row => <div key={row.model} className="rounded-lg border border-gray-800 bg-gray-950/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-all text-xs font-medium text-gray-200">{row.model}</span>
          <div className="shrink-0 text-right text-xs"><ModelCost row={row} /></div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-[10px] text-gray-500">
          <span>Requests<strong className="block text-xs font-medium text-gray-300">{row.requests.toLocaleString()}</strong></span>
          <span>Images<strong className="block text-xs font-medium text-gray-300">{row.images.toLocaleString()}</strong></span>
          <span>Videos<strong className="block text-xs font-medium text-gray-300">{row.videos.toLocaleString()}</strong></span>
          <span>Text tasks<strong className="block text-xs font-medium text-gray-300">{row.text_requests.toLocaleString()}</strong></span>
        </div>
        {row.text_requests > 0 && <p className="mt-2 text-[10px] text-gray-400">{textBreakdown(row)}</p>}
      </div>)}
    </div>
    <table className="hidden w-full table-fixed text-xs sm:table">
      <thead><tr className="border-b border-gray-800 text-left text-[10px] uppercase tracking-wide text-gray-500">
        <th className="w-[31%] pb-2 pr-3 font-medium">Model</th>
        <th className="w-[12%] pb-2 text-right font-medium">Requests</th>
        <th className="w-[16%] pb-2 text-right font-medium">Outputs</th>
        <th className="w-[23%] pb-2 pl-3 font-medium">Text tasks</th>
        <th className="w-[18%] pb-2 text-right font-medium">Logged USD</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.model} className="border-b border-gray-800/50 align-top last:border-0">
        <td className="break-all py-3 pr-3 font-medium text-gray-200">{row.model}</td>
        <td className="py-3 text-right tabular-nums text-gray-300">{row.requests.toLocaleString()}</td>
        <td className="py-3 text-right text-gray-300"><span className="block">{row.images.toLocaleString()} images</span><span className="block text-[10px] text-gray-500">{row.videos.toLocaleString()} videos</span></td>
        <td className="py-3 pl-3 text-gray-300">{row.text_requests.toLocaleString()}<span className="mt-1 block text-[10px] leading-relaxed text-gray-500">{textBreakdown(row)}</span></td>
        <td className="py-3 text-right"><ModelCost row={row} /></td>
      </tr>)}</tbody>
    </table>
  </div>;
};

export const AdminProviderUsage = ({ usage }: { usage: ProviderUsageSummary | null }) => <section className="mx-4 mt-4 rounded-xl border border-gray-800 bg-gray-900/30 p-4 sm:mx-6" aria-label="Provider account reports">
  <h3 className="text-sm font-semibold text-gray-200">Provider account reports</h3>
  <p className="mt-1 text-xs text-gray-400">Not affected by the time range filter.</p>
  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">Separate account or workspace totals; reporting dates and users may differ from app logs. These amounts are not added to or substituted for the app totals.</p>
  {!usage?.fal && !usage?.evolink && !usage?.openai && <p className="mt-3 text-xs text-gray-400">Provider account data is unavailable.</p>}
  {usage?.fal && <div className="mt-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h4 className="text-xs font-semibold text-violet-300">fal.ai{usage.fal.scope === 'workspace_endpoints' ? ' · workspace' : ''}</h4><p className="mt-0.5 break-all text-[10px] text-gray-500">{usage.fal.start ? `${usage.fal.start}${usage.fal.end ? ` — ${usage.fal.end}` : ' — present'}` : 'Provider reporting period'}</p></div>
      <span className="font-mono text-sm text-gray-200">{money(usage.fal.actualCostUsd)}</span>
    </div>
    <p className="mt-1 text-[10px] text-gray-500">Workspace charges for app endpoints: images {money(usage.fal.imageActualCostUsd)} · video {money(usage.fal.videoActualCostUsd)} · text {money(usage.fal.textActualCostUsd)}. Text models share one fal endpoint.</p>
    {usage.fal.byEndpoint.length > 0 && <details className="mt-3 rounded-lg border border-gray-800" open>
      <summary className="cursor-pointer px-3 py-2 text-xs text-gray-300">Model / endpoint charges · {usage.fal.byEndpoint.length}</summary>
      <div className="px-3 pb-3">
        <p className="mb-2 text-[10px] leading-relaxed text-gray-500">Provider quantity uses the endpoint’s billing unit; it is not a request count.</p>
        {usage.fal.byEndpoint.map(row => <div key={JSON.stringify([row.endpoint, row.unit])} className="flex flex-wrap items-start justify-between gap-2 border-t border-gray-800 py-2 text-xs">
          <span className="min-w-0 flex-1 basis-44 break-all text-gray-300">{row.endpoint}</span>
          <div className="text-right"><span className="font-mono text-gray-200">{money(row.costUsd)}</span><span className="mt-0.5 block text-[10px] text-gray-500">{row.quantity == null ? 'Quantity unavailable' : `${row.quantity.toLocaleString()} ${row.unit || 'units (unspecified)'}`}</span></div>
        </div>)}
      </div>
    </details>}
  </div>}
  {usage?.openai && <div className="mt-4 border-t border-gray-800 pt-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h4 className="text-xs font-semibold text-emerald-300">OpenAI · {usage.openai.scope === 'project' ? 'project' : 'organization'}</h4><p className="mt-0.5 break-all text-[10px] text-gray-500">{usage.openai.start} — {usage.openai.end}</p></div>
      <span className="font-mono text-sm text-gray-200">{money(usage.openai.actualCostUsd)}</span>
    </div>
    {usage.openai.byLineItem.length > 0 && <details className="mt-3 rounded-lg border border-gray-800" open>
      <summary className="cursor-pointer px-3 py-2 text-xs text-gray-300">Model / line item charges · {usage.openai.byLineItem.length}</summary>
      <div className="px-3 pb-3">
        <p className="mb-2 text-[10px] leading-relaxed text-gray-500">Daily OpenAI cost buckets; the latest charges can appear with a delay.{usage.openai.scope === 'organization' ? ' Includes every project in the organization.' : ''}</p>
        {usage.openai.byLineItem.map(row => <div key={row.lineItem} className="flex flex-wrap items-start justify-between gap-2 border-t border-gray-800 py-2 text-xs">
          <span className="min-w-0 flex-1 basis-44 break-all text-gray-300">{row.lineItem}</span>
          <span className="font-mono text-gray-200">{money(row.costUsd)}</span>
        </div>)}
      </div>
    </details>}
  </div>}
  {usage?.evolink && <div className="mt-4 border-t border-gray-800 pt-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-amber-300">EvoLink · account totals</h4><span className="font-mono text-gray-200">{usage.evolink.usedUsdApprox == null ? 'Unknown' : `≈ ${money(usage.evolink.usedUsdApprox)}`}</span></div>
    <p className="mt-1 text-[10px] text-gray-500">These credits cover the entire EvoLink account, not an individual model.</p>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500">
      <span>{usage.evolink.usedCredits == null ? 'Used credits unavailable' : `${usage.evolink.usedCredits.toLocaleString()} used credits`}</span>
      {usage.evolink.remainingCredits != null && <span>{usage.evolink.remainingCredits.toLocaleString()} credits remaining{usage.evolink.remainingUsdApprox != null ? ` (≈ ${money(usage.evolink.remainingUsdApprox)})` : ''}</span>}
    </div>
  </div>}
  {!!usage?.warnings?.length && <p className="mt-3 text-[11px] leading-relaxed text-amber-300/80">{usage.warnings.join(' ')}</p>}
</section>;
