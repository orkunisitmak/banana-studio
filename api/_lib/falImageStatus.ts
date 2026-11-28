import type { SupabaseClient } from '@supabase/supabase-js';
import { isSeedreamEndpoint, type SeedreamResult } from '../../src/lib/images/seedream55.js';
import { archiveSeedreamResult, readArchivedSeedreamResult, SeedreamArchiveRejected } from './seedreamResultStorage.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
/**
 * fal.ai returns 4xx errors as either a flat object or as a list of
 * pydantic-style {loc, msg, type, input} entries. The `input` field
 * echoes the entire request (prompt + every image_url) which is huge
 * and useless to surface in the UI — extract just the human-readable
 * message so the gallery's failure tile shows something compact.
 */
const extractFalErrorMessage = (raw: unknown, fallback = 'Image generation failed'): string => {
  if (!raw) return fallback;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const msgs = raw
      .map(entry => entry?.msg)
      .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0);
    if (msgs.length > 0) return msgs.join(' • ');
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.msg === 'string') return obj.msg;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (Array.isArray(obj.detail)) return extractFalErrorMessage(obj.detail, fallback);
  }
  return fallback;
};

// Bound the decoded response, not merely Content-Length: layer results may
// repeat inline image data in both the flattened and the structured lists.
const MAX_SEEDREAM_RESULT_BYTES = 160 * 1024 * 1024;
async function readCompletedSeedreamJson(response: Response): Promise<unknown> {
  const tooLarge = () => new SeedreamArchiveRejected('The completed Seedream result exceeds the archive size limit.');
  if (Number(response.headers.get('content-length')) > MAX_SEEDREAM_RESULT_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) throw new SeedreamArchiveRejected('The completed Seedream result was empty.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); // Interrupted transfers remain retryable.
      if (done) break;
      if ((size += value.byteLength) > MAX_SEEDREAM_RESULT_BYTES) throw tooLarge();
      parts.push(decoder.decode(value,{stream:true}));
    }
    parts.push(decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(parts.join('')); }
  catch { throw new SeedreamArchiveRejected('The completed Seedream result was not valid JSON.'); }
}


const seedreamSuccess = (result: SeedreamResult) => ({status:'SUCCEEDED',progress:1,output:result.images.map(image=>image.url),...result});

