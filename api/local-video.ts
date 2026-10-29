import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser, createUserScopedClient } from './_lib/auth.js';
import { chooseProvider } from './_lib/providerConfiguration.js';
import { isReferenceUrl, providerImageData } from './_lib/providerMedia.js';
import { prepareTaskRegistry, registerProviderTask, requireProviderTask } from './_lib/providerTasks.js';
import { signedMediaUrl } from './_lib/imageStorage.js';
import { comfyDownload, comfyStatus, comfySubmit } from './_lib/localMedia.js';
import { LOCAL_VIDEO_MODEL, isLocalAssetName, isWorkflowName, localVideoSize } from '../src/lib/localModels.js';

export const config = { maxDuration: 300 };
const HANDLE = /^bs_comfyui_local-video_([a-zA-Z0-9-]{1,64})$/;

/** POST queues a ComfyUI video workflow; GET polls it and saves the finished file to workspace storage. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res); if (!user) return;
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (body?.videoModel !== LOCAL_VIDEO_MODEL) return res.status(400).json({ error: 'Unsupported video model.' });
      try { chooseProvider(LOCAL_VIDEO_MODEL, body.provider); } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 20000) return res.status(400).json({ error: 'Enter a prompt up to 20,000 characters.' });
      if (!isWorkflowName(body.localWorkflow)) return res.status(400).json({ error: 'Choose a ComfyUI video workflow in AI settings → Local models.' });
      if (body.localModel != null && !isLocalAssetName(body.localModel)) return res.status(400).json({ error: 'Invalid local model.' });
      if (body.localNegativePrompt != null && (typeof body.localNegativePrompt !== 'string' || body.localNegativePrompt.length > 2000)) return res.status(400).json({ error: 'The negative prompt can have up to 2,000 characters.' });
      const duration = Number(body.duration);
      if (!Number.isFinite(duration) || duration < 1 || duration > 30) return res.status(400).json({ error: 'Choose a duration between 1 and 30 seconds.' });
      if (body.imageUrls != null && (!Array.isArray(body.imageUrls) || body.imageUrls.length > 1 || body.imageUrls.some((url: unknown) => !isReferenceUrl(url)))) {
        return res.status(400).json({ error: 'Local video accepts one reference image.' });
      }
      const registry = await prepareTaskRegistry(res); if (!registry) return;
      let image: Buffer | undefined, imageMime: string | undefined;
      if (body.imageUrls?.[0]) {
        const match = (await providerImageData(createUserScopedClient(req), body.imageUrls[0])).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
        if (!match) return res.status(400).json({ error: 'The reference image could not be prepared.' });
        image = Buffer.from(match[2], 'base64'); imageMime = match[1];
      }
      const id = await comfySubmit({ prompt: body.prompt, ...localVideoSize(String(body.aspectRatio), String(body.quality)), duration,
        workflow: body.localWorkflow, checkpoint: body.localModel, negative: body.localNegativePrompt || undefined, image, imageMime }, 'video', AbortSignal.timeout(55_000));
      const taskId = `bs_comfyui_local-video_${id}`;
      await registerProviderTask(registry, 'comfyui', taskId, user.id);
      return res.status(200).json({ taskId, provider: 'comfyui', endpoint: `comfyui/${body.localWorkflow}` });
    }
    const taskId = req.query.taskId as string;
    const match = typeof taskId === 'string' && taskId.match(HANDLE);
    if (!match) return res.status(400).json({ error: 'Invalid video task.' });
    if (!await requireProviderTask(req, res, 'comfyui', taskId)) return;
    const bucket = createUserScopedClient(req).storage.from('media');
    const result = await comfyStatus(match[1], 'video', AbortSignal.timeout(15_000));
    if (result.status === 'failed') return res.status(200).json({ status: 'FAILED', error: result.error });
    if (result.status === 'running') return res.status(200).json({ status: 'RUNNING', progress: 0.5 });
    const ext = (result.file!.filename.match(/\.(\w+)$/)?.[1] || 'mp4').toLowerCase();
    const path = `${user.id}/local-video/${match[1]}.${ext}`;
    const existing = await bucket.createSignedUrl(path, 3600);
    if (!existing.error && existing.data?.signedUrl) return res.status(200).json({ status: 'SUCCEEDED', output: [existing.data.signedUrl], actualCostUsd: 0 });
    const file = await comfyDownload(result.file!, 512 * 1024 * 1024, AbortSignal.timeout(120_000));
    const saved = await bucket.upload(path, file.bytes, { contentType: file.mime, upsert: true });
    if (saved.error) throw new Error('The generated video could not be saved.');
    return res.status(200).json({ status: 'SUCCEEDED', output: [await signedMediaUrl(bucket, path)], actualCostUsd: 0 });
  } catch (error) {
    const message = error instanceof Error && /ComfyUI|workflow|checkpoint|reference/i.test(error.message) ? error.message : null;
    return res.status(502).json({ error: message || (req.method === 'POST' ? 'ComfyUI could not be reached. Check that it is running.' : 'The local video result is temporarily unavailable.'), retryable: req.method === 'GET' });
  }
}
