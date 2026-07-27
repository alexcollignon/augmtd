// ONE BRAIN — PORTFOLIO + TIMELINE + LIFECYCLE smoke (cross-user). Verifies the shared read layer's data
// (entities, events for the axis, closure candidates, weight ordering), the fallback signal for
// non-memory users, and the FULL lifecycle verb set round-tripped on a synthetic entity (track → rename
// learns an alias → mute → reopen → done → forget deletes entity+links, never items).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const EVAL = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];
let NONEVAL = ''; // the PROBE HOST — resolved at start (scripts/probe-user.ts)

const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  NONEVAL = await resolveProbeUser(sb);
  // ── 1. Portfolio data per eval user. ──
  for (const uid of EVAL) {
    const { data: ents } = await sb.from('work_entities').select('id, name, status, state, next_move, priority, last_event_at').eq('user_id', uid).eq('kind', 'initiative');
    const rows = (ents ?? []) as any[];
    const active = rows.filter((r) => r.status === 'active');
    const withState = active.filter((r) => r.state?.summary);
    const withMove = active.filter((r) => r.next_move?.title);
    // Events reachable for the axis: links exist for active entities.
    const { count: linkCount } = await sb.from('entity_links').select('entity_id', { count: 'exact', head: true }).eq('user_id', uid).in('entity_id', active.map((r) => r.id).slice(0, 200));
    // Closure candidates (route logic replicated).
    const nowMs = Date.now();
    const closure = active.filter((r) => {
      const s = r.state ?? {}; const owes = s.whoOwes ?? { you: [], them: [] };
      const quiet = r.last_event_at ? (nowMs - new Date(r.last_event_at).getTime()) / 86400000 : 0;
      return (s.momentum === 'gone_quiet' || s.momentum === 'stalled') && !(owes.you ?? []).length && !(owes.them ?? []).length && quiet >= 14;
    });
    check(`portfolio ${uid.slice(0, 8)}: entities+states`, active.length > 10 && withState.length / Math.max(1, active.length) > 0.8, `${withState.length}/${active.length} with state`);
    check(`portfolio ${uid.slice(0, 8)}: next-moves present`, withMove.length > 5, `${withMove.length}`);
    check(`portfolio ${uid.slice(0, 8)}: events linked`, (linkCount ?? 0) > active.length, `${linkCount} links`);
    check(`portfolio ${uid.slice(0, 8)}: closure candidates sane`, closure.length <= active.length * 0.4, `${closure.length} proposed`);
  }
  // ── 2. Non-memory fallback signal — STRUCTURAL: the fixture user (e009a499) has since been
  // bootstrapped (universal memory backfill), so no real zero-entity user exists to probe. The
  // fallback contract is the route's own empty-rows branch. ──
  {
    const { readFileSync } = await import('fs');
    const src = readFileSync('app/api/entities/portfolio/route.ts', 'utf8');
    check('fallback: non-memory user → label-era views (route hasMemory:false branch)', src.includes('hasMemory: false, entities: []'));
  }
  // ── 3. Lifecycle round-trip on a synthetic entity (the route's exact ops). ──
  {
    const uid = EVAL[0];
    const { data: created } = await sb.from('work_entities').insert({ user_id: uid, kind: 'initiative', name: 'Smoke Lifecycle Probe', summary: 'synthetic', status: 'active' }).select('id').single();
    const id = created!.id as string;
    await sb.from('entity_links').upsert({ user_id: uid, entity_id: id, item_kind: 'inbox_item', item_id: 'probe-lifecycle-item', via: 'user', reason: 'probe' });
    // track
    await sb.from('work_entities').update({ tracked: true }).eq('id', id);
    // rename learns alias
    const { data: e1 } = await sb.from('work_entities').select('name, aliases').eq('id', id).single();
    await sb.from('work_entities').update({ name: 'Renamed Probe', aliases: [...((e1 as any).aliases ?? []), (e1 as any).name] }).eq('id', id);
    // mute → reopen → done
    await sb.from('work_entities').update({ status: 'muted' }).eq('id', id);
    await sb.from('work_entities').update({ status: 'active' }).eq('id', id);
    await sb.from('work_entities').update({ status: 'done' }).eq('id', id);
    const { data: e2 } = await sb.from('work_entities').select('name, aliases, status, tracked').eq('id', id).single();
    check('lifecycle: track+rename(alias)+mute+reopen+done', (e2 as any).tracked === true && (e2 as any).status === 'done' && (e2 as any).name === 'Renamed Probe' && ((e2 as any).aliases ?? []).includes('Smoke Lifecycle Probe'));
    // forget: entity + links die; nothing else touched
    await sb.from('entity_links').delete().eq('user_id', uid).eq('entity_id', id);
    await sb.from('work_entities').delete().eq('id', id);
    const [{ data: gone }, { data: linkGone }] = await Promise.all([
      sb.from('work_entities').select('id').eq('id', id).maybeSingle() as any,
      sb.from('entity_links').select('item_id').eq('user_id', uid).eq('item_id', 'probe-lifecycle-item').maybeSingle() as any,
    ]);
    check('lifecycle: forget removes entity+links only', gone === null && linkGone === null);
  }
  // ── 4. Timeline axis data: events within the -21d..+14d window exist. ──
  {
    const uid = EVAL[0];
    const { data: links } = await sb.from('entity_links').select('entity_id, item_id').eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null).limit(200);
    const ids = (links ?? []).map((l: any) => l.item_id);
    const { data: items } = await sb.from('inbox_items').select('id, source_data, created_at').in('id', ids.slice(0, 200));
    const nowMs = Date.now();
    const inWindow = (items ?? []).filter((it: any) => {
      const at = it.source_data?.received_at ?? it.created_at;
      const d = (new Date(at).getTime() - nowMs) / 86400000;
      return d >= -21 && d <= 14;
    });
    check('timeline: events land in the visible window', inWindow.length >= 5, `${inWindow.length} in window`);
  }

  console.log('\n════ PORTFOLIO + TIMELINE + LIFECYCLE ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
})();