/** The caller must authorize the task owner and allowlist the endpoint before entering here. */
export async function readFalImageStatus(endpoint:string, requestId:string, apiKey:string | undefined, owner:string, db:SupabaseClient | null) {
  const report = (http:number, body:{status?:string;error?:string;requestId?:string;output?:string[];progress?:number;stage?:string;queuePosition?:number|null}) => ({http,body});
  const rejected = (message: string) => report(200,{status:'FAILED',requestId,progress:0,error:message + ' The accepted task ID was retained; no new generation was submitted.'});
  const seedreamDb = isSeedreamEndpoint(endpoint) ? db : null;
  if (seedreamDb) {
    const archived = await readArchivedSeedreamResult(seedreamDb,owner,requestId,endpoint);
    if (archived) return report(200,seedreamSuccess(archived));
  }
  if (!apiKey) return report(503,{error:'fal.ai is not configured.'});
  const queueBase = endpoint.split('/').slice(0,2).join('/');
  // Fetch status (light) first to know whether to grab the result
  const statusRes = await fetch(
    `${FAL_QUEUE_BASE}/${queueBase}/requests/${encodeURIComponent(requestId)}/status`,
    { headers: { Authorization: `Key ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) },
  );

  let statusData: Record<string,unknown> | null;
  // Read the body once: after json() fails, text() is always empty.
  const text = await statusRes.text().catch(() => '');
  try {
    statusData = JSON.parse(text);
  } catch {
    return report(statusRes.ok ? 502 : statusRes.status, { error: `fal.ai returned a non-JSON status response (${statusRes.status})` });
  }

  if (!statusRes.ok) {
    const msg = extractFalErrorMessage(
    statusData?.detail ?? statusData?.error ?? statusData?.message ?? statusData,
    `fal.ai status lookup failed (${statusRes.status})`,
    );
    // A status lookup can fail because of credentials, rate limits, or
    // ownership/expiry. None of those proves the generation itself failed.
    if (!seedreamDb && [400,404,422].includes(statusRes.status)) return report(200,{status:'FAILED',error:msg,progress:0});
    return report(statusRes.status, { error: msg });
  }

  const falStatus = statusData?.status;
  // fal status values observed: IN_QUEUE | IN_PROGRESS | COMPLETED | ERROR
  if (falStatus === 'COMPLETED') {
    if (statusData?.error || statusData?.error_type) {
      return report(200, {
        status: statusData.error_type === 'client_cancelled' ? 'CANCELLED' : 'FAILED',
        error: extractFalErrorMessage(statusData.error || statusData.error_type), progress: 0,
      });
    }
    const resultRes = await fetch(
    `${FAL_QUEUE_BASE}/${queueBase}/requests/${encodeURIComponent(requestId)}`,
    { headers: { Authorization: 'Key ' + apiKey }, redirect:'error',signal:AbortSignal.timeout(60_000) }
    );
    let resultData: Record<string,unknown> | null;
    try {
      resultData = seedreamDb && resultRes.ok
        ? await readCompletedSeedreamJson(resultRes) as Record<string,unknown> | null
        : await resultRes.json();
    } catch (error) {
      if (error instanceof SeedreamArchiveRejected) return rejected(error.message);
      return report(502, { error: 'Could not read the fal.ai result. Reconnect to the saved task to retry.' });
    }
    if (!resultRes.ok) {
      const msg = extractFalErrorMessage(resultData?.detail ?? resultData?.error ?? resultData?.message ?? resultData, 'fal.ai result lookup failed (' + resultRes.status + ')');
      // Legacy image tasks treated missing handles as terminal. A Seedream
      // lookup failure isn't evidence of the outcome of its accepted job.
      if (resultRes.status === 422 || resultRes.status === 499 || (!seedreamDb && [400,404].includes(resultRes.status))) {
        return report(200, { status: resultRes.status === 499 ? 'CANCELLED' : 'FAILED', error: msg, progress: 0 });
      }
      return report(resultRes.status, { error: msg });
    }

    if (seedreamDb) {
      try {
        const archived = await archiveSeedreamResult(seedreamDb, owner, requestId, endpoint, resultData);
        return report(200, seedreamSuccess(archived));
      } catch (error) {
        if (error instanceof SeedreamArchiveRejected) return rejected(error.message);
        throw error; // A storage, signing or network failure can be retried on this same task.
      }
    }
    const images = Array.isArray(resultData?.images)
      ? resultData.images.map(img => img?.url).filter((url): url is string => typeof url === 'string') : [];
    if (!images.length) return report(502, { error: 'fal.ai returned no images in the completed result' });
    return report(200, { status: 'SUCCEEDED', output: images, progress: 1 });
  }

  if (falStatus === 'ERROR' || falStatus === 'CANCELLED') {
    const errMsg = extractFalErrorMessage(
    statusData?.error_message ?? statusData?.detail ?? statusData?.message ?? statusData,
    falStatus === 'CANCELLED' ? 'Generation was cancelled' : 'Generation failed',
    );
    return report(200, {
      status: falStatus === 'CANCELLED' ? 'CANCELLED' : 'FAILED', error: errMsg, progress: 0,
    });
  }

  if (falStatus !== 'IN_QUEUE' && falStatus !== 'IN_PROGRESS') {
    return report(502, { error: 'fal.ai returned an unrecognized task status' });
  }
  return report(200, {
    status: 'RUNNING',
    stage: falStatus,
    queuePosition: typeof statusData?.queue_position === 'number' ? statusData.queue_position : null,
  });

}
