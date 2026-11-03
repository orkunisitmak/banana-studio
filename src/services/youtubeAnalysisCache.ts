import { createTaskDeadline, waitForTask } from '../lib/shared/asyncTask';
import { supabase } from './authService';

// Cache factual video research, never cast assignments or creative prompts.
// Bump the version when the model, extraction prompt or coverage rules change.
const STORAGE_KEY = 'nanogen-youtube-analysis-v1';
const MAX_ENTRIES = 12;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
interface Entry { key: string; owner: string; expires: number; text: string }

const readEntries = (): Entry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 400_000) return [];
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry: any) => typeof entry?.key === 'string'
      && typeof entry.owner === 'string' && typeof entry.text === 'string'
      && entry.text.length < 25_000 && Number.isFinite(entry.expires)
      && entry.expires > Date.now() && entry.expires <= Date.now() + MAX_AGE_MS).slice(-MAX_ENTRIES);
  } catch { return []; }
};

const currentOwner = async (signal: AbortSignal, timeout = 15_000): Promise<string | undefined> => {
  const task = createTaskDeadline(timeout, signal, 'Oturum doğrulanamadı. Sayfayı yenileyip yeniden dene.');
  try {
    const { data: { session } } = await waitForTask(supabase.auth.getSession(), task.signal);
    task.signal.throwIfAborted();
    return session?.user?.id;
  } finally { task.dispose(); }
};

export const openYouTubeAnalysisCache = async (input: string, signal: AbortSignal) => {
  signal.throwIfAborted();
  // Private browsing/storage denial must not prevent video analysis.
  try { if (typeof localStorage === 'undefined' || !globalThis.crypto?.subtle) return undefined; localStorage.getItem(STORAGE_KEY); }
  catch { return undefined; }
  let key: string;
  try {
    const digest = await waitForTask(crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)), signal);
    key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { signal.throwIfAborted(); return undefined; }
  let owner: string | undefined;
  try { owner = await currentOwner(signal); }
  catch { signal.throwIfAborted(); return undefined; }
  if (!owner) return undefined;
  signal.throwIfAborted();
  return {
    read: () => readEntries().find(entry => entry.owner === owner && entry.key === key)?.text,
    write: async (text: string) => {
      if (text.length >= 25_000 || await currentOwner(signal, 500) !== owner) return;
      signal.throwIfAborted();
      try {
        const entries = readEntries().filter(entry => !(entry.owner === owner && entry.key === key));
        entries.push({ key, owner, expires: Date.now() + MAX_AGE_MS, text });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
      } catch { /* Quota/storage denial cannot discard a completed analysis. */ }
    },
  };
};
