import type { GenerationConfig } from '../../types';

export interface PromptHistoryEntry {
  id: string;
  prompt: string;
  createdAt: number;
  mode: GenerationConfig['mode'];
  imageModel?: string;
  videoModel?: string;
}

const MAX_ENTRIES = 30;
const keyFor = (userId: string) => `banana:prompt-history:v1:${userId}`;
const id = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const read = (userId: string): PromptHistoryEntry[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(userId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PromptHistoryEntry =>
      !!entry && typeof entry.id === 'string' && typeof entry.prompt === 'string' && typeof entry.createdAt === 'number',
    ).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
};

const write = (userId: string, entries: PromptHistoryEntry[]): void => {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Quota or privacy mode: history is a convenience, never a generation dependency.
  }
};

export const loadPromptHistory = (userId: string): PromptHistoryEntry[] => read(userId);

export const recordPromptHistory = (userId: string, config: GenerationConfig): PromptHistoryEntry[] => {
  const prompt = config.prompt.trim();
  if (!prompt || !userId) return read(userId);
  const entry: PromptHistoryEntry = {
    id: id(),
    prompt,
    createdAt: Date.now(),
    mode: config.mode,
    imageModel: config.mode === 'image' ? config.imageModel : undefined,
    videoModel: config.mode === 'video' ? config.videoModel : undefined,
  };
  const existing = read(userId).filter(item => item.prompt !== prompt);
  const next = [entry, ...existing].slice(0, MAX_ENTRIES);
  write(userId, next);
  return next;
};

export const clearPromptHistory = (userId: string): PromptHistoryEntry[] => {
  write(userId, []);
  return [];
};
