// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONVERSATION HOARD REPAIR (W8.2 · ONE CONVERSATION, ONE LIVE ITEM). GUARDED; DRY-RUN BY DEFAULT.
//
// Before W8.2 every new message on a conversation EXTRACTED new commitments and nothing reconsidered
// the older open ones — one client thread on the reference account held ~20 open rows. This repair
// heals history with THE SAME law the write path now runs:
//
//   ZERO-AI PART (always computed):
//     · NAME VARIANTS — each open row's counterparty through `foldCounterparty` (the write door's own
//       fold: the person registry, then the conversation's own forms) → the canonical form.
//     · DUE BEFORE SOURCE — `dueFloorAgainstSource` against the source's own date (email received_at /
//       meeting start): the due is nulled; a title naming that past date is dismissed `past_at_source`.
//   AI PART (only with --judge; otherwise a CENSUS + a cost estimate, zero calls):
//     · groups open commitments by conversation (email thread, ≥2 live rows), walks the thread's later
//       messages OLDEST → NEWEST and runs THE SAME delta pass (lib/work/conversation-delta.ts —
//       `judgeConversationDelta` + `applyDeltaPlan`) with the items open BEFORE each message and the
//       rows born OF it as candidates. `delivered` is only NOMINATED (dry-run) / sent to the one
//       fulfillment judge (--apply) — only a judged delivery closes.
//
//   npx tsx scripts/repair-conversation-hoard.ts --user <id-prefix> [--limit N]     dry run, zero AI
//   npx tsx scripts/repair-conversation-hoard.ts --all                               dry run, zero AI + estimate
//   npx tsx scripts/repair-conversation-hoard.ts --user <p> --judge [--limit N]      dry run WITH the AI pass
//   ... --apply --yes                                                                 write the zero-AI part
//   ... --judge --apply --yes                                                         write both parts
//
// Every write is a conditional claim (the row still live, the value as read); every dismissal is a
// REVERSIBLE commitment_dismissed activity row (/api/restore reopens it). Output is MASKED (titles as
// their first word + length, parties as shapes) unless --show.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { getPersonEntities } from '../lib/entities/people';
import { foldCounterparty, dueFloorAgainstSource } from '../lib/commitments/extract';
import { topMessageOf } from '../lib/inbox/top-message';
import {
  judgeConversationDelta, applyDeltaPlan, factoryJudge, capOpen, emptyReport,
  type DeltaOpenItem, type DeltaCandidate, type DeltaMessage, type DeltaReport,
} from '../lib/work/conversation-delta';

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const val = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] ?? null : null);
const APPLY = flag('--apply');
const YES = flag('--yes');
const ALL = flag('--all');
const JUDGE = flag('--judge');
const SHOW = flag('--show');
const USER = val('--user');
const LIMIT = val('--limit') != null && Number.isFinite(Number(val('--limit'))) ? Math.max(0, Number(val('--limit'))) : Infinity;
/** Later messages one group may be walked through (the rest are reported, never silently dropped). */
const MAX_MESSAGES_PER_GROUP = 30;
/** €/call — classification tier (~2.5k in / ~0.8k out incl. reasoning) + the fulfillment judge's share. */
const EST_EUR_PER_CALL = 0.004;

type Row = {
  id: string; user_id: string; description: string; direction: string | null; counterparty: string | null;
  due_date: string | null; created_at: string | null; status: string; thread_id: string | null;
  source: string | null; source_id: string | null;
};
type Mail = { id: string; received_at: string | null; is_from_user: boolean | null; subject: string | null; body: string | null };

const mask = (s: string | null | undefined): string => {
  const t = String(s ?? '').trim();
  if (SHOW) return JSON.stringify(t);
  if (!t) return '∅';
  if (t.includes('@') && !/\s/.test(t)) return '<address>';
  const words = t.split(/\s+/);
  return `${words[0]}…(${t.length}ch)`;
};
const partyShape = (s: string | null | undefined): string => {
  if (SHOW) return JSON.stringify(s ?? null);
  const t = String(s ?? '').trim();
  if (!t) return '∅';
  if (/<[^>]+@/.test(t)) return `Name(${t.replace(/<[^>]*>/, '').trim().split(/\s+/).length})<addr>`;
  if (t.includes('@')) return '<address>';
  return `Name(${t.split(/\s+/).length})`;
};

