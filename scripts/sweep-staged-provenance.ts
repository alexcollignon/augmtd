// STAGED-PROVENANCE SWEEP (proactive-team W6 — the wrong-attach cleanup). The staging law now
// forbids auto-staging a KB/drive file that doesn't belong to the item's own body of work; this
// sweep removes what the OLD law staged: draft attachments and `require:*` / docsend pool rows
// whose file fails the provenance check. The draft itself strips with its attachment (it was
// written under a truth that claimed the file); the judged pass re-prepares lawfully on its next
// sweep. Prep narration turns for stripped items are removed (the narration must follow the work).
//
// Usage: npx tsx scripts/sweep-staged-provenance.ts [--apply]   (dry-run by default, ALL users)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

type Att = { fileId?: string; filename?: string; source?: string } | null | undefined;

// The law, mirrored: pool = the item's own; kb only when the file's entity === the item's entity.
async function lawful(userId: string, itemKind: 'inbox_item' | 'commitment', itemId: string, att: Att): Promise<boolean> {
  if (!att?.fileId) return true;             // no attachment claim → nothing to validate
  if (att.source === 'pool') return true;    // the item's own material
  // The item's entity:
  const { data: link } = await sb.from('entity_links').select('entity_id')
    .eq('user_id', userId).eq('item_kind', itemKind).eq('item_id', itemId).not('entity_id', 'is', null).maybeSingle();
  const itemEntity = (link?.entity_id as string) ?? null;
  if (!itemEntity) return false;             // loose item + non-pool file → unlawful under W6
  const { data: kf } = await sb.from('knowledge_files').select('entity_id').eq('id', att.fileId).maybeSingle();
  return (kf?.entity_id as string | null) === itemEntity;
}

(async () => {
  console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} staged-provenance sweep (all users)\n`);
  const { data: profs } = await sb.from('profiles').select('id');
  let strippedDrafts = 0, deletedRows = 0, usersTouched = 0;

  for (const p of profs ?? []) {
    const uid = p.id as string;
    let touched = false;

    // 1 — pending inbox drafts carrying a staged attachment.
    const { data: items } = await sb.from('inbox_items').select('id, source_data')
      .eq('user_id', uid).eq('status', 'pending').not('source_data->draft->attachment', 'is', null).limit(500);
    for (const it of (items ?? []) as Array<{ id: string; source_data: Record<string, unknown> }>) {
      const sd = { ...it.source_data };
      const att = (sd.draft as { attachment?: Att } | undefined)?.attachment;
      if (await lawful(uid, 'inbox_item', it.id, att)) continue;
      strippedDrafts++; touched = true;
      console.log(`  [draft] ${uid.slice(0, 8)} item ${it.id.slice(0, 8)} — "${att?.filename ?? '?'}" fails provenance`);
      if (APPLY) {
        delete sd.draft;
        if (!(sd.nudge_draft as { body?: string } | undefined)?.body && !sd.prepared_invite && !sd.prepared_forward) delete sd.prepared_by;
        await sb.from('inbox_items').update({ source_data: sd }).eq('id', it.id);
        await sb.from('room_turns').delete().eq('user_id', uid).eq('dedupe_key', `prep:inbox:${it.id}`).then(() => {}, () => {});
      }
    }

    // 2 — requirement-staged + docsend pool rows whose file fails provenance.
    const { data: rows } = await sb.from('item_deliverables')
      .select('id, kind, entity_id, task_id, metadata')
      .eq('user_id', uid).or('task_id.like.require:*,task_id.eq.prepare-pass-docsend').limit(500);
    for (const r of (rows ?? []) as Array<{ id: string; kind: string; entity_id: string; task_id: string; metadata: Record<string, unknown> | null }>) {
      const att = (r.metadata?.attachment ?? null) as Att;
      if (!att?.fileId) continue;
      const itemKind = r.kind === 'commitment' ? 'commitment' as const : 'inbox_item' as const;
      if (await lawful(uid, itemKind, r.entity_id, att)) continue;
      deletedRows++; touched = true;
      console.log(`  [pool] ${uid.slice(0, 8)} ${r.task_id.slice(0, 40)} — "${att.filename ?? '?'}" fails provenance`);
      if (APPLY) await sb.from('item_deliverables').delete().eq('id', r.id);
    }

    if (touched) usersTouched++;
  }

  console.log(`\n${APPLY ? 'DONE' : 'WOULD DO'}: drafts stripped=${strippedDrafts} · pool rows removed=${deletedRows} · users touched=${usersTouched}`);
  if (!APPLY) console.log('Re-run with --apply.');
})();
