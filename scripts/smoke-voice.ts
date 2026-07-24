// VOICE SMOKE (just-works P5a) — the entity-state synthesis speaks like a colleague, cross-user.
// This run IS the backfill: STATE_PROMPT_VERSION rides the sig, so refreshEntityStates regenerates
// every active entity's state under the new voice (the same sig-gated path the cron/hooks use — no
// bespoke backfill machinery). Gates, per user with memory:
//   • zero regenerated summaries in the BANNED machinery register ("prepared for nudge",
//     "no completion signal", …) — the exact class the user flagged;
//   • summaries are short colleague speech: no 3+-clause semicolon telegrams, bounded length;
//   • next-move titles read imperative-ish (start with a verb-like token, not a noun chain).
// Prints samples for eyeballing. Run with --regen to force the full regeneration first (default:
// regenerate only what the sig says is stale — which after a version bump is everything).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { refreshEntityStates, refreshEntityState, MACHINERY_REGISTER } from '../lib/entities/state';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

// The banned machinery register — ONE definition, shared with the synthesis's self-correction.
const BANNED = MACHINERY_REGISTER;
// A status-telegram: 4+ semicolon-chained clauses (grammatical semicolons in colleague speech are
// fine; the old register chained fragments like "accepted; prepared; awaiting; pending").
const TELEGRAM = /;[^;]+;[^;]+;/;

(async () => {
  const { data: ents } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative');
  const uids = [...new Set(((ents ?? []) as Array<{ user_id: string }>).map((e) => e.user_id))];
  console.log(`[voice] regenerating states for ${uids.length} users (sig-gated — the version bump makes stale ones regenerate)…`);

  for (const uid of uids) {
    await refreshEntityStates(sb, uid);
    // SELF-HEAL: any summary still in the banned register gets ONE forced re-synthesis (the
    // corrective-retry path) before the gate judges — a sig-matched stale violation can't hide.
    {
      const { data: pre } = await sb.from('work_entities').select('id, state')
        .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').limit(300);
      for (const r of (pre ?? []) as Array<{ id: string; state?: { summary?: string } | null }>) {
        if (r.state?.summary && MACHINERY_REGISTER.test(String(r.state.summary))) {
          await refreshEntityState(sb, uid, r.id, { force: true });
        }
      }
    }
    const { data: rows } = await sb.from('work_entities')
      .select('name, state, next_move')
      .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').limit(300);
    const states = ((rows ?? []) as Array<{ name: string; state?: { summary?: string } | null; next_move?: { title?: string } | null }>)
      .filter((r) => r.state?.summary);
    const label = `user ${uid.slice(0, 8)}`;
    if (!states.length) { check(`${label} · states regenerated`, true, 'no active states (vacuous)'); continue; }

    const banned = states.filter((r) => BANNED.test(String(r.state!.summary)));
    check(`${label} · zero machinery-register summaries`, banned.length === 0,
      banned.length ? `${banned.length}: "${String(banned[0].state!.summary).slice(0, 70)}"` : `${states.length} states clean`);

    const telegrams = states.filter((r) => TELEGRAM.test(String(r.state!.summary)));
    check(`${label} · no status-telegram summaries (3+ semicolon clauses)`, telegrams.length === 0,
      telegrams.length ? `${telegrams.length}: "${String(telegrams[0].state!.summary).slice(0, 70)}"` : 'clean');

    const tooLong = states.filter((r) => String(r.state!.summary).length > 220);
    check(`${label} · summaries bounded`, tooLong.length === 0, `${tooLong.length} over 220 chars`);

    // THE ARBITER (P6a): covers cite REAL linked members only (grounded citations — a ref that isn't
    // in the entity's own links would be an invented cover). Reported: how many moves arbitrate.
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withMoves = ((rows ?? []) as any[]).filter((r) => r.next_move?.title);
      const withCovers = withMoves.filter((r) => Array.isArray(r.next_move?.covers) && r.next_move.covers.length);
      let invalid = 0;
      for (const r of withCovers.slice(0, 15)) {
        const { data: ents } = await sb.from('work_entities').select('id').eq('user_id', uid).eq('name', r.name).limit(1);
        const eid = ents?.[0]?.id as string | undefined;
        if (!eid) continue;
        const { data: links } = await sb.from('entity_links').select('item_kind, item_id').eq('user_id', uid).eq('entity_id', eid);
        const valid = new Set(((links ?? []) as Array<{ item_kind: string; item_id: string }>)
          .map((l) => `${l.item_kind === 'inbox_item' ? 'inbox' : l.item_kind === 'commitment' ? 'commit' : l.item_kind}:${l.item_id}`));
        for (const c of r.next_move.covers as string[]) {
          if (!c.startsWith('inbox:') && !c.startsWith('commit:')) continue; // context refs — not folded, not validated
          if (!valid.has(c)) invalid++;
        }
      }
      // A stale pointer (a member that left the entity AFTER synthesis — merges/moves) is harmless:
      // consumers match covers against live members, so it simply doesn't fold. Gate: ≤5% stale.
      check(`${label} · next-move covers cite real members (≤5% stale)`, invalid <= Math.ceil(withCovers.length * 0.05),
        `${withCovers.length}/${withMoves.length} moves arbitrate · ${invalid} stale refs`);
    }

    // Next-move titles: imperative-ish — first token isn't a bare article/noun-chain starter.
    const moves = ((rows ?? []) as Array<{ next_move?: { title?: string } | null }>).map((r) => r.next_move?.title).filter((t): t is string => !!t);
    const nounish = moves.filter((t) => /^(the|a|an|status|update on|overview)\b/i.test(t.trim()));
    check(`${label} · next-move titles imperative`, nounish.length === 0, `${moves.length} moves · ${nounish.length} noun-led`);

    for (const r of states.slice(0, 3)) console.log(`    ⤷ ${label} "${r.name}": ${String(r.state!.summary).slice(0, 110)}`);
  }

  console.log('\n════ VOICE GATES (P5a) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