async function main() {
  if (!USER && !ALL) { console.log('usage: --user <id-prefix> | --all  [--limit N] [--judge] [--apply --yes] [--show]'); process.exit(1); }
  if (APPLY && !YES) { console.log('--apply needs --yes (owner-gated write)'); process.exit(1); }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // ── the live commitments, paged (NO SILENT CAPS) ──
  const all = await fetchAllRows<Row>((from, to) => sb.from('commitments')
    .select('id, user_id, description, direction, counterparty, due_date, created_at, status, thread_id, source, source_id')
    .in('status', ['open', 'suggested']).order('id', { ascending: true }).range(from, to), { maxRows: 50_000 });
  const users = [...new Set(all.map((r) => r.user_id))].filter((u) => ALL || (USER && u.startsWith(USER)));
  if (!users.length) { console.log('no user with live commitments matches'); return; }

  const tot = { names: 0, dueNulled: 0, pastDropped: 0, groups: 0, groupsLeft: 0, calls: 0, msgsLeft: 0, writes: 0 };
  const agg: DeltaReport = emptyReport();

  for (const uid of users) {
    const rows = all.filter((r) => r.user_id === uid);
    console.log(`\n▸ user ${uid.slice(0, 8)} · ${rows.length} live commitments`);
    const persons = await getPersonEntities(sb as never, uid).catch(() => []);

    // ── source dates (email received_at · meeting start) ──
    const srcAt = new Map<string, string>();
    const emailIds = [...new Set(rows.filter((r) => r.source === 'email' && r.source_id).map((r) => r.source_id!))];
    for (let i = 0; i < emailIds.length; i += 100) {
      const { data, error } = await sb.from('emails').select('id, received_at').eq('user_id', uid).in('id', emailIds.slice(i, i + 100));
      if (error) { console.log(`  ✗ emails read: ${error.message}`); continue; }
      for (const e of (data ?? []) as Array<{ id: string; received_at: string | null }>) if (e.received_at) srcAt.set(e.id, e.received_at);
    }
    const mtIds = [...new Set(rows.filter((r) => r.source === 'meeting' && r.source_id).map((r) => r.source_id!))];
    for (let i = 0; i < mtIds.length; i += 100) {
      const { data, error } = await sb.from('meeting_transcripts').select('id, start_time, created_at').eq('user_id', uid).in('id', mtIds.slice(i, i + 100));
      if (error) { console.log(`  ✗ transcripts read: ${error.message}`); continue; }
      for (const m of (data ?? []) as Array<{ id: string; start_time: string | null; created_at: string | null }>) {
        const at = m.start_time ?? m.created_at; if (at) srcAt.set(m.id, at);
      }
    }
    const sourceTime = (r: Row) => (r.source_id && srcAt.get(r.source_id)) || r.created_at || '';

    // ── ZERO-AI PART A: name variants → the canonical form ──
    for (const r of rows) {
      if (!r.counterparty) continue;
      const conv = r.thread_id ? rows.filter((x) => x.thread_id === r.thread_id && x.id !== r.id).map((x) => x.counterparty) : [];
      const folded = foldCounterparty(r.counterparty, persons, conv);
      if (!folded || folded === r.counterparty) continue;
      tot.names++;
      console.log(`  name   ${partyShape(r.counterparty)} → ${partyShape(folded)}  on ${mask(r.description)}`);
      if (APPLY) {
        const { data, error } = await sb.from('commitments').update({ counterparty: folded, updated_at: new Date().toISOString() })
          .eq('id', r.id).eq('user_id', uid).eq('counterparty', r.counterparty).in('status', ['open', 'suggested']).select('id');
        if (error) console.log(`    ✗ ${error.message}`); else if (data?.length) { tot.writes++; r.counterparty = folded; }
      }
    }

    // ── ZERO-AI PART B: due before its own source ──
    for (const r of rows) {
      if (!r.due_date) continue;
      const f = dueFloorAgainstSource(r.due_date, sourceTime(r) || null, r.description);
      if (!f.floored) continue;
      if (f.drop) tot.pastDropped++; else tot.dueNulled++;
      console.log(`  due    ${r.due_date} < source ${sourceTime(r).slice(0, 10)} → ${f.drop ? 'dismiss past_at_source' : 'null'}  on ${mask(r.description)}`);
      if (!APPLY) continue;
      const nowIso = new Date().toISOString();
      const { data, error } = f.drop
        ? await sb.from('commitments').update({ status: 'dismissed', resolved_reason: 'past_at_source', resolved_at: nowIso, updated_at: nowIso })
          .eq('id', r.id).eq('user_id', uid).eq('due_date', r.due_date).in('status', ['open', 'suggested']).select('id')
        : await sb.from('commitments').update({ due_date: null, updated_at: nowIso })
          .eq('id', r.id).eq('user_id', uid).eq('due_date', r.due_date).in('status', ['open', 'suggested']).select('id');
      if (error) { console.log(`    ✗ ${error.message}`); continue; }
      if (data?.length) {
        tot.writes++;
        if (f.drop) {
          r.status = 'dismissed';
          const { logActivity } = await import('../lib/activity/log');
          await logActivity(sb, uid, { type: 'commitment_dismissed', title: `Already past at its source: ${r.description}`, entityType: 'commitment', entityId: r.id, metadata: { reason: 'past_at_source', auto: true, via: 'repair-conversation-hoard' } });
        } else r.due_date = null;
      }
    }

    // ── AI PART: the conversation hoard, oldest → newest ──
    const byThread = new Map<string, Row[]>();
    for (const r of rows) if (r.thread_id && r.status !== 'dismissed') (byThread.get(r.thread_id) ?? byThread.set(r.thread_id, []).get(r.thread_id)!).push(r);
    const groups = [...byThread.entries()].filter(([, g]) => g.length >= 2).sort((a, b) => b[1].length - a[1].length);
    const walked = groups.slice(0, Number.isFinite(LIMIT) ? LIMIT : groups.length);
    tot.groups += walked.length; tot.groupsLeft += groups.length - walked.length;
    if (groups.length > walked.length) console.log(`  (${groups.length - walked.length} group(s) left behind by --limit)`);

    for (const [threadId, g] of walked) {
      const earliest = g.map(sourceTime).filter(Boolean).sort()[0] ?? null;
      const { data: mailData, error: mErr } = await sb.from('emails').select('id, received_at, is_from_user, subject, body')
        .eq('user_id', uid).eq('thread_id', threadId).order('received_at', { ascending: true }).limit(500);
      if (mErr) { console.log(`  ✗ thread read: ${mErr.message}`); continue; }
      const mails = ((mailData ?? []) as Mail[]).filter((m) => m.received_at && (!earliest || m.received_at > earliest));
      const walk = mails.slice(0, MAX_MESSAGES_PER_GROUP);
      tot.msgsLeft += mails.length - walk.length;
      console.log(`  group  thread …${threadId.slice(-6)} · ${g.length} live · ${mails.length} later message(s)${mails.length > walk.length ? ` (${mails.length - walk.length} left behind)` : ''}`);
      const live = new Map(g.map((r) => [r.id, r]));
      for (const m of walk) {
        const openBefore = [...live.values()].filter((r) => r.source_id !== m.id && sourceTime(r) < m.received_at!);
        if (!openBefore.length) continue;
        const bornHere = [...live.values()].filter((r) => r.source_id === m.id);
        tot.calls++;
        if (!JUDGE) continue;
        const { kept: open, leftBehind } = capOpen(openBefore.map((r): DeltaOpenItem => ({
          id: r.id, description: r.description, direction: r.direction, counterparty: r.counterparty, due_date: r.due_date, created_at: sourceTime(r) || r.created_at, status: r.status,
        })));
        const candidates: DeltaCandidate[] = bornHere.map((r) => ({ id: r.id, description: r.description, direction: r.direction, counterparty: r.counterparty, due_date: r.due_date }));
        const message: DeltaMessage = { kind: 'email', id: m.id, text: topMessageOf(String(m.body ?? '')), at: m.received_at, authoredByUser: m.is_from_user, subject: m.subject };
        if (!message.text.trim()) continue;
        const plan = await judgeConversationDelta({ open, candidates, message, todayIso: new Date().toISOString().slice(0, 10) }, factoryJudge(sb, uid));
        const label = (id: string) => mask(live.get(id)?.description);
        for (const d of plan.items) if (d.action !== 'keep') console.log(`    ${m.received_at!.slice(0, 10)} ${d.action.padEnd(10)} ${label(d.id)}`);
        for (const c of plan.candidates) if (c.action === 'duplicate') console.log(`    ${m.received_at!.slice(0, 10)} duplicate  ${mask(candidates[c.index].description)} ≡ ${label(c.of)}`);
        if (plan.failed) console.log(`    ${m.received_at!.slice(0, 10)} pass failed — kept everything`);
        let rep: DeltaReport;
        if (APPLY) {
          rep = await applyDeltaPlan(sb, uid, { plan, open, candidates, message, leftBehind: leftBehind.length });
        } else {
          rep = emptyReport();
          for (const d of plan.items) {
            if (d.action === 'keep') rep.kept++; else if (d.action === 'update') rep.updated++;
            else if (d.action === 'superseded') rep.superseded++; else if (d.action === 'moot') rep.moot++;
            else rep.deliveredNominated++;
          }
          rep.duplicates = plan.candidates.filter((c) => c.action === 'duplicate').length;
          rep.leftBehind = leftBehind.length; rep.failed = plan.failed;
        }
        for (const k of Object.keys(agg) as Array<keyof DeltaReport>) {
          if (typeof agg[k] === 'number') (agg[k] as number) += Number(rep[k] ?? 0);
        }
        // The simulation carries forward: a settled row is no longer open for the next message.
        for (const d of plan.items) if (d.action === 'superseded' || d.action === 'moot') live.delete(d.id);
        for (const c of plan.candidates) if (c.action === 'duplicate' && candidates[c.index].id) live.delete(candidates[c.index].id!);
      }
    }
  }

  console.log('\n══ SUMMARY ══');
  console.log(`zero-AI: name variants=${tot.names} · due nulled=${tot.dueNulled} · past-at-source dismissals=${tot.pastDropped}`);
  console.log(`hoard:   groups walked=${tot.groups} (left by --limit: ${tot.groupsLeft}) · delta passes=${tot.calls} · messages left by the per-group cap=${tot.msgsLeft}`);
  if (JUDGE) {
    console.log(`plan:    kept=${agg.kept} updated=${agg.updated} superseded=${agg.superseded} moot=${agg.moot} delivered-nominated=${agg.deliveredNominated}${APPLY ? ` delivered-closed=${agg.deliveredClosed}` : ''} duplicates=${agg.duplicates} downgraded-by-floors=${agg.downgraded} open-left-by-cap=${agg.leftBehind}`);
  } else {
    console.log(`AI part not run (pass --judge). Estimated cost of --judge on this scope: ${tot.calls} classification call(s) ≈ €${(tot.calls * EST_EUR_PER_CALL).toFixed(2)} (+ one fulfillment judgment per delivered nomination, included in the per-call estimate).`);
  }
  console.log(APPLY ? `writes=${tot.writes} (zero-AI part)` : '(dry-run — pass --apply --yes to write)');
}

main().catch((e) => { console.error(e); process.exit(1); });
