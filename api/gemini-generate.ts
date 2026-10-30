import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { applyCors, requireUser } from './_lib/auth.js';
import { createTaskDeadline, waitForTask } from '../src/lib/shared/asyncTask.js';
import { requireSpendingAllowance } from './_lib/spendingLimit.js';

interface GeminiGenerateRequest {
  model: string;
  contents: unknown;
  config?: unknown;
}

const ALLOWED_MODELS = new Set(['gemini-3.8-flash', 'gemini-3-pro-image-preview', 'gemini-nano-banana-2.1']);
const ALLOWED_CONFIG_KEYS = new Set([
  'temperature', 'topP', 'topK', 'candidateCount', 'maxOutputTokens', 'stopSequences',
  'responseModalities', 'responseMimeType', 'responseSchema', 'responseJsonSchema',
  'systemInstruction', 'safetySettings', 'tools', 'toolConfig', 'thinkingConfig',
  'imageConfig', 'mediaResolution', 'speechConfig', 'seed', 'presencePenalty', 'frequencyPenalty',
]);

// Vercel's serverless functions enforce a hard ~4.5 MB request body limit
// across all plans; `bodyParser.sizeLimit` is a Next.js-only knob and would
// be silently ignored here. Reference images therefore have to be downscaled
// + re-encoded as JPEG on the client (see `services/imageCompression.ts`)
// before they are bundled into a single request.
//
// `maxDuration` is set to 300 (the Pro-plan max) because brainstorm with
// several reference images can keep Gemini busy well past the default 60s.
// This call used to run directly from the browser with no Vercel timeout in
// the path, so we have to give the proxy enough room to match the previous
// behaviour without changing any of the brainstorm logic.
export const config = {
  maxDuration: 300,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = createTaskDeadline(15_000);
  const user = await requireUser(req, res, auth.signal).finally(() => auth.dispose());
  if (!user) return;
  if (!await requireSpendingAllowance(req, res)) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  let body: GeminiGenerateRequest;
  try {
    body =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as GeminiGenerateRequest)
        : (req.body as GeminiGenerateRequest);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { model, contents, config: genConfig } = body || ({} as GeminiGenerateRequest);
  if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: 'Unsupported Gemini model' });
  }
  if (contents === undefined || contents === null) {
    return res.status(400).json({ error: 'contents is required' });
  }
  if (genConfig != null && (typeof genConfig !== 'object' || Array.isArray(genConfig))) {
    return res.status(400).json({ error: 'Invalid generation config' });
  }
  const safeConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(genConfig || {})) {
    // The SDK accepts config.httpOptions.baseUrl and sends the API key to
    // that destination. Browser input must never control SDK transport.
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      return res.status(400).json({ error: `Unsupported generation config field: ${key}` });
    }
    safeConfig[key] = value;
  }

  const startedAt = Date.now();
  const provider = createTaskDeadline(250_000, undefined, 'Gemini yanıt süresi aşıldı. İstek otomatik olarak tekrarlanmadı. Yeniden deneyebilirsin.');
  // Negotiate the same status/result protocol as the text proxy. Heartbeats
  // prevent a long video read from becoming a silent, idle HTTP connection.
  // Existing clients continue to receive the original JSON response.
  const streaming = String(req.headers?.accept || req.headers?.Accept || '').includes('application/x-ndjson');
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let disconnected = false;
  const parts = (contents as any)?.parts || (Array.isArray(contents) ? contents.flatMap((item: any) => item?.parts || []) : []);
  const kind = Array.isArray(parts) && parts.some((part: any) => part?.fileData) ? 'video' : 'content';
  const requestedThinking = (safeConfig.thinkingConfig as any)?.thinkingLevel;
  const thinking = ['LOW', 'MEDIUM', 'HIGH'].includes(requestedThinking) ? requestedThinking : 'default';
  const send = (event: unknown) => {
    if (!disconnected && !res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  const close = () => {
    disconnected = true;
    clearInterval(heartbeat);
    provider.abort(new DOMException('Client disconnected', 'AbortError'));
  };
  res.on?.('close', close);
  try {
    if (streaming) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no');
      send({ type: 'status', stage: 'generating' });
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
    }
    console.info(`[gemini-generate] model=${model} kind=${kind} thinking=${thinking} stage=generating`);
    const ai = new GoogleGenAI({ apiKey });
    const response = await waitForTask(ai.models.generateContent({
      model, contents,
      config: { ...safeConfig, abortSignal: provider.signal, httpOptions: { timeout: 250_000 } },
    } as any), provider.signal);

    // Surfaced in `vercel logs` so we can see how long each Gemini call took
    // — handy when a brainstorm timeout strikes again.
    console.log(
      `[gemini-generate] model=${model} kind=${kind} thinking=${thinking} stage=completed ms=${Date.now() - startedAt} thoughts=${response.usageMetadata?.thoughtsTokenCount ?? 'unknown'} input=${response.usageMetadata?.promptTokenCount ?? 'unknown'}`,
    );

    // Hand back the bits the client actually consumes. Anything not listed here
    // stays on the server.
    const result = {
      text: response.text ?? null,
      candidates: response.candidates ?? null,
      usageMetadata: (response as any).usageMetadata ?? null,
      promptFeedback: (response as any).promptFeedback ?? null,
    };
    if (disconnected) return;
    if (streaming) {
      send({ type: 'status', stage: 'finishing' });
      send({ type: 'result', result });
      return res.end();
    }
    return res.status(200).json(result);
  } catch (error: any) {
    if (disconnected) {
      console.info(`[gemini-generate] model=${model} kind=${kind} stage=cancelled ms=${Date.now() - startedAt}`);
      return;
    }
    const message = String(error?.message || 'Gemini request failed').replaceAll(apiKey, '[redacted]');
    const status = error?.name === 'TimeoutError' ? 504 : typeof error?.status === 'number' ? error.status : 500;
    console.error(
      `Gemini proxy error: model=${model} kind=${kind} ms=${Date.now() - startedAt} msg=${message}`,
    );
    if (streaming) { send({ type: 'error', error: message }); return res.end(); }
    return res.status(status).json({ error: message });
  } finally { provider.dispose(); clearInterval(heartbeat); res.off?.('close', close); }
}
