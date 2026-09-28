// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REPLY-CLOSED DELIVERABLES REPAIR (stabilization W19.A · A REPLY IS NOT A DELIVERY).
// GUARDED; DRY-RUN BY DEFAULT.
//
// Before W19.A the reply resolver (lib/inbox/resolve-on-reply.ts) closed ANY needs-reply item the
// moment the user wrote back on its thread (`resolved_reason: 'replied'`) — including items whose ask
// was a DELIVERABLE (send the RIB, share the deck), where the reply only PROMISED it. This census lists
// those closes:
//   · items completed with reason 'replied' whose ask is a deliverable (the SAME predicate the
//     resolver now uses — lib/commitments/deliverable-ask `isDeliverableAsk`, over the item's judgment
//     record + understanding);
//   · whose closing reply LOOKS promised — a ZERO-AI heuristic, dry-run only: no attachment on the
//     reply AND a future-tense / later-marker promise in its own words (EN · PT · DE · FR). It is a
//     census filter, never a decision: --apply asks the ONE fulfillment judge before touching a row.
// Output is MASKED: counts + item ids only (no subjects, no names, no addresses).
//
//   npx tsx scripts/repair-reply-closed-deliverables.ts --user <uuid>          dry run (default)
//   npx tsx scripts/repair-reply-closed-deliverables.ts --user <uuid> --apply --yes
//        OWNER-GATED. For each listed row: the fulfillment judge (≈ one small call per row, cached
//        per evidence set; stated before the run) rules the closing reply; on `promised`/`unclear` the
//        item is REOPENED through THE ONE restore flip (lib/activity/reopen.ts — byte-identical to the
//        user's own Undo, logged `restored`), and a `promised` verdict with a verified quote records
//        the you-owe commitment through the one creation door (resolve-on-reply's recorder). A
//        `delivered` verdict leaves the close standing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** The known case from the Sep 28 walk (id prefix) — always reported, listed or not. */
export const KNOWN_CASE_PREFIX = 'c24e47ed';

