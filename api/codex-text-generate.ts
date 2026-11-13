import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth.js';
import { CodexTextInputError, requestCodexText, validateCodexTextRequest } from './_lib/codexText.js';

/** No hosted access: desktop packaging replaces requireUser with native-session authentication. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.BANANA_RUNTIME !== 'local') return res.status(404).json({ error: 'ChatGPT plan text generation is desktop-only.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireUser(req, res)) return;
  let body: unknown;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    validateCodexTextRequest(body);
  } catch (error) { return res.status(400).json({ error: error instanceof CodexTextInputError ? error.message : 'Invalid JSON body.' }); }
  const controller = new AbortController();
  const streaming = String(req.headers.accept || '').includes('application/x-ndjson');
  const send = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
  const close = () => controller.abort();
  res.on('close', close);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    if (streaming) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      send({ type: 'status', stage: 'generating' });
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
    }
    const result = await requestCodexText(body, controller.signal);
    if (controller.signal.aborted) return;
    if (streaming) { send({ type: 'result', result }); return res.end(); }
    return res.status(200).json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    const message = error instanceof Error ? error.message : 'Codex text generation failed. No API fallback was attempted.';
    if (streaming) { send({ type: 'error', error: message }); return res.end(); }
    return res.status(502).json({ error: message });
  } finally { clearInterval(heartbeat); res.off('close', close); }
}
