// ════════════════════════════════════════════════════════════════════════════════════════════════
// RETRO-REPAIR BY LAW — THE SELF-RECOGNITION FLOOR (Q1, docs/attention-plan.md PART III).
//
// The law repairs the future: from now on, mail from the user's OWN coworkers can never judge as a
// counterparty ask, mint a commitment, or count as a visible obligation row. This sweep applies the
// SAME law to the standing backlog — the rows born before the floor existed.
//
// The class it repairs, measured on the reference account (Sep 17): the deck's top rows were our
// own reminder mail, and ONE ask ("approve the Data Analyst shortlist") stood FOUR times — three
// re-sent reminder emails plus the commitment one of them minted. Nothing here is hand-picked: the
// senders come from the ADDRESS REGISTRY that produces them (lib/inbox/self-echo, the same
// predicate the live floor consults), so this script names no sender it did not itself send as.
//
// GUARDED: dry-run by default, --apply to write, --user <uid-or-prefix> to scope.
//   npx tsx --env-file=.env.local scripts/sweep-self-echoes.ts --user <uid> [--apply]
//
// WHAT IT DOES, and what it deliberately does NOT:
//   • STAMP — every standing self-echo item gets `source_data.self_echo = true`. A POSTURE, not a
//     hiding: the row stays in its lane, findable. The user's own `type_override` outranks the
//     stamp permanently (the precedence chain), so the repair is reversible by the person it serves.
//   • RESOLVE THE DUPLICATES — within a cluster of self-echo rows that are the SAME pointer
//     (near-identical wording, the extractor's own token test), exactly ONE canonical survives:
//       – a commitment minted from one of them, if there is one (the durable surface wins), else
//       – the NEWEST row (the freshest reminder is the live pointer).
//     The rest are DISMISSED through the same undoable door as every other machine closure
//     (activity type `dismissed` + entityType `inbox_item` → /api/restore brings it back). Never
//     deleted; the mail itself is untouched.
//   • COMMITMENTS — an open commitment minted FROM own-coworker mail is a debt to one's own
//     assistant. Dismissed through the same undoable door, with an auditable resolved_reason.
//   • A LONE self-echo row with no duplicate is STAMPED and LEFT STANDING. It is a pointer, and the
//     serving floors already posture it; resolving a lone pointer would hide the only trace of a
//     real deliverable that arrived by mail.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { logActivity } from '../lib/activity/log';
import { isNearDuplicate } from '../lib/commitments/extract';
import { itemIsSelfEcho, ownCoworkerLocals } from '../lib/inbox/self-echo';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const titleOf = (it: Row) => String((it.source_data ?? {}).subject ?? it.work_title ?? '');
const senderOf = (it: Row) => String((it.source_data ?? {}).from_address ?? '');

/** THE POINTER CLUSTER — self-echo rows that chase the SAME thing. Greedy, deterministic, on the
 *  extractor's OWN near-duplicate test (one text law, never a second one). The bar is the house's
 *  PURE-TEXT floor (0.6, lib/home/dedupe-deck): these rows share no structural tie — each reminder
 *  is its own thread — so only strong wording counts. */
const CLUSTER_FLOOR = 0.6;

/** A DELIVERY IS NOT A POINTER (found by running the dry-run: twenty-two weekly briefings, each a
 *  DIFFERENT report, read as one repeated ask because their subjects are one template).
 *
 *  Two guards, both structural:
 *  1. THE PERIOD GUARD — a title naming a period ("week of 2026-07-08", "KW 38", "Q2") is about
 *     THAT period. Two titles whose period markers are disjoint are two different things, however
 *     identical the rest of the words. (The text test strips dates, which is exactly why it cannot
 *     see this.)
 *  2. THE STANDING-ASK GUARD (applied by the caller) — only rows standing as an ASK are resolved.
 *     A delivery filed as `noted` claims no seat, so folding it would buy nothing and could hide
 *     the only trace of a report that really arrived. */
const PERIOD_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|kw\s?\d{1,2}|q[1-4]\b|\b(19|20)\d{2}\b)/gi;

export function periodMarkers(title: string): Set<string> {
  return new Set((String(title).toLowerCase().match(PERIOD_RE) ?? []).map((m) => m.replace(/\s+/g, '')));
}

