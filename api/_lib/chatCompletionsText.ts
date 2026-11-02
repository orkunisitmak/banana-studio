import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './auth.js';
import { startOpenAIRequest } from './openaiGuard.js';
import { createTaskDeadline, waitForTask } from '../../src/lib/shared/asyncTask.js';
import { DEFAULT_OPENROUTER_REASONING, isOpenRouterReasoningEffort } from '../../src/lib/prompts/openrouterText.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, YOUTUBE_ANALYSIS_FORMAT, normalizeBrainstormOutput } from './textOutputFormats.js';

const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];

/** One OpenAI-compatible chat-completions text route (OpenRouter, Liquid Inference).
 * Validation, the spend guard, usage logging and output checks are shared so
 * every provider gets the same protections. Only the transport differs. */
export type ChatTextProvider = {
  /** Value returned to the client as `provider`. */
  id: 'openrouter' | 'liquid';
  /** Spend-guard label; also selects the `<NAME>_ENABLED` switch. */
  guard: 'OpenRouter' | 'Liquid Inference';
  endpoint: string;
  apiKeyEnv: string;
  missingKeyMessage: () => string;
  /** App model id → upstream model id. Only listed models are accepted. */
  models: Record<string, string>;
  /** YouTube footage is forwarded as `video_url` only where the upstream reads it. */
  acceptsYouTube: (model: string) => boolean;
  unsupportedPartMessage: string;
  headers: Record<string, string>;
  /** Provider-specific request fields (routing rules, attribution). */
  extraBody: (model: string) => Record<string, unknown>;
  cost: (data: any, model: string) => number | null;
  /** Response metadata key the client reads to recompute cost. */
  usageKey: 'openrouterUsage' | 'liquidUsage';
  usage: (data: any) => unknown;
  errorMessage: (status?: number) => string;
  logTag: string;
};

export type ChatTextRequest = { model: string; upstreamModel: string; content: Record<string, unknown>[]; effort: string; userId: string;
  action: string; wardrobe: boolean; analysis: boolean; brainstormCount?: number };

