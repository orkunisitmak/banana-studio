import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { createTaskDeadline } from '../src/lib/shared/asyncTask.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, normalizeBrainstormOutput } from './_lib/textOutputFormats.js';
import { runLocalAgentText, type LocalTextPart } from './_lib/localAgentText.js';
import type { LocalAgent } from './_lib/localAgents.js';

export const config = { maxDuration: 300 };
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];
// Each vendor CLI serves its own vendor's model; opencode serves all three through an OpenCode account.
const AGENT_MODELS: Record<string, LocalAgent[]> = { 'anthropic/claude-opus-5.5': ['claude-code', 'opencode'], 'gpt-6.1-sol': ['codex', 'opencode'], 'gemini-3.8-flash': ['gemini-cli', 'opencode'] };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const LABEL: Record<LocalAgent, string> = { codex: 'Codex', 'claude-code': 'Claude Code', 'gemini-cli': 'Gemini CLI', opencode: 'opencode' };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.BANANA_RUNTIME !== 'local') return res.status(404).json({ error: 'Local agents are available in the desktop app only.' });
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  const agents = Object.hasOwn(AGENT_MODELS, body?.model) ? AGENT_MODELS[body.model] : undefined;
  const agent = agents?.includes(body?.provider) ? body.provider as LocalAgent : undefined;
  if (!agent) return res.status(400).json({ error: 'Unsupported text model or local agent.' });
  const parts = body?.contents?.parts, usageContext = body?.usageContext;
  if (!ACTIONS.includes(usageContext?.action) || typeof usageContext?.prompt !== 'string') return res.status(400).json({ error: 'Invalid text feature.' });
  if (body.reasoningEffort != null && !EFFORTS.includes(body.reasoningEffort)) return res.status(400).json({ error: 'Unsupported reasoning effort.' });
  if (body.outputFormat != null) return res.status(400).json({ error: 'Video analysis requires Gemini.' });
  if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || usageContext.action !== 'brainstorm')) return res.status(400).json({ error: 'Invalid Brainstorm output format.' });
  if (body.brainstormCount != null && (usageContext.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) return res.status(400).json({ error: 'Invalid Brainstorm idea count.' });
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) return res.status(400).json({ error: 'Provide text and optional image references.' });
  if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) return res.status(413).json({ error: 'Reference images are too large. Use fewer or smaller images.' });
  const content: LocalTextPart[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string' && !part.inlineData && !part.fileData) content.push({ text: part.text });
    else if (part?.text == null && !part.fileData && ['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
      && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data)) content.push({ image: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
    else return res.status(400).json({ error: 'This model accepts text and image references. YouTube footage requires Gemini.' });
  }
  const streaming = String(req.headers?.accept || req.headers?.Accept || '').includes('application/x-ndjson');
  const controller = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined, disconnected = false;
  const send = (event: unknown) => { if (!disconnected && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  // A closed connection stops the agent so a subscription turn is not spent on nobody.
  const close = () => { disconnected = true; clearInterval(heartbeat); if (!res.writableFinished) controller.abort(); };
  const fail = (status: number, error: string) => {
    if (streaming) { send({ type: 'error', error }); return res.end(); }
    return res.status(status).json({ error });
  };
  if (streaming) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('X-Accel-Buffering', 'no');
    send({ type: 'status', stage: 'generating' });
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
  }
  res.on('close', close);
  const wardrobe = body.brainstormFormat === 'wardrobe', brainstorm = usageContext.action === 'brainstorm';
  try {
    const { text: raw, sessionId } = await runLocalAgentText({ agent, model: body.model, parts: content, effort: body.reasoningEffort,
      instructions: 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable.'
        + (brainstorm ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : ''),
      schema: brainstorm ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount).schema : undefined,
    }, controller.signal);
    if (streaming) send({ type: 'status', stage: 'finishing' });
    let text = raw;
    if (!text.trim()) return fail(502, `${LABEL[agent]} returned an empty reply. Try again.`);
    if (brainstorm) {
      const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
      if (!normalized) return fail(502, `${LABEL[agent]} did not return the ideas in the expected format. Try again.`);
      text = normalized;
    }
    // Subscription usage has no per-request API charge; record the action so history stays complete.
    let usageLogged = false;
    try {
      const { error } = await createUserScopedClient(req).from('usage_logs').insert({ user_id: user.id, action: usageContext.action, model: body.model,
        prompt: usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: 0 });
      usageLogged = !error;
    } catch { /* History is best effort; the result is still returned. */ }
    const result = { text, candidates: null, provider: agent, providerModel: `${agent}/${body.model}`, usageMetadata: { provider: agent, usageLogged, usageLoggingPending: false }, requestId: sessionId };
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return fail(error?.status || (timeout ? 504 : 502), timeout ? `${LABEL[agent]} did not finish in time. Shorten the request and try again.` : String(error?.message || `${LABEL[agent]} failed.`).slice(0, 500));
  } finally {
    clearInterval(heartbeat); res.off?.('close', close);
  }
}
