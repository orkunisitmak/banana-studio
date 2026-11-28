import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OPENROUTER_MODELS, PROVIDER_KEYS } from '../src/lib/providers.js';
import { OPENAI_TEXT_MODEL } from '../src/lib/prompts/openaiText.js';
import { admitProvider } from './_lib/providerConfiguration.js';
import { chatContent, postEvoOpus, postTextChat, routedChatError, vendorCost, HYDROGEN } from './_lib/textRouting.js';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { startOpenAIRequest, startPaidRequest } from './_lib/openaiGuard.js';
import { createTaskDeadline, waitForTask } from '../src/lib/shared/asyncTask.js';
import { DEFAULT_OPENROUTER_REASONING, OPENROUTER_TEXT_MODEL, calculateOpenRouterTextCost, isOpenRouterReasoningEffort, openRouterErrorMessage } from '../src/lib/prompts/openrouterText.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, YOUTUBE_ANALYSIS_FORMAT, normalizeBrainstormOutput } from './_lib/textOutputFormats.js';

export const config = { maxDuration: 300 };
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  const parts = body?.contents?.parts;
  const usageContext = body?.usageContext;
  if (![OPENROUTER_TEXT_MODEL, OPENAI_TEXT_MODEL, HYDROGEN].includes(body?.model)) return res.status(400).json({ error: 'Unsupported text model' });
  const model = body.model as string;
  const upstreamModel = OPENROUTER_MODELS[model];
  const effort = body.reasoningEffort ?? DEFAULT_OPENROUTER_REASONING;
  if (!isOpenRouterReasoningEffort(effort)) return res.status(400).json({ error: 'Unsupported thinking effort.' });
  if (!ACTIONS.includes(usageContext?.action) || typeof usageContext?.prompt !== 'string') return res.status(400).json({ error: 'Invalid text feature.' });
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) {
    return res.status(400).json({ error: 'Provide text and optional image references.' });
  }
  if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || usageContext.action !== 'brainstorm')) return res.status(400).json({ error: 'Invalid Brainstorm output format.' });
  if (body.brainstormCount != null && (usageContext.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) return res.status(400).json({ error: 'Invalid Brainstorm idea count.' });
  if (body.outputFormat != null && (body.outputFormat !== 'youtube_analysis' || usageContext.action !== 'enhance' || body.brainstormFormat != null)) return res.status(400).json({ error: 'Invalid analysis output format.' });
  if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) return res.status(413).json({ error: 'Reference images are too large. Use fewer or smaller images.' });
  const content = chatContent(parts);
  if (!content) return res.status(400).json({ error: 'This model accepts text and image references. YouTube footage requires native Gemini.' });
  const provider = await admitProvider(req, res, model, body.provider);
  if (!provider) return;
  if (provider !== 'openrouter' && provider !== 'fal' && !(provider === 'evolink' && model === OPENROUTER_TEXT_MODEL)) {
    return res.status(409).json({ error: 'This model requires a different text endpoint for the selected provider.' });
  }
  const key = process.env[PROVIDER_KEYS[provider]]?.trim();
  if (!key) return res.status(503).json({ error: `Configure the ${provider} key before generating.` });
  const guard = provider === 'openrouter' ? await startOpenAIRequest(req, res, user, 'text', undefined, 'OpenRouter') : await startPaidRequest(req, res, user, 'text', provider);
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
  const wardrobe = body.brainstormFormat === 'wardrobe';
  const analysis = body.outputFormat === 'youtube_analysis';
  const format = analysis ? YOUTUBE_ANALYSIS_FORMAT : usageContext.action === 'brainstorm' ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount) : undefined;
  try {
    const system = analysis
      ? 'Prepare the requested factual episode analysis using only the verified observations. Never invent events, identities, prices, outcomes or timestamps. Return exactly the requested JSON object.'
      : 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.' + (usageContext.action === 'brainstorm' ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : '');
    const response = await waitForTask(provider === 'evolink' ? postEvoOpus(key, system, content, effort, format?.schema, deadline.signal)
      : postTextChat(provider, key, model, { messages: [{ role: 'system', content: system }, { role: 'user', content }], effort, maxTokens: 32768,
        responseFormat: format && { type: 'json_schema', json_schema: { name: format.name, strict: format.strict, schema: format.schema } } }, deadline.signal), deadline.signal);
    providerStatus = response.status; requestId = response.headers.get('x-request-id');
    if (!response.ok) return fail(response.status, provider === 'openrouter' ? openRouterErrorMessage(response.status) : routedChatError(provider, response.status));
    const data = await waitForTask(response.json(), deadline.signal);
    deadline.dispose();
    requestId = typeof data?.id === 'string' ? data.id : requestId;
    // Account for a billed truncated/refused response before validating output.
    let usageLogged = false;
    let usageLoggingPending = false;
    const accounting = createTaskDeadline(5_000);
    if (streaming) send({ type: 'status', stage: 'finishing' });
    try {
      const { error } = await waitForTask(createUserScopedClient(req).from('usage_logs').insert({
        user_id: user.id, action: usageContext.action, model,
        prompt: usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: provider === 'openrouter' ? calculateOpenRouterTextCost(data?.usage, model) : vendorCost(data?.usage),
      }).abortSignal(accounting.signal), accounting.signal);
      usageLogged = !error;
    } catch { usageLoggingPending = true; }
    finally { accounting.dispose(); }
    const choice = data?.choices?.[0];
    if (provider === 'evolink' ? data?.stop_reason === 'refusal' : choice?.message?.refusal) return fail(422, 'Model bu isteği yanıtlayamadı.');
    if (provider === 'evolink' ? data?.stop_reason !== 'end_turn' : choice?.finish_reason !== 'stop') return fail(502, 'Model yanıtı tamamlanamadı. İsteği kısaltıp yeniden dene.');
    let text: string = provider === 'evolink'
      ? data.role === 'assistant' && Array.isArray(data.content) ? data.content.filter((p: { type?: string; text?: unknown }) => p?.type === 'text' && typeof p.text === 'string').map((p: { text: string }) => p.text).join('\n') : ''
      : choice?.message?.role === 'assistant' && typeof choice.message.content === 'string' ? choice.message.content : '';
    if (!text.trim()) return fail(502, 'Model boş yanıt döndürdü. Yeniden dene.');
    if (usageContext.action === 'brainstorm') {
      const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
      console.info(`[openrouter-brainstorm] id=${guard.id} expected=${body.brainstormCount ?? 'legacy'} accepted=${normalized ? JSON.parse(normalized).length : 0} thinking=${effort}`);
      if (!normalized) return fail(502, 'Model fikirleri beklenen biçimde döndürmedi. Yeniden dene.');
      text = normalized;
    }
    if (analysis) {
      let value: any;
      try { value = JSON.parse(text); } catch { /* checked below */ }
      if (typeof value?.videoAvailable !== 'boolean' || typeof value.brief !== 'string' || typeof value.premise !== 'string'
        || typeof value.limitation !== 'string' || !Array.isArray(value.evidence)) return fail(502, 'Model video analizini beklenen biçimde döndürmedi.');
    }
    const result = { text, candidates: null, provider, providerModel: provider === 'evolink' ? 'claude-opus-5-5' : upstreamModel, usageMetadata: { provider, textProvider: provider, providerCost: vendorCost(data.usage), openrouterUsage: data.usage ?? null, usageLogged, usageLoggingPending }, requestId: guard.id };
    outcome = 'completed'; await guard.finish('completed', requestId, providerStatus);
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return fail(timeout ? 504 : 502, timeout ? 'Model yanıt süresi aşıldı. İsteği kısaltıp yeniden dene.' : provider === 'openrouter' ? openRouterErrorMessage() : routedChatError(provider));
  } finally {
    deadline.dispose(); clearInterval(heartbeat); res.off?.('close', close);
    await guard.finish(outcome, requestId, providerStatus);
  }
}