/** Pure request builder, kept separate so routing can be tested without network. */
export function buildChatTextBody(provider: ChatTextProvider, request: ChatTextRequest) {
  const format = request.analysis ? YOUTUBE_ANALYSIS_FORMAT : request.action === 'brainstorm' ? buildBrainstormOutputFormat(request.wardrobe, request.brainstormCount) : undefined;
  return { model: request.upstreamModel,
    messages: [{ role: 'system', content: request.analysis
      ? 'Prepare the requested factual episode analysis using only the supplied footage or verified observations. Report unavailable footage honestly; never invent events, identities, prices, outcomes or timestamps. Return exactly the requested JSON object.'
      : 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.' + (request.action === 'brainstorm' ? brainstormOutputInstruction(request.wardrobe, request.brainstormCount) : '') },
      { role: 'user', content: request.content }],
    reasoning: { effort: request.effort, exclude: true }, max_tokens: 32768, user: request.userId,
    ...provider.extraBody(request.model),
    ...(format ? { response_format: { type: 'json_schema', json_schema: { name: format.name, strict: format.strict, schema: format.schema } } } : {}),
  };
}

export function createChatTextHandler(provider: ChatTextProvider) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    applyCors(res); res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const auth = createTaskDeadline(15_000);
    const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
    if (!user) return;
    const key = process.env[provider.apiKeyEnv]?.trim();
    if (!key) return res.status(503).json({ error: provider.missingKeyMessage() });
    let body: any;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
    const parts = body?.contents?.parts;
    const usageContext = body?.usageContext;
    if (typeof body?.model !== 'string' || !Object.hasOwn(provider.models, body.model)) return res.status(400).json({ error: 'Unsupported text model' });
    const model = body.model as string;
    const upstreamModel = provider.models[model];
    const effort = body.reasoningEffort ?? DEFAULT_OPENROUTER_REASONING;
    if (!isOpenRouterReasoningEffort(effort)) return res.status(400).json({ error: 'Unsupported Opus thinking effort.' });
    if (!ACTIONS.includes(usageContext?.action) || typeof usageContext?.prompt !== 'string') return res.status(400).json({ error: 'Invalid text feature.' });
    if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) {
      return res.status(400).json({ error: 'Provide text and optional image references.' });
    }
    if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || usageContext.action !== 'brainstorm')) return res.status(400).json({ error: 'Invalid Brainstorm output format.' });
    if (body.brainstormCount != null && (usageContext.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) return res.status(400).json({ error: 'Invalid Brainstorm idea count.' });
    if (body.outputFormat != null && (body.outputFormat !== 'youtube_analysis' || usageContext.action !== 'enhance' || body.brainstormFormat != null)) return res.status(400).json({ error: 'Invalid analysis output format.' });
    if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) return res.status(413).json({ error: 'Reference images are too large. Use fewer or smaller images.' });
    const content: Record<string, unknown>[] = [];
    for (const part of parts) {
      if (typeof part?.text === 'string' && !part.inlineData && !part.fileData) content.push({ type: 'text', text: part.text });
      else if (part?.text == null && !part.fileData && ['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
        && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data)) {
        content.push({ type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } });
      } else if (provider.acceptsYouTube(model) && typeof part?.fileData?.fileUri === 'string'
        && /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}$/.test(part.fileData.fileUri)) {
        content.push({ type: 'video_url', video_url: { url: part.fileData.fileUri } });
      } else return res.status(400).json({ error: provider.unsupportedPartMessage });
    }
    const guard = await startOpenAIRequest(req, res, user, 'text', undefined, provider.guard);
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
    try {
      const response = await waitForTask(fetch(provider.endpoint, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...provider.headers },
        body: JSON.stringify(buildChatTextBody(provider, { model, upstreamModel, content, effort, userId: user.id,
          action: usageContext.action, wardrobe, analysis, brainstormCount: body.brainstormCount })),
        signal: deadline.signal,
      }), deadline.signal);
      providerStatus = response.status; requestId = response.headers.get('x-request-id');
      const data = await waitForTask(response.json(), deadline.signal);
      deadline.dispose();
      if (!response.ok) return fail(response.status, provider.errorMessage(response.status));
      requestId = typeof data?.id === 'string' ? data.id : requestId;
      // Account for a billed truncated/refused response before validating output.
      let usageLogged = false;
      let usageLoggingPending = false;
      const accounting = createTaskDeadline(5_000);
      if (streaming) send({ type: 'status', stage: 'finishing' });
      try {
        const { error } = await waitForTask(createUserScopedClient(req).from('usage_logs').insert({
          user_id: user.id, action: usageContext.action, model,
          prompt: usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: provider.cost(data, model),
        }).abortSignal(accounting.signal), accounting.signal);
        usageLogged = !error;
      } catch { usageLoggingPending = true; }
      finally { accounting.dispose(); }
      const choice = data?.choices?.[0];
      if (choice?.finish_reason !== 'stop') return fail(502, 'Model yanıtı tamamlanamadı. İsteği kısaltıp yeniden dene.');
      if (choice?.message?.refusal) return fail(422, 'Model bu isteği yanıtlayamadı.');
      let text = choice?.message?.role === 'assistant' && typeof choice.message.content === 'string' ? choice.message.content : '';
      if (!text.trim()) return fail(502, 'Model boş yanıt döndürdü. Yeniden dene.');
      if (usageContext.action === 'brainstorm') {
        const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
        console.info(`[${provider.logTag}-brainstorm] id=${guard.id} expected=${body.brainstormCount ?? 'legacy'} accepted=${normalized ? JSON.parse(normalized).length : 0} thinking=${effort}`);
        if (!normalized) return fail(502, 'Model fikirleri beklenen biçimde döndürmedi. Yeniden dene.');
        text = normalized;
      }
      if (analysis) {
        let value: any;
        try { value = JSON.parse(text); } catch { /* checked below */ }
        if (typeof value?.videoAvailable !== 'boolean' || typeof value.brief !== 'string' || typeof value.premise !== 'string'
          || typeof value.limitation !== 'string' || !Array.isArray(value.evidence)) return fail(502, 'Model video analizini beklenen biçimde döndürmedi.');
      }
      const result = { text, candidates: null, provider: provider.id, providerModel: upstreamModel,
        usageMetadata: { provider: provider.id, [provider.usageKey]: provider.usage(data) ?? null, usageLogged, usageLoggingPending }, requestId: guard.id };
      outcome = 'completed'; await guard.finish('completed', requestId, providerStatus);
      if (streaming) { send({ type: 'result', result }); return res.end(); }
      return res.status(200).json(result);
    } catch (error: any) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return fail(timeout ? 504 : 502, timeout ? 'Model yanıt süresi aşıldı. İsteği kısaltıp yeniden dene.' : provider.errorMessage());
    } finally {
      deadline.dispose(); clearInterval(heartbeat); res.off?.('close', close);
      await guard.finish(outcome, requestId, providerStatus);
    }
  };
}
