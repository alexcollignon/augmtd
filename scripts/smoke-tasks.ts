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
const RENE_PREFIX = 'ae306f38';
let PERSONAL = ''; // the PROBE HOST — resolved at start (scripts/probe-user.ts)
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const MARKER = 'ZZ-smoke chase the pilot paperwork';

// Mirror of the status-update route's compose path (scripts can't auth HTTP) — same modules, same
// cache contract (item_deliverables kind 'entity' + sig).
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
async function fetchStatus(sbc: SupabaseClient, uid: string, ent: { id: string; name: string; sig: string; state: Record<string, unknown>; next_move: { title?: string } | null }): Promise<{ text: string; cached: boolean }> {
  const { data: prior } = await sbc.from('item_deliverables').select('id, content, metadata').eq('user_id', uid)
    .eq('kind', 'entity').eq('entity_id', ent.id).eq('type', 'document').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const pm = (prior?.metadata ?? {}) as { statusUpdate?: boolean; sig?: string };
  if (prior && pm.statusUpdate && pm.sig === ent.sig) return { text: String(prior.content), cached: true };
  const { assembleLedger } = await import('../lib/entities/state');
  const { aiCall } = await import('../lib/ai/call');
  const st = (ent.state ?? {}) as { summary?: string };
  const { ledger } = await assembleLedger(sbc, uid, ent.id);
  const recent = ledger.filter((l) => l.at).slice(0, 10).map((l) => `- ${l.at.slice(0, 10)} ${l.kind}: ${l.text.slice(0, 140)}`).join('\n');
  const res = await aiCall<{ update?: string }>({
    userId: uid, supabase: sbc, shape: { output: 'json' }, temperature: 0.2, maxTokens: 500, source: 'brain_synthesis',
    prompt: `Write a SHORT status update on ONE body of work, shared with its counterparty. 3 short paragraphs max, colleague voice, grounded-or-absent, no internal bookkeeping language, plain text.\n` +
      `Body of work: ${ent.name}\nWhere it stands: ${st.summary ?? ''}\n${ent.next_move?.title ? `Next: ${ent.next_move.title}\n` : ''}Events:\n${recent}\n\nJSON only: {"update":"..."}`,
  });
  const text = String(res.json?.update ?? '').trim();
  await sbc.from('item_deliverables').insert({ user_id: uid, kind: 'entity', entity_id: ent.id, type: 'document', title: `Status update — ${ent.name}`.slice(0, 100), content: text, metadata: { statusUpdate: true, sig: ent.sig } });
  return { text, cached: false };
}

