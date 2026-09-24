// LAW 4 fidelity proof (temporary, untracked). Read-only except the nominations it is asked to
// write for real. Run: npx tsx --env-file=.env.local scripts/tmp-law4-fidelity.ts [--apply]
import { createClient } from '@supabase/supabase-js';
import { findSiblingThreads, readThreadFacts, cascadeConversationSettlement, normalizeRfcId } from '../lib/inbox/conversation-identity';

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const GM = '1a0624df9a5834d8';
const OUT = 'AAQkADYwY2QzNjE2LTYyNWItNGM4ZS1iM2E5LTI5ZDM3ZDI2NGE3MQAQAHJ3wftGn0QLuCXf9AKELM4=';
const short = (s: string) => (s.length > 26 ? `${s.slice(0, 12)}…${s.slice(-8)}` : s);

async function main() {
  const { data: profs } = await sb.from('profiles').select('id').limit(500);
  const uid = (profs ?? []).map((p) => p.id as string).find((id) => id.startsWith('08fe4449'))!;

  console.log('\n══ A · THE PROOF CASE — the split conversation');
  for (const [label, t] of [['gmail-side thread', GM], ['other-mailbox thread', OUT]] as const) {
    const sibs = await findSiblingThreads(sb, uid, t);
    console.log(`\n  from ${label} ${short(t)} → ${sibs.length} sibling(s)`);
    for (const s of sibs) {
      console.log(`    key=${s.key.padEnd(10)} thread=${short(s.threadId)}`);
      console.log(`      evidence: ${s.evidence}`);
      console.log(`      sibling lastInbound=${s.lastInboundAt ?? '-'}`);
      const { data: its } = await sb.from('inbox_items').select('id, status, work_title, source_data')
        .eq('user_id', uid).eq('source_data->>thread_id', s.threadId);
      for (const it of (its ?? []) as any[]) {
        console.log(`      item ${it.id.slice(0, 8)} ${it.status.padEnd(9)} "${it.work_title}" settled=${it.source_data?.resolved_at ?? '-'}`);
      }
    }
  }

  console.log('\n══ B · ACCOUNT SWEEP — every open item whose conversation was settled elsewhere');
  // ONE scan of the corpus, grouped structurally by shared RFC ids (zero AI, the bridge key only).
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('emails').select('thread_id, message_id, in_reply_to, references_ids, received_at, is_from_user')
      .eq('user_id', uid).order('id').range(from, from + 999);
    rows.push(...((data ?? []) as any[]));
    if (!data || data.length < 1000) break;
  }
  const idToThreads = new Map<string, Set<string>>();
  const lastInbound = new Map<string, string>();
  for (const r of rows) {
    const t = String(r.thread_id ?? ''); if (!t) continue;
    if (!r.is_from_user && r.received_at) {
      const prev = lastInbound.get(t); if (!prev || prev < r.received_at) lastInbound.set(t, String(r.received_at));
    }
    for (const v of [r.message_id, r.in_reply_to, ...(Array.isArray(r.references_ids) ? r.references_ids : [])]) {
      const id = normalizeRfcId(v); if (!id) continue;
      if (!idToThreads.has(id)) idToThreads.set(id, new Set());
      idToThreads.get(id)!.add(t);
    }
  }
  const neighbours = new Map<string, Map<string, string>>(); // thread → sibling → shared id
  for (const [id, ts] of idToThreads) {
    if (ts.size < 2) continue;
    for (const a of ts) for (const b of ts) {
      if (a === b) continue;
      if (!neighbours.has(a)) neighbours.set(a, new Map());
      if (!neighbours.get(a)!.has(b)) neighbours.get(a)!.set(b, id);
    }
  }
  console.log(`  corpus: ${rows.length} messages · ${new Set(rows.map((r) => r.thread_id)).size} threads · ${neighbours.size} threads with a structural sibling`);

  const items: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('inbox_items').select('id, status, work_title, source_data, created_at')
      .eq('user_id', uid).eq('source', 'email').order('id').range(from, from + 999);
    items.push(...((data ?? []) as any[]));
    if (!data || data.length < 1000) break;
  }
  const byThread = new Map<string, any[]>();
  for (const it of items) {
    const t = String(it.source_data?.thread_id ?? ''); if (!t) continue;
    if (!byThread.has(t)) byThread.set(t, []);
    byThread.get(t)!.push(it);
  }
  console.log('  debug: OUT in neighbours?', neighbours.has(OUT), '| GM in neighbours?', neighbours.has(GM), '| items on OUT', (byThread.get(OUT) ?? []).length, '| items on GM', (byThread.get(GM) ?? []).length);
  const table: string[] = [];
  const toNominate: Array<{ settledThread: string; settledAt: string; openItem: any; sibling: string }> = [];
  for (const [t, sibs] of neighbours) {
    const open = (byThread.get(t) ?? []).filter((i) => i.status === 'pending');
    if (!open.length) continue;
    for (const [sib] of sibs) {
      const settled = (byThread.get(sib) ?? []).filter((i) => i.status === 'completed' || i.status === 'dismissed');
      for (const s of settled) {
        const settledAt = String(s.source_data?.resolved_at ?? s.source_data?.resolution_at ?? '');
        const moved = (lastInbound.get(t) ?? '') > settledAt;
        for (const o of open) {
          table.push(`  open ${o.id.slice(0, 8)} "${String(o.work_title).slice(0, 42)}"\n` +
            `     sibling ${short(sib)} settled ${settledAt.slice(0, 10) || '?'} — "${String(s.work_title).slice(0, 42)}"\n` +
            `     key=rfc_bridge · sibling-inbound-since-settle=${moved} → ${moved || !settledAt ? 'NOMINATE' : 'CASCADE'}`);
          toNominate.push({ settledThread: sib, settledAt: settledAt || new Date().toISOString(), openItem: o, sibling: t });
        }
      }
    }
  }
  console.log(table.length ? table.join('\n') : '  (no open item has a settled structural sibling)');

  if (APPLY && toNominate.length) {
    console.log('\n══ C · NOMINATING FOR REAL (through the one door)');
    const seen = new Set<string>();
    for (const n of toNominate) {
      if (seen.has(n.settledThread)) continue; seen.add(n.settledThread);
      const r = await cascadeConversationSettlement(sb, uid, {
        threadId: n.settledThread, settledAt: n.settledAt, via: 'law-4 fidelity sweep',
      });
      console.log(`  from settled thread ${short(n.settledThread)} → siblings=${r.siblings} bridged=${r.bridged} reasoned=${r.reasoned} cascaded=${JSON.stringify(r.cascaded.map((x) => x.slice(0, 8)))} nominated=${JSON.stringify(r.nominated.map((x) => x.slice(0, 14)))}`);
    }
  }

  const f = await readThreadFacts(sb, uid, GM);
  console.log(`\n  (thread facts sanity: ${f?.rfcIds.length} rfc ids · ${f?.participants.length} participants · subjects ${JSON.stringify(f?.subjects)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
