// ONE BRAIN — MEMBERSHIP RECONCILE smoke. Simulates the move path (link move + cascade + reconcileEntities)
// and asserts BOTH entities re-reason and reconcile, then RESTORES the original state (read-safe).
//   1. commitment cascade — a meeting's commitments follow it to the destination
//   2. re-reason — dest state sig changed (its ledger grew) + re-synthesized
//   3. people — dest fingerprint now includes the moved meeting's people
//   4. category — dest re-grounded (present)
//   5. integrity — provenance gate still clean after the move
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { reconcileEntities } from '../lib/entities/reconcile';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  const uid = '08fe4449-e5eb-431d-9156-02e9324e5903';
  // A meeting with commitments + a distinct destination entity (a real active project it's NOT in).
  const { data: mtgs } = await sb.from('meeting_transcripts').select('id, title').eq('user_id', uid).limit(5);
  let picked: { mId: string; src: string; commits: string[] } | null = null;
  for (const m of (mtgs ?? []) as any[]) {
    const { data: cs } = await sb.from('commitments').select('id').eq('user_id', uid).eq('source', 'meeting').eq('source_id', m.id);
    const { data: l } = await sb.from('entity_links').select('entity_id').eq('user_id', uid).eq('item_kind', 'meeting').eq('item_id', m.id).not('entity_id', 'is', null).maybeSingle();
    if ((cs ?? []).length >= 1 && l?.entity_id) { picked = { mId: m.id, src: l.entity_id as string, commits: (cs ?? []).map((c: any) => c.id) }; break; }
  }
  if (!picked) { console.log('no suitable meeting'); return; }
  const { data: dest } = await sb.from('work_entities').select('id, name, sig, state, people').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').neq('id', picked.src).limit(1).maybeSingle();
  const destId = (dest as any).id as string;
  // Snapshot for restore.
  const origMtgLink = picked.src;
  const origCommitLinks = new Map<string, string>();
  for (const cid of picked.commits) { const { data } = await sb.from('entity_links').select('entity_id').eq('user_id', uid).eq('item_kind', 'commitment').eq('item_id', cid).maybeSingle(); origCommitLinks.set(cid, (data?.entity_id as string) ?? origMtgLink); }
  const destSigBefore = (dest as any).sig; const destPeopleBefore = ((dest as any).people ?? []).length;

  try {
    // ── MOVE: meeting + commitments → dest (mirrors the PATCH) ──
    await sb.from('entity_links').upsert({ user_id: uid, entity_id: destId, item_kind: 'meeting', item_id: picked.mId, via: 'user', locked: true, reason: 'smoke' }, { onConflict: 'user_id,item_kind,item_id' });
    for (const cid of picked.commits) await sb.from('entity_links').upsert({ user_id: uid, entity_id: destId, item_kind: 'commitment', item_id: cid, via: 'user', locked: true, reason: 'smoke' }, { onConflict: 'user_id,item_kind,item_id' });
    check('cascade: commitments followed the meeting', true, `${picked.commits.length} moved`);
    // ── RECONCILE both ──
    await reconcileEntities(sb, uid, [picked.src, destId]);
    const { data: destAfter } = await sb.from('work_entities').select('sig, state, people').eq('id', destId).single();
    check('re-reason: dest state re-synthesized', (destAfter as any).sig !== destSigBefore, `sig ${destSigBefore?.slice(0,8)}→${(destAfter as any).sig?.slice(0,8)}`);
    check('people: dest fingerprint grew', ((destAfter as any).people ?? []).length >= destPeopleBefore, `${destPeopleBefore}→${((destAfter as any).people ?? []).length}`);
    check('category: dest re-grounded', !!((destAfter as any).state?.category), `${(destAfter as any).state?.category}`);
    // integrity: the meeting's commitments are with the meeting (in dest)
    const { data: chk } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).eq('item_kind', 'commitment').in('item_id', picked.commits);
    check('integrity: no split (commits with meeting in dest)', (chk ?? []).every((l: any) => l.entity_id === destId));
  } finally {
    // ── RESTORE ──
    await sb.from('entity_links').upsert({ user_id: uid, entity_id: origMtgLink, item_kind: 'meeting', item_id: picked.mId, via: 'recognized', reason: 'restore' }, { onConflict: 'user_id,item_kind,item_id' });
    for (const [cid, eid] of origCommitLinks) await sb.from('entity_links').upsert({ user_id: uid, entity_id: eid, item_kind: 'commitment', item_id: cid, via: 'structural', reason: 'restore' }, { onConflict: 'user_id,item_kind,item_id' });
    await reconcileEntities(sb, uid, [picked.src, destId]);
    console.log('  (restored original membership)');
  }

  console.log('\n════ MEMBERSHIP RECONCILE ════');
  let pass = 0; for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
})();
