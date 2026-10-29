import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isCliProvider } from '../src/lib/providers.js';
import { applyCors, requireUser } from './_lib/auth.js';
import { CliError, cliAvailability, runCliText } from './_lib/cliProviders.js';
import { createTaskDeadline } from '../src/lib/shared/asyncTask.js';
import { DEFAULT_OPENROUTER_REASONING, isOpenRouterReasoningEffort } from '../src/lib/prompts/openrouterText.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, normalizeBrainstormOutput } from './_lib/textOutputFormats.js';

export const config = { maxDuration: 300 };
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];
const MODELS: Record<string, string> = { 'claude-cli': 'anthropic/claude-opus-5.5', 'codex-cli': 'gpt-6.1-sol' };

/** Text features through the user's own signed-in Claude / Codex command.
 * Desktop only: the user's CLI account and plan determine billing. The
 * API-key paid-request ledger does not account for external CLI usage. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  if (process.env.BANANA_RUNTIME !== 'local') return res.status(403).json({ error: 'Abonelik (CLI) rotası yalnızca masaüstü uygulamasında çalışır.' });
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  const provider = body?.cliProvider;
  if (!isCliProvider(provider) || MODELS[provider] !== body?.model) return res.status(400).json({ error: 'Unsupported text model' });
  if (!cliAvailability()[provider]) return res.status(503).json({ error: `${provider === 'claude-cli' ? 'claude' : 'codex'} komutu bu bilgisayarda bulunamadı.` });
  const parts = body?.contents?.parts;
  const usageContext = body?.usageContext;
  const effort = body.reasoningEffort ?? DEFAULT_OPENROUTER_REASONING;
  if (!isOpenRouterReasoningEffort(effort)) return res.status(400).json({ error: 'Unsupported thinking effort.' });
  if (!ACTIONS.includes(usageContext?.action) || typeof usageContext?.prompt !== 'string') return res.status(400).json({ error: 'Invalid text feature.' });
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) {
    return res.status(400).json({ error: 'Provide text and optional image references.' });
  }
  if (body.outputFormat != null) return res.status(400).json({ error: 'Video analysis needs Gemini; the subscription route handles text and image references.' });
  if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || usageContext.action !== 'brainstorm')) return res.status(400).json({ error: 'Invalid Brainstorm output format.' });
  if (body.brainstormCount != null && (usageContext.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) return res.status(400).json({ error: 'Invalid Brainstorm idea count.' });
  if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) return res.status(413).json({ error: 'Reference images are too large. Use fewer or smaller images.' });
  const texts: string[] = [];
  const images: { mimeType: string; data: string }[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string' && !part.inlineData && !part.fileData) texts.push(part.text);
    else if (part?.text == null && !part.fileData && ['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
      && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data)) {
      images.push({ mimeType: part.inlineData.mimeType, data: part.inlineData.data });
    } else return res.status(400).json({ error: 'This route accepts text and image references only.' });
  }
  const wardrobe = body.brainstormFormat === 'wardrobe';
  const brainstorm = usageContext.action === 'brainstorm';
  const format = brainstorm ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount) : undefined;
  const system = 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.'
    + (brainstorm ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : '');
  const streaming = String(req.headers?.accept || req.headers?.Accept || '').includes('application/x-ndjson');
  let disconnected = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const send = (event: unknown) => { if (!disconnected && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  const deadline = createTaskDeadline(250_000);
  const close = () => { if (!res.writableEnded) deadline.abort(new DOMException('Client disconnected', 'AbortError')); disconnected = true; clearInterval(heartbeat); };
  res.on?.('close', close);
  const fail = (status: number, error: string) => {
    if (disconnected || res.destroyed || res.writableEnded) return;
    if (streaming) { send({ type: 'error', error }); return res.end(); }
    return res.status(status).json({ error });
  };
  if (streaming) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('X-Accel-Buffering', 'no');
    send({ type: 'status', stage: 'generating' });
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
  }
  try {
    let text = await runCliText(provider, { prompt: texts.join('\n\n'), system, effort, images, jsonSchema: format?.schema, signal: deadline.signal });
    if (disconnected || res.destroyed) return;
    if (streaming) send({ type: 'status', stage: 'finishing' });
    if (brainstorm) {
      const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
      if (!normalized) return fail(502, 'Model fikirleri beklenen biçimde döndürmedi. Yeniden dene.');
      text = normalized;
    }
    const result = { text, candidates: null, provider, providerModel: MODELS[provider], usageMetadata: { provider, subscription: true }, requestId: null };
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof CliError) return fail(error.status, error.message);
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return fail(timeout ? 504 : 502, timeout ? 'Model yanıt süresi aşıldı. İsteği kısaltıp yeniden dene.' : 'Komut satırı isteği tamamlanamadı.');
  } finally {
    deadline.dispose(); clearInterval(heartbeat); res.off?.('close', close);
  }
}
