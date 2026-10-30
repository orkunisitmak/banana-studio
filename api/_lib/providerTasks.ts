import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceRoleClient, createUserScopedClient } from './auth.js';

type Provider = 'fal' | 'evolink' | 'openrouter';
type RegistryWriter = NonNullable<ReturnType<typeof createServiceRoleClient>>;

/** Fail before charging a provider if durable, server-owned tracking is unavailable. */
export async function prepareTaskRegistry(res: VercelResponse): Promise<RegistryWriter | null> {
  const writer = createServiceRoleClient();
  if (!writer) {
    res.status(503).json({ error: 'Private task tracking is not configured. Contact an administrator.' });
    return null;
  }
  try {
    const { error } = await writer.from('provider_tasks').select('task_id,generation_id,task_metadata').limit(0);
    if (error) throw error;
    return writer;
  } catch {
    res.status(503).json({ error: 'Private task tracking is unavailable. No generation request was sent.' });
    return null;
  }
}

export type VideoTaskAssociation = { generationId?: string; metadata: Record<string, unknown> };
export type VideoGenerationClaim = { id?: string; metadata: Record<string, unknown> };

/** Return an accepted registry association without ever submitting it again. */
export async function recoverRegisteredVideoTask(writer: RegistryWriter, res: VercelResponse, generationId: string, userId: string): Promise<boolean> {
  const { data, error } = await writer.from('provider_tasks').select('task_id,provider,task_metadata')
    .eq('generation_id',generationId).eq('user_id',userId).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const metadata = data.task_metadata || {};
  res.status(200).json({ taskId:data.task_id,provider:data.provider,endpoint:metadata.falEndpoint,queueEndpoint:metadata.falQueueEndpoint });
  return true;
}

/** Claim a saved Seedance/EvoLink card before its one paid provider call. */
export async function claimVideoGeneration(writer: RegistryWriter, res: VercelResponse, generationId: unknown, userId: string, metadata: Record<string, unknown>): Promise<VideoGenerationClaim | null> {
  if (generationId === undefined) return { metadata }; // Legacy API clients.
  if (typeof generationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(generationId)) {
    res.status(400).json({ error:'A valid generation ID is required' });return null;
  }
  const { data:saved,error } = await writer.from('generations').select('id,user_id,type,status,task_id,metadata')
    .eq('id',generationId).eq('user_id',userId).maybeSingle();
  if (error) { res.status(503).json({error:'Saved generation access could not be verified. No provider request was sent.'});return null; }
  if (!saved || saved.user_id!==userId || saved.type!=='video') {res.status(404).json({error:'Saved video generation not found'});return null;}
  if (await recoverRegisteredVideoTask(writer,res,generationId,userId)) return null;
  const previous=saved.metadata && typeof saved.metadata==='object' && !Array.isArray(saved.metadata)?saved.metadata:{};
  if (saved.task_id || saved.status!=='pending' || previous.videoSubmissionStartedAt || previous.h3SubmissionStartedAt) {
    res.status(409).json({code:'GENERATION_SUBMITTING',error:'This video was already submitted or its acceptance is uncertain. Check its saved task history before submitting again.'});return null;
  }
  const next={...previous,...metadata,videoSubmissionStartedAt:Date.now()};
  const { data:claimed,error:claimError } = await writer.from('generations').update({status:'processing',metadata:next})
    .eq('id',generationId).eq('user_id',userId).eq('status','pending').is('task_id',null).select('id').maybeSingle();
  if (claimError) {res.status(503).json({error:'The saved video could not be claimed. No provider request was sent.'});return null;}
  if (!claimed) {res.status(409).json({code:'GENERATION_SUBMITTING',error:'This video is already being submitted. Check the existing task.'});return null;}
  return {id:generationId,metadata:next};
}

export async function registerProviderTask(writer: RegistryWriter, provider: Provider, taskId: string, userId: string, association?: VideoTaskAssociation): Promise<void> {
  const { error } = await writer.from('provider_tasks').insert({ provider, task_id: taskId, user_id: userId,
    ...(association?.generationId ? {generation_id:association.generationId,task_metadata:association.metadata}:{}),
  });
  if (error) {
    // Do not overwrite an existing association or automatically resubmit a
    // billable task. The ID lets an admin inspect the provider after a DB outage.
    throw new Error(`Generation was submitted but its private task could not be recorded (Task: ${taskId}). Contact an administrator before retrying.`);
  }
}

/** Registry acceptance is durable before this best-effort gallery acknowledgement. */
export async function persistAcceptedVideo(writer: RegistryWriter, userId: string, taskId: string, claim: VideoGenerationClaim, metadata: Record<string, unknown>): Promise<string | undefined> {
  if (!claim.id) return;
  try {
    const {data,error}=await writer.from('generations').update({task_id:taskId,status:'processing',metadata:{...claim.metadata,...metadata}})
      .eq('id',claim.id).eq('user_id',userId).eq('type','video').eq('status','processing').is('task_id',null).select('id').maybeSingle();
    if (!error && data) return;
  } catch { /* The registry retains the exact task for reload recovery. */ }
  return 'The provider accepted this video. Its private task is saved; the gallery acknowledgement will be recovered when the gallery reloads.';
}

/**
 * RLS grants SELECT only to the owner or an active administrator. The registry
 * has no client write grants; editable generation metadata is never proof of
 * ownership, because an attacker could copy a foreign task ID into their row.
 */
export async function requireProviderTaskOwner(req: VercelRequest, res: VercelResponse, provider: Provider, taskId: unknown): Promise<string | null> {
  if (typeof taskId !== 'string' || !taskId || taskId.length > 200) {
    res.status(400).json({ error: 'A valid task ID is required' });
    return null;
  }
  try {
    const { data, error } = await createUserScopedClient(req).from('provider_tasks')
      .select('task_id,user_id').eq('provider', provider).eq('task_id', taskId).maybeSingle();
    if (error) throw error;
    if (!data || typeof data.user_id !== 'string' || !data.user_id) {
      res.status(404).json({ error: 'Task not found' });
      return null;
    }
    return data.user_id;
  } catch {
    res.status(503).json({ error: 'Task access could not be verified. Try again shortly.' });
    return null;
  }
}

/** Preserve the boolean access-check contract for status routes that do not store output. */
export async function requireProviderTask(req: VercelRequest, res: VercelResponse, provider: Provider, taskId: unknown): Promise<boolean> {
  return (await requireProviderTaskOwner(req,res,provider,taskId)) !== null;
}
