// Never expose upstream messages: they may contain keys, headers or signed URLs.
const SAFE_CODES = new Set(['invalid_image', 'invalid_image_url', 'image_parse_error', 'image_download_failed', 'content_policy_violation', 'moderation_blocked', 'rate_limit_exceeded', 'insufficient_quota']);

export function safeOpenAIErrorCode(data: unknown): string | undefined {
  const error = (data as { error?: { code?: unknown; type?: unknown; message?: unknown }; message?: unknown } | null)?.error;
  const code = error?.code;
  if (typeof code === 'string' && SAFE_CODES.has(code)) return code;
  const category = `${typeof code==='string'?code:''} ${typeof error?.type==='string'?error.type:''} ${typeof error?.message==='string'?error.message:''}`;
  if (/insufficient.quota|quota.exceeded|billing.hard.limit|insufficient.(?:credit|balance|fund)|exceeded.*quota|usage.limit|spend.limit/i.test(category)) return 'insufficient_quota';
  if (error?.type === 'rate_limit_error') return 'rate_limit_exceeded';
  return;
}

/** HTTP 429 explicitly rejects a request. Quota failures, lost HTTP responses
 * and responses with generated output or usage never qualify for a retry. */
export function imageRateLimitDelay(response: Response, data: any, now = Date.now()): number | undefined {
  const error = data?.error || data;
  if (response.status !== 429
    || data?.usage != null || (data?.data != null && (!Array.isArray(data.data) || data.data.length))) return;
  const category = `${error?.code || ''} ${error?.type || ''} ${error?.message || ''} ${typeof error==='string'?error:''}`;
  if (/quota|billing|balance|credit|hard.?limit|spend.?limit|usage.limit/i.test(category)) return;
  return providerRetryDelay(response,60,now);
}

/** Quota refusals wait at least an hour and respect a longer provider delay. */
export function imageQuotaDelay(response: Response, data: any, now = Date.now()): number | undefined {
  if (response.status !== 429 || safeOpenAIErrorCode(data) !== 'insufficient_quota' || data?.usage != null
    || (data?.data != null && (!Array.isArray(data.data) || data.data.length))) return;
  return providerRetryDelay(response,3600,now);
}

/** Seconds to wait after a provider refusal, from Retry-After or rate-limit reset headers, never below `minimum`. */
function providerRetryDelay(response: Response, minimum: number, now: number): number | undefined {
  // Some refusals omit `error.code` or return an opaque error body. The HTTP
  // status is authoritative; timeouts/5xx never enter this path.
  const delays = [minimum];
  const retry = response.headers.get('retry-after');
  if (retry) {
    const seconds = /^\d+(?:\.\d+)?$/.test(retry.trim()) ? Number(retry) : (Date.parse(retry) - now) / 1000;
    if (Number.isFinite(seconds)) delays.push(seconds);
  }
  for (const name of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
    const value = response.headers.get(name)?.trim();
    if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) continue;
    let seconds = 0;
    for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) seconds += Number(match[1]) * ({ms:.001,s:1,m:60,h:3600}[match[2]]!);
    delays.push(seconds);
  }
  const seconds = Math.ceil(Math.max(...delays));
  return seconds <= 86400 ? seconds : undefined;
}

export function openAIErrorMessage(status?: number, code?: string): string {
  if (status === 401 || status === 403) return 'OpenAI credentials or model permissions need attention. Contact the administrator.';
  if (code === 'insufficient_quota') return 'OpenAI quota is exhausted. Contact the administrator before generating again.';
  if (status === 429) return 'OpenAI is temporarily rate limited or out of quota. Try again later.';
  if (status != null && status >= 500 && status <= 599) return `OpenAI is temporarily unavailable (HTTP ${status}). No image was returned. Check usage before starting a new generation.`;
  if (code === 'content_policy_violation' || code === 'moderation_blocked') return 'OpenAI declined this image request under its content policy. Adjust the prompt or references.';
  if (code === 'invalid_image' || code === 'invalid_image_url' || code === 'image_parse_error' || code === 'image_download_failed') return 'OpenAI could not read a reference image. Reattach the affected reference before generating again.';
  if (status === 400 || status === 422) return 'OpenAI could not accept this request. Check the prompt and references.';
  return 'OpenAI request failed. Check the saved generation and usage before trying again.';
}
