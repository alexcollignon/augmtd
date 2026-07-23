// CROSS-TYPE DEDUP SMOKE (just-works P2) — one obligation surfaces ONCE on the deck. Gates:
//   PURE — the fold rule: a commitment extracted from a visible email/meeting row folds when the
//          wording overlaps (structural tie → moderate floor); a same-source commitment about a
//          DIFFERENT obligation survives; near-identical wording folds even across sources; unrelated
//          text never folds.
//   LIVE (both users) — over the real deck candidates (same queries as the brief route): after the
//          fold, ZERO visible commitment rows near-duplicate a visible actionable item. Deterministic,
//          no AI, nothing deleted (folding is presentation, the commitment rows stay in the data).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { foldDuplicateCommitments, isDupOfVisible, visibleObligationsFromItems } from '../lib/home/dedupe-deck';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  // ── PURE — the fold rule on synthetic rows (generic fakes only) ──
  const visible = [
    { title: 'Send pricing offer for the Acme agent (7-8 seats)', sourceId: 'msg-1', threadId: 'thr-1', meetingId: null },
    { title: 'Review Q3 budget with the finance team', sourceId: 'msg-2', threadId: 'thr-2', meetingId: 'mtg-1' },
  ];
  check('fold: same thread + same obligation → folds',
    isDupOfVisible({ id: 'c1', description: 'Send the pricing offer for the Acme agent covering 7-8 seats', thread_id: 'thr-1' }, visible));
  check('fold: same thread, DIFFERENT obligation → survives',
    !isDupOfVisible({ id: 'c2', description: 'Share the signed NDA with their legal team', thread_id: 'thr-1' }, visible));
  check('fold: near-identical wording across sources → folds',
    isDupOfVisible({ id: 'c3', description: 'Review the Q3 budget with the finance team' }, visible));
  check('fold: unrelated wording → survives',
    !isDupOfVisible({ id: 'c4', description: 'Book the venue for the offsite in September' }, visible));
  check('fold: meeting-extracted action item duplicating its meeting row → folds',
    isDupOfVisible({ id: 'c5', description: 'Review Q3 budget with finance', source_id: 'mtg-1' }, visible));

  // ── LIVE — the real deck candidates, both users ──
  for (const { uid, label } of USERS) {
    const [{ data: items }, { data: commits }] = await Promise.all([
      sb.from('inbox_items')
        .select('id, work_title, source_id, source_meeting_transcript_id, source_data')
        .eq('user_id', uid).eq('status', 'pending')
        .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
        .limit(60),
      sb.from('commitments').select('id, description, source, source_id, thread_id, status').eq('user_id', uid).eq('status', 'open'),
    ]);
    const vis = visibleObligationsFromItems(items ?? []);
    const { kept, foldedIds } = foldDuplicateCommitments((commits ?? []) as Array<{ id: string; description: string; source_id?: string; thread_id?: string }>, vis);
    // The invariant: after the fold, NO kept commitment still near-duplicates a visible item.
    const leftovers = kept.filter((c) => isDupOfVisible(c, vis));
    check(`${label} · zero visible cross-type dupes after the fold`, leftovers.length === 0,
      `${foldedIds.length} folded · ${kept.length} kept of ${(commits ?? []).length}`);
    for (const fid of foldedIds.slice(0, 4)) {
      const c = ((commits ?? []) as Array<{ id: string; description: string }>).find((x) => x.id === fid);
      console.log(`    ⤷ ${label} folded: "${String(c?.description).slice(0, 90)}"`);
    }
  }

  console.log('\n════ CROSS-TYPE DEDUP GATES (P2) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
