/** Read a collection using an ascending unique ID, avoiding shifting offsets. */
export async function readKeysetPages<Row extends { id: string }>(
  page: (after?: string) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  while (true) {
    const { data, error } = await page(cursor);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    const next = data[data.length - 1].id;
    if (!next || (cursor !== undefined && next <= cursor)) throw new Error('The collection could not be fully loaded.');
    rows.push(...data);
    cursor = next;
  }
}
