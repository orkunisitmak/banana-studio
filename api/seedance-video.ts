import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser, createUserScopedClient } from './_lib/auth.js';
import { admitProvider, providerKey } from './_lib/providerConfiguration.js';
import { seedanceProviderError, openRouterSeedanceInput } from '../src/lib/video/seedanceProviders.js';
import { buildFalSeedanceInput } from '../src/lib/video/falSeedance25.js';
import { exceedsCharacterLimit } from '../src/lib/video/providerTextLimits.js';
import { claimVideo, rejectVideoClaim } from './_lib/videoClaim.js';
import { recordSeedanceUsage, seedanceActualCost } from './_lib/seedanceUsage.js';
import { persistFalFailure } from './_lib/videoTerminal.js';
import { isReferenceUrl } from './_lib/providerMedia.js';
import { startPaidRequest, type PaidRequest } from './_lib/openaiGuard.js';
import { isGenerationId, prepareTaskRegistry, registerProviderTask, requireProviderTask, requireSavedVideo, saveGenerationTask } from './_lib/providerTasks.js';
import evolinkGenerate from './evolink-generate.js';
import { signedMediaUrl } from './_lib/imageStorage.js';

export const config = { maxDuration: 300 };
const HANDLE = /^bs_(fal|openrouter)_(seedance-2\.[05])_([a-zA-Z0-9_-]{1,128})$/;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET','POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req,res); if (!user) return;
  let acceptedTaskId = false;
  let guard: PaidRequest = null;
  try {
    if (req.method === 'POST') {
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { return res.status(400).json({error:'Expected a JSON video generation request.'}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({error:'Expected a video generation request.'});
      if (body.mode === 'text_to_video') body = { ...body, mode:'text_only' };
      const provider = await admitProvider(req, res, body?.videoModel, body?.provider);
      if (!provider) return;
      const error = provider === 'fal' ? undefined : seedanceProviderError(provider, body);
      if (error) return res.status(400).json({ error });
      if (body?.generationId !== undefined && !isGenerationId(body.generationId)) return res.status(400).json({ error: 'A valid generation ID is required.' });
      if (provider === 'evolink') { req.body = body; return evolinkGenerate(req,res); }
      if (provider !== 'fal' && provider !== 'openrouter') return res.status(400).json({ error: 'Unsupported video provider.' });
      if ((provider !== 'fal' && (typeof body.prompt !== 'string' || !body.prompt.trim())) || (body.prompt != null && (typeof body.prompt !== 'string' || exceedsCharacterLimit(body.prompt,20000)))) return res.status(400).json({ error: 'Enter a supported prompt up to 20,000 characters.' });
      for (const field of ['imageUrls','videoUrls','audioUrls']) {
        if (body[field] != null && (!Array.isArray(body[field]) || body[field].some((url: unknown) => !isReferenceUrl(url) && !(provider === 'openrouter' && typeof url === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(url))))) return res.status(400).json({ error: 'Invalid reference media.' });
      }
      let endpoint: string, input: Record<string, unknown>;
      try {
        if (provider === 'fal') ({ endpoint, input } = buildFalSeedanceInput(body, user.id));
        else { endpoint = 'openrouter/bytedance/' + body.videoModel; input = openRouterSeedanceInput(body); }
      } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
      const registry = await prepareTaskRegistry(res); if (!registry) return;
      if (body.generationId && !await requireSavedVideo(registry, res, body.generationId, user.id)) return;
      guard = await startPaidRequest(req, res, user, 'image', provider === 'fal' ? 'fal.ai' : 'OpenRouter');
      if (!guard) return;
      if (body.generationId && !await claimVideo(registry, res, body.generationId, user.id, { generationProvider: provider, videoModel: body.videoModel, providerModel: endpoint, falEndpoint: endpoint })) {
        await guard.finish('rejected');
        return;
      }
      const response = await fetch(provider === 'fal' ? `https://queue.fal.run/${endpoint}` : 'https://openrouter.ai/api/v1/videos', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55_000), headers: { Authorization: `${provider === 'fal' ? 'Key' : 'Bearer'} ${providerKey(provider)}`, 'Content-Type':'application/json' },
        body: JSON.stringify(input),
      });
      await guard.finish(response.ok ? 'completed' : 'failed', null, response.status);
      if (!response.ok) await rejectVideoClaim(registry, body.generationId, user.id, response.status);
      const data = await response.json().catch(() => null);
      if (response.status === 408 || response.status >= 500) return res.status(response.status).json({code:'SUBMISSION_UNKNOWN', error:'Video acceptance could not be confirmed. Check the original provider task history before submitting again.'});
      if (!response.ok) return res.status(response.status).json({ error: `${provider === 'fal' ? 'fal.ai' : 'OpenRouter'} rejected the video request (${response.status}). Check the prompt, media and account credit.` });
      const id = provider === 'fal' ? data?.request_id : data?.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('The provider did not confirm a task ID.');
      const taskId = `bs_${provider}_${body.videoModel}_${id}`;
      acceptedTaskId = true;
      await registerProviderTask(registry, provider, taskId, user.id);
      if (provider === 'fal') await recordSeedanceUsage(registry, user.id, taskId, body.videoModel, body.mode, body.prompt || '');
      if (body.generationId && !await saveGenerationTask(registry, body.generationId, user.id, taskId)) {
        return res.status(503).json({ error: `Generation was submitted, but its saved video could not be updated (Task: ${taskId}). Do not submit again; check task history or contact an administrator.`, taskId, provider, endpoint });
      }
      return res.status(200).json({ taskId, provider, endpoint });
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
    if (!response.ok) {
      const after = response.headers?.get('retry-after');
      if (response.status === 429 && after && /^\d+$/.test(after)) res.setHeader('Retry-After', after);
      return res.status(response.status).json({ error: 'Video status is temporarily unavailable.', retryable: true });
    }
    const fail = async (status: 'CANCELLED' | 'FAILED', error: string) => {
      const actualCostUsd = provider === 'fal' ? await seedanceActualCost(user.id, taskId, id, key) : undefined;
      if (provider === 'fal') await persistFalFailure(prepareTaskRegistry, user.id, taskId, status, error, actualCostUsd);
      return res.status(200).json({status,error,actualCostUsd});
    };
    if (['error','failed','canceled','cancelled','expired'].includes(String(data?.status).toLowerCase()))
      return fail(/^cancel/i.test(data.status) ? 'CANCELLED' : 'FAILED', 'The provider could not generate this video. Check its task history.');
    const state = String(data?.status || '').toLowerCase();
    if (['in_queue','queued','pending','in_progress','processing','running'].includes(state)) return res.status(200).json({status:'RUNNING',progress:['in_queue','queued','pending'].includes(state) ? .05 : .5});
    if (state !== 'completed') return res.status(503).json({error:'The provider returned an unknown video status.',retryable:true});
    if (provider === 'fal') {
      // fal reports a failed request as COMPLETED with `error`. Its result
      // route repeats the model's error status (often 5xx), which would be
      // retried as "not available yet" for the whole recovery window.
      if (data?.error || data?.error_type) {
        const reason = typeof data.error === 'string' && data.error.trim() ? `: ${data.error.trim().slice(0, 500)}` : '. Check its task history.';
        return fail(data.error_type === 'client_cancelled' ? 'CANCELLED' : 'FAILED', `fal.ai could not generate this video${reason}`);
      }
      const result = await fetch(base, { headers, redirect:'error', signal:AbortSignal.timeout(45_000) });
      if ([400,422].includes(result.status)) return fail('FAILED','fal.ai could not generate this video. Check its task history for the model rejection.');
      if (!result.ok) return res.status(503).json({ error:'The completed video is not available yet.', retryable:true });
      data = await result.json();
      if (data?.error || data?.detail) return fail('FAILED','fal.ai returned a generation error. Check its task history.');
      data = data?.video ? data : data?.data;
      if (!isReferenceUrl(data?.video?.url)) throw new Error('Video output is not available.');
      return res.status(200).json({ status:'SUCCEEDED', output:[data.video.url], actualCostUsd: await seedanceActualCost(user.id, taskId, id, key),
        ...(Number.isSafeInteger(data.seed) ? { seed: data.seed } : {}), ...(typeof data.draft_id === 'string' ? { draftId: data.draft_id } : {}),
        ...(isReferenceUrl(data.last_frame?.url) ? { lastFrameUrl: data.last_frame.url } : {}), duration: data.duration });
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
  } catch (error) {
    await guard?.finish('failed');
    // The provider already accepted the job: keep the registry message, which carries the task id and warns against retrying.
    if (acceptedTaskId) return res.status(502).json({ error: (error as Error).message, retryable:false });
    return res.status(502).json({ error: req.method === 'POST' ? 'The video request could not be confirmed. Check provider task history before submitting again; it was not retried.' : 'The video result is temporarily unavailable. The original task is retained.', retryable:req.method === 'GET' });
  }
}
