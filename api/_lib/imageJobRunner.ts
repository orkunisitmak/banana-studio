import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeOpenAIImage } from '../openai-image-generate.js';
import { refreshImageJobReferences } from './imageJobPayload.js';
import { readStoredImage } from './imageStorage.js';
import { MediaAccessError } from '../../src/lib/references/mediaAccess.js';
import type { ImageJobMessage } from './imageJobQueue.js';

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

/** Storage/database reconciliation only. Never call the provider after the
 * durable dispatch marker, even if a worker died before returning its result. */
const observeDispatchedJob = async (db:any,job:ImageJobMessage,claim:any) => {
  const {data:row,error} = await db.from('generations').select('status,metadata,storage_path').eq('id',job.id).eq('user_id',job.userId).maybeSingle();
  if (error) throw new Error('Saved image state is unavailable.');
  const finish = (success:boolean,metadata?:any,path?:string,error?:string) => rpc(db,'finish_image_job',{
    p_id:job.id,p_claim:claim.claim,p_success:success,p_metadata:metadata||null,p_storage_path:path||null,p_error:error||null,
  });
  if (row?.status==='completed') {
    await finish(true,row.metadata,row.storage_path);
    if (claim.audit) await finishAudit(db,claim.audit).finish('completed',row.metadata?.openaiRequestId,200);
    return;
  }
  const elapsed=Date.now()-new Date(claim.dispatchedAt).getTime();
  if (elapsed<330_000) throw new ImageJobWait(Math.max(1,Math.ceil((330_000-elapsed)/1000)));
  const storage=db.storage.from('media');
  for (const extension of ['png','jpg','webp']) {
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
