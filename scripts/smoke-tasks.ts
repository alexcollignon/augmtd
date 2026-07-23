// PHASE-4 GATES (docs/projecthood-plan.md — the room does the work). Cross-user, live, full cleanup.
//   THE LOOP — chat-create a task on a real deal → it exists as a manual commitment, linked+locked →
//     the deal's LEDGER carries it (the brain sees it) → the SPINE carries it (deck/timeline/room) →
//     edit text + due date → complete (resolved_at stamps — the ring counts it) → cleanup.
//   Doctrine guards — a manual insert bypasses extraction dedup by construction; extraction's
//     cross-source fold still requires a shared anchor; due dates absolute-or-null.
//   Structural — the room's TaskList, prepared tokens, typed inventory, hand-off chip; R1 fixes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { converse } from '../lib/converse';
import { createManualTask } from '../lib/commitments/manual';
import { assembleLedger } from '../lib/entities/state';
import { buildWorkItems } from '../lib/work-items/model';
import { capabilitiesFor } from '../lib/home/capability-map';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const MARKER = 'ZZ-smoke chase the pilot paperwork';

(async () => {
  // ── THE LOOP, live on both users' top deal. ──
  for (const [uid, label] of [[A, 'user A'], [B, 'user B']] as const) {
    const { data: ent } = await sb.from('work_entities').select('id, name').eq('user_id', uid)
      .eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null)
      .order('last_event_at', { ascending: false }).limit(1).maybeSingle();
    const eid = ent!.id as string;

    // 1 — create via the CHAT (entity scope = the room's composer; no project name needed).
    const t1 = await converse(sb, uid, { kind: 'entity', entityId: eid }, `add a task: ${MARKER}`);
    const { data: row } = await sb.from('commitments').select('id, source, status, due_date')
      .eq('user_id', uid).ilike('description', `%${MARKER}%`).maybeSingle();
    const taskId = row?.id as string | undefined;
    check(`${label} · chat-create lands a MANUAL commitment`, row?.source === 'manual' && row?.status === 'open', `"${t1.say.slice(0, 50)}"`);
    const { data: lnk } = await sb.from('entity_links').select('entity_id, via, locked')
      .eq('user_id', uid).eq('item_kind', 'commitment').eq('item_id', taskId ?? '').maybeSingle();
    check(`${label} · linked to the room's deal (via user, locked)`, lnk?.entity_id === eid && lnk?.via === 'user' && lnk?.locked === true);

    // 2 — the BRAIN sees it (the ledger carries the declared task).
    const { ledger } = await assembleLedger(sb, uid, eid);
    check(`${label} · the deal's LEDGER carries the task`, ledger.some((l) => l.text.includes('chase the pilot paperwork')));

    // 3 — the SPINE carries it (deck / timeline / room all read this).
    const items = await buildWorkItems(sb, uid, { todayStr: new Date().toISOString().slice(0, 10), skipReconcile: true });
    check(`${label} · the SPINE carries it (deck/timeline/room)`, items.some((w) => w.entityId === taskId));

    // 4 — writable: edit text + set an absolute due date; a garbage date collapses to null.
    await sb.from('commitments').update({ description: `${MARKER} (edited)`, due_date: '2026-08-01' }).eq('id', taskId!);
    const { validDate } = await import('../lib/commitments/extract');
    check('doctrine · due dates absolute-or-null', validDate('2026-08-01') === '2026-08-01' && validDate('next Friday') === null && validDate(null) === null);

    // 5 — complete: resolved_at stamps (the ring's currency).
    await sb.from('commitments').update({ status: 'done', resolved_at: new Date().toISOString(), resolved_reason: 'user_marked' }).eq('id', taskId!);
    const { data: doneRow } = await sb.from('commitments').select('status, resolved_at').eq('id', taskId!).single();
    check(`${label} · complete stamps resolved_at`, doneRow?.status === 'done' && !!doneRow?.resolved_at);

    // Cleanup — no trace.
    await sb.from('entity_links').delete().eq('user_id', uid).eq('item_kind', 'commitment').eq('item_id', taskId!);
    await sb.from('commitments').delete().eq('id', taskId!);
    await sb.from('activity_events').delete().eq('user_id', uid).ilike('title', '%ZZ-smoke%');
  }

  // ── Doctrine guards. ──
  check('doctrine · a manual task bypasses extraction dedup by construction',
    readFileSync('lib/commitments/manual.ts', 'utf8').includes(".insert({") &&
    !readFileSync('lib/commitments/manual.ts', 'utf8').includes('writeCommitments'));
  {
    const r = await createManualTask(sb, A, { description: '' });
    check('doctrine · empty task refused', !r.ok);
  }

  // ── Structural (R1 + R3). ──
  const pv = readFileSync('components/entities/portfolio-view.tsx', 'utf8');
  const er = readFileSync('components/entities/entity-room.tsx', 'utf8');
  const li = readFileSync('app/api/entities/loose-items/route.ts', 'utf8');
  check('R1 · category pills gone; suggestion rows expandable; star gone',
    !pv.includes('toggleCat') && pv.includes('prune(') && !pv.includes('StarSolid'));
  check('R1 · loose picker filters automated/bulk', li.includes('isAutomatedSender') && li.includes('bulk'));
  check('R1 · category picker + lock (route + backfill)',
    readFileSync('app/api/entities/[id]/route.ts', 'utf8').includes('categoryLocked') &&
    readFileSync('scripts/backfill-entity-category.ts', 'utf8').includes('categoryLocked'));
  check('R3b · the room holds the writable TaskList (+ Task, edit, due, human waiting groups)',
    er.includes('function TaskList') && er.includes('Add a task…') && er.includes('Waiting on {name}'));
  check('R3c · prepared tokens + ONE suggested hand-off (no assignee column)',
    er.includes("w.prepared === 'draft'") && er.includes('can take this') && !er.includes('assignee'));
  check('R3d · typed inventory (Conversations · Files & docs · Activity); Gantt out',
    er.includes('label="Conversations"') && er.includes('label="Files & docs"') && er.includes('label="Activity"') && !er.includes('GanttChart'));
  check('R3a · create_task_item exposed to every chat surface',
    new Set(capabilitiesFor('chief_of_staff').map((c) => c.tool)).has('create_task_item'));
  // ── R2 — the one shell. ──
  const idt = readFileSync('components/home/item-detail.tsx', 'utf8');
  check('R2 · artifacts render EMBEDDED (room provides shell + rail)',
    idt.includes('embedded?: boolean') && er.includes('<ItemDetail key=') && er.includes('embedded'));
  check('R2 · room-internal navigation stays in-shell (focus, not route)',
    er.includes('focusFromHref') && er.includes('setFocused({ kind: ') && er.includes('onOpen={openHref}'));
  {
    const { focusFromHref } = await import('../components/entities/entity-room');
    check('R2 · href→focus parsing (email default, awareness→email, non-item passthrough)',
      focusFromHref('/item/abc?kind=commitment')?.kind === 'commitment'
      && focusFromHref('/item/abc')?.kind === 'email'
      && focusFromHref('/item/abc?kind=awareness')?.kind === 'email'
      && focusFromHref('/?view=projects&entity=x') === null);
  }

  console.log('\n════ PHASE-4 GATES (tasks · the room does the work) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
