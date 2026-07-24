// T1/T2 SWEEP (work-surface plan) — repair what the pre-T1 resolver got wrong.
//   T1: items/commitments auto-resolved by "you replied" in the last 14 days where the resolving
//       user message was NOT addressed to the thread's counterparty (a forward/FYI) → REOPEN.
//   T2: pool deliverables whose recipient/title resolves to the SELF entity (pre-O1 debris, e.g.
//       "Nudge — <the user>") → DELETE (machine output, never user work).
// Dry-run by default; `--apply` writes. Everything it changes is logged per row.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeThreadReplyState, messagesForResolution, threadCounterpartyEmail, type ThreadMessage } from '../lib/inbox/thread-resolution';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const FLOOR = new Date(Date.now() - 14 * 86_400_000).toISOString();

async function threadMessages(userId: string, threadId: string): Promise<ThreadMessage[]> {
  const { data } = await sb.from('emails')
    .select('is_from_user, received_at, from_address, to_addresses, cc_addresses')
    .eq('user_id', userId).eq('thread_id', threadId);
  return ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
    is_from_user: !!m.is_from_user, received_at: (m.received_at as string) ?? null,
    from: (m.from_address as string) ?? null,
    to: [...((m.to_addresses as string[]) ?? []), ...((m.cc_addresses as string[]) ?? [])],
  }));
}

(async () => {
  const { data: profs } = await sb.from('profiles').select('id');
  for (const p of (profs ?? []) as Array<{ id: string }>) {
    const uid = p.id;
    let reopenedItems = 0, reopenedCommits = 0, deletedDebris = 0;

    // ── T1a — inbox items resolved by reply in the window. ──
    const { data: items } = await sb.from('inbox_items')
      .select('id, created_at, work_title, source_data')
      .eq('user_id', uid).eq('status', 'completed')
      .eq('source_data->>resolved_reason', 'replied')
      .gte('updated_at', FLOOR).limit(300);
    for (const it of (items ?? []) as Array<{ id: string; created_at: string; work_title?: string; source_data: Record<string, unknown> }>) {
      const tid = (it.source_data?.thread_id as string) ?? null;
      if (!tid) continue;
      const msgs = await threadMessages(uid, tid);
      const cp = (it.source_data?.from_address as string) || threadCounterpartyEmail(msgs);
      const st = computeThreadReplyState(messagesForResolution(msgs, cp), it.created_at ? new Date(it.created_at) : null);
      if (st.userReplied) continue; // still resolves under the new floor — correct
      reopenedItems++;
      console.log(`  ${APPLY ? 'REOPEN' : 'would reopen'} [item] "${String(it.work_title || (it.source_data?.subject as string) || '').slice(0, 50)}" (resolver counted a message not addressed to ${cp})`);
      if (APPLY) {
        const sd = { ...it.source_data };
        delete sd.resolved_reason; delete sd.resolved_at;
        await sb.from('inbox_items').update({ status: 'pending', source_data: sd, updated_at: new Date().toISOString() }).eq('id', it.id);
      }
    }

    // ── T1b — you-owe commitments resolved by reply in the window. ──
    const { data: cs } = await sb.from('commitments')
      .select('id, created_at, description, thread_id')
      .eq('user_id', uid).eq('status', 'done').eq('resolved_reason', 'replied')
      .gte('resolved_at', FLOOR).limit(300);
    for (const c of (cs ?? []) as Array<{ id: string; created_at: string; description: string; thread_id: string | null }>) {
      if (!c.thread_id) continue;
      const msgs = await threadMessages(uid, c.thread_id);
      const st = computeThreadReplyState(messagesForResolution(msgs, threadCounterpartyEmail(msgs)), c.created_at ? new Date(c.created_at) : null);
      if (st.userReplied) continue;
      reopenedCommits++;
      console.log(`  ${APPLY ? 'REOPEN' : 'would reopen'} [commitment] "${c.description.slice(0, 50)}"`);
      if (APPLY) await sb.from('commitments').update({ status: 'open', resolved_reason: null, resolved_at: null, updated_at: new Date().toISOString() }).eq('id', c.id);
    }

    // ── T2 — self-recipient pool debris. ──
    const persons = await getPersonEntities(sb, uid);
    const { data: dels } = await sb.from('item_deliverables')
      .select('id, title, metadata').eq('user_id', uid).eq('type', 'draft').limit(500);
    for (const d of (dels ?? []) as Array<{ id: string; title: string | null; metadata: Record<string, unknown> | null }>) {
      // A nudge/draft whose NAMED recipient (the title's "Nudge — X" form or metadata provenance who)
      // resolves to the user themself is pre-O1 debris.
      const named = (String(d.title || '').match(/^Nudge — (.+)$/)?.[1])
        ?? ((d.metadata?.provenance as { who?: string } | undefined)?.who ?? null);
      if (!named) continue;
      if (!resolveIdentity(persons, named).isSelf) continue;
      deletedDebris++;
      console.log(`  ${APPLY ? 'DELETE' : 'would delete'} [debris] "${String(d.title).slice(0, 50)}"`);
      if (APPLY) await sb.from('item_deliverables').delete().eq('id', d.id);
    }

    if (reopenedItems || reopenedCommits || deletedDebris) {
      console.log(`══ ${uid.slice(0, 8)} — reopened items:${reopenedItems} commitments:${reopenedCommits} · debris deleted:${deletedDebris}${APPLY ? ' (APPLIED)' : ' (dry-run)'}`);
    }
  }
  process.exit(0);
})();
