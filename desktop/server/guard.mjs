import { randomUUID } from 'node:crypto';
import { getWorkspace, LOCAL_AUTH } from './context.mjs';
export { openAIErrorMessage } from '../../api/_lib/openaiError.ts';
export const getOpenAISessionId = req => req[LOCAL_AUTH] ? getWorkspace().identity.sessionId : null;
export const startPaidRequest=(req,res,user,kind,_provider,generationId)=>startOpenAIRequest(req,res,user,kind,generationId);
export async function startOpenAIRequest(req,res,user,kind,generationId) {
  if(!req[LOCAL_AUTH]){res.status(401).json({error:'Native session required.'});return null;}
  const id=randomUUID(),store=getWorkspace();
  const result=store.workerRpc('start_openai_request',{p_id:id,p_generation_id:generationId,p_kind:kind});
  if(!result.allowed){res.status(409).json({code:'GENERATION_EXISTS',error:'This generation already has a saved request. Recover it instead of generating again.'});return null;}
  let finished=false;return {id,async finish(outcome,providerRequestId,providerStatus){if(finished)return;store.workerRpc('finish_openai_request',{p_id:id,p_outcome:outcome,p_provider_request_id:providerRequestId,p_provider_status:providerStatus});finished=true;}};
}
