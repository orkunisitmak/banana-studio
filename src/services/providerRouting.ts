import { supabase } from './authService';
import { isProviderChoice, parseHostedProviderSettings, parseProviderPreferences, resolveProvider, upgradeProviderPreferences, type ProviderAvailability, type ProviderChoice, type ProviderSettings } from '../lib/providers';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';

const currentUserId = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user.id) throw new Error('Sign in before using AI settings.');
  return data.session.user.id;
};

async function persist(userId: string, model: string, value: ProviderChoice, onlyIfMissing = false) {
  if (!isProviderChoice(model, value) || (!isLocalWorkspace() && value === 'codex')) throw new Error('Unsupported provider choice.');
  const { error } = await supabase.rpc('save_provider_preference', {
    p_expected_user_id: userId, p_model: model, p_provider: value, ...(onlyIfMissing ? { p_if_missing: true } : {}),
  }).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error('Provider preferences could not be saved.');
}

async function migrateBrowserPreferences(userId: string) {
  const key = `banana-provider-routes-v1:${userId}`;
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return; }
  if (!raw) return;
  let legacy: unknown;
  try { legacy = JSON.parse(raw); } catch { legacy = {}; }
  // Another device may already have set Off. Import missing rows only.
  const entries = Object.entries(upgradeProviderPreferences(legacy)).filter(([, choice]) => choice !== 'codex');
  await Promise.all(entries.map(([model, value]) => persist(userId, model, value, true)));
  try { if (localStorage.getItem(key) === raw) localStorage.removeItem(key); } catch { /* Import is idempotent. */ }
}

async function loadProviderSettings(userId: string) {
  const local = isLocalWorkspace();
  if (!local) await migrateBrowserPreferences(userId);
  const { data, error } = await supabase.rpc('get_provider_preferences', { p_expected_user_id:userId,...(!local && {p_include_policy:true}) }).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error('Provider preferences could not be loaded.');
  if (await currentUserId() !== userId) throw new Error('Session changed. Refresh AI settings.');
  if (!local) return {userId,...parseHostedProviderSettings(data)};
  const preferences = parseProviderPreferences(data);
  return {userId,preferences,personal:preferences,policy:{},canManage:false};
}
// Several controls mount together. Share only an in-flight read for the same
// account, never a cached preference or an import across accounts.
const pending = new Map<string,Promise<ProviderSettings & { userId:string }>>();
export async function readProviderSettings() {
  const userId = await currentUserId();
  const existing = pending.get(userId);
  if (existing) return existing;
  const read = loadProviderSettings(userId);
  pending.set(userId,read);
  try { return await read; }
  finally { if (pending.get(userId) === read) pending.delete(userId); }
}
export async function getProviderPreferences() {
  return (await readProviderSettings()).preferences;
}
export async function saveProviderPreference(model: string, value: ProviderChoice, expectedUserId?: string) {
  const userId = expectedUserId ?? await currentUserId();
  await persist(userId, model, value);
  pending.delete(userId);
  if (await currentUserId() !== userId) throw new Error('Session changed. Refresh AI settings.');
}
export async function saveWorkspaceProviderPolicy(model:string, value:ProviderChoice | null, userId:string) {
  if (isLocalWorkspace() || (value !== null && (value === 'auto' || value === 'codex' || !isProviderChoice(model,value)))) throw new Error('Unsupported workspace policy.');
  const { error } = await supabase.rpc('save_workspace_provider_policy',{p_expected_user_id:userId,p_model:model,p_provider:value}).abortSignal(AbortSignal.timeout(10000));
  if (error) throw new Error(error.code === '42501' ? 'Workspace administrator access required.' : 'Workspace provider policy could not be saved.');
  pending.delete(userId);
  if (await currentUserId() !== userId) throw new Error('Session changed. Refresh AI settings.');
}
export async function getProviderAvailability(signal?: AbortSignal): Promise<ProviderAvailability> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch('/api/gemini-status', { cache: 'no-store', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
  if (!response.ok) throw new Error('Provider availability could not be checked. No generation was submitted.');
  return (await response.json()).providers || {};
}
export async function selectProvider(model: string, signal?: AbortSignal) {
  const [preferences, available] = await Promise.all([getProviderPreferences(), getProviderAvailability(signal)]);
  return resolveProvider(model, preferences[model], available);
}
