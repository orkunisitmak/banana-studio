import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { missingProviderMessage } from './_lib/providerConfiguration.js';
import { createTaskDeadline, waitForTask } from '../src/lib/shared/asyncTask.js';
import { OLLAMA_TEXT_MODEL, buildOllamaChat, buildOpenAICompatibleChat, isOllamaModelName, ollamaContextSize, ollamaErrorMessage, openAICompatibleErrorMessage } from '../src/lib/prompts/ollamaText.js';
import { isLocalAssetName, localServerUrl, LOCAL_SERVERS } from '../src/lib/localModels.js';
import { ANALYSIS_SYSTEM_PROMPT, TEXT_TASK_SYSTEM_PROMPT, buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, YOUTUBE_ANALYSIS_FORMAT, normalizeBrainstormOutput } from './_lib/textOutputFormats.js';

export const config = { maxDuration: 300 };
const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];

/** GET lists installed models; POST runs one text task on the selected local model. No provider credits are used.
 * Serves Ollama's native API and any OpenAI-compatible server (LM Studio, llama.cpp, vLLM, LocalAI). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  let body: any;
  try { body = req.method === 'GET' ? {} : typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  const server = (req.method === 'GET' ? req.query?.provider : body?.provider) === 'openaicompat' ? 'openaicompat' : 'ollama';
  const native = server === 'ollama';
  const isModelName = native ? isOllamaModelName : isLocalAssetName;
  const base = localServerUrl(server, process.env);
  if (!base) return res.status(503).json({ error: missingProviderMessage(LOCAL_SERVERS[server].label, LOCAL_SERVERS[server].env) });
  const configured = (native ? process.env.OLLAMA_MODEL : process.env.LOCAL_OPENAI_MODEL)?.trim();
  const defaultModel = isModelName(configured) ? configured : null;
  const unreachable = typeof body?.fallbackFor === 'string'
    ? `${body.fallbackFor.slice(0, 60)} has no provider key and the local model server could not be reached. Add a key in Provider keys or start Ollama / LM Studio.`
    : native ? ollamaErrorMessage() : 'The local OpenAI-compatible server could not be reached. Check that the LM Studio server is running and LOCAL_OPENAI_BASE_URL is correct.';

  if (req.method === 'GET') {
    try {
      const response = await fetch(`${base}${native ? '/api/tags' : '/models'}`, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return res.status(502).json({ error: native ? ollamaErrorMessage(response.status) : unreachable });
      const data = await response.json();
      const entries = native ? data?.models?.map((entry: any) => entry?.name) : data?.data?.map((entry: any) => entry?.id);
      return res.status(200).json({ models: Array.isArray(entries) ? entries.filter(isModelName).slice(0, 200) : [], defaultModel });
    } catch { return res.status(502).json({ error: unreachable }); }
  }
  const parts = body?.contents?.parts;
  const usageContext = body?.usageContext;
  if (body?.model !== OLLAMA_TEXT_MODEL) return res.status(400).json({ error: 'Unsupported text model' });
  const localModel = body.localModel ?? defaultModel;
  if (!isModelName(localModel)) return res.status(400).json({ error: 'Choose an installed local model in AI settings → AI Text Model.' });
  if (!ACTIONS.includes(usageContext?.action) || typeof usageContext?.prompt !== 'string') return res.status(400).json({ error: 'Invalid text feature.' });
  if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) {
    return res.status(400).json({ error: 'Provide text and optional image references.' });
  }
  if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || usageContext.action !== 'brainstorm')) return res.status(400).json({ error: 'Invalid Brainstorm output format.' });
  if (body.brainstormCount != null && (usageContext.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) return res.status(400).json({ error: 'Invalid Brainstorm idea count.' });
  if (body.outputFormat != null && (body.outputFormat !== 'youtube_analysis' || usageContext.action !== 'enhance' || body.brainstormFormat != null)) return res.status(400).json({ error: 'Invalid analysis output format.' });
  if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) return res.status(413).json({ error: 'Reference images are too large. Use fewer or smaller images.' });
  for (const part of parts) {
    const text = typeof part?.text === 'string' && !part.inlineData && !part.fileData;
    const image = part?.text == null && !part.fileData && ['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
      && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data);
    if (!text && !image) return res.status(400).json({ error: 'Local models accept text and image references. YouTube footage requires Gemini.' });
  }

  const streaming = String(req.headers?.accept || req.headers?.Accept || '').includes('application/x-ndjson');
  let disconnected = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const send = (event: unknown) => { if (!disconnected && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  const close = () => { disconnected = true; clearInterval(heartbeat); };
  const fail = (status: number, error: string) => {
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
    const chat = { model: localModel, parts, schema: format?.schema, numCtx: ollamaContextSize(process.env.OLLAMA_NUM_CTX),
      system: analysis ? ANALYSIS_SYSTEM_PROMPT : TEXT_TASK_SYSTEM_PROMPT + (usageContext.action === 'brainstorm' ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : '') };
    const response = await waitForTask(fetch(`${base}${native ? '/api/chat' : '/chat/completions'}`, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: deadline.signal,
      body: JSON.stringify(native ? buildOllamaChat(chat) : buildOpenAICompatibleChat(chat, format?.name)),
    }), deadline.signal);
    const data = await waitForTask(response.json().catch(() => null), deadline.signal);
    const detail = typeof data?.error === 'string' ? data.error : typeof data?.error?.message === 'string' ? data.error.message : undefined;
    if (!response.ok) return fail(response.status === 404 ? 404 : 502, (native ? ollamaErrorMessage : openAICompatibleErrorMessage)(response.status, detail));
    const choice = data?.choices?.[0];
    const finish = native ? data?.done_reason : choice?.finish_reason;
    if (finish && finish !== 'stop') return fail(502, 'The model response did not finish. Increase the context window (OLLAMA_NUM_CTX or the server setting) or shorten the request.');
    const content = native ? data?.message?.content : choice?.message?.content;
    // Reasoning models may wrap their scratchpad in <think> tags on OpenAI-compatible servers.
    let text = typeof content === 'string' ? content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '') : '';
    if (!text.trim()) return fail(502, 'The model returned an empty response. Try again.');
    if (streaming) send({ type: 'status', stage: 'finishing' });
    if (usageContext.action === 'brainstorm') {
      const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
      if (!normalized) return fail(502, 'The model did not return ideas in the expected format. Try again or choose a stronger local model.');
      text = normalized;
    }
    if (analysis) {
      let value: any;
      try { value = JSON.parse(text); } catch { /* checked below */ }
      if (typeof value?.videoAvailable !== 'boolean' || typeof value.brief !== 'string' || typeof value.premise !== 'string'
        || typeof value.limitation !== 'string' || !Array.isArray(value.evidence)) return fail(502, 'The model did not return the video analysis in the expected format.');
    }
    // Local usage is free; record token counts so admin usage still shows the activity.
    const accounting = createTaskDeadline(5_000);
    let usageLogged = false;
    try {
      const { error } = await waitForTask(createUserScopedClient(req).from('usage_logs').insert({
        user_id: user.id, action: usageContext.action, model: OLLAMA_TEXT_MODEL,
        prompt: usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: 0,
      }).abortSignal(accounting.signal), accounting.signal);
      usageLogged = !error;
    } catch { /* Accounting never fails a completed local response. */ }
    finally { accounting.dispose(); }
    const usage = native ? { prompt_tokens: data.prompt_eval_count ?? null, completion_tokens: data.eval_count ?? null } : { prompt_tokens: data.usage?.prompt_tokens ?? null, completion_tokens: data.usage?.completion_tokens ?? null };
    const result = { text, candidates: null, provider: server, providerModel: localModel, usageMetadata: { provider: server, localUsage: usage, usageLogged } };
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error: any) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return fail(timeout ? 504 : 502, timeout ? 'The local model took too long. Choose a smaller model or shorten the request.' : unreachable);
  } finally {
    deadline.dispose(); clearInterval(heartbeat); res.off?.('close', close);
  }
}
