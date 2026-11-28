import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFalRequestCosts } from './falBillingCosts.js';
import { createServiceRoleClient } from './auth.js';

// Include the wrapped task handle (provider and logical model) in the namespace.
function usageId(owner: string, taskId: string) {
  const bytes = createHash('sha256').update('banana:video-usage:v1:' + owner + ':' + taskId).digest().subarray(0, 16);
  bytes[6] = bytes[6] & 0x0f | 0x50;
  bytes[8] = bytes[8] & 0x3f | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
}
export async function recordSeedanceUsage(db: SupabaseClient, owner: string, taskId: string, model: string, mode: string, prompt: string) {
  try {
    const { error } = await db.from('usage_logs').upsert({ id: usageId(owner, taskId), user_id: owner, action: 'video_generate', model: model + '-' + mode.replaceAll('_','-'), prompt: prompt.slice(0,500), image_count: 1, estimated_cost: null }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  } catch { console.warn('Accepted Seedance task usage could not be saved', taskId); }
}
export async function seedanceActualCost(owner: string, taskId: string, requestId: string, fallbackKey: string) {
  let usd: number | undefined;
  try {
    usd = (await fetchFalRequestCosts([requestId], process.env.FAL_ADMIN_KEY?.trim() || fallbackKey)).get(requestId);
    if (usd !== undefined) await createServiceRoleClient()?.from('usage_logs').update({ estimated_cost: usd }).eq('id', usageId(owner, taskId)).eq('user_id', owner).eq('action', 'video_generate');
  } catch { /* Missing billing information must never hide a finished task or invent a charge. */ }
  return usd;
}
