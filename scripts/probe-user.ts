// THE PROBE HOST — one dedicated real auth user every smoke suite inserts its fixtures into.
// FK-safe (a real auth.users row), no human's data at risk, and it survives any personal account
// being deleted (the failure mode that broke 12 suites at once when a test account was removed).
// Created once on first use, reused forever.
import type { SupabaseClient } from '@supabase/supabase-js';

export const PROBE_EMAIL = 'smoke-probe@augmtd-internal.test';

export async function resolveProbeUser(sb: SupabaseClient): Promise<string> {
  let id: string | null = null;
  for (let page = 1; page <= 5; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    const found = data?.users?.find((u) => u.email === PROBE_EMAIL);
    if (found) { id = found.id; break; }
    if (!data?.users?.length || data.users.length < 200) break;
  }
  if (!id) {
    const { data: created, error } = await sb.auth.admin.createUser({ email: PROBE_EMAIL, email_confirm: true });
    if (error || !created?.user) throw new Error(`cannot provision probe user: ${error?.message}`);
    id = created.user.id;
  }
  // Full parity with a real account: engine paths read `profiles` (first name, brief cache) — a
  // bare auth row makes those silently null and probes fail for the wrong reason.
  await sb.from('profiles').upsert({ id, full_name: 'Probe Host', email: PROBE_EMAIL }, { onConflict: 'id' }).then(() => {}, () => {});
  return id;
}
