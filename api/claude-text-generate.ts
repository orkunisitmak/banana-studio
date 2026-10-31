import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { startOpenAIRequest } from './_lib/openaiGuard.js';
import { createTaskDeadline, waitForTask } from '../src/lib/shared/asyncTask.js';
import { DEFAULT_OPENROUTER_REASONING, OPENROUTER_TEXT_MODEL, isOpenRouterReasoningEffort } from '../src/lib/prompts/openrouterText.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, YOUTUBE_ANALYSIS_FORMAT, normalizeBrainstormOutput } from './_lib/textOutputFormats.js';
import { CLAUDE_TEXT_MODEL, ClaudeTextError, claudeAvailable, claudeErrorMessage, requestClaudeText, type ClaudeContent } from './_lib/claudeText.js';

export const config = { maxDuration: 300 };
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];

/** Same request/response contract as /api/openrouter-text-generate, served by the user's Claude plan. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  if (!claudeAvailable()) return res.status(503).json({ error: 'Claude plan kullanılamıyor. Masaüstü uygulamada `claude setup-token` ile aldığın tokenı Provider keys bölümüne ekle ve Claude Code kurulu olsun.' });
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  const parts = body?.contents?.parts;
  const usageContext = body?.usageContext;
  if (body?.model !== OPENROUTER_TEXT_MODEL) return res.status(400).json({ error: 'Unsupported text model' });
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
  const content: ClaudeContent = [];
  for (const part of parts) {
    if (typeof part?.text === 'string' && !part.inlineData && !part.fileData) content.push({ type: 'text', text: part.text });
    else if (part && part.text == null && !part.fileData &&['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
      && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data } });
    } else return res.status(400).json({ error: 'This model accepts text and image references. YouTube footage requires Gemini.' });
  }
  const guard = await startOpenAIRequest(req, res, user, 'text', undefined, 'Claude');
  if (!guard) return;
  const streaming = String(req.headers?.accept || req.headers?.Accept || '').includes('application/x-ndjson');
  let disconnected = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let requestId: string | null = null;
  let providerStatus: number | undefined;
  let outcome: 'completed' | 'failed' = 'failed';
  const send = (event: unknown) => { if (!disconnected && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  const deadline = createTaskDeadline(250_000);
  // A closed connection stops Claude Code so a dropped request does not keep spending the plan.
  const close = () => { disconnected = true; clearInterval(heartbeat); deadline.abort(new DOMException('Client disconnected', 'AbortError')); };
  res.on('close', close);
  // The client may have left while the body and guard were read; never start the plan call then.
  if (res.destroyed) { close(); deadline.dispose(); res.off?.('close', close); await guard.finish('rejected'); return; }
  const fail = async (status: number, error: string) => {
    await guard.finish('failed', requestId, providerStatus);
    if (streaming) { send({ type: 'error', error }); return res.end(); }
    return res.status(status).json({ error });
  };
  if (streaming) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('X-Accel-Buffering', 'no');
    send({ type: 'status', stage: 'generating' });
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
  }
  const wardrobe = body.brainstormFormat === 'wardrobe';
  const analysis = body.outputFormat === 'youtube_analysis';
  const format = analysis ? YOUTUBE_ANALYSIS_FORMAT : usageContext.action === 'brainstorm' ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount) : undefined;
  try {
    const response = await waitForTask(requestClaudeText({ effort, content, schema: format?.schema,
      system: analysis
        ? 'Prepare the requested factual episode analysis using only the supplied footage or verified observations. Report unavailable footage honestly; never invent events, identities, prices, outcomes or timestamps. Return exactly the requested JSON object.'
        : 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.' + (usageContext.action === 'brainstorm' ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : ''),
    }, deadline.signal), deadline.signal);
    deadline.dispose();
    providerStatus = 200; requestId = response.sessionId;
    let usageLogged = false;
    let usageLoggingPending = false;
    const accounting = createTaskDeadline(5_000);
    if (streaming) send({ type: 'status', stage: 'finishing' });
    try {
      // Plan usage has no per-request API charge.
      const { error } = await waitForTask(createUserScopedClient(req).from('usage_logs').insert({
        user_id: user.id, action: usageContext.action, model: CLAUDE_TEXT_MODEL,
        prompt: usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: 0,
      }).abortSignal(accounting.signal), accounting.signal);
      usageLogged = !error;
    } catch { usageLoggingPending = true; }
    finally { accounting.dispose(); }
    let text = response.text;
    if (!text.trim()) return fail(502, 'Model boş yanıt döndürdü. Yeniden dene.');
    if (usageContext.action === 'brainstorm') {
      const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
      console.info(`[claude-brainstorm] id=${guard.id} expected=${body.brainstormCount ?? 'legacy'} accepted=${normalized ? JSON.parse(normalized).length : 0} thinking=${effort}`);
      if (!normalized) return fail(502, 'Model fikirleri beklenen biçimde döndürmedi. Yeniden dene.');
      text = normalized;
    }
    if (analysis) {
      let value: any;
      try { value = JSON.parse(text); } catch { /* checked below */ }
      if (typeof value?.videoAvailable !== 'boolean' || typeof value.brief !== 'string' || typeof value.premise !== 'string'
        || typeof value.limitation !== 'string' || !Array.isArray(value.evidence)
        || value.videoAvailable === false || !value.brief.trim() || !value.premise.trim()
        || !value.evidence.some((item: any) => item?.relevance === 'premise'
          && typeof item.timestamp === 'string' && typeof item.fact === 'string' && item.fact.trim())) {
        return fail(502, 'Model video analizini beklenen biçimde döndürmedi.');
      }
    }
    const result = { text, candidates: null, provider: 'claude', providerModel: CLAUDE_TEXT_MODEL, usageMetadata: { provider: 'claude', claudeUsage: response.usage, usageLogged, usageLoggingPending }, requestId: guard.id };
    outcome = 'completed'; await guard.finish('completed', requestId, providerStatus);
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof ClaudeTextError) { providerStatus = error.status; return fail(error.status, error.message); }
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return fail(timeout ? 504 : 502, timeout ? 'Model yanıt süresi aşıldı. İsteği kısaltıp yeniden dene.' : claudeErrorMessage());
  } finally {
    deadline.dispose(); clearInterval(heartbeat); res.off?.('close', close);
    await guard.finish(outcome, requestId, providerStatus);
  }
}
