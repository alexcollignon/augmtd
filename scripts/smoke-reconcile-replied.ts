/** READ-ONLY smoke of the read-time reply reconcile across users. Mirrors reconcileRepliedItems' exact
 * candidate + reply-state logic but REPORTS instead of writing. Validates: (a) already-answered items are
 * caught, (b) reopened threads (newer inbound after the user's reply) are correctly NOT resolved.
 * Usage: npx tsx scripts/smoke-reconcile-replied.ts */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeThreadReplyState, type ThreadMessage } from '../lib/inbox/thread-resolution';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const USERS: Record<string, string> = {
  Alexandre: '08fe4449-e5eb-431d-9156-02e9324e5903',
  Rene: 'ae306f38-4ec9-4f5f-8b1e-3f8e2c1d6a7b', // resolved below by email if id is wrong
  Madalena: 'c723c2f2-0000-0000-0000-000000000000',
  'ac@axyans': 'e009a499-0000-0000-0000-000000000000',
};

async function resolveUsers(): Promise<Record<string, string>> {
  const out: Record<string, string> = { Alexandre: USERS.Alexandre };
  for (const [name, pat] of [['Rene', '%zeroto100%'], ['Madalena', '%madalena%'], ['ac@axyans', '%axyans%']] as const) {
    const { data } = await sb.from('profiles').select('id, email').ilike('email', pat).limit(1);
    if (data?.[0]) out[name] = data[0].id;
  }
  return out;
}

async function smokeUser(name: string, uid: string) {
  const { data: items } = await sb.from('inbox_items')
    .select('id, work_title, work_state, rule_type, type_override, source_data, created_at')
    .eq('user_id', uid).eq('source', 'email').eq('status', 'pending')
    .or('rule_type.eq.needs_reply,work_state.in.(work_prepared,decision_required)')
    .limit(500);
  const candidates = (items ?? []).filter((it: any) =>
    it.type_override !== 'waiting_on' && it.type_override !== 'fyi' && it.source_data?.thread_id);
  const threadIds = [...new Set(candidates.map((it: any) => String(it.source_data.thread_id)))];

  let wouldResolve = 0, reopenedSkip = 0, noReply = 0;
  const resolveList: string[] = [];
  if (threadIds.length) {
    const { data: emails } = await sb.from('emails').select('thread_id, is_from_user, received_at').eq('user_id', uid).in('thread_id', threadIds as string[]);
    const byThread = new Map<string, ThreadMessage[]>();
    for (const e of emails ?? []) {
      const t = String(e.thread_id); let a = byThread.get(t); if (!a) { a = []; byThread.set(t, a); }
      a.push({ is_from_user: (e as any).is_from_user, received_at: (e as any).received_at });
    }
    for (const it of candidates as any[]) {
      const msgs = byThread.get(String(it.source_data.thread_id)) ?? [];
      const stThread = computeThreadReplyState(msgs, null);          // for lastMessageFromUser
      const stSince = computeThreadReplyState(msgs, it.created_at ? new Date(it.created_at) : null); // userReplied after created
      if (stThread.lastMessageFromUser && stSince.userReplied) { wouldResolve++; resolveList.push(it.work_title); }
      else if (stSince.userReplied && !stThread.lastMessageFromUser) reopenedSkip++;
      else noReply++;
    }
  }
  console.log(`\n=== ${name} (${uid.slice(0, 8)}) — ${candidates.length} reply-ish items on ${threadIds.length} threads`);
  console.log(`   WOULD RESOLVE (you already replied, ball in their court): ${wouldResolve}`);
  console.log(`   correctly SKIP (reopened — newer inbound after your reply): ${reopenedSkip}`);
  console.log(`   correctly STAY (you have not replied): ${noReply}`);
  for (const t of resolveList.slice(0, 8)) console.log(`     ✓ resolves: ${String(t).slice(0, 60)}`);
}

async function main() {
  const users = await resolveUsers();
  for (const [name, uid] of Object.entries(users)) {
    try { await smokeUser(name, uid); } catch (e) { console.log(`   ${name}: error`, (e as Error).message); }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
