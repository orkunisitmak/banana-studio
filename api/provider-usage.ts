import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createServiceRoleClient, requireAdmin } from './_lib/auth.js';
import { H3_MAX_ENDPOINTS } from '../src/lib/video/h3Max.js';
import { reconcileH3Usage } from './_lib/h3Usage.js';

const EVOLINK_BASE = 'https://api.evolink.ai';
const FAL_PLATFORM_BASE = 'https://api.fal.ai';
const OPENAI_BASE = 'https://api.openai.com';
const EVOLINK_CREDITS_PER_USD = 68;
const FAL_IMAGE_ENDPOINTS = [
  'fal-ai/nano-banana-pro',
  'fal-ai/nano-banana-pro/edit',
  'google/nano-banana-2.1',
  'google/nano-banana-2.1/edit',
  // Historical Nano Banana 2 jobs/billing remain available.
  'fal-ai/nano-banana-2',
  'fal-ai/nano-banana-2/edit',
  'openai/gpt-image-2',
  'openai/gpt-image-2/edit',
  // Provider routing can send Sunburst to fal (api/_lib/imageProviders.ts).
  'openai/gpt-image-2.5/sunburst/text-to-image',
  'openai/gpt-image-2.5/sunburst/edit',
];
const FAL_VIDEO_ENDPOINTS = [
  ...Object.values(H3_MAX_ENDPOINTS),
  // Historical billing reconciliation only. Active H3 submissions are
  // Max-only in fal-h3-video.ts.
  'minimax/h3/text-to-video',
  'minimax/h3/image-to-video',
  'minimax/h3/reference-to-video',
  // Seedance routed to fal (src/lib/video/seedanceProviders.ts).
  ...['seedance-2.0', 'seedance-2.5'].flatMap(model => ['text-to-video', 'image-to-video', 'reference-to-video'].map(mode => `bytedance/${model}/${mode}`)),
];
const FAL_BILLING_ENDPOINTS = [...FAL_IMAGE_ENDPOINTS, ...FAL_VIDEO_ENDPOINTS];
export const config = { maxDuration: 60 };

const numberOrNull = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const usagePeriod = (provider: string) => {
  const usageStart = process.env.PROVIDER_USAGE_START_DATE || '2025-01-01T00:00:00Z';
  const usageEnd = new Date().toISOString();
  if (!Number.isFinite(Date.parse(usageStart)) || Date.parse(usageStart) >= Date.parse(usageEnd)) {
    throw new UsageError('unavailable', `PROVIDER_USAGE_START_DATE must be a valid date before the current time. ${provider} totals are unavailable.`);
  }
  return { usageStart, usageEnd };
};

const loadEvoLinkUsage = async () => {
  const apiKey = process.env.EVOLINK_API_KEY;
  if (!apiKey) throw new Error('EVOLINK_API_KEY is not configured');

  const response = await fetch(`${EVOLINK_BASE}/v1/credits`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new Error('EvoLink usage could not be loaded. Retry shortly.'); });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(`EvoLink credits request failed (${response.status})`);
  }

  const account = data?.data?.user || {};
  const token = data?.data?.token || {};
  const usedCredits = numberOrNull(account.used_credits);
  const remainingCredits = numberOrNull(account.remaining_credits);

  return {
    usedCredits,
    remainingCredits,
    usedUsdApprox: usedCredits == null ? null : usedCredits / EVOLINK_CREDITS_PER_USD,
    remainingUsdApprox: remainingCredits == null ? null : remainingCredits / EVOLINK_CREDITS_PER_USD,
    creditsPerUsd: EVOLINK_CREDITS_PER_USD,
    tokenUsedCredits: numberOrNull(token.used_credits),
  };
};

