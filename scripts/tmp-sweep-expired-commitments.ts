// ════════════════════════════════════════════════════════════════════════════════════════════════
// RETRO-REPAIR BY LAW — LAW 2 · THE EXPIRY LAW over the STANDING BACKLOG (proactive-reach arc).
//
// The live lane (app/api/cron/commitments-sweep) applies the law to what passes through it from
// now on. The backlog — obligations that lapsed months ago and have been nagging ever since —
// needs the SAME lane run over it once. Nothing is hand-picked: the same deterministic nomination
// (open + past due on the USER'S clock), the same judge, the same asymmetry (only `expired`
// closes), the same undoable close. The law's own asymmetry is the proof: an unpaid bill comes
// back `still_owed` and keeps its seat.
//
//   npx tsx scripts/tmp-sweep-expired-commitments.ts [--apply] [--user email] [--all] [--cap 60]
//
// Dry-run by default (prints the table of verdicts it WOULD reach; the judge's verdicts cache, so
// the --apply run costs nothing extra). Guarded: one user unless --all, per-user cap.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { userTimezone, localNow } from '../lib/utils/user-time';
import { isPastDue, judgeCommitmentExpiry, applyExpiryVerdict } from '../lib/commitments/expiry';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const CAP = Number(process.argv[process.argv.indexOf('--cap') + 1]) || 60;
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  if (!ALL && !userArg) console.log('(no --user / --all given — defaulting to the signed-in owner account)');
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? process.env.SWEEP_DEFAULT_USER ?? ''));
  if (!targets.length) { console.log('no target user resolved — pass --user <email> or --all'); process.exit(1); }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · ${targets.length} user(s) · cap ${CAP}/user\n`);

  let nominated = 0, expiredN = 0, stillOwed = 0, unclear = 0;
  for (const u of targets) {
    const today = localNow(await userTimezone(sb, u.id)).dateStr;
    const { data: rows } = await sb.from('commitments')
      .select('id, user_id, description, direction, due_date, counterparty, source, created_at, status')
      .eq('user_id', u.id).eq('status', 'open')
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true })
      .limit(500);
    const past = (rows ?? []).filter((c) => isPastDue(c, today));
    if (!past.length) continue;
    console.log(`── ${u.email} · today ${today} · ${past.length} past-due open commitment(s)\n`);
    console.log('  id        | due        | verdict     | obligation');
    for (const c of past.slice(0, CAP)) {
      nominated++;
      const v = await judgeCommitmentExpiry(sb, u.id, c, today);
      if (v.verdict === 'expired') expiredN++; else if (v.verdict === 'still_owed') stillOwed++; else unclear++;
      console.log(`  ${String(c.id).slice(0, 8)}  | ${c.due_date} | ${v.verdict.padEnd(11)} | ${clip(String(c.description).replace(/\s+/g, ' '), 70)}`);
      console.log(`             ${' '.repeat(12)}  ${' '.repeat(11)}   ↳ ${clip(v.reason, 110)}`);
      if (APPLY) {
        const closedNow = await applyExpiryVerdict(sb, u.id, c, v);
        if (closedNow) {
          await sb.from('profiles').update({ home_brief: null }).eq('id', u.id); // the deck must forget it
          console.log(`             → CLOSED (undoable: activity 'commitment_expired')`);
        }
      }
    }
    if (past.length > CAP) console.log(`  … ${past.length - CAP} left behind by the cap (re-run)`);
    console.log('');
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — nominated ${nominated} · expired ${expiredN} · still_owed ${stillOwed} · unclear ${unclear}`);
  process.exit(0);
})();
