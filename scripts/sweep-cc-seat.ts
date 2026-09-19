// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CC-SEAT SWEEP (THE SEAT LAW — docs/threads-plan.md · THE OPENING CONTRACT clause 4).
//
// The repair half of the law: every OPEN email-sourced `you_owe` commitment whose source email was
// addressed To: SOMEONE ELSE, with the user merely in CC, and whose text never names the user. Those
// rows stand on the deck as "You owe <sender>" for work that was never the user's — found live: the
// sender asked the To: recipient for THAT person's CV and the user, in CC, was served the debt plus
// a checklist asking for the user's own CV.
//
// The seat question is asked through the SAME predicate the extractor and the judge's fact block
// consult (`seatStripsObligation`) — one law, one answer, never a second copy that can drift.
// Dry-run by default (prints each candidate with its To: line); --apply dismisses + busts the brief.
//   npx tsx scripts/sweep-cc-seat.ts [--apply] [--days 90] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { seatStripsObligation } from '../lib/inbox/recipient-role';
import { userAddresses } from '../lib/inbox/ensure-mail-kind';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 90;
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: users } = await sb.auth.admin.listUsers();
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let checked = 0, bystander = 0, dismissed = 0;

  for (const u of targets) {
    const { data: rows } = await sb.from('commitments')
      .select('id, description, counterparty, source_id, created_at')
      .eq('user_id', u.id).eq('direction', 'you_owe').eq('source', 'email')
      .in('status', ['open', 'pending', 'in_progress'])
      .gte('created_at', since).limit(500);
    if (!rows?.length) continue;

    const mine = await userAddresses(sb, u.id);
    const { data: prof } = await sb.from('profiles').select('full_name').eq('id', u.id).maybeSingle();
    const userName = (prof?.full_name as string | null) ?? null;

    for (const c of rows) {
      if (!c.source_id) continue;
      const { data: email } = await sb.from('emails')
        .select('id, subject, body, to_addresses, cc_addresses, from_address, is_from_user')
        .eq('user_id', u.id).eq('id', c.source_id).maybeSingle();
      if (!email || email.is_from_user) continue; // sent mail has no bystander seat
      checked++;
      const seat = {
        to: (email.to_addresses as string[] | null) ?? [], cc: (email.cc_addresses as string[] | null) ?? [],
        userAddresses: mine, userName,
      };
      // The SAME test the extractor applies at the write door — subject + body, never the model's
      // own description (a generated line can name the user the email never did).
      if (!seatStripsObligation(`${email.subject ?? ''}\n${email.body ?? ''}`, seat)) continue;
      bystander++;
      console.log(`  ✗ CC-seat debt (${u.email}): "${String(c.description).slice(0, 70)}" — owed to ${c.counterparty ?? '?'}`);
      console.log(`      To: ${(seat.to.join(', ') || '(none)')} · CC: ${seat.cc.join(', ') || '(none)'} · from ${email.from_address ?? '?'} · "${String(email.subject ?? '').slice(0, 60)}"`);
      if (APPLY) {
        const nowIso = new Date().toISOString();
        const { error } = await sb.from('commitments')
          .update({ status: 'dismissed', resolved_at: nowIso, resolved_reason: 'cc_seat', updated_at: nowIso })
          .eq('id', c.id).eq('user_id', u.id).in('status', ['open', 'pending', 'in_progress']);
        if (!error) {
          dismissed++;
          await sb.from('profiles').update({ home_brief: null }).eq('id', u.id);
        }
      }
    }
  }
  console.log(`\nchecked=${checked} · cc-seat debts=${bystander} · dismissed=${dismissed}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