const loadFalUsage = async () => {
  // Usage requires Admin scope, independent of a key's environment-variable
  // name. A legacy FAL_KEY may have that scope; a 403 must explain the setup.
  // https://fal.ai/docs/api-reference/platform-apis/authentication
  const normalizeKey = (key?: string) => key?.trim().replace(/^Key\s+/i, '').trim() || '';
  const explicitAdminKey = normalizeKey(process.env.FAL_ADMIN_KEY);
  const adminKey = explicitAdminKey || normalizeKey(process.env.FAL_KEY);
  if (!adminKey) throw new UsageError('needs_admin_key', 'fal.ai billing is unavailable. Add an Admin-scope key from fal.ai/dashboard/keys as the server-only FAL_ADMIN_KEY environment variable, then redeploy.');
  const { usageStart, usageEnd } = usagePeriod('fal.ai');
  const params = new URLSearchParams({
    start: usageStart,
    end: usageEnd,
    expand: 'summary',
    timeframe: 'month',
    bound_to_timeframe: 'false',
    endpoint_id: FAL_BILLING_ENDPOINTS.join(','),
    limit: '100',
  });

  const allowed = new Set(FAL_BILLING_ENDPOINTS);
  const rows: FalUsageRow[] = [];
  const cursors = new Set<string>();
  const deadline = Date.now() + 45_000;
  // Keep a fixed end across pages. Never present a truncated result as a total.
  // https://fal.ai/docs/platform-apis/v1/models/usage
  for (let page = 0; ; page++) {
    const remainingMs = deadline - Date.now();
    if (page >= 100 || remainingMs <= 0) throw new UsageError('unavailable', 'fal.ai usage could not be loaded completely. Totals are unavailable; retry shortly.');
    const response = await fetch(`${FAL_PLATFORM_BASE}/v1/models/usage?${params}`, {
      headers: { Authorization: `Key ${adminKey}` },
      signal: AbortSignal.timeout(Math.min(15_000, remainingMs)),
    }).catch(() => { throw new UsageError('unavailable', 'fal.ai usage could not be loaded. Totals are unavailable; retry shortly.'); });
    if (response.status === 403) {
      throw new UsageError(explicitAdminKey ? 'forbidden' : 'needs_admin_key', explicitAdminKey
        ? 'fal.ai denied billing access (403). Check that FAL_ADMIN_KEY has Admin scope and belongs to the intended fal workspace, then redeploy after correcting it.'
        : 'fal.ai billing requires Admin scope (403). The current FAL_KEY cannot read usage. Add an Admin-scope key from fal.ai/dashboard/keys as the server-only FAL_ADMIN_KEY, then redeploy. Image generation uses its separate existing key.');
    }
    if (response.status === 401) throw new UsageError('invalid_key', 'fal.ai rejected the billing key (401). Check that the configured server key is valid and has not been revoked.');
    if (!response.ok) throw new UsageError('unavailable', `fal.ai usage request failed (${response.status}). Totals are unavailable; retry shortly.`);
    const data = await response.json().catch(() => null);
    const payload = Array.isArray(data?.summary) ? data : data?.data;
    if (!Array.isArray(payload?.summary) || typeof payload.has_more !== 'boolean'
      || !(payload.next_cursor === null || (typeof payload.next_cursor === 'string' && payload.next_cursor.length > 0))
      || payload.has_more !== (payload.next_cursor !== null)) {
      throw new UsageError('unavailable', 'fal.ai returned incomplete usage data. Totals are unavailable; retry shortly.');
    }
    for (const row of payload.summary) {
      if (!row || typeof row.endpoint_id !== 'string') throw new UsageError('unavailable', 'fal.ai returned invalid usage records. Totals are unavailable.');
      if (!allowed.has(row.endpoint_id)) continue;
      // cost_total is after discounts. `cost` is its legacy alias; never use
      // pre-discount cost_subtotal or coerce null/empty/missing costs to zero.
      const cost = numberOrNull(Object.hasOwn(row, 'cost_total') ? row.cost_total : row.cost);
      if (cost == null || cost < 0 || row.currency !== 'USD') throw new UsageError('unavailable', 'fal.ai returned usage without complete USD costs. Totals are unavailable.');
      const quantity = numberOrNull(row.quantity);
      rows.push({ endpoint: row.endpoint_id, costUsd: cost,
        quantity: quantity != null && quantity >= 0 ? quantity : null,
        unit: typeof row.unit === 'string' && row.unit.trim() ? row.unit.trim() : null });
    }
    if (!payload.has_more) break;
    if (cursors.has(payload.next_cursor)) throw new UsageError('unavailable', 'fal.ai usage pagination repeated a page. Totals are unavailable; retry shortly.');
    cursors.add(payload.next_cursor);
    params.set('cursor', payload.next_cursor);
  }
  const grouped = new Map<string, FalUsageRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.endpoint, row.unit]);
    const current = grouped.get(key);
    if (!current) grouped.set(key, { ...row });
    else {
      current.costUsd += row.costUsd;
      current.quantity = current.quantity == null || row.quantity == null ? null : current.quantity + row.quantity;
    }
  }
  const byEndpoint = [...grouped.values()];
  const imageEndpointSet = new Set(FAL_IMAGE_ENDPOINTS);
  const videoEndpointSet = new Set(FAL_VIDEO_ENDPOINTS);
  const imageRows = byEndpoint.filter(row => imageEndpointSet.has(row.endpoint));
  const videoRows = byEndpoint.filter(row => videoEndpointSet.has(row.endpoint));
  const sumCost = (items: FalUsageRow[]) => items.reduce((sum, row) => sum + row.costUsd, 0);
  const units = new Set(byEndpoint.map(row => row.unit));
  const quantityUnit = units.size === 1 ? byEndpoint[0]?.unit ?? null : null;

  return {
    actualCostUsd: sumCost(byEndpoint),
    imageActualCostUsd: sumCost(imageRows),
    videoActualCostUsd: sumCost(videoRows),
    // Seconds, images, megapixels, etc. are billing units, not request counts.
    quantity: quantityUnit && byEndpoint.every(row => row.quantity != null) ? byEndpoint.reduce((sum, row) => sum + row.quantity!, 0) : null,
    quantityUnit,
    start: usageStart,
    end: usageEnd,
    scope: 'workspace_endpoints' as const,
    byEndpoint,
  };
};