export function namesDifferentPeriod(a: string, b: string): boolean {
  const pa = periodMarkers(a), pb = periodMarkers(b);
  if (!pa.size || !pb.size) return false;              // one of them names no period — no evidence
  for (const m of pa) if (pb.has(m)) return false;     // they share one — the same period
  return true;                                         // both name periods, none shared
}

export function samePointer(a: string, b: string): boolean {
  return isNearDuplicate(a, b, CLUSTER_FLOOR) && !namesDifferentPeriod(a, b);
}

function clusterPointers(items: Row[]): Row[][] {
  const clusters: Row[][] = [];
  for (const it of items) {
    const t = titleOf(it);
    if (!t) continue;
    const home = clusters.find((c) => c.every((r) => samePointer(titleOf(r), t)));
    if (home) home.push(it); else clusters.push([it]);
  }
  return clusters;
}

/** Is this row standing as an ASK (would it claim a seat), as opposed to a filed delivery? */
function standsAsAsk(it: Row): boolean {
  const or = String(it.type_override || '');
  if (or === 'needs_reply' || or === 'to_do' || or === 'waiting_on') return true;
  const rt = String(it.rule_type || '');
  if (rt === 'fyi' || rt === 'notifications' || rt === 'marketing' || rt === 'done') return false;
  const ws = String(it.work_state || '');
  if (ws === 'noted' || ws === 'noise') return rt === 'needs_reply' || rt === 'to_do' || rt === 'waiting_on';
  return true;
}

