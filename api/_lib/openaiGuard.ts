import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceRoleClient, type AuthenticatedUser } from './auth.js';

// JWT identity has already been verified by requireUser. The database checks
// that its session still exists and belongs to that same user before spending.
export const getOpenAISessionId = (req: VercelRequest): string | null => {
  try {
    const header = req.headers?.authorization || req.headers?.Authorization;
    const token = (Array.isArray(header) ? header[0] : header)?.replace(/^Bearer /, '').trim();
    const id = JSON.parse(Buffer.from(token?.split('.')[1] || '', 'base64url').toString()).session_id;
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch { return null; }
};

// The historical server-only ledger now also admits OpenRouter requests, so
// provider switching cannot bypass the existing session/spend limits.
export async function startOpenAIRequest(req: VercelRequest, res: VercelResponse, user: AuthenticatedUser, kind: 'image' | 'text', generationId?: string, provider: 'OpenAI' | 'OpenRouter' | 'Local API' = 'OpenAI') {
  const prefix = provider === 'Local API' ? 'local-request' : provider === 'OpenRouter' ? 'openrouter-request' : 'openai-request';
  const enabled = provider === 'Local API' ? process.env.LOCAL_ENABLED : provider === 'OpenRouter' ? process.env.OPENROUTER_ENABLED : process.env.OPENAI_ENABLED;
  if (enabled === 'false' || (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production')) {
    res.status(503).json({ error: `${provider} generation is temporarily disabled.` });
    return null;
  }
  const session = getOpenAISessionId(req);
  if (!session) {
    res.status(401).json({ error: 'Refresh your session before generating.' });
    return null;
  }
  const db = createServiceRoleClient();
  if (!db) {
    res.status(503).json({ error: `${provider} request protection is unavailable. No provider request was sent.` });
    return null;
  }
  const id = randomUUID();
  let result;
  try {
    result = await db.rpc('start_openai_request', {
      p_id: id, p_user_id: user.id, p_session_id: session, p_kind: kind,
      p_generation_id: generationId || null,
    }).abortSignal(AbortSignal.timeout(5_000));
  } catch { result = { error: true }; }
  if (result.error || !result.data || typeof result.data.allowed !== 'boolean') {
    res.status(503).json({ error: `${provider} request protection is unavailable. No provider request was sent.` });
    return null;
  }
  if (!result.data.allowed) {
    if (kind === 'image' && result.data.reason === 'duplicate') {
      res.status(409).json({ code:'GENERATION_EXISTS', error:'This generation already has a saved request. Recover it instead of generating again.' });
      return null;
    }
    const forbidden = result.data.reason === 'session';
    const retryAfter = Number.isFinite(result.data.retry_after) && result.data.retry_after > 0 ? result.data.retry_after : 60;
    if (!forbidden) res.setHeader('Retry-After', String(result.data.retry_after || 60));
    res.status(forbidden ? 403 : 429).json({ error: forbidden
      ? 'Your session is no longer authorized. Sign in again.'
      : `${provider} request limit reached. Wait before trying again.`,
      ...(!forbidden && kind === 'image' && ['rate', 'daily'].includes(result.data.reason)
        ? { code: 'IMAGE_CAPACITY_WAIT', providerRequestSent: false, retryAfter } : {}),
    });
    return null;
  }
  console.info(`[${prefix}] id=${id} kind=${kind} stage=accepted`);
  let finished = false;
  return {
    id,
    async finish(outcome: 'completed' | 'failed' | 'rejected', providerRequestId?: string | null, providerStatus?: number) {
      if (finished) return;
      finished = true;
      // Only operational identifiers go in this server-owned ledger. Never
      // persist prompts, keys, tokens, request headers or upstream error text.
      const safeRequestId = typeof providerRequestId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(providerRequestId) ? providerRequestId : null;
      try {
        const { error } = await db.rpc('finish_openai_request', {
          p_id: id, p_outcome: outcome, p_provider_request_id: safeRequestId,
          p_provider_status: Number.isInteger(providerStatus) && providerStatus! >= 100 && providerStatus! <= 599 ? providerStatus : null,
        }).abortSignal(AbortSignal.timeout(5_000));
        if (error) console.warn(`[${prefix}] id=${id} stage=ledger_unconfirmed`);
      } catch { console.warn(`[${prefix}] id=${id} stage=ledger_unconfirmed`); }
      console.info(`[${prefix}] id=${id} stage=${outcome}`);
    },
  };
}

// Provider errors can reflect credentials (including partially masked keys),
// headers or transport diagnostics. Expose a fixed message instead.
export { openAIErrorMessage } from './openaiError.js';
