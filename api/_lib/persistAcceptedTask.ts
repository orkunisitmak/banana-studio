/** Recover a known, accepted provider task without creating a second billable provider request. */
export async function persistAcceptedTask(
  insert: () => Promise<{ error: unknown }>,
  lookup: () => Promise<{ data: { user_id: string } | null; error: unknown }>,
  userId: string,
  attempts = 3,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    // An insert can succeed on the server even if its acknowledgement is lost.
    // Read the server-owned association before every subsequent write.
    if (attempt > 0) {
      try {
        const existing = await lookup();
        if (!existing.error && existing.data) return existing.data.user_id === userId;
      } catch { /* Database still unavailable; one bounded retry remains. */ }
      await wait(200 * (attempt + 1));
    }
    try {
      const result = await insert();
      if (!result.error) return true;
    } catch { /* Treat transport failures as an uncertain insertion. */ }
  }
  // The last insert may also have committed without an acknowledgement.
  try {
    const existing = await lookup();
    if (!existing.error && existing.data) return existing.data.user_id === userId;
  } catch { /* Preserve the existing safe failure path. */ }
  return false;
}