async function sweepUser(uid: string): Promise<{ stamped: number; resolved: number; commitments: number }> {
  const locals = await ownCoworkerLocals(sb, uid);
  // PAGED (the PostgREST 1000-row cap — the repo's oldest lesson): a partial read here would leave
  // half a cluster standing and dismiss the other half.
  const items = await fetchAllRows<Row>((f, t) => sb.from('inbox_items')
    .select('id, work_title, status, work_state, rule_type, type_override, source_id, source_data, created_at')
    .eq('user_id', uid).eq('status', 'pending').order('created_at', { ascending: false }).range(f, t));
  const echoes = items.filter((it) => itemIsSelfEcho(it, locals));
  if (!echoes.length) return { stamped: 0, resolved: 0, commitments: 0 };

  console.log(`\n══ ${uid.slice(0, 8)} — ${echoes.length} standing rows from our own coworkers (of ${items.length} open)`);

  // ── COMMITMENTS minted from own-coworker mail (any of them, not just the standing ones). ───────
  const allItems = await fetchAllRows<Row>((f, t) => sb.from('inbox_items')
    .select('id, source_data').eq('user_id', uid).order('created_at', { ascending: false }).range(f, t));
  const echoItemIds = new Set(allItems.filter((it) => itemIsSelfEcho(it, locals)).map((it) => String(it.id)));
  const comms = await fetchAllRows<Row>((f, t) => sb.from('commitments')
    .select('id, description, status, direction, source, source_id, due_date, created_at')
    .eq('user_id', uid).in('status', ['open', 'pending']).order('created_at', { ascending: false }).range(f, t));
  const commEchoes = comms.filter((c) => c.source_id && echoItemIds.has(String(c.source_id)));

  // ── THE CLUSTERS ───────────────────────────────────────────────────────────────────────────────
  const clusters = clusterPointers(echoes.filter(standsAsAsk));
  const toStamp = echoes.filter((it) => !it.type_override && (it.source_data ?? {}).self_echo !== true);
  const protectedByUser = echoes.filter((it) => !!it.type_override).length;
  const toResolve: Array<{ row: Row; keptBy: string }> = [];
  for (const c of clusters) {
    if (c.length < 2) continue;
    const ids = new Set(c.map((r) => String(r.id)));
    const anchorComm = commEchoes.find((m) => ids.has(String(m.source_id)));
    // Newest first is the read order, so c[0] is the freshest reminder.
    const keeper = anchorComm ? null : c[0];
    const keptBy = anchorComm
      ? `commitment "${String(anchorComm.description).slice(0, 48)}"`
      : `the newest row (${String(c[0].created_at).slice(0, 10)})`;
    for (const r of c) {
      if (keeper && String(r.id) === String(keeper.id)) continue;
      if (r.type_override) continue; // the user's own re-type outranks the floor
      toResolve.push({ row: r, keptBy });
    }
  }

  console.log(`   CLUSTERS — ${clusters.length} distinct pointers · ${clusters.filter((c) => c.length > 1).length} standing more than once`);
  for (const c of clusters.filter((x) => x.length > 1)) {
    console.log(`     · ×${c.length} "${titleOf(c[0]).slice(0, 64)}"`);
    for (const r of c) console.log(`         ${String(r.created_at).slice(0, 10)} ${senderOf(r)} :: ${titleOf(r).slice(0, 58)}`);
  }
  console.log(`   ITEMS — ${toStamp.length} to stamp · ${toResolve.length} duplicate pointers to resolve · ${protectedByUser} protected by the user's own re-type`);
  for (const r of toResolve.slice(0, 25)) console.log(`     · dismiss "${titleOf(r.row).slice(0, 58)}" — kept: ${r.keptBy}`);
  if (toResolve.length > 25) console.log(`     … and ${toResolve.length - 25} more`);
  console.log(`   COMMITMENTS — ${comms.length} open · ${commEchoes.length} minted from our own coworkers' mail`);
  for (const c of commEchoes.slice(0, 25)) console.log(`     · ${String(c.description).slice(0, 66)} (due ${c.due_date ?? '—'})`);

  if (APPLY) {
    const now = new Date().toISOString();
    for (const it of toStamp) {
      await sb.from('inbox_items')
        .update({ source_data: { ...(it.source_data ?? {}), self_echo: true, self_echo_sender: senderOf(it) } })
        .eq('id', it.id).eq('user_id', uid);
    }
    for (const { row, keptBy } of toResolve) {
      const sd = (row.source_data ?? {}) as Row;
      await sb.from('inbox_items').update({
        status: 'dismissed',
        source_data: { ...sd, self_echo: true, self_echo_sender: senderOf(row), resolved_at: now, resolution_reason: 'self_echo_duplicate' },
        updated_at: now,
      }).eq('id', row.id).eq('user_id', uid);
      await logActivity(sb, uid, {
        type: 'dismissed',
        title: `Folded a repeat reminder: ${titleOf(row).slice(0, 70)}`,
        entityType: 'inbox_item', entityId: String(row.id),
        metadata: { reason: 'self_echo_duplicate', kept: keptBy },
      }).catch(() => {});
    }
    for (const c of commEchoes) {
      await sb.from('commitments').update({
        status: 'dismissed', resolved_reason: 'self_echo', resolved_at: now,
      }).eq('id', c.id).eq('user_id', uid);
      await logActivity(sb, uid, {
        type: 'commitment_dismissed',
        title: `Dropped "${String(c.description).slice(0, 70)}" — minted from our own team's mail`,
        entityType: 'commitment', entityId: String(c.id),
        metadata: { reason: 'self_echo' },
      }).catch(() => {});
    }
  }

  console.log(`   ${APPLY ? 'APPLIED' : 'DRY RUN'} — stamped ${toStamp.length} · resolved ${toResolve.length} · commitments ${commEchoes.length}`);
  return { stamped: toStamp.length, resolved: toResolve.length, commitments: commEchoes.length };
}

(async () => {
  const { data } = await sb.from('profiles').select('id');
  let ids = ((data ?? []) as Row[]).map((p) => String(p.id));
  if (ONLY) {
    ids = ids.filter((id) => id === ONLY || id.startsWith(ONLY));
    if (!ids.length) { console.error(`no user matches "${ONLY}"`); process.exit(1); }
  }
  const total = { stamped: 0, resolved: 0, commitments: 0 };
  for (const uid of ids) {
    const r = await sweepUser(uid).catch((e) => { console.error(`  ! ${uid.slice(0, 8)}:`, e?.message ?? e); return null; });
    if (r) { total.stamped += r.stamped; total.resolved += r.resolved; total.commitments += r.commitments; }
  }
  console.log(`\nTOTAL — stamped ${total.stamped} · resolved ${total.resolved} · commitments ${total.commitments}`);
  console.log(APPLY ? '✅ applied' : 'ℹ️  dry run — re-run with --apply to write');
})();
