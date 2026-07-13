// Paginated full-table read. Supabase/PostgREST hard-caps a single response at 1000 rows regardless of
// `.limit(N)`, and without an explicit `.order()` the returned 1000 are an arbitrary slice — so any read
// that can exceed 1000 rows silently loses data (see the initiative machine's missed outreach/clusters).
// `fetchAllRows` pages through the FULL set with `.range()`. The caller MUST include a stable `.order()`
// in the query so page boundaries don't shift between requests.

export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const page = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 20000; // safety backstop against a runaway loop
  const all: T[] = [];
  for (let from = 0; from < maxRows; from += page) {
    const { data, error } = await makeQuery(from, from + page - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < page) break; // last page
  }
  return all;
}
