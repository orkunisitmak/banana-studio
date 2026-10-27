import { randomUUID } from 'node:crypto';
import { getWorkspace, LOCAL_AUTH } from './context.mjs';
export { openAIErrorMessage } from '../../api/_lib/openaiError.ts';
export const getOpenAISessionId = req => req[LOCAL_AUTH] ? getWorkspace().identity.sessionId : null;
export async function startOpenAIRequest(req,res,user,kind,generationId) {
  if(!req[LOCAL_AUTH]){res.status(401).json({error:'Native session required.'});return null;}
  const id=randomUUID(),store=getWorkspace();
  const result=store.workerRpc('start_openai_request',{p_id:id,p_generation_id:generationId,p_kind:kind});
  if(!result.allowed){res.status(409).json({code:'GENERATION_EXISTS',error:'This generation already has a saved request. Recover it instead of generating again.'});return null;}
  let finished=false;return {id,async finish(outcome,providerRequestId,providerStatus){if(finished)return;store.workerRpc('finish_openai_request',{p_id:id,p_outcome:outcome,p_provider_request_id:providerRequestId,p_provider_status:providerStatus});finished=true;}};
}
// One local user spends their own keys: record each paid submission, no shared budget.
export async function startProviderRequest(req,res,user,kind) {
  if(!req[LOCAL_AUTH]){res.status(401).json({error:'Native session required.'});return null;}
  const id=randomUUID(),store=getWorkspace();store.workerRpc('start_openai_request',{p_id:id,p_kind:kind});
  // Recording runs after the provider answered: a store error is logged, never
  // allowed to replace that response or turn a sent request into a retry.
  let finished=false;const finish=async(outcome,providerRequestId,providerStatus)=>{if(finished)return;finished=true;
    try{store.workerRpc('finish_openai_request',{p_id:id,p_outcome:outcome,p_provider_request_id:providerRequestId,p_provider_status:providerStatus});}
    catch(error){console.warn(`[provider-request] id=${id} stage=ledger_unconfirmed ${error?.name||'Error'}`);}};
  return {id,finish,async track(request){try{const response=await request;await finish(response.ok?'completed':'failed',null,response.status);return response;}catch(error){await finish('failed');throw error;}}};
}
