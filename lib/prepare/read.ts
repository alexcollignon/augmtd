// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE PREPARED-WORK READER (single-source consolidation #1). Prepared artifacts live in three
// physical places — `source_data.draft` (reply drafts), `source_data.nudge_draft` (waiting-on nudges),
// and `item_deliverables` (coworker/pass deliverables, commitment drafts). Consumers must NEVER know
// that: they call getPrepared()/preparedFromSourceData() and get one normalized shape. Storage may stay
// plural; the knowledge of where things live is singular, here.
// Consumers: /api/items/view (deep-dive prepared/byline) · commitments nudge route · brief route (✦ tokens) · smokes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type PreparedArtifact = {
  kind: 'reply_draft' | 'nudge_draft' | 'deliverable' | 'invite' | 'forward';
  title: string | null;
  content: string;
  by: string | null;           // coworker name (attributed) or null (in-house)
  at: string | null;
  attachment: { fileId: string; filename: string; source?: string } | null;
  provenance: Record<string, string> | null;
  /** THE DECISION BRIEF's structured payload (trichotomy T2) — when present, the DECISION CARD
   *  is this artifact's ONE surface (options + trade-offs + recommendation render THERE; the
   *  prepared strip must not duplicate it as a second document — owner, Aug 12). */
  decision?: { options: Array<{ label: string; tradeoff?: string | null }>; recommendation: string | null; why: string | null } | null;
  /** René sweep (Aug 13): an invite with no time / a forward with no recipient is NOT send-shaped —
   *  the send door hard-rejects it, so a Send primary would be a button that cannot fire. false =
   *  staged but missing what the send needs (the machine reads awaiting_input). Absent = ready. */
  sendReady?: boolean;
  /** THE GROUND LAW (Aug 13): the ground this artifact was prepared FROM (the newest inbound at
   *  prep time), read off the stored prepared_from stamp. */
  ground?: { emailId: string | null; receivedAt: string | null } | null;
  /** Derived at read time by getPrepared: the item's ground moved past this artifact — it is
   *  SUPERSEDED. The machine treats it as not-prepared; no surface offers it as current. Absent
   *  on the pure preparedFromSourceData path (no query there). */
  stale?: boolean;
};

type PreparedFrom = { emailId?: string | null; receivedAt?: string | null } | null;
type SourceData = {
  draft?: { body?: string; generated_at?: string; prepared_from?: PreparedFrom; attachment?: { fileId: string; filename: string; source?: string } } | null;
  nudge_draft?: { body?: string; generated_at?: string; prepared_from?: PreparedFrom } | null;
  // THE READER READS EVERYTHING (trichotomy T1 find: a fresh prepared invite existed and the
  // canonical reader missed it — every consumer under-reported preparedness for schedule/forward
  // items). Sent artifacts are done work, not pending preparation — they don't render here.
  prepared_invite?: { title?: string; start?: string; startISO?: string; generated_at?: string; sent_at?: string; prepared_from?: PreparedFrom } | null;
  prepared_forward?: { to?: string[]; note?: string; generated_at?: string; sent_at?: string; prepared_from?: PreparedFrom } | null;
  prepared_by?: { worker?: string; at?: string } | null;
} | null | undefined;

const groundFrom = (pf: PreparedFrom | undefined): { emailId: string | null; receivedAt: string | null } | null =>
  pf?.receivedAt ? { emailId: pf.emailId ?? null, receivedAt: pf.receivedAt } : null;

/** The pure half — prepared artifacts already present ON an inbox row's source_data (no queries).
 *  The brief route uses this over rows it already holds; getPrepared uses it after fetching. */
export function preparedFromSourceData(sd: SourceData): PreparedArtifact[] {
  const out: PreparedArtifact[] = [];
  if (sd?.draft?.body) {
    out.push({
      kind: 'reply_draft', title: null, content: sd.draft.body,
      by: sd.prepared_by?.worker ?? null, at: sd.draft.generated_at ?? null,
      attachment: sd.draft.attachment ?? null, provenance: null,
      ground: groundFrom(sd.draft.prepared_from),
    });
  }
  if (sd?.nudge_draft?.body) {
    // B3 (verb-lane sweep): the pass stamps prepared_by on the nudge lane too — reading null here
    // rendered the chase draft unattributed while every sibling lane said "by Clara".
    out.push({ kind: 'nudge_draft', title: null, content: sd.nudge_draft.body, by: sd.prepared_by?.worker ?? null, at: sd.nudge_draft.generated_at ?? null, attachment: null, provenance: null, ground: groundFrom(sd.nudge_draft.prepared_from) });
  }
  if (sd?.prepared_invite && !sd.prepared_invite.sent_at) {
    out.push({
      kind: 'invite', title: sd.prepared_invite.title ?? 'Prepared invite',
      // B2 (verb-lane sweep): the writer stores startISO — reading `.start` served a timeless invite.
      content: [sd.prepared_invite.title, sd.prepared_invite.startISO ?? sd.prepared_invite.start].filter(Boolean).join(' · ') || 'Calendar invite prepared',
      by: sd.prepared_by?.worker ?? null, at: sd.prepared_invite.generated_at ?? null, attachment: null, provenance: null,
      sendReady: !!(sd.prepared_invite.startISO ?? sd.prepared_invite.start),
      ground: groundFrom(sd.prepared_invite.prepared_from),
    });
  }
  if (sd?.prepared_forward && !sd.prepared_forward.sent_at) {
    out.push({
      kind: 'forward', title: 'Prepared forward',
      content: [`To: ${(sd.prepared_forward.to ?? []).join(', ')}`, sd.prepared_forward.note].filter(Boolean).join('\n') || 'Forward prepared',
      by: sd.prepared_by?.worker ?? null, at: sd.prepared_forward.generated_at ?? null, attachment: null, provenance: null,
      sendReady: (sd.prepared_forward.to ?? []).length > 0,
      ground: groundFrom(sd.prepared_forward.prepared_from),
    });
  }
  return out;
}