const loadOpenAIUsage = async () => {
  // The Costs API needs an organization Admin key; the inference OPENAI_API_KEY
  // cannot read billing. https://developers.openai.com/cookbook/examples/completions_usage_api
  const adminKey = process.env.OPENAI_ADMIN_KEY?.trim() || '';
  if (!adminKey) throw new UsageError('needs_admin_key', 'OpenAI billing is unavailable. Add an Admin key from platform.openai.com → Settings → Organization → Admin keys as the server-only OPENAI_ADMIN_KEY environment variable, then redeploy.');
  const { usageStart, usageEnd } = usagePeriod('OpenAI');
  const projectId = process.env.OPENAI_PROJECT_ID?.trim() || '';
  const params = new URLSearchParams({
    start_time: String(Math.floor(Date.parse(usageStart) / 1000)),
    end_time: String(Math.floor(Date.parse(usageEnd) / 1000)),
    bucket_width: '1d',
    group_by: 'line_item',
    limit: '180',
  });
  // Without a project filter the report covers every project in the organization.
  if (projectId) params.append('project_ids', projectId);

  const totals = new Map<string, number>();
  const cursors = new Set<string>();
  const deadline = Date.now() + 45_000;
  // Keep a fixed end across pages. Never present a truncated result as a total.
  for (let page = 0; ; page++) {
    const remainingMs = deadline - Date.now();
    if (page >= 100 || remainingMs <= 0) throw new UsageError('unavailable', 'OpenAI costs could not be loaded completely. Totals are unavailable; retry shortly.');
    const response = await fetch(`${OPENAI_BASE}/v1/organization/costs?${params}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(Math.min(15_000, remainingMs)),
    }).catch(() => { throw new UsageError('unavailable', 'OpenAI costs could not be loaded. Totals are unavailable; retry shortly.'); });
    if (response.status === 401) throw new UsageError('invalid_key', 'OpenAI rejected the billing key (401). Check that OPENAI_ADMIN_KEY is a valid, unrevoked Admin key.');
    if (response.status === 403) throw new UsageError('forbidden', 'OpenAI denied billing access (403). OPENAI_ADMIN_KEY must be an organization Admin key with usage read access; a project API key cannot read costs.');
    if (!response.ok) throw new UsageError('unavailable', `OpenAI costs request failed (${response.status}). Totals are unavailable; retry shortly.`);
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.data) || typeof data.has_more !== 'boolean'
      || (data.has_more && (typeof data.next_page !== 'string' || !data.next_page))) {
      throw new UsageError('unavailable', 'OpenAI returned incomplete cost data. Totals are unavailable; retry shortly.');
    }
    for (const bucket of data.data) {
      if (!Array.isArray(bucket?.results)) throw new UsageError('unavailable', 'OpenAI returned invalid cost buckets. Totals are unavailable.');
      for (const result of bucket.results) {
        const value = numberOrNull(result?.amount?.value);
        if (value == null || String(result.amount.currency).toLowerCase() !== 'usd') {
          throw new UsageError('unavailable', 'OpenAI returned costs without complete USD amounts. Totals are unavailable.');
        }
        const lineItem = typeof result.line_item === 'string' && result.line_item.trim() ? result.line_item.trim() : 'Unspecified';
        totals.set(lineItem, (totals.get(lineItem) ?? 0) + value);
      }
    }
    if (!data.has_more) break;
    if (cursors.has(data.next_page)) throw new UsageError('unavailable', 'OpenAI cost pagination repeated a page. Totals are unavailable; retry shortly.');
    cursors.add(data.next_page);
    params.set('page', data.next_page);
  }
  const byLineItem = [...totals].map(([lineItem, costUsd]) => ({ lineItem, costUsd })).sort((a, b) => b.costUsd - a.costUsd);
  return {
    actualCostUsd: byLineItem.reduce((sum, row) => sum + row.costUsd, 0),
    start: usageStart,
    end: usageEnd,
    scope: projectId ? 'project' as const : 'organization' as const,
    byLineItem,
  };
};

type UsageStatus = 'ok' | 'needs_admin_key' | 'forbidden' | 'invalid_key' | 'unavailable';
type FalUsageRow = { endpoint: string; costUsd: number; quantity: number | null; unit: string | null };
class UsageError extends Error {
  constructor(readonly code: Exclude<UsageStatus, 'ok'>, message: string) { super(message); }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const warnings: string[] = [];
  const normalizeKey = (key?: string) => key?.trim().replace(/^Key\s+/i, '').trim() || '';
  const billingKey = normalizeKey(process.env.FAL_ADMIN_KEY) || normalizeKey(process.env.FAL_KEY);
  const serviceDb = createServiceRoleClient();
  const [evolinkResult, falResult, openaiResult, h3Result] = await Promise.allSettled([
    loadEvoLinkUsage(),
    loadFalUsage(),
    loadOpenAIUsage(),
    billingKey && serviceDb ? reconcileH3Usage(serviceDb, billingKey) : Promise.resolve(null),
  ]);

  const evolink = evolinkResult.status === 'fulfilled' ? evolinkResult.value : null;
  if (evolinkResult.status === 'rejected') warnings.push(evolinkResult.reason?.message || 'EvoLink usage unavailable');

  const fal = falResult.status === 'fulfilled' ? falResult.value : null;
  let falStatus: UsageStatus = 'ok';
  if (falResult.status === 'rejected') {
    falStatus = falResult.reason instanceof UsageError ? falResult.reason.code : 'unavailable';
    warnings.push(falResult.reason instanceof UsageError ? falResult.reason.message : 'fal.ai usage unavailable. Retry shortly.');
  }

  const openai = openaiResult.status === 'fulfilled' ? openaiResult.value : null;
  let openaiStatus: UsageStatus = 'ok';
  if (openaiResult.status === 'rejected') {
    openaiStatus = openaiResult.reason instanceof UsageError ? openaiResult.reason.code : 'unavailable';
    warnings.push(openaiResult.reason instanceof UsageError ? openaiResult.reason.message : 'OpenAI costs unavailable. Retry shortly.');
  }

  const h3Reconciliation = h3Result.status === 'fulfilled' ? h3Result.value : null;
  if (h3Reconciliation) warnings.push(...h3Reconciliation.warnings);
  else if (h3Result.status === 'rejected') warnings.push('H3 request billing could not be reconciled. Retry refresh.');
  return res.status(200).json({ evolink, fal, falStatus, openai, openaiStatus, h3Reconciliation, warnings });
}