(async () => {
  PERSONAL = await resolveProbeUser(sb);
  // The probe host owns no organic portfolio — provision its fixture entity so the errand-account
  // leg of the loop has a room to create tasks in (idempotent by name; state set so it qualifies).
  {
    const { data: ex } = await sb.from('work_entities').select('id').eq('user_id', PERSONAL)
      .eq('kind', 'initiative').eq('name', 'Probe Errands').maybeSingle();
    if (!ex) await sb.from('work_entities').insert({
      user_id: PERSONAL, kind: 'initiative', name: 'Probe Errands', status: 'active',
      state: { summary: 'fixture errand pool for the smoke probes' }, last_event_at: new Date().toISOString(),
    });
  }
  // Resolve Rene's full uid from the prefix (never hardcode a guessed uuid — the earlier lesson).
  const { data: uidRows } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative').limit(1000);
  const RENE = [...new Set((uidRows ?? []).map((r) => r.user_id as string))].find((u) => u.startsWith(RENE_PREFIX))!;

  // ── THE LOOP, live across ALL FOUR users — deal-heavy, meeting-heavy, and errand-only accounts. ──
  for (const [uid, label] of [[A, 'user A'], [B, 'user B'], [RENE, 'Rene'], [PERSONAL, 'personal user']] as const) {
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

    // 3 — the SPINE carries it (deck / timeline / room all read this) AND it is a PREPARATION-PASS
    // candidate (5B: partitionDailyReport routes it into needsYou — the pass's working set).
    const items = await buildWorkItems(sb, uid, { todayStr: new Date().toISOString().slice(0, 10), skipReconcile: true });
    check(`${label} · the SPINE carries it (deck/timeline/room)`, items.some((w) => w.entityId === taskId));
    {
      const { partitionDailyReport } = await import('../lib/work-items/report');
      const rep = partitionDailyReport(items, new Date().toISOString().slice(0, 10));
      check(`${label} · 5B candidacy: a manual task enters the pass's working set`, rep.needsYou.some((w) => w.entityId === taskId));
    }

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
  check('R1 · category pills gone; star gone; NO suggestion rows (one-room R4 — projects are human-created)',
    !pv.includes('toggleCat') && !pv.includes('SuggestRow') && !pv.includes('StarSolid'));
  check('R1 · loose picker filters automated/bulk', li.includes('isAutomatedSender') && li.includes('bulk'));
  check('R1 · category picker + lock (route + backfill)',
    readFileSync('app/api/entities/[id]/route.ts', 'utf8').includes('categoryLocked') &&
    readFileSync('scripts/backfill-entity-category.ts', 'utf8').includes('categoryLocked'));
  check('R3b · the room holds the writable TaskList (+ Task, edit, due, human waiting groups)',
    er.includes('function TaskList') && er.includes('Add a task…') && er.includes('Waiting on {name}'));
  check('R3c · prepared tokens + ONE suggested hand-off (no assignee column)',
    er.includes("w.prepared === 'draft'") && er.includes('can take this') && !er.includes('assignee'));
  // Workbench B1a reversed the "Gantt out" call (user ask, July 24): the Schedule disclosure
  // renders the ONE shared Gantt — behind a fold, so first paint stays calm.
  check('R3d · typed inventory (Conversations · Files & docs · Activity); Schedule behind a fold',
    er.includes('label="Conversations"') && er.includes('label="Files & docs"') && er.includes('label="Activity"') && er.includes('label="Schedule"'));
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

  // ══ 5A — the polish batch. ══
  {
    const pv2 = readFileSync('components/entities/portfolio-view.tsx', 'utf8');
    const er2 = readFileSync('components/entities/entity-room.tsx', 'utf8');
    const hv2 = readFileSync('components/home/home-view.tsx', 'utf8');
    const rl2 = readFileSync('components/home/item-rail.tsx', 'utf8');
    const dt2 = readFileSync('app/api/entities/[id]/detail/route.ts', 'utf8');
    const id2 = readFileSync('components/home/item-detail.tsx', 'utf8');
    const { existsSync } = await import('fs');
    check('5A.1 · seeding moved to the ROOM (user-created-only era): the modal is name+description; the founding proposal + chat seed members',
      !pv2.includes('+ Add work') && !pv2.includes('SuggestRow') &&
      readFileSync('lib/entities/founding.ts', 'utf8').includes('founding_proposal'));
    check('5A.2 · Accept is optimistic (local flip, write behind, restore on fail)',
      pv2.includes('acceptOptimistic') && pv2.includes("Couldn't accept"));
    check('5A.3 · files fold by filename + preview refs + modal + endpoint',
      dt2.includes('byName') && dt2.includes("kind: 'kb'") && er2.includes('FilePreviewModal') && existsSync('app/api/files/preview/route.ts'));
    // T4 (work-surface) made the EMAIL chip ALWAYS null (posture vocabulary is internal) —
    // stronger than embedded-only; the other kinds stay embedded-conditional.
    check('5A.4 · embedded artifact hides type/project pills (email chip gone entirely)',
      id2.includes('chip={null}') && (id2.match(/chip=\{embedded \? null/g) ?? []).length === 3 && (id2.match(/action=\{embedded \? undefined/g) ?? []).length >= 2);
    // W3 superseded the static line: the narration is now COMPOSED from the board row's prepared
    // facts (keyed dedup, real offers) — still deterministic, never a hedge.
    check('5A.5 · CTA-focus narrates in the per-deal chat (deterministic, grounded — W3)',
      rl2.includes('export function pushDealTurn') && er2.includes('openHref(moveHref, true)') && er2.includes("row?.prepared === 'draft'"));
    check('5A.6 · room width + Tasks auto-open + Goals&Rules beside on lg',
      er2.includes('max-w-[1000px]') && er2.includes("add('work')") && er2.includes('lg:grid-cols-[minmax(0,1fr)_280px]'));
    check('5A.7 · Home today-strip from the existing schedule read',
      hv2.includes('TODAY STRIP') && hv2.includes('b!.schedule![0].time'));
  }

  // ══ 5B — the Preparation Pass over tasks. ══
  {
    // O2 superseded the shape map: routing is the ROSTER JUDGE (the team in view).
    const { routeTasks } = await import('../lib/prepare/route-suggestion');
    const routes = await routeTasks(sb, A, [
      'Prepare a one-page summary of the pilot results',
      'Call the lawyer about the lease renewal',
    ]);
    check('5B judge: a doc-shaped task routes to a teammate whose craft fits', !!routes[0]?.worker,
      routes[0]?.worker ? `→ ${routes[0].worker.name} (${routes[0].worker.role})` : 'none');
    check('5B judge: human-only work honestly routes to NO ONE (never faked)', !routes[1]?.worker && !routes[1]?.sendDoc);
    const pass = readFileSync('lib/prepare/pass.ts', 'utf8');
    check('5B doctrine: the pass NEVER sends (no send executors)', !/sendCoworkerEmail|send-reply|sendEmail\(/.test(pass));
    check('5B observability: task_preparation usage source wired',
      readFileSync('lib/ai/log-usage.ts', 'utf8').includes("'task_preparation'") && pass.includes("source: 'task_preparation'"));
    const br = readFileSync('app/api/home/brief/route.ts', 'utf8');
    const hv3 = readFileSync('components/home/home-view.tsx', 'utf8');
    const er3 = readFileSync('components/entities/entity-room.tsx', 'utf8');
    check('5B surface: deck commitment rows carry prepared tokens', br.includes('commitPrepared') && hv3.includes('prepared: c.prepared ?? null'));
    check('5B surface: room prepared tokens are TAPPABLE (deliverable preview)',
      er3.includes('onPreviewDeliverable') && readFileSync('app/api/files/preview/route.ts', 'utf8').includes("'deliverable'"));
  }

  // ══ 5C — the shareable status update (incl. a QUIET/errand entity — the personal user). ══
  for (const [uid, label] of [[A, 'user A'], [B, 'user B'], [PERSONAL, 'personal user']] as const) {
    const { data: ent } = await sb.from('work_entities').select('id, name, sig, state, next_move, people').eq('user_id', uid)
      .eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null)
      .order('last_event_at', { ascending: false }).limit(1).maybeSingle();
    // Replicate the route's compose inline (scripts can't auth HTTP): same prompt path via the module.
    const { MACHINERY_REGISTER } = await import('../lib/entities/state');
    const res = await fetchStatus(sb, uid, ent as never);
    check(`${label} · 5C compose: non-empty, colleague voice (no machinery register)`,
      res.text.length > 80 && !MACHINERY_REGISTER.test(res.text), `"${res.text.slice(0, 70)}"`);
    // Cache: a second compose with the same sig serves the stored row (same content, no new row).
    const res2 = await fetchStatus(sb, uid, ent as never);
    check(`${label} · 5C cache: unchanged deal re-serves (no second compose)`, res2.cached === true && res2.text === res.text);
    // Cleanup — remove the smoke's stored update rows.
    await sb.from('item_deliverables').delete().eq('user_id', uid).eq('kind', 'entity').eq('entity_id', (ent as { id: string }).id).eq('type', 'document');
  }
  {
    const er4 = readFileSync('components/entities/entity-room.tsx', 'utf8');
    check('5C surface: room ⋯ → Share a status update → editable modal, Copy + explicit Send',
      er4.includes('Share a status update') && er4.includes('StatusUpdateModal') && er4.includes('/api/compose/send'));
    check('5C trust: recipient only ever SUGGESTED, never auto-filled',
      er4.includes('Use suggestion') && !er4.includes('setTo(suggested)]') );
  }

  // ══ 5D slice 1 — the MCP rail scaffold. ══
  {
    const { existsSync } = await import('fs');
    const mount = readFileSync('infra/agentos/mcp_mount.py', 'utf8');
    const wk = readFileSync('infra/agentos/workers.py', 'utf8');
    check('5D · MCP mount is FLAG-GATED + failure-proof (unset → [], bad config skipped)',
      mount.includes('AGENTOS_MCP_SERVERS') && mount.includes('return []') && mount.includes('skipped'));
    check('5D · workers wired to the mount (zero change when off)',
      wk.includes('build_mcp_tools') && wk.includes('*mcp_tools'));
    check('5D · tenant-safety is a REVIEW REQUIREMENT (auth-shim documented)',
      mount.includes('TENANT-SAFE') && readFileSync('infra/agentos/README.md', 'utf8').includes('auth-shim'));
    check('5D · the registry stays the gate (Capability.mcp field + recipe)',
      readFileSync('lib/home/capability-map.ts', 'utf8').includes('mcp?: { server: string; tool: string }'));
    check('5D · runbook shipped with the shortlist', existsSync('infra/agentos/README.md') && readFileSync('infra/agentos/README.md', 'utf8').includes('Shortlist'));
  }

  // ══ July-24 batch — one picker everywhere, create-with-work, time/order fixes. ══
  {
    const { existsSync } = await import('fs');
    const pv3 = readFileSync('components/entities/portfolio-view.tsx', 'utf8');
    const er5 = readFileSync('components/entities/entity-room.tsx', 'utf8');
    const hv4 = readFileSync('components/home/home-view.tsx', 'utf8');
    const vs = readFileSync('components/home/view-switcher.tsx', 'utf8');
    check('J24 · ONE AddItemPicker shared (extracted; no local copy in the room)',
      existsSync('components/entities/add-item-picker.tsx') && !er5.includes('function AddItemPicker') && er5.includes("from '@/components/entities/add-item-picker'"));
    check('J24 · the ONE picker lives in the ROOM (portfolio modal picker removed by design — user-created-only era)',
      !pv3.includes('AddItemPicker') && er5.includes("from '@/components/entities/add-item-picker'"));
    check('J24 · creation proposes members from the BRAIN (the founding proposal replaced create-with-work)',
      readFileSync('lib/entities/founding.ts', 'utf8').includes('proposeFoundingAdoptions') &&
      readFileSync('app/api/entities/adopt/route.ts', 'utf8').includes('absorbEntity'));
    check('J24 · today-strip renders the HUMAN time (localTime, one formatter)',
      hv4.includes('localTime ?? b!.schedule![0].time'));
    check('J24 · switcher order Home · Projects · Timeline',
      vs.indexOf("id: 'projects'") < vs.indexOf("id: 'timeline'"));
  }
  // LIVE: found a project WITH work in it — every chosen item lands linked+locked; full cleanup.
  {
    const { data: loose } = await sb.from('inbox_items').select('id').eq('user_id', A)
      .eq('status', 'pending').eq('source', 'email').order('created_at', { ascending: false }).limit(30);
    const ids = ((loose ?? []) as Array<{ id: string }>).map((r) => r.id);
    const { data: linked } = await sb.from('entity_links').select('item_id').eq('user_id', A).in('item_id', ids).not('entity_id', 'is', null);
    const linkedSet = new Set((linked ?? []).map((l) => l.item_id as string));
    const pick = ids.filter((i) => !linkedSet.has(i)).slice(0, 2);
    const { data: created } = await sb.from('work_entities').insert({ user_id: A, kind: 'initiative', name: 'ZZ Smoke Founded With Work', aliases: ['ZZ Smoke Founded With Work'], tracked: true, status: 'active' }).select('id').single();
    const { setItemMembership } = await import('../lib/entities/membership');
    for (const i of pick) await setItemMembership(sb, A, { kind: 'inbox_item', id: i, entityId: created!.id as string }, { inline: false });
    const { data: lnks } = await sb.from('entity_links').select('item_id, locked').eq('user_id', A).eq('entity_id', created!.id as string);
    check('J24 live · create-with-work lands every item linked+locked',
      pick.length > 0 && (lnks ?? []).length === pick.length && (lnks ?? []).every((l) => l.locked === true), `${(lnks ?? []).length}/${pick.length}`);
    for (const i of pick) await sb.from('entity_links').delete().eq('user_id', A).eq('item_kind', 'inbox_item').eq('item_id', i);
    await sb.from('work_entities').delete().eq('id', created!.id as string);
    await sb.from('activity_events').delete().eq('user_id', A).ilike('title', '%ZZ Smoke Founded%');
  }

  console.log('\n════ PHASE-4 GATES (tasks · the room does the work) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
