// ════════════════════════════════════════════════════════════════════════════════════════════════
// REPAIR LEDGER — STALE "WAITING" ROWS (stabilization W8.3, THE LIST SAYS ONLY WHAT WAS JUDGED).
//
// The fix is READ-TIME DERIVATION, so this script writes NOTHING: the held reader
// (lib/deeds/held-members.ts → lib/home/attention.ts) now files a deck-eligible row with no cached
// judgment as "Not yet judged", re-applies the kind floor to verdicts cached under an older
// JUDGE_VERSION, and keeps a past-dated unjudged event out of Waiting. This dry run is the census:
// per user, every row that WAS in the waiting band under the old law and is not under the new one,
// with the reason —
//   · not_judged:stale     — no verdict; the only "work" evidence is a pre-mailKind understanding
//   · not_judged:passed    — no verdict; its stated date is behind today
//   · not_judged:unvisited — no verdict on a current understanding (the judge has not visited it)
//   · kind_floor:<class>   — an unsolicited / notice kind the current law floors (bulk_mail / notices)
//   · other:<class>        — anything else that moved
//
// `--apply --yes` is accepted for the house's repair grammar and REFUSES to write: there is nothing
// the reader needs stamped. (Re-judging is the judgment sweep's job, under its own budget.)
// Zero AI. Read-only SELECTs through the ledger's own derivation.
//
//   npx tsx scripts/repair-stale-waiting.ts --user <email> | --prefix <uuid-prefix> | --all
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { deriveHeld } from '../lib/deeds/held-members';
import { classifyHeld, bandOf, statedDueOf, isStaleUnderstanding, type HeldFacts } from '../lib/home/attention';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const argOf = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const ALL = process.argv.includes('--all');
const userArg = argOf('--user');
const prefixArg = argOf('--prefix');
const APPLY = process.argv.includes('--apply');

/** The OLD law's view of the same facts: the two W8.3 facts withheld (three-valued → legacy). */
const legacy = (f: HeldFacts): HeldFacts => ({ ...f, neverJudged: undefined, judgedCurrent: undefined });

(async () => {
  if (!ALL && !userArg && !prefixArg) { console.log('usage: --user <email> | --prefix <uuid-prefix> | --all'); process.exit(1); }
  if (APPLY) console.log('⚠ --apply: this repair has NOTHING to write — the held reader derives the fix at read time. Running the census only.\n');
  const { data: list, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error || !list) { console.log(`could not list users: ${error?.message ?? 'no data'}`); process.exit(1); }
  const targets = list.users.filter((u) => ALL || (userArg && u.email === userArg) || (prefixArg && u.id.startsWith(prefixArg)));
  const today = new Date().toISOString().slice(0, 10);
  const totals: Record<string, number> = {};
  let before = 0, after = 0;
  for (const u of targets) {
    const d = await deriveHeld(sb as never, u.id, u.email ?? null);
    let b = 0, a = 0;
    const moved: Array<{ why: string; subject: string }> = [];
    for (const f of d.facts) {
      const oldCls = classifyHeld(legacy(f));
      const wasWaiting = bandOf(oldCls, legacy(f)) === 'waiting';
      const cls = classifyHeld(f);
      const isWaiting = bandOf(cls, f) === 'waiting';
      if (wasWaiting) b++;
      if (isWaiting) a++;
      if (!wasWaiting || isWaiting) continue;
      const sd = (f.item.source_data ?? {}) as Record<string, unknown>;
      const due = statedDueOf(f.item);
      const why = cls === 'not_judged'
        ? (due && due < today ? 'not_judged:passed' : isStaleUnderstanding(sd) ? 'not_judged:stale' : 'not_judged:unvisited')
        : (cls === 'bulk_mail' || cls === 'notices') ? `kind_floor:${cls}` : `other:${cls}`;
      totals[why] = (totals[why] ?? 0) + 1;
      moved.push({ why, subject: String(sd.subject ?? f.item.work_title ?? '(no subject)').slice(0, 80) });
    }
    before += b; after += a;
    if (!b && !a) continue;
    console.log(`\n${u.id.slice(0, 8)} · waiting ${b} → ${a} (${moved.length} leave Waiting)`);
    for (const m of moved) console.log(`  · ${m.why.padEnd(20)} ${m.subject}`);
  }
  console.log(`\nTOTAL · waiting ${before} → ${after}`);
  for (const [k, v] of Object.entries(totals).sort((x, y) => y[1] - x[1])) console.log(`  ${k}: ${v}`);
  console.log('\nNothing was written (read-time derivation).');
})();