/** The PURE pool-row mapper — the other half of the one reader, shared by getPrepared and the
 *  machine's batch derivation (workStatesFor): forking this mapping is how a deck row and a
 *  deep-dive disagree about what's prepared.
 *  René sweep (Aug 13): a commitment's `type:'draft'` row IS the chase/reply lane home — a
 *  ready-to-send nudge must not wear the document card; and stacked re-drafts collapse to the
 *  NEWEST (rows must arrive newest-first). Ask-journey D5: `file` rows are the user's own
 *  supplied inputs and `sent` rows are done work — neither is pending preparation. J3:
 *  version-history rows are the ledger, not the surface. */
export function poolRowsToArtifacts(rows: Array<Record<string, unknown>>, poolKind: 'email' | 'commitment'): PreparedArtifact[] {
  const out: PreparedArtifact[] = [];
  let sawCommitDraft = false;
  for (const d of rows) {
    if (!d.content) continue;
    if (d.type === 'file' || d.type === 'sent') continue;
    const meta = (d.metadata ?? {}) as { agentName?: string; worker?: string; attachment?: { fileId: string; filename: string; source?: string }; provenance?: Record<string, string>; version_of?: string; decisionBrief?: boolean; options?: Array<string | { label?: string; tradeoff?: string | null }>; recommendation?: string | null; why?: string | null; prepared_from?: PreparedFrom };
    if (meta.version_of) continue;
    const isCommitDraft = poolKind === 'commitment' && d.type === 'draft' && !meta.decisionBrief;
    if (isCommitDraft && sawCommitDraft) continue;
    if (isCommitDraft) sawCommitDraft = true;
    out.push({
      kind: isCommitDraft ? (String(d.title ?? '').startsWith('Nudge — ') ? 'nudge_draft' : 'reply_draft') : 'deliverable',
      title: (d.title as string) ?? null, content: String(d.content),
      ground: groundFrom(meta.prepared_from),
      by: meta.agentName ?? meta.worker ?? null, at: (d.created_at as string) ?? null,
      attachment: meta.attachment ?? null, provenance: meta.provenance ?? null,
      // Both metadata generations parse: label strings (the first live briefs) and
      // {label, tradeoff} objects (current writes).
      ...(meta.decisionBrief ? { decision: {
        options: (meta.options ?? []).map((o) => typeof o === 'string' ? { label: o } : { label: String(o.label ?? ''), tradeoff: o.tradeoff ?? null }).filter((o) => o.label),
        recommendation: meta.recommendation ?? null, why: meta.why ?? null,
      } } : {}),
    });
  }
  return out;
}

/** A single ✦ badge for an inbox row — 'draft' (in-house) or the coworker's name. The brief's tokens. */
export function preparedBadge(sd: SourceData): string | null {
  if (sd?.prepared_by?.worker) return String(sd.prepared_by.worker);
  if (sd?.draft?.body || sd?.nudge_draft?.body) return 'draft';
  if ((sd?.prepared_invite && !sd.prepared_invite.sent_at) || (sd?.prepared_forward && !sd.prepared_forward.sent_at)) return 'draft';
  return null;
}

/** Everything prepared for ONE item, newest first — across all storage places. */
export async function getPrepared(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox_item' | 'commitment'; id: string },
): Promise<PreparedArtifact[]> {
  const out: PreparedArtifact[] = [];
  try {
    if (item.kind === 'inbox_item') {
      const { data } = await client.from('inbox_items').select('source_data').eq('id', item.id).eq('user_id', userId).maybeSingle();
      out.push(...preparedFromSourceData(data?.source_data as SourceData));
    }
    // Deliverables hang off items under the plan-kind key ('email' for inbox-backed, 'commitment' for commitments).
    const poolKind = item.kind === 'inbox_item' ? 'email' : 'commitment';
    const { data: dels } = await client.from('item_deliverables')
      .select('type, title, content, metadata, created_at')
      .eq('user_id', userId).eq('kind', poolKind).eq('entity_id', item.id)
      .order('created_at', { ascending: false }).limit(8);
    out.push(...poolRowsToArtifacts(dels ?? [], poolKind));
    // THE GROUND LAW — stale is DERIVED here, never stored: an artifact whose ground predates
    // the item's newest inbound is SUPERSEDED (the counterparty's new message is their supply).
    // Unstamped/unresolvable artifacts are exempt (conservative — the pass re-stamps on rewrite).
    try {
      const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
      const current = await groundOf(client, userId, { kind: item.kind === 'inbox_item' ? 'inbox' : 'commitment', id: item.id });
      if (current.receivedAt) for (const a of out) { if (groundMoved(a.ground, current)) a.stale = true; }
    } catch { /* staleness is a protection, never a blocker */ }
  } catch { /* non-fatal — prepared work is an enhancement */ }
  // W6 — IDENTICAL artifacts collapse to one (the triple-chip bug: three requirement labels once
  // staged the same file as three pool rows). Distinct drafts (different content) always survive.
  const seen = new Set<string>();
  const deduped = out.filter((a) => {
    const k = `${a.kind}:${a.attachment?.fileId ?? ''}:${a.title ?? ''}:${a.content.replace(/\s+/g, ' ').slice(0, 80)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}
