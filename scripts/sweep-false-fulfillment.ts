// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FALSE-FULFILLMENT SWEEP (July 30) — re-judges recently AUTO-closed you_owe commitments under
// THE FULFILLMENT LAW (lib/commitments/fulfillment.ts): the structural resolvers used to close a
// deliverable-obligation on ANY user reply ("I'll send it by Sunday" → marked fulfilled — found
// live: the STC assessment report vanished from the Home while still owed by Aug 2).
//
// For each commitment auto-resolved in the window (resolved_reason 'fulfilled'|'replied'), the
// sweep re-nominates the candidate fulfilling message and asks the SAME judge the live resolvers
// now use. Verdict ≠ delivered → REOPEN (+ re-anchor due_date when a new date was promised).
// Dry-run by default; --apply commits. Per-user; --all sweeps every user.
//   npx tsx scripts/sweep-false-fulfillment.ts [--apply] [--days 14] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { judgeCommitmentFulfillment } from '../lib/commitments/fulfillment';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 14;
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let checked = 0, wrong = 0, reopened = 0;

  for (const u of targets) {
    const { data: closedRows } = await sb.from('commitments')
      .select('id, user_id, description, direction, due_date, thread_id, counterparty, created_at, resolved_at, resolved_reason')
      .eq('user_id', u.id).eq('status', 'done').eq('direction', 'you_owe')
      .in('resolved_reason', ['fulfilled', 'replied'])
      .gte('resolved_at', since).limit(200);
    for (const c of closedRows ?? []) {
      checked++;
      // Re-nominate the candidate fulfilling message: the user's latest sent mail on the thread
      // after the commitment was born (the same signal the resolvers use).
      let email: { id: string; body: string; metadata: unknown } | null = null;
      if (c.thread_id) {
        const { data } = await sb.from('emails').select('id, body, metadata')
          .eq('user_id', u.id).eq('thread_id', c.thread_id).eq('is_from_user', true)
          .gt('received_at', c.created_at).order('received_at', { ascending: false }).limit(1).maybeSingle();
        email = (data ?? null) as { id: string; body: string; metadata: unknown } | null;
      }
      if (!email) continue; // no judgeable message — leave the historical close alone (conservative)
      const meta = (email.metadata ?? {}) as { attachments?: unknown[] };
      const fv = await judgeCommitmentFulfillment(sb, u.id, c,
        { id: email.id, body: String(email.body ?? ''), attachmentCount: Array.isArray(meta.attachments) ? meta.attachments.length : 0 }, true);
      console.log(`  · "${c.description.slice(0, 60)}" → ${fv.verdict}${fv.newDue ? ` (new due ${fv.newDue})` : ''} — ${fv.reason.slice(0, 110)}`);
      if (fv.verdict === 'delivered' || fv.verdict === 'unclear') continue; // only a POSITIVE "promised" reopens history
      wrong++;
      console.log(`  ✗ falsely closed: "${c.description.slice(0, 70)}" (${u.email}) — ${fv.reason}${fv.newDue ? ` · promised ${fv.newDue}` : ''}`);
      if (APPLY) {
        const patch: Record<string, unknown> = { status: 'open', resolved_at: null, resolved_reason: null, updated_at: new Date().toISOString() };
        if (fv.newDue) patch.due_date = fv.newDue;
        const { error } = await sb.from('commitments').update(patch).eq('id', c.id).eq('user_id', u.id).eq('status', 'done');
        if (!error) {
          reopened++;
          await sb.from('profiles').update({ home_brief: null }).eq('id', u.id);
        }
      }
    }
  }
  console.log(`\nchecked=${checked} · falsely-closed=${wrong} · reopened=${reopened}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
