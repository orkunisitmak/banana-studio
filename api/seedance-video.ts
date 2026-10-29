import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser, createUserScopedClient } from './_lib/auth.js';
import { chooseProvider, providerKey } from './_lib/providerConfiguration.js';
import { seedanceProviderError, falSeedanceInput, openRouterSeedanceInput } from '../src/lib/video/seedanceProviders.js';
import { isReferenceUrl } from './_lib/providerMedia.js';
import { prepareTaskRegistry, registerProviderTask, requireProviderTask } from './_lib/providerTasks.js';
import evolinkGenerate from './evolink-generate.js';
import { signedMediaUrl } from './_lib/imageStorage.js';

export const config = { maxDuration: 300 };
const HANDLE = /^bs_(fal|openrouter)_(seedance-2\.[05])_([a-zA-Z0-9_-]{1,128})$/;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET','POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req,res); if (!user) return;
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      let provider;
      try { provider = chooseProvider(body?.videoModel, body?.provider); }
      catch (error) { return res.status(400).json({ error:(error as Error).message }); }
      const error = seedanceProviderError(provider, body);
      if (error) return res.status(400).json({ error });
      if (provider === 'evolink') return evolinkGenerate(req,res);
      if (provider !== 'fal' && provider !== 'openrouter') return res.status(400).json({ error: 'Unsupported video provider.' });
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 20000) return res.status(400).json({ error: 'Enter a prompt up to 20,000 characters.' });
      for (const field of ['imageUrls','videoUrls','audioUrls']) {
        if (body[field] != null && (!Array.isArray(body[field]) || body[field].some((url: unknown) => !isReferenceUrl(url) && !(provider === 'openrouter' && typeof url === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(url))))) return res.status(400).json({ error: 'Invalid reference media.' });
      }
      const registry = await prepareTaskRegistry(res); if (!registry) return;
      const fal = falSeedanceInput(body);
      const response = await fetch(provider === 'fal' ? `https://queue.fal.run/${fal.endpoint}` : 'https://openrouter.ai/api/v1/videos', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55_000), headers: { Authorization: `${provider === 'fal' ? 'Key' : 'Bearer'} ${providerKey(provider)}`, 'Content-Type':'application/json' },
        body: JSON.stringify(provider === 'fal' ? fal.input : openRouterSeedanceInput(body)),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) return res.status(response.status).json({ error: `${provider === 'fal' ? 'fal.ai' : 'OpenRouter'} rejected the video request (${response.status}). Check the prompt, media and account credit.` });
      const id = provider === 'fal' ? data?.request_id : data?.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('The provider did not confirm a task ID.');
      const taskId = `bs_${provider}_${body.videoModel}_${id}`;
      await registerProviderTask(registry, provider, taskId, user.id);
      return res.status(200).json({ taskId, provider, endpoint: provider === 'fal' ? fal.endpoint : `openrouter/bytedance/${body.videoModel}` });
    }
    const taskId = req.query.taskId as string;
    const match = typeof taskId === 'string' && taskId.match(HANDLE);
    if (!match) return res.status(400).json({ error: 'Invalid video task.' });
    const [,provider,model,id] = match;
    if (!await requireProviderTask(req,res,provider as 'fal' | 'openrouter',taskId)) return;
    const key = process.env[provider === 'fal' ? 'FAL_KEY' : 'OPENROUTER_API_KEY'];
    if (!key) return res.status(503).json({ error: 'Restore the original provider key to recover this video.', retryable: true });
    const headers = { Authorization: `${provider === 'fal' ? 'Key' : 'Bearer'} ${key}` };
    const base = provider === 'fal' ? `https://queue.fal.run/bytedance/${model}/requests/${encodeURIComponent(id)}` : `https://openrouter.ai/api/v1/videos/${encodeURIComponent(id)}`;
    const response = await fetch(provider === 'fal' ? `${base}/status` : base, { headers, redirect: 'error', signal: AbortSignal.timeout(45_000), cache:'no-store' });
    let data = await response.json().catch(() => null);
    if (!response.ok) return res.status(response.status).json({ error: 'Video status is temporarily unavailable.', retryable: true });
    if (['FAILED','failed','cancelled','expired'].includes(data?.status)) return res.status(200).json({ status: 'FAILED', error: 'The provider could not generate this video. Check its task history.' });
    if (data?.status !== 'COMPLETED' && data?.status !== 'completed') return res.status(200).json({ status:'RUNNING', progress: data?.status === 'IN_QUEUE' || data?.status === 'pending' ? .05 : .5 });
    if (provider === 'fal') {
      const result = await fetch(base, { headers, redirect:'error', signal:AbortSignal.timeout(45_000) });
      if ([400,422].includes(result.status)) return res.status(200).json({ status:'FAILED', error:'fal.ai could not generate this video. Check its task history for the model rejection.' });
      if (!result.ok) return res.status(503).json({ error:'The completed video is not available yet.', retryable:true });
      data = await result.json();
      if (data?.error || data?.detail) return res.status(200).json({ status:'FAILED', error:'fal.ai returned a generation error. Check its task history.' });
      if (!isReferenceUrl(data?.video?.url)) throw new Error('Video output is not available.');
      return res.status(200).json({ status:'SUCCEEDED', output:[data.video.url] });
    }
    const actualCostUsd = typeof data?.usage?.cost === 'number' && Number.isFinite(data.usage.cost) && data.usage.cost >= 0 ? data.usage.cost : undefined;
    const signed = Array.isArray(data.urls) ? data.urls.filter(isReferenceUrl) : [];
    if (signed.length) return res.status(200).json({ status:'SUCCEEDED', output:signed, actualCostUsd });
    // OpenRouter's unsigned content endpoint needs our key. Copy to the user's
    // storage instead of exposing credentials or an unusable download URL.
    const db = createUserScopedClient(req), bucket = db.storage.from('media'), path = `${user.id}/openrouter-video/${id}.mp4`;
    const existing = await bucket.createSignedUrl(path,3600);
    if (!existing.error && existing.data?.signedUrl) return res.status(200).json({ status:'SUCCEEDED', output:[existing.data.signedUrl], actualCostUsd });
    const content = await fetch(`${base}/content?index=0`, { headers, redirect:'error', signal:AbortSignal.timeout(120_000) });
    if (!content.ok || Number(content.headers.get('content-length')) > 256*1024*1024) throw new Error('The generated video could not be downloaded.');
    const bytes = Buffer.from(await content.arrayBuffer());
    if (bytes.length > 256*1024*1024) throw new Error('The generated video exceeds the download limit.');
    const saved = await bucket.upload(path,bytes,{contentType:'video/mp4',upsert:true});
    if (saved.error) throw new Error('The generated video could not be saved.');
    return res.status(200).json({ status:'SUCCEEDED', output:[await signedMediaUrl(bucket,path)], actualCostUsd });
  } catch {
    return res.status(502).json({ error: req.method === 'POST' ? 'The video request could not be confirmed. Check provider task history before submitting again; it was not retried.' : 'The video result is temporarily unavailable. The original task is retained.', retryable:req.method === 'GET' });
  }
}
