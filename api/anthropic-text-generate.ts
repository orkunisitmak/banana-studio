import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { startOpenAIRequest } from './_lib/openaiGuard.js';
import { createTaskDeadline, waitForTask } from '../src/lib/shared/asyncTask.js';
import { DEFAULT_OPENROUTER_REASONING, isOpenRouterReasoningEffort } from '../src/lib/prompts/openrouterText.js';
import { ANTHROPIC_MODELS, anthropicErrorMessage, calculateAnthropicTextCost } from '../src/lib/prompts/anthropicText.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, YOUTUBE_ANALYSIS_FORMAT, normalizeBrainstormOutput } from './_lib/textOutputFormats.js';

export const config = { maxDuration: 300 };
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImageType = typeof IMAGE_TYPES[number];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return res.status(503).json({ error: 'ANTHROPIC_API_KEY sunucuda tanımlı değil. Yönetici Anthropic anahtarını eklemeli.' });
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  const parts = body?.contents?.parts;
  const usageContext = body?.usageContext;
  const upstreamModel = typeof body?.model === 'string' && Object.hasOwn(ANTHROPIC_MODELS, body.model) ? ANTHROPIC_MODELS[body.model] : undefined;
  if (!upstreamModel) return res.status(400).json({ error: 'Unsupported text model' });
  const model = body.model as string;
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
  const content: Anthropic.ContentBlockParam[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string' && !part.inlineData && !part.fileData) content.push({ type: 'text', text: part.text });
    else if (part?.text == null && !part.fileData && IMAGE_TYPES.includes(part?.inlineData?.mimeType)
      && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: part.inlineData.mimeType as ImageType, data: part.inlineData.data } });
    } else return res.status(400).json({ error: 'This model accepts text and image references. YouTube footage requires Gemini.' });
  }
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
  const wardrobe = body.brainstormFormat === 'wardrobe';
  const analysis = body.outputFormat === 'youtube_analysis';
  const format = analysis ? YOUTUBE_ANALYSIS_FORMAT : usageContext.action === 'brainstorm' ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount) : undefined;
  // Paid requests are never retried automatically; the user decides whether to try again.
  const client = new Anthropic({ apiKey: key, maxRetries: 0, fetch: (input, init) => globalThis.fetch(input, init) });
  try {
    // Thinking is always on for Claude Opus 5.5 (adaptive); effort sets its depth.
    // A refusal is re-run on Anthropic's default fallback model inside the same request.
    const message = await waitForTask(client.beta.messages.stream({
      model: upstreamModel, max_tokens: 32768,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      system: analysis
        ? 'Prepare the requested factual episode analysis using only the supplied footage or verified observations. Report unavailable footage honestly; never invent events, identities, prices, outcomes or timestamps. Return exactly the requested JSON object.'
        : 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.' + (usageContext.action === 'brainstorm' ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : ''),
      messages: [{ role: 'user', content }],
      output_config: { effort, ...(format ? { format: { type: 'json_schema', schema: format.schema } } : {}) },
      metadata: { user_id: user.id },
    }, { signal: deadline.signal }).finalMessage(), deadline.signal);
    deadline.dispose();
    providerStatus = 200; requestId = message.id;
    let usageLogged = false;
    let usageLoggingPending = false;
    const accounting = createTaskDeadline(5_000);
    if (streaming) send({ type: 'status', stage: 'finishing' });
    try {
      const { error } = await waitForTask(createUserScopedClient(req).from('usage_logs').insert({
        user_id: user.id, action: usageContext.action, model,
        prompt: usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: calculateAnthropicTextCost(message.usage, message.model),
      }).abortSignal(accounting.signal), accounting.signal);
      usageLogged = !error;
    } catch { usageLoggingPending = true; }
    finally { accounting.dispose(); }
    if (message.stop_reason === 'refusal') return fail(422, 'Model bu isteği yanıtlayamadı.');
    if (message.stop_reason !== 'end_turn') return fail(502, 'Model yanıtı tamamlanamadı. İsteği kısaltıp yeniden dene.');
    let text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    if (!text.trim()) return fail(502, 'Model boş yanıt döndürdü. Yeniden dene.');
    if (usageContext.action === 'brainstorm') {
      const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
      console.info(`[anthropic-brainstorm] id=${guard.id} expected=${body.brainstormCount ?? 'legacy'} accepted=${normalized ? JSON.parse(normalized).length : 0} thinking=${effort}`);
      if (!normalized) return fail(502, 'Model fikirleri beklenen biçimde döndürmedi. Yeniden dene.');
      text = normalized;
    }
    if (analysis) {
      let value: any;
      try { value = JSON.parse(text); } catch { /* checked below */ }
      if (typeof value?.videoAvailable !== 'boolean' || typeof value.brief !== 'string' || typeof value.premise !== 'string'
        || typeof value.limitation !== 'string' || !Array.isArray(value.evidence)) return fail(502, 'Model video analizini beklenen biçimde döndürmedi.');
    }
    const result = { text, candidates: null, provider: 'anthropic', providerModel: message.model, usageMetadata: { provider: 'anthropic', anthropicUsage: message.usage ?? null, usageLogged, usageLoggingPending }, requestId: guard.id };
    outcome = 'completed'; await guard.finish('completed', requestId, providerStatus);
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
      providerStatus = error.status; requestId = error.requestID ?? requestId;
      return fail(error.status, anthropicErrorMessage(error.status));
    }
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof Anthropic.APIUserAbortError;
    return fail(timeout ? 504 : 502, timeout ? 'Model yanıt süresi aşıldı. İsteği kısaltıp yeniden dene.' : anthropicErrorMessage());
  } finally {
    deadline.dispose(); clearInterval(heartbeat); res.off?.('close', close);
    await guard.finish(outcome, requestId, providerStatus);
  }
}
