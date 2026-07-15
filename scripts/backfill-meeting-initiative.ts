// One-time backfill — label existing meetings' initiative + associate them to projects (the meetings-as-
// project-context feature). Requires 20260715_meeting_transcripts_project.sql to be APPLIED first.
// For each transcript with no initiative, resolve it from the meeting's commitments' counterparties (the
// SAME grounded, exactly-one-only logic new meetings use), then run the magnet so any transcript whose
// initiative matches a named project gets project_id (+ its knowledge_file, for KB retrieval).
//
// Usage: npx tsx scripts/backfill-meeting-initiative.ts <userId|all> [--apply]
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getInitiativeCandidates } from '../lib/inbox/initiative-candidates';
import { reconcileProjectMembership } from '../lib/projects/associate';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

async function backfillUser(uid: string) {
  const { data: mtgs, error } = await sb.from('meeting_transcripts').select('id, title, initiative').eq('user_id', uid).is('initiative', null).limit(500);
  if (error) { console.log(`  (skip ${uid.slice(0, 8)} — ${error.message}; is the migration applied?)`); return { labeled: 0, associated: 0 }; }
  let labeled = 0;
  for (const m of mtgs ?? []) {
    // Counterparties of this meeting's commitments = its attendees (the resolution the forward path uses).
    const { data: coms } = await sb.from('commitments').select('counterparty').eq('user_id', uid).eq('source', 'meeting').eq('source_id', m.id);
    const names = [...new Set((coms ?? []).map((c: { counterparty: string | null }) => c.counterparty).filter(Boolean))] as string[];
    if (!names.length) continue;
    const { canonical, candidates } = await getInitiativeCandidates(sb, uid, { personNames: names, personEmails: names });
    if (!(canonical && candidates.length === 0)) continue; // exactly-one safety
    console.log(`  "${(m.title || '').slice(0, 40)}" → "${canonical}"`);
    labeled++;
    if (APPLY) await sb.from('meeting_transcripts').update({ initiative: canonical }).eq('id', m.id);
  }
  // Run the magnet so labeled meetings whose initiative matches a NAMED project get adopted.
  let associated = 0;
  if (APPLY) {
    const { data: projects } = await sb.from('projects').select('id, name').eq('user_id', uid).eq('status', 'active');
    if (projects?.length) { const counts = await reconcileProjectMembership(sb as any, uid, projects); associated = Object.values(counts).reduce((a, b) => a + b, 0); }
  }
  return { labeled, associated };
}

async function main() {
  const arg = process.argv[2];
  let uids: string[];
  if (!arg || arg === 'all') { const { data } = await sb.from('meeting_transcripts').select('user_id').limit(5000); uids = [...new Set((data ?? []).map((r: any) => r.user_id))].filter(Boolean); }
  else uids = [arg];
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} over ${uids.length} user(s)\n`);
  for (const uid of uids) { const r = await backfillUser(uid); console.log(`user ${uid.slice(0, 8)}: ${r.labeled} meetings labeled, ${r.associated} atoms (re)associated`); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