// ── ZERO-AI PROMISE HEURISTIC (census only) ─────────────────────────────────────────────────────
// A later-marker ("next week", "tomorrow", "semaine prochaine") or a first-person future of a handing
// verb ("I'll send", "vou enviar", "ich schicke … zu", "je t'envoie … "). It LISTS candidates; the judge
// decides (--apply). Never imported by the product.
const LATER = /\b(?:next week|tomorrow|later (?:today|this week)|early next|by (?:mon|tues|wednes|thurs|fri)day|shortly|soon|pr[óo]xima semana|semana que vem|amanh[ãa]|em breve|n[äa]chste(?:n)? woche|morgen|bald|demn[äa]chst|semaine prochaine|demain|d[èe]s que possible|bient[ôo]t|d[ée]but de semaine)\b/iu;
const FUTURE_SEND = /\b(?:i['’]?ll|i will|we['’]?ll|we will|will)\s+(?:send|share|forward|get|provide|attach)|\b(?:vou|vamos|irei)\s+(?:enviar|mandar|partilhar|compartilhar)|\benvio[- ]?(?:te|lhe)?\b.*\b(?:amanh|pr[óo]xim)|\bich\s+(?:schicke|sende|werde)|\bwir\s+(?:schicken|senden|werden)|\bje\s+(?:t['’]|vous\s+)?(?:enverrai|envoie|ferai parvenir|transmettrai|partagerai)|\bnous\s+(?:enverrons|vous enverrons)/iu;

/** Does a closing reply LOOK like a promise rather than a delivery? Pure, census-only. */
export function replyLooksPromised(ownWords: string, attachmentCount: number | null): boolean {
  if ((attachmentCount ?? 0) > 0) return false; // something was handed over — not a promise-only reply
  const t = String(ownWords ?? '');
  return LATER.test(t) && (FUTURE_SEND.test(t) || /\b(?:send|envoie|envio|enviar|schick|sende|transmet)/iu.test(t));
}

type Item = { id: string; user_id: string; created_at: string; work_title: string | null; source_data: Record<string, unknown> | null };

async function main() {
  const argv = process.argv;
  const APPLY = argv.includes('--apply');
  const YES = argv.includes('--yes');
  const userId = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;
  if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) { console.error('usage: --user <uuid> [--apply --yes]'); process.exit(2); }
  if (APPLY && !YES) { console.error('--apply requires --yes (the repair reopens items and spends one judgment per row).'); process.exit(2); }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as SupabaseClient;
  const { fetchAllRows } = await import('../lib/utils/fetch-all');
  const { readPlans } = await import('../lib/store/item-plans');
  const { isDeliverableAsk } = await import('../lib/commitments/deliverable-ask');
  const { topMessageOf } = await import('../lib/inbox/top-message');

  // Every item this user's reply resolver closed (paged — no silent caps).
  const closed = await fetchAllRows<Item>((from, to) => sb.from('inbox_items')
    .select('id, user_id, created_at, work_title, source_data')
    .eq('user_id', userId).eq('status', 'completed').eq('source_data->>resolved_reason', 'replied')
    .order('created_at', { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: Item[] | null; error: unknown }>);
  const judgments = new Map<string, { work?: string; requires?: unknown[] }>();
  const keys = closed.map((i) => `inbox:${i.id}`);
  for (let i = 0; i < keys.length; i += 200) {
    for (const r of await readPlans(sb, userId, 'judgment', { keys: keys.slice(i, i + 200) })) {
      const v = ((r.tasks ?? null) as { verdict?: { work?: string; requires?: unknown[] } } | null)?.verdict;
      if (v) judgments.set(r.key, v);
    }
  }
  const census = { closedReplied: closed.length, deliverable: 0, looksPromised: 0, noReplyFound: 0, reopened: 0, recorded: 0, keptDelivered: 0, failed: 0 };
  const listed: Array<{ item: Item; sent: { id: string; body: string; received_at: string | null; subject: string | null; attachments: number | null } }> = [];
  for (const it of closed) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const v = judgments.get(`inbox:${it.id}`);
    if (!isDeliverableAsk({ work: v?.work ?? null, requires: v?.requires ?? null, understanding: (sd.understanding ?? null) as { relevance?: string; ownership?: string } | null })) continue;
    census.deliverable++;
    const threadId = typeof sd.thread_id === 'string' ? sd.thread_id : null;
    if (!threadId) { census.noReplyFound++; continue; }
    // The CLOSING reply: the user's newest message on the thread after the item arose, at or before the close.
    const resolvedAt = typeof sd.resolved_at === 'string' ? sd.resolved_at : new Date().toISOString();
    const { data: sentRows, error } = await sb.from('emails').select('id, body, metadata, received_at, subject')
      .eq('user_id', userId).eq('thread_id', threadId).eq('is_from_user', true)
      .gt('received_at', it.created_at).lte('received_at', resolvedAt)
      .order('received_at', { ascending: false }).limit(1);
    if (error) { census.failed++; continue; }
    const s = (sentRows ?? [])[0] as { id: string; body: string | null; metadata: { attachments?: unknown[] } | null; received_at: string | null; subject: string | null } | undefined;
    if (!s) { census.noReplyFound++; continue; }
    const attachments = Array.isArray(s.metadata?.attachments) ? s.metadata!.attachments!.length : null;
    const own = topMessageOf(String(s.body ?? ''));
    const known = it.id.startsWith(KNOWN_CASE_PREFIX);
    if (!replyLooksPromised(own, attachments) && !known) continue;
    census.looksPromised++;
    listed.push({ item: it, sent: { id: s.id, body: String(s.body ?? ''), received_at: s.received_at, subject: s.subject, attachments } });
  }

  console.log(`\nW19.A reply-closed deliverables — user ${userId.slice(0, 8)}… (${APPLY ? 'APPLY' : 'dry run'})`);
  console.log(`  closed with reason 'replied': ${census.closedReplied}`);
  console.log(`  …whose ask is a deliverable: ${census.deliverable} (no closing reply found: ${census.noReplyFound})`);
  console.log(`  …whose closing reply looks PROMISED (zero-AI census filter): ${census.looksPromised}`);
  for (const l of listed) console.log(`    - ${l.item.id}${l.item.id.startsWith(KNOWN_CASE_PREFIX) ? '  (the known case)' : ''} · reply ${l.sent.id.slice(0, 8)}… · attachments ${l.sent.attachments ?? 'unknown'}`);
  const knownListed = listed.some((l) => l.item.id.startsWith(KNOWN_CASE_PREFIX));
  console.log(`  known case ${KNOWN_CASE_PREFIX}…: ${knownListed ? 'listed' : 'NOT among the closes (already reopened, or another user)'}`);

  if (!APPLY) {
    console.log(`\n  Dry run — nothing written. --apply --yes would spend ≤ ${listed.length} fulfillment judgment(s) (small calls, cached per evidence set) and reopen only what the judge rules not delivered.`);
    return;
  }
  const { judgeFulfillmentFromEvidence } = await import('../lib/commitments/fulfillment');
  const { reopenInboxItem } = await import('../lib/activity/reopen');
  const { recordPromiseCommitment } = await import('../lib/inbox/resolve-on-reply');
  for (const { item, sent } of listed) {
    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    const u = (sd.understanding ?? {}) as { ask?: string; deadline?: string | null };
    try {
      const fv = await judgeFulfillmentFromEvidence(sb, userId, {
        kind: 'inbox', id: item.id, description: String(u.ask || item.work_title || sd.subject || ''),
        due_date: u.deadline ?? null, created_at: item.created_at, wantsPromiseQuote: true,
      }, [{ type: 'email', id: sent.id, at: String(sent.received_at ?? ''), title: String(sent.subject ?? ''), body: sent.body, attachmentCount: sent.attachments }], true);
      if (fv.verdict === 'delivered') { census.keptDelivered++; continue; }
      const r = await reopenInboxItem(sb, userId, item.id, { note: 'w19a_reply_not_delivery' });
      if (!r.ok) { census.failed++; console.error(`  ✗ reopen ${item.id.slice(0, 8)}…: ${r.error}`); continue; }
      census.reopened++;
      if (fv.verdict === 'promised') {
        const outcome = await recordPromiseCommitment(sb, userId, {
          item: { id: item.id, work_title: item.work_title, source_data: sd }, verdict: fv,
          sent: { id: sent.id, body: sent.body, received_at: sent.received_at, subject: sent.subject },
          threadId: String(sd.thread_id), counterparty: typeof sd.from_address === 'string' ? sd.from_address : null,
        });
        if (outcome === 'created' || outcome === 'reanchored') census.recorded++;
      }
    } catch (e) { census.failed++; console.error(`  ✗ ${item.id.slice(0, 8)}…:`, e instanceof Error ? e.message : e); }
  }
  console.log(`\n  reopened ${census.reopened} · promises recorded ${census.recorded} · close kept (judged delivered) ${census.keptDelivered} · failed ${census.failed}`);
}

if (/repair-reply-closed-deliverables\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
