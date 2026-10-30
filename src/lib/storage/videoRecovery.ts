type VideoRow = { id: string; type?: string; status?: string; task_id?: string | null; metadata?: Record<string, unknown> };
type Recovery = { id: string; task_id: string; status: string; metadata: Record<string, unknown> };

/** Restore only server-proven handles; this operation never creates a paid task. */
export async function recoverVideoRows<Row extends VideoRow>(rows: Row[],
  recover: (ids: string[]) => PromiseLike<{ data: Recovery[] | null; error: { message: string } | null }>,
): Promise<void> {
  const missing = new Map(rows.filter(row => row.type === 'video' && !row.task_id
    && (row.status === 'pending' || row.status === 'processing')).map(row => [row.id, row]));
  const ids = [...missing.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const { data, error } = await recover(batch);
    if (error) throw new Error('Accepted video task recovery is temporarily unavailable.');
    for (const restored of data || []) {
      const row = batch.includes(restored.id) ? missing.get(restored.id) : undefined;
      if (row && restored.task_id) Object.assign(row, {
        task_id: restored.task_id, status: restored.status,
        metadata: { ...row.metadata, ...restored.metadata },
      });
    }
  }
}
