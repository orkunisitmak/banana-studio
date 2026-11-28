import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { OPENAI_TEXT_MODEL, calculateOpenAITextCost, DEFAULT_OPENAI_REASONING, isOpenAIReasoningEffort } from '../src/lib/prompts/openaiText.js';
import { createTaskDeadline, waitForTask } from '../src/lib/shared/asyncTask.js';
import { startOpenAIRequest, startPaidRequest, openAIErrorMessage } from './_lib/openaiGuard.js';
import { admitProvider } from './_lib/providerConfiguration.js';
import { chatContent, evoReferenceUrl, routedChatError, vendorCost } from './_lib/textRouting.js';
import { PROVIDER_KEYS } from '../src/lib/providers.js';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, YOUTUBE_ANALYSIS_FORMAT, normalizeBrainstormOutput } from './_lib/textOutputFormats.js';

export const config = { maxDuration: 300 };
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const started = Date.now();
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  const parts = body?.contents?.parts;
  const usageContext = body?.usageContext;
  if (body?.model !== OPENAI_TEXT_MODEL) return res.status(400).json({ error: 'Unsupported text model' });
  const reasoningEffort = body.reasoningEffort ?? DEFAULT_OPENAI_REASONING;
  if (!isOpenAIReasoningEffort(reasoningEffort)) return res.status(400).json({ error: 'Unsupported GPT-6.2 Sol reasoning effort.' });
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) {
    return res.status(400).json({ error: 'Provide text and optional image references.' });
  }
  if (!ACTIONS.includes(usageContext?.action) || typeof usageContext?.prompt !== 'string') {
    return res.status(400).json({ error: 'Invalid text feature.' });
  }
  if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || usageContext.action !== 'brainstorm')) {
    return res.status(400).json({ error: 'Invalid Brainstorm output format.' });
  }
  if (body.brainstormCount != null && (usageContext.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) return res.status(400).json({ error: 'Invalid Brainstorm idea count.' });
  const wardrobeFormat = body.brainstormFormat === 'wardrobe';
  if (body.outputFormat != null && (body.outputFormat !== 'youtube_analysis' || usageContext.action !== 'enhance' || body.brainstormFormat != null)) return res.status(400).json({ error: 'Invalid analysis output format.' });
  const analysisFormat = body.outputFormat === 'youtube_analysis';
  if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) return res.status(413).json({ error: 'Reference images are too large. Use fewer or smaller images.' });
  const references = chatContent(parts);
  if (!references) return res.status(400).json({ error: 'Unsupported reference content. Use text or JPEG, PNG, WebP images.' });
  const vendor = await admitProvider(req, res, OPENAI_TEXT_MODEL, body.provider);
  if (!vendor) return;
  if (vendor !== 'openai' && vendor !== 'evolink') return res.status(409).json({ error: 'This provider requires the chat endpoint.' });
  const key = process.env[PROVIDER_KEYS[vendor]]?.trim();
  if (!key) return res.status(503).json({ error: `Configure the ${vendor} key before generating.` });
  const guard = vendor === 'openai' ? await startOpenAIRequest(req, res, user, 'text') : await startPaidRequest(req, res, user, 'text', vendor);
  if (!guard) return;
  let providerRequestId: string | null = null;
  let providerStatus: number | undefined;
  let outcome: 'completed' | 'failed' = 'failed';

  // Keep the mobile connection active while reasoning runs. Older clients
  // keep the JSON contract; new clients read a single terminal result/error.
  const streaming = String(req.headers?.accept || req.headers?.Accept || '').includes('application/x-ndjson');
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let disconnected = false;
  const send = (event: unknown) => {
    if (!disconnected && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  const close = () => { disconnected = true; clearInterval(heartbeat); };
  const fail = async (status: number, error: string) => {
    console.warn(`[openai-text-generate] action=${usageContext.action} status=${status} ms=${Date.now() - started}`);
    await guard.finish('failed', providerRequestId, providerStatus);
    if (streaming) { send({ type: 'error', error }); return res.end(); }
    return res.status(status).json({ error });
  };
  if (streaming) {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    res.on('close', close);
    send({ type: 'status', stage: 'generating' });
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
  }
  const provider = createTaskDeadline(250_000);
  console.info(`[openai-text-generate] action=${usageContext.action} reasoning=${reasoningEffort} stage=generating`);
  try {
    const content = [];
    for (const part of references) content.push(part.type === 'text' ? { type: 'input_text', text: part.text } : {
      type: 'input_image', image_url: vendor === 'evolink' ? await evoReferenceUrl(key, part.image_url.url, provider.signal) : part.image_url.url, detail: 'auto',
    });
    const response = await waitForTask(fetch(vendor === 'evolink' ? 'https://direct.evolink.ai/v1/responses' : 'https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': guard.id },
      body: JSON.stringify({
        model: OPENAI_TEXT_MODEL, input: [{ role: 'user', content }],
        instructions: analysisFormat ? 'Prepare the requested factual episode analysis using only the verified footage observations. Do not claim to watch a video yourself or invent events, identities, prices, outcomes or timestamps. Return exactly the requested JSON object.' : 'Complete the requested prompt-writing task now using the supplied brief and references. Make reasonable creative decisions without asking follow-up questions. Return only the requested finished deliverable.'
          + (usageContext.action === 'brainstorm' ? brainstormOutputInstruction(wardrobeFormat, body.brainstormCount) : ''),
        ...(analysisFormat || usageContext.action === 'brainstorm' ? { text: { format: analysisFormat ? YOUTUBE_ANALYSIS_FORMAT : buildBrainstormOutputFormat(wardrobeFormat, body.brainstormCount) } } : {}),
        reasoning: { effort: reasoningEffort }, max_output_tokens: 32768, store: false, ...(vendor === 'openai' && { safety_identifier: user.id }),
      }),
      signal: provider.signal,
    }), provider.signal);
    providerRequestId = response.headers.get('x-request-id');
    providerStatus = response.status;
    // Check the status first: a gateway error page is not JSON, and parsing
    // it would replace the status-specific message with a generic one.
    if (!response.ok) {
      provider.dispose();
      return fail(response.status, vendor === 'openai' ? openAIErrorMessage(response.status, undefined, true) : routedChatError(vendor, response.status));
    }
    const data = await waitForTask(response.json(), provider.signal);
    provider.dispose();

    // A truncated/refused response can still be billed. Record returned usage
    // before checking output; the client skips logging a second copy.
    let usageLogged = false;
    let usageLoggingPending = false;
    const accounting = createTaskDeadline(5_000);
    if (streaming) send({ type: 'status', stage: 'finishing' });
    try {
      const db = createUserScopedClient(req);
      const { error } = await waitForTask(db.from('usage_logs').insert({
        user_id: user.id, action: usageContext.action, model: OPENAI_TEXT_MODEL,
        prompt: usageContext.prompt.slice(0, 500), image_count: 0,
        estimated_cost: vendor === 'openai' ? calculateOpenAITextCost(data?.usage) : vendorCost(data?.usage),
      }).abortSignal(accounting.signal), accounting.signal);
      usageLogged = !error;
      if (error) console.warn('Could not record GPT-6.2 Sol text usage');
    } catch {
      // A timed-out write may still commit. Do not create another charge record
      // from the browser when the database outcome is uncertain.
      usageLoggingPending = true;
      console.warn('Could not confirm GPT-6.2 Sol text usage recording');
    } finally { accounting.dispose(); }

    if (data?.status !== 'completed') return fail(502, 'GPT-6.2 Sol yanıtı tamamlanamadı. İsteği kısaltıp yeniden dene.');
    const output = (Array.isArray(data.output) ? data.output : [])
      .filter((item: any) => item?.type === 'message' && item.role === 'assistant')
      .flatMap((item: any) => Array.isArray(item.content) ? item.content : []);
    const refusal = output.find((item: any) => item?.type === 'refusal');
    if (refusal) return fail(422, 'GPT-6.2 Sol bu isteği yanıtlayamadı.');
    let text = output.filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string').map((item: any) => item.text).join('\n');
    if (!text.trim()) return fail(502, 'GPT-6.2 Sol boş yanıt döndürdü. Yeniden dene.');
    if (usageContext.action === 'brainstorm') {
      // Keep the browser's existing array contract while enforcing provider-side
      // structure. A clarification or prose response must never become an idea.
      const normalized = normalizeBrainstormOutput(text, wardrobeFormat, body.brainstormCount);
      if (!normalized) {
        return fail(502, 'GPT-6.2 Sol fikirleri beklenen biçimde döndürmedi. Yeniden dene.');
      }
      // Missing wardrobe is recoverable in the client. Keep otherwise usable
      // scenes and metadata intact; do not convert objects to strings.
      text = normalized;
    }
    const result = { text, candidates: null, usageMetadata: { textProvider: vendor, providerCost: vendorCost(data.usage), openaiUsage: data.usage ?? null, usageLogged, usageLoggingPending }, requestId: guard.id };
    outcome = 'completed';
    console.info(`[openai-text-generate] action=${usageContext.action} stage=completed ms=${Date.now() - started} usageLogged=${usageLogged}`);
    await guard.finish('completed', providerRequestId, providerStatus);
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return fail(timeout ? 504 : 502, timeout
      ? 'GPT-6.2 Sol yanıt süresi aşıldı. İsteği kısaltıp yeniden dene.'
      : vendor === 'openai' ? openAIErrorMessage(undefined, undefined, true) : routedChatError(vendor));
  } finally {
    provider.dispose(); clearInterval(heartbeat); res.off?.('close', close);
    await guard.finish(outcome, providerRequestId, providerStatus);
  }
}
