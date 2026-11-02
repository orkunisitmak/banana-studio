export interface WaitingVideo { id: string; mediaType: string; status?: string; taskId?: string | null }

/** Only looks up an already-submitted task; this function never dispatches paid work. */
export type LateVideoTaskResult<T> = { kind: 'accepted' | 'terminal'; media: T };

export async function findLateVideoTaskId<T extends WaitingVideo>(
  id: string, checking: Set<string>, current: () => T | undefined,
  read: () => Promise<T | null>,
): Promise<LateVideoTaskResult<T> | null> {
  if (checking.has(id)) return null;
  const before = current();
  if (!before || before.id !== id || before.mediaType !== 'video'
      || before.status !== 'processing' || before.taskId) return null;
  checking.add(id);
  try {
    const saved = await read();
    const live = current();
    if (!live || live.id !== id || live.status !== 'processing' || live.taskId
        || !saved || saved.id !== id || saved.mediaType !== 'video') return null;
    if (saved.status === 'completed' || saved.status === 'failed') return { kind: 'terminal', media: saved };
    if (saved.status === 'processing' && saved.taskId) return { kind: 'accepted', media: saved };
    return null;
  } finally {
    checking.delete(id);
  }
}
