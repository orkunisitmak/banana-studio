import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { startOpenAIRequest } from './_lib/openaiGuard.js';
import { createTaskDeadline, waitForTask } from '../src/lib/shared/asyncTask.js';
import { buildAnthropicMessage, readAnthropicMessage, calculateAnthropicCost } from './_lib/anthropicText.js';
import { normalizeBrainstormOutput } from './_lib/textOutputFormats.js';

export const config = { maxDuration: 300 };
const providerError = (status?: number) => status === 401 || status === 403
  ? 'Anthropic API key or model access was rejected. Check Provider keys.'
  : status === 429 || status === 529 ? 'Anthropic is busy or rate limited. Check usage before trying again.'
  : 'Anthropic could not finish the request. Check provider usage before trying again.';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body.' }); }
  let payload;
  try { payload = buildAnthropicMessage(body); }
  catch (error: any) { return res.status(400).json({ error: error?.message || 'Invalid request.' }); }
  const guard = await startOpenAIRequest(req, res, user, 'text', undefined, 'Anthropic');
  if (!guard) return;
  const streaming = String(req.headers?.accept || req.headers?.Accept || '').includes('application/x-ndjson');
  let disconnected = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let requestId: string | null = null;
  let providerStatus: number | undefined;
  let outcome: 'completed' | 'failed' = 'failed';
  const send = (event: unknown) => { if (!disconnected && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  const close = () => { disconnected = true; clearInterval(heartbeat); };
  const fail = async (status: number, error: string) => {
    await guard.finish('failed', requestId, providerStatus);
    if (streaming) { send({ type: 'error', error }); return res.end(); }
    return res.status(status).json({ error });
  };
  if (streaming) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('X-Accel-Buffering', 'no');
    res.on('close', close); send({ type: 'status', stage: 'generating' });
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
  }
  const deadline = createTaskDeadline(250_000);
  try {
    const response = await waitForTask(fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', redirect: 'error', signal: deadline.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), deadline.signal);
    providerStatus = response.status;
    requestId = response.headers.get('request-id');
    const data = await waitForTask(response.json(), deadline.signal);
    deadline.dispose();
    if (!response.ok) return fail(response.status, providerError(response.status));
    requestId = typeof data?.id === 'string' ? data.id : requestId;
    let usageLogged = false, usageLoggingPending = false;
    const accounting = createTaskDeadline(5_000);
    if (streaming) send({ type: 'status', stage: 'finishing' });
    try {
      const { error } = await waitForTask(createUserScopedClient(req).from('usage_logs').insert({
        user_id: user.id, action: body.usageContext.action, model: body.model,
        prompt: body.usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: calculateAnthropicCost(data?.usage),
      }).abortSignal(accounting.signal), accounting.signal);
      usageLogged = !error;
    } catch { usageLoggingPending = true; }
    finally { accounting.dispose(); }
    let text: string;
    try { text = readAnthropicMessage(data); }
    catch { return fail(502, 'Model response did not finish. Check usage before trying again.'); }
    if (body.usageContext.action === 'brainstorm') {
      const normalized = normalizeBrainstormOutput(text, body.brainstormFormat === 'wardrobe', body.brainstormCount);
      if (!normalized) return fail(502, 'Model did not return ideas in the expected format. Check usage before trying again.');
      text = normalized;
    }
    const result = { text, candidates: null, provider: 'anthropic', providerModel: payload.model,
      usageMetadata: { provider: 'anthropic', anthropicUsage: data.usage ?? null, usageLogged, usageLoggingPending }, requestId: guard.id };
    outcome = 'completed'; await guard.finish('completed', requestId, providerStatus);
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return fail(timeout ? 504 : 502, timeout ? 'Model response timed out. Check usage before trying again.' : providerError());
  } finally {
    deadline.dispose(); clearInterval(heartbeat); res.off?.('close', close);
    await guard.finish(outcome, requestId, providerStatus);
  }
}
