import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeOpenAIImage } from '../openai-image-generate.js';
import { refreshImageJobReferences } from './imageJobPayload.js';
import { readStoredImage } from './imageStorage.js';
import { MediaAccessError } from '../../src/lib/references/mediaAccess.js';
import type { ImageJobMessage } from './imageJobQueue.js';
import { buildSeedreamRequest, isSeedreamEndpoint, SEEDREAM_MODEL } from '../../src/lib/images/seedream55.js';
import { normalizeReferencePrompt } from '../../src/lib/references/personReferences.js';
import { registerProviderTask, saveGenerationTask } from './providerTasks.js';
import { providerImageUrl } from './providerMedia.js';
import { readFalImageStatus } from './falImageStatus.js';

export class ImageJobWait extends Error {
  constructor(readonly afterSeconds:number) { super('Image job is waiting for capacity'); }
}
const rpc = async (db:any,name:string,args:Record<string,unknown>) => {
  const {data,error} = await db.rpc(name,args);
  if (error) throw new Error(`Image job ${name} could not be confirmed.`);
  return data;
};
const finishAudit = (db:any,id:string) => {
  let finished=false;
  return { id, async finish(outcome:'completed'|'failed'|'rejected',requestId?:string|null,status?:number) {
    if (finished) return;
    const safe = requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)?requestId:null;
    await rpc(db,'finish_openai_request',{p_id:id,p_outcome:outcome,p_provider_request_id:safe,p_provider_status:status||null});
    finished=true;
  } };
};

/** After dispatch, only query existing task state or inspect storage. Never send another generation request. */
const observeDispatchedJob = async (db:any,job:ImageJobMessage,claim:any) => {
  const {data:row,error} = await db.from('generations').select('status,metadata,storage_path,image_model,task_id').eq('id',job.id).eq('user_id',job.userId).maybeSingle();
  if (error) throw new Error('Saved image state is unavailable.');
  const finish = (success:boolean,metadata?:any,path?:string,error?:string) => rpc(db,'finish_image_job',{
    p_id:job.id,p_claim:claim.claim,p_success:success,p_metadata:metadata||null,p_storage_path:path||null,p_error:error||null,
  });
  if (row?.status==='completed') {
    if (claim.audit) await finishAudit(db,claim.audit).finish('completed',row.task_id || row.metadata?.openaiRequestId,200);
    await finish(true,row.metadata,row.storage_path);
    return;
  }
  if (row?.image_model === SEEDREAM_MODEL && row.task_id && isSeedreamEndpoint(row.metadata?.falEndpoint)) {
    // A gallery row is editable. Never use the service key to read a task
    // merely because a client copied its ID into that row.
    const {data:registered,error:lookup} = await db.from('provider_tasks').select('user_id').eq('provider','fal').eq('task_id',row.task_id).maybeSingle();
    if (lookup) throw new ImageJobWait(10);
    if (!registered || registered.user_id !== job.userId) {
      await finish(false,undefined,undefined,'The saved Seedream task could not be authorized. No new request was sent.');
      if (claim.audit) await finishAudit(db,claim.audit).finish('failed');
      return;
    }
    const {http,body} = await readFalImageStatus(row.metadata.falEndpoint,row.task_id,process.env.FAL_KEY,job.userId,db);
    if (http !== 200 || body.status === 'RUNNING') throw new ImageJobWait(http !== 200 ? 30 : 5);
    const success = body.status === 'SUCCEEDED';
    if (claim.audit) await finishAudit(db,claim.audit).finish(success ? 'completed' : 'failed',row.task_id,http);
    // The completed manifest, including storage_path, is already in the row.
    await finish(success,undefined,undefined,body.error);
    return;
  }
  const elapsed=Date.now()-new Date(claim.dispatchedAt).getTime();
  if (elapsed<330_000) throw new ImageJobWait(Math.max(1,Math.ceil((330_000-elapsed)/1000)));
  const storage=db.storage.from('media');
  for (const extension of ['png','jpg','webp','svg','gif']) {
    const path=`openai/${job.userId}/${job.id}.${extension}`;
    const file=await readStoredImage(storage,path,row?.metadata?.imageOutputSha256,true);
    if (file) {
      await finish(true,{...row?.metadata,imageOutputSize:file.size,imageOutputBytes:file.bytes,imageStoragePath:path,storageRecoveredAt:Date.now()},path);
      if (claim.audit) await finishAudit(db,claim.audit).finish('completed',row?.metadata?.openaiRequestId,200);
      return;
    }
  }
  await finish(false,row?.metadata,undefined,row?.metadata?.error||'The image worker was interrupted. The saved job was retained and generation was not repeated. Check usage before creating another image.');
  if (claim.audit) await finishAudit(db,claim.audit).finish('failed',row?.metadata?.openaiRequestId);
};

