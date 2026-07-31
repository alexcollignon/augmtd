// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KIND COMPLETER — one place that makes a missing `understanding.mailKind` land.
//
// The sync's noise fast-path never runs computeUnderstanding, and transactional mail (a Canva
// invoice) carries no List-Unsubscribe header — so resolveKind had NOTHING and the mail sat
// unlabeled forever ("the sweep tops up once the understanding lands" — but nothing made it land).
// This computes the reasoned kind and merges ONLY `mailKind` into the stored understanding —
// ROUTING-INERT by construction (every routing consumer goes through coerceUnderstanding, which
// returns null without role+relevance; only the label resolver reads the raw field).
// Consumers: the label-sweep (ambient backstop) + scripts/backfill-mail-kind.ts (manual batch).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export async function userAddresses(sb: SupabaseClient, userId: string): Promise<string[]> {
  const addrs: string[] = [];
  try {
    const [{ data: conns }, { data: prof }] = await Promise.all([
      sb.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
      sb.from('profiles').select('email').eq('id', userId).maybeSingle(),
    ]);
    for (const c of (conns ?? []) as Array<Record<string, unknown>>) {
      const a = ((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string);
      if (a) addrs.push(a);
    }
    if (prof?.email) addrs.push(prof.email as string);
  } catch { /* non-fatal */ }
  return addrs;
}

/** Compute + persist the reasoned mailKind for one item that lacks it. Returns the kind (also
 *  merged into the item's stored source_data.understanding) or null when the model judged none /
 *  the compute failed. `addrs` from userAddresses() — pass through when batching. */
export async function ensureMailKind(
  sb: SupabaseClient, userId: string,
  item: { id: string; source_data: Record<string, unknown> },
  addrs: string[],
): Promise<string | null> {
  const sd = item.source_data ?? {};
  const raw = (sd.understanding ?? null) as { mailKind?: string } | null;
  if (raw?.mailKind) return raw.mailKind;
  try {
    const { computeUnderstanding } = await import('@/lib/ai/email-processor');
    const fresh = await computeUnderstanding({
      user_id: userId, id: item.id,
      subject: String(sd.subject || ''), body: String(sd.body || '').slice(0, 4000),
      from_address: String(sd.from_address || ''), from_name: String(sd.from_name || ''),
      to_addresses: (sd.to as string[]) ?? [], cc_addresses: (sd.cc as string[]) ?? [],
      received_at: (sd.received_at as string) ?? null, user_addresses: addrs, recipient_email: addrs[0] ?? null,
    } as never, sb, {
      useEntityContext: true,
      // A REGISTRY FACT, not a heuristic: mail from the platform's own coworker domain is the
      // user's own AI assistant writing — the reasoned pass judges WITH that certainty (it
      // should land 'team', not read like third-party automation).
      facts: String(sd.from_address || '').toLowerCase().endsWith('@team.augmtd.ai')
        ? ["the sender is one of the user's OWN AI coworkers (this platform's assistant, writing on the user's behalf) — their mail is the user's own team's output, not a third-party service notification"]
        : undefined,
    });
    const kind = fresh?.mailKind ?? null;
    if (!kind) return null;
    const stored = (sd.understanding ?? {}) as Record<string, unknown>;
    await sb.from('inbox_items')
      .update({ source_data: { ...sd, understanding: { ...stored, mailKind: kind } } })
      .eq('id', item.id).eq('user_id', userId);
    // Keep the caller's in-memory copy coherent (it labels right after).
    (sd as Record<string, unknown>).understanding = { ...stored, mailKind: kind };
    return kind;
  } catch { return null; }
}
