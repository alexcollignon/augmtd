// STALE "Prepared by" SWEEP (fix-3 residue). The old delegatePrepare stamped `prepared_by` on the
// item BEFORE the evaluator's verdict — so a delegation that came back as a missing-inputs ASK (no
// deliverable stored, honest report-back) still left a stamp claiming prepared work. The new engine
// never stamps on a needs_input outcome; this cleans the rows the old engine already wrote.
//
// A stamp is STALE when: no pool deliverable backs it (kind email/commitment, entity_id = item id)
// AND its timestamp doesn't match a draft/nudge write (±5 min) — i.e. nothing anywhere carries the
// claimed work. A stamp riding a real draft (same-write timestamps) is legitimate attribution and
// stays. Dry-run by default; `--apply` strips the stamp (source_data only, item untouched) and busts
// the user's home_brief so the ✦ badge re-derives.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const NEAR_MS = 5 * 60 * 1000;

(async () => {
  const { data: uidRows } = await sb.from('work_entities').select('user_id').limit(2000);
  const users = [...new Set(((uidRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))];
  const touched = new Set<string>();
  for (const uid of users) {
    const { data: items } = await sb.from('inbox_items')
      .select('id, work_title, source_data')
      .eq('user_id', uid).eq('status', 'pending').not('source_data->prepared_by', 'is', null).limit(500);
    for (const it of (items ?? []) as Array<Record<string, unknown>>) {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const pb = (sd.prepared_by ?? {}) as { worker?: string; at?: string };
      const at = pb.at ? new Date(pb.at).getTime() : NaN;
      // Backing pool deliverable?
      const { data: dels } = await sb.from('item_deliverables').select('id')
        .eq('user_id', uid).eq('kind', 'email').eq('entity_id', it.id as string).limit(1);
      if (dels?.length) continue;
      // Same-write draft/nudge attribution?
      const draftAt = (sd.draft as { generated_at?: string } | null)?.generated_at;
      const nudgeAt = (sd.nudge_draft as { generated_at?: string } | null)?.generated_at;
      const near = (t?: string) => !!t && Number.isFinite(at) && Math.abs(new Date(t).getTime() - at) < NEAR_MS;
      if (near(draftAt) || near(nudgeAt)) continue;
      console.log(`${APPLY ? 'STRIP' : 'would strip'} · ${uid.slice(0, 8)} · "${String(it.work_title).slice(0, 60)}" · by ${pb.worker} at ${pb.at} (draft:${draftAt ?? '—'} nudge:${nudgeAt ?? '—'})`);
      if (APPLY) {
        const { prepared_by: _pb, ...rest } = sd;
        await sb.from('inbox_items').update({ source_data: rest }).eq('id', it.id as string);
        touched.add(uid);
      }
    }
  }
  if (APPLY) {
    for (const uid of touched) {
      const { data: prof } = await sb.from('profiles').select('home_brief').eq('id', uid).maybeSingle();
      if (prof?.home_brief) await sb.from('profiles').update({ home_brief: null }).eq('id', uid);
      console.log('busted home_brief for', uid.slice(0, 8));
    }
  }
  console.log(APPLY ? 'done' : 'dry-run done (re-run with --apply)');
})();