export const runImageJob = async (db:any,job:ImageJobMessage) => {
  if (!job || !/^[a-zA-Z0-9_-]{1,128}$/.test(job.id) || !/^[0-9a-f-]{36}$/i.test(job.userId)) return;
  if ((process.env.VERCEL_ENV && process.env.VERCEL_ENV!=='production')) throw new ImageJobWait(60);
  const token=randomUUID();
  const claim=await rpc(db,'claim_image_job',{p_id:job.id,p_user_id:job.userId,p_claim:token});
  if (claim?.action==='stop') return;
  if (claim?.action==='wait') throw new ImageJobWait(Number(claim.retryAfter)||60);
  if (claim?.action==='observe') return observeDispatchedJob(db,job,claim);
  if (claim?.action!=='prepare' || !claim.audit || !claim.payload) throw new Error('Invalid saved image claim.');
  const guard=finishAudit(db,claim.audit);
  let dispatched=false;
  let rateLimitDelay=0;
  let status=500,result:any;
  const response={setHeader(){},status(value:number){status=value;return this;},json(value:unknown){result=value;return this;},end(){}} as unknown as VercelResponse;
  try {
    let references;
    try { references=await refreshImageJobReferences(db,claim.payload); }
    catch (error) {
      // A removed reference never becomes available again; end the job instead
      // of re-admitting it on every redelivery.
      if (!(error instanceof MediaAccessError) || error.temporary) throw error;
      // Keep redelivery possible until the admission audit is finalized.
      await guard.finish('rejected');
      await rpc(db,'finish_image_job',{p_id:job.id,p_claim:token,p_success:false,p_metadata:null,p_storage_path:null,
        p_error:'A reference is unavailable or was removed. Attach that image again. No generation was submitted.'});
      return;
    }
    if (claim.payload.model === SEEDREAM_MODEL) {
      if (claim.payload.provider !== 'fal' || !process.env.FAL_KEY?.trim() || process.env.FAL_ENABLED === 'false') {
        await guard.finish('rejected');
        await rpc(db,'finish_image_job',{p_id:job.id,p_claim:token,p_success:false,p_storage_path:null,p_metadata:null,p_error:'The saved Seedream provider is unavailable. No generation was submitted.'});
        return;
      }
      const {error:tracking} = await db.from('provider_tasks').select('task_id').limit(0);
      if (tracking) throw new Error('Private task tracking is unavailable.');
      const urls = await Promise.all(references.map(ref => providerImageUrl(db,ref.data)));
      const prompt = claim.payload.seedreamOptions?.mode === 'edit' ? normalizeReferencePrompt(claim.payload.prompt,references) : claim.payload.prompt;
      const {endpoint,input} = buildSeedreamRequest(claim.payload.seedreamOptions,prompt,urls);
      const metadata = {generationProvider:'fal',providerModel:endpoint,falEndpoint:endpoint,seedreamOptions:claim.payload.seedreamOptions, imageOperation:claim.payload.imageOperation,imageGenerationReferenceIds:references.map(ref=>ref.id),imageGenerationPrompt:prompt,generationStartedAt:Date.now()};
      dispatched = await rpc(db,'dispatch_image_job',{p_id:job.id,p_claim:token,p_metadata:metadata}) === true;
      if (!dispatched) throw new ImageJobWait(5);
      const response = await fetch('https://queue.fal.run/' + endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Key ' + process.env.FAL_KEY,'Content-Type':'application/json','X-Fal-No-Retry':'1'},body:JSON.stringify(input),signal:AbortSignal.timeout(45_000)});
      const accepted = await response.json().catch(()=>null);
      if (!response.ok || typeof accepted?.request_id !== 'string' || !accepted.request_id || accepted.request_id.length > 200) {
        await guard.finish('failed',null,response.status);
        await rpc(db,'finish_image_job',{p_id:job.id,p_claim:token,p_success:false,p_metadata:null,p_storage_path:null,p_error:'Could not confirm the Seedream submission. Check provider usage before generating again.'});
        return;
      }
      const task = accepted.request_id;
      try { await registerProviderTask(db,'fal',task,job.userId); }
      catch (error) {
        // Keep the handle for support, but do not poll an unregistered task.
        await guard.finish('failed',task,response.status);
        await rpc(db,'finish_image_job',{p_id:job.id,p_claim:token,p_success:false,p_storage_path:null,p_metadata:{falRequestId:task},p_error:'The accepted Seedream task could not be registered (' + task + '). No new request was sent.'});
        throw error;
      }
      // Repeating only the idempotent binding handles an ambiguous DB reply.
      const bind = () => saveGenerationTask(db,job.id,job.userId,task).catch(()=>false);
      if (!await bind() && !await bind()) {
        await guard.finish('failed',task,response.status);
        await rpc(db,'finish_image_job',{p_id:job.id,p_claim:token,p_success:false,p_storage_path:null,p_metadata:{falRequestId:task},p_error:'Could not save the registered Seedream task (' + task + '). Contact an administrator before retrying.'});
        return;
      }
      return observeDispatchedJob(db,job,{claim:token,audit:claim.audit,dispatchedAt:Date.now()});
    }
    await executeOpenAIImage({method:'POST',headers:{},body:{...claim.payload,referenceImages:references}} as VercelRequest,response,{
      user:{id:job.userId},db,guard,
      dispatch:async metadata => {
        const allowed=await rpc(db,'dispatch_image_job',{p_id:job.id,p_claim:token,p_metadata:metadata});
        dispatched=allowed===true;
        return dispatched;
      },
      deferRateLimit:async (seconds,requestId,reason) => {
        const safeRequestId=requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)?requestId:null;
        const deferred=await rpc(db,'defer_refused_image_job',{p_id:job.id,p_claim:token,p_retry_after:seconds,p_request_id:safeRequestId,p_wait_reason:reason});
        if (deferred===true) rateLimitDelay=seconds;
        return deferred===true;
      },
    });
    if (rateLimitDelay || result?.code==='IMAGE_PROVIDER_RATE_STATE_UNKNOWN') throw new ImageJobWait(rateLimitDelay || Number(result.retryAfter) || 60);
    // The lease ended before dispatch, so no provider request was sent. Leave
    // the job unfinished: claim_image_job reclaims it on redelivery and bounds
    // consecutive preparations that never reach dispatch.
    if (!dispatched && result?.code==='IMAGE_CLAIM_LOST') throw new ImageJobWait(5);
    // As above: an undispatched job stays redeliverable until its audit is final.
    if (!dispatched) await guard.finish('rejected');
    await rpc(db,'finish_image_job',{p_id:job.id,p_claim:token,p_success:status===200,
      p_metadata:result?.metadata||null,p_storage_path:result?.storagePath||null,p_error:status===200?null:result?.error||'Saved image generation failed.'});
  } catch (error) {
    // A redelivery can safely retry preparation if no dispatch was committed.
    // A committed dispatch is observed on redelivery and can never call again.
    if (!dispatched) await guard.finish('rejected').catch(()=>{});
    throw error;
  }
};
