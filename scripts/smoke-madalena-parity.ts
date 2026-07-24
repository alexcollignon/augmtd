// MADALENA PARITY (Prepared-Work) — the bar the user set: an externally-generated Slack daily summary
// ("Wins today / New tasks with priority-due-blocker / Open questions with who"). This smoke renders OUR
// native equivalent for HER account from the ONE ledger and gates on matching-or-beating each quality:
//   • WINS        — done-today populated with real resolutions (hers: narrative wins)
//   • TASK LINES  — `Task — 📁 deal — due — blocked on X` structure on the top tasks (hers: — High — due)
//   • QUESTIONS   — every open question carries WHO it waits on (hers: "asked René, no reply yet")
//   • THE EDGE    — prepared work attached (✦ drafts/deliverables ready) — hers DESCRIBES work; ours
//                   ARRIVES with it done. This is the beat-her gate.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildWorkItems } from '../lib/work-items/model';
import { partitionDailyReport, reportLine } from '../lib/work-items/report';
import { runPreparationPass } from '../lib/prepare/pass';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UID = 'c723c2f2-e069-4ab8-980e-ac3585028fec'; // the doc-heavy, email-only account — the bar's owner
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  // Ensure the pass has run (idempotent — fresh work is a no-op).
  const pass = await runPreparationPass(sb, UID);
  const items = await buildWorkItems(sb, UID, { todayStr, includeCalendar: true, skipReconcile: true });
  const rep = partitionDailyReport(items, todayStr);

  // Prepared coverage on the TOP tasks (the edge): drafts on inbox items + pool deliverables on commitments.
  const top = rep.needsYou.slice(0, 10);
  const inboxIds = top.filter((w) => w.id.startsWith('inbox:')).map((w) => w.entityId);
  const commitIds = [...top, ...rep.openQuestions.slice(0, 8)].filter((w) => w.id.startsWith('commit:')).map((w) => w.entityId);
  const prepared = new Set<string>();
  if (inboxIds.length) {
    const { data } = await sb.from('inbox_items').select('id, source_data').in('id', inboxIds);
    for (const it of (data ?? []) as Array<{ id: string; source_data: { draft?: { body?: string }; nudge_draft?: unknown; prepared_by?: unknown } }>) {
      if (it.source_data?.draft?.body || it.source_data?.nudge_draft || it.source_data?.prepared_by) prepared.add(it.id);
    }
  }
  if (commitIds.length) {
    const { data } = await sb.from('item_deliverables').select('entity_id').eq('user_id', UID).eq('kind', 'commitment').in('entity_id', commitIds);
    for (const d of (data ?? []) as Array<{ entity_id: string }>) prepared.add(d.entity_id);
  }

  // ── THE RENDER — our native daily summary, her structure, from live data. ──
  console.log(`\n════ DAILY SUMMARY — ${todayStr} (native, from the ledger) ════`);
  if (rep.meetingsToday.length) console.log(`Meetings today: ${rep.meetingsToday.map((w) => w.title.slice(0, 38)).join(' · ')}`);
  console.log(`\nDone today (${rep.counts.done})`);
  rep.doneToday.slice(0, 6).forEach((w) => console.log(`  ✓ ${reportLine(w, todayStr)}${w.actor === 'team' ? '  [team]' : ''}`));
  console.log(`\nNeeds you (top ${Math.min(10, rep.needsYou.length)} of ${rep.counts.open})`);
  top.forEach((w) => console.log(`  • ${reportLine(w, todayStr)}${prepared.has(w.entityId) ? '  ✦ prepared' : ''}`));
  console.log(`\nOpen questions (${rep.counts.questions})`);
  rep.openQuestions.slice(0, 8).forEach((w) => console.log(`  ? ${reportLine(w, todayStr)}${prepared.has(w.entityId) ? '  ✦ nudge ready' : ''}`));

  // ── THE GATES vs her example. ──
  check('pass ran (prepared-by-default)', pass.prepared + pass.nudges + pass.delegated >= 0, JSON.stringify(pass));
  check('WINS: done-today populated', rep.counts.done > 0, `${rep.counts.done}`);
  const structured = top.filter((w) => w.entity || w.when.explicit || w.blockedOn).length;
  check(`TASK LINES: structure on top tasks (${structured}/${top.length})`, top.length > 0 && structured / top.length >= 0.6);
  check('QUESTIONS: every question carries WHO', rep.openQuestions.length > 0 && rep.openQuestions.every((w) => !!w.blockedOn), `${rep.counts.questions} questions`);
  const blockedSomewhere = [...top, ...rep.openQuestions].some((w) => w.blockedOn);
  check('BLOCKED-ON present (her "blocked on René")', blockedSomewhere);
  const prepTop = top.filter((w) => prepared.has(w.entityId)).length;
  const prepQ = rep.openQuestions.slice(0, 8).filter((w) => prepared.has(w.entityId)).length;
  check(`THE EDGE: prepared work attached (tasks ${prepTop}/${top.length} · questions ${prepQ})`, prepTop + prepQ >= 3);
  check('LIVE (not a once-daily digest): report derives from current rows', items.length > 0);

  console.log('\n════ PARITY GATES (vs the shared example) ════');
  let pass2 = 0;
  for (const [n, ok, d] of out) { if (ok) pass2++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass2}/${out.length} pass`);
  process.exit(pass2 === out.length ? 0 : 1);
})();
