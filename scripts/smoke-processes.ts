// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROCESSES SUITE (permanent, Phase A of the processes arc — docs/processes-plan.md "Gates").
// A PROCESS is a run wearing its human state. The laws this suite makes un-decayable:
//   P1  THE DERIVATION — processStateOf / gateDeltaOf / PROCESS_BUCKETS are pure and total
//       (every status maps, an unknown status degrades to `running`, a clean gate pass is SILENT).
//   P2  THE SUBJECT LADDER — derived, never stored: a reaction-fired run wears its triggering
//       event's title; a scheduled repeat deliberately keeps the plain workflow name (calm).
//       Real reads against the probe host — the served derivation, not a mock.
//   P3  THE SERVED CONTRACT — /api/workflows/ledger serves `processes[]` through the ONE
//       derivation and fills stepsTotal from the workflow's own steps.
//   P4  THE ONE-DERIVATION LAW — the strip, the drawer and the deep-dive CONSUME the contract
//       module; no surface re-implements a status→bucket mapping (the bug class the module kills).
//   P5  THE ONE DOOR — every approve/reject in the workflows surfaces is the ONE resume route.
//   P6  THE CALM + STANDBY FLOORS — a quiet account renders no strip, held_back never seeks
//       attention, empty buckets don't render, Frames stays behind its flag, /workflows redirects.
// Zero AI by design (pure table-tests + source floors + one served-derivation probe).
// Run: npx tsx --env-file=.env.local scripts/smoke-processes.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import {
  processStateOf, gateDeltaOf, PROCESS_BUCKETS, deriveProcessRows,
  type RunLike, type StepOutputLike,
} from '../lib/workflows/process-state';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const st = (status: string, error: string | null = null) => processStateOf({ status, error });
const verdictStep = (status: string, findings: number): StepOutputLike =>
  ({ verdict: { status, findings: Array.from({ length: findings }, (_, i) => ({ quote: `q${i}`, action: 'corrected', source: 'rule' })), reported: true } as never });

async function main() {
  // ── P1 — THE DERIVATION (pure) ─────────────────────────────────────────────────────────────
  console.log('\nP1 — THE DERIVATION (processStateOf):');
  ok('queued → running', st('queued').state === 'running', st('queued').state);
  ok('running → running', st('running').state === 'running', st('running').state);
  ok('awaiting_approval → needs_you', st('awaiting_approval').state === 'needs_you', st('awaiting_approval').state);
  ok('…and a park speaks NO reason (the ask is the card, not a sentence)', st('awaiting_approval').reason === undefined);
  ok('succeeded → delivered', st('succeeded').state === 'delivered', st('succeeded').state);
  {
    const f = st('failed', 'Together AI returned 402: credit balance exhausted');
    ok('failed → needs_you (a failure is the owner\'s to act on)', f.state === 'needs_you', f.state);
    ok('…carrying the error as the spoken reason', f.reason === 'Together AI returned 402: credit balance exhausted', String(f.reason));
  }
  {
    const long = 'x'.repeat(400);
    const f = st('failed', long);
    ok('…clipped to ≤140 chars', (f.reason ?? '').length === 140, String((f.reason ?? '').length));
  }
  ok('failed with error:null STILL speaks a reason (never a mute failure)',
    st('failed', null).state === 'needs_you' && !!st('failed', null).reason, JSON.stringify(st('failed', null)));
  ok('rejected → held_back (history, never attention)', st('rejected').state === 'held_back', st('rejected').state);
  ok('cancelled → held_back', st('cancelled').state === 'held_back', st('cancelled').state);
  ok('an UNKNOWN status degrades to running (the safe default — never a blank surface)',
    st('some_future_status').state === 'running', st('some_future_status').state);
  ok('every ProcessState the module names is reachable or reserved for Phase B',
    PROCESS_BUCKETS.some((b) => b.state === 'waiting_on_others'));

  console.log('\nP1 — THE DELTA RULE (gateDeltaOf):');
  ok('null outputs → null', gateDeltaOf(null) === null);
  ok('outputs without a verdict → null', gateDeltaOf([{ label: 'fetch' }, { label: 'write' }]) === null);
  ok('a PASSED verdict → null (a clean pass is SILENT)', gateDeltaOf([verdictStep('passed', 0)]) === null);
  {
    const d = gateDeltaOf([verdictStep('corrected', 3)]);
    ok('corrected with 3 findings → {corrected, fixed:3}', d?.status === 'corrected' && d?.fixed === 3, JSON.stringify(d));
  }
  {
    const d = gateDeltaOf([verdictStep('blocked', 1)]);
    ok('blocked → {blocked, fixed:1}', d?.status === 'blocked' && d?.fixed === 1, JSON.stringify(d));
  }
  {
    const d = gateDeltaOf([verdictStep('corrected', 2), { label: 'plain' }, verdictStep('blocked', 4)]);
    ok('several verdict-bearing steps → the LAST verdict wins', d?.status === 'blocked' && d?.fixed === 4, JSON.stringify(d));
  }

  console.log('\nP1 — THE BUCKET VOCABULARY (PROCESS_BUCKETS):');
  ok('exactly 4 buckets', PROCESS_BUCKETS.length === 4, String(PROCESS_BUCKETS.length));
  ok('needs_you leads (attention first)', PROCESS_BUCKETS[0].state === 'needs_you', PROCESS_BUCKETS[0].state);
  ok('the words are the fixed vocabulary',
    JSON.stringify(PROCESS_BUCKETS.map((b) => b.label)) ===
    JSON.stringify(['Needs my input', 'Running', 'Waiting on others', 'Delivered']),
    JSON.stringify(PROCESS_BUCKETS.map((b) => b.label)));
  ok('held_back is NOT a bucket (it never seeks attention)',
    !PROCESS_BUCKETS.some((b) => b.state === 'held_back'));

  // ── P2 — THE SUBJECT LADDER (real reads on the probe host) ─────────────────────────────────
  console.log('\nP2 — THE SUBJECT LADDER (derived, against the probe DB):');
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const userId = await resolveProbeUser(admin);
  const stamp = Date.now();
  const EVENT_TITLE = 'Acme tender — road resurfacing lot 4';
  const WF_NAME = `Probe process suite ${stamp}`;

  let wfId: string | null = null;
  let eventRunId: string | null = null;
  let schedRunId: string | null = null;
  const fireEntityId = `probe-fire-${stamp}`;

  try {
    const { data: wf, error: wfErr } = await admin.from('workflows').insert({
      user_id: userId, name: WF_NAME, status: 'active',
      trigger: { type: 'schedule', label: 'Weekly' },
      steps: [{ type: 'tool', label: 'gather' }, { type: 'ai', label: 'write' }],
    }).select('id').single();
    if (!wf) { console.log(`  ✗ workflow fixture failed — ${wfErr?.message}`); fail++; }
    wfId = (wf as { id: string } | null)?.id ?? null;

    if (wfId) {
      const { data: r1, error: r1e } = await admin.from('workflow_runs').insert({
        workflow_id: wfId, user_id: userId, status: 'running', triggered_by: 'event',
      }).select('id').single();
      const { data: r2, error: r2e } = await admin.from('workflow_runs').insert({
        workflow_id: wfId, user_id: userId, status: 'succeeded', triggered_by: 'schedule',
      }).select('id').single();
      if (!r1 || !r2) { console.log(`  ✗ run fixtures failed — ${r1e?.message ?? ''} ${r2e?.message ?? ''}`); fail++; }
      eventRunId = (r1 as { id: string } | null)?.id ?? null;
      schedRunId = (r2 as { id: string } | null)?.id ?? null;

      if (eventRunId) {
        // The exactly-once fire record, in the shape reactions.ts writes (triggerBlock's context:
        // a header line, then the event's TITLE, then the gist).
        const { error: fErr } = await admin.from('item_plans').insert({
          user_id: userId, kind: 'reaction_fire', entity_id: fireEntityId,
          tasks: {
            runId: eventRunId,
            reason: 'probe',
            context: `A new item matched this workflow's trigger:\n${EVENT_TITLE}\nfrom: procurement@example-buyer.test\ngist: bid documents attached`,
            firedAt: new Date().toISOString(),
          },
        });
        if (fErr) { console.log(`  ✗ fire fixture failed — ${fErr.message}`); fail++; }
      }
    }

    if (wfId && eventRunId && schedRunId) {
      const runs: RunLike[] = [
        {
          id: eventRunId, workflow_id: wfId, status: 'running', triggered_by: 'event',
          step_outputs: [{ label: 'gather' }], error: null,
          started_at: new Date(stamp).toISOString(), completed_at: null, created_at: new Date(stamp).toISOString(),
        },
        {
          id: schedRunId, workflow_id: wfId, status: 'succeeded', triggered_by: 'schedule',
          step_outputs: [{ label: 'gather' }, verdictStep('passed', 0)], error: null,
          started_at: new Date(stamp).toISOString(), completed_at: new Date(stamp + 1000).toISOString(),
          created_at: new Date(stamp).toISOString(),
        },
      ];
      const rows = await deriveProcessRows(admin, userId, runs, new Map([[wfId, { name: WF_NAME }]]));
      const ev = rows.find((r) => r.runId === eventRunId);
      const sc = rows.find((r) => r.runId === schedRunId);

      console.log(`    · event-run subject   → "${ev?.subject}"`);
      console.log(`    · schedule-run subject → "${sc?.subject}"`);

      ok('a reaction-fired run wears the triggering EVENT\'s title (context line 2)',
        ev?.subject === EVENT_TITLE, String(ev?.subject));
      ok('…and its state comes from the ONE mapper', ev?.state === 'running', String(ev?.state));
      ok('a SCHEDULED repeat keeps the plain workflow name (calm — no invented case chrome)',
        sc?.subject === WF_NAME, String(sc?.subject));
      ok('the delivered run buckets as delivered', sc?.state === 'delivered', String(sc?.state));
      ok('a clean gate pass leaves NO chip on the served row', sc?.gate === null, JSON.stringify(sc?.gate));
      ok('stepsDone counts the run\'s own outputs', ev?.stepsDone === 1 && sc?.stepsDone === 2,
        `${ev?.stepsDone}/${sc?.stepsDone}`);
      ok('stepsTotal is left to the route (the module never guesses the method\'s length)',
        ev?.stepsTotal === 0 && sc?.stepsTotal === 0, `${ev?.stepsTotal}/${sc?.stepsTotal}`);
      ok('the row carries its workflow identity for the deep-dive filter',
        ev?.workflowId === wfId && ev?.workflowName === WF_NAME);
    }
  } finally {
    // Zero leftovers — the probe host is shared by every suite.
    if (wfId) await admin.from('workflow_runs').delete().eq('workflow_id', wfId);
    await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', fireEntityId);
    if (wfId) await admin.from('workflows').delete().eq('id', wfId);
    const { data: leftRuns } = await admin.from('workflow_runs').select('id').eq('workflow_id', wfId ?? '00000000-0000-0000-0000-000000000000');
    const { data: leftFire } = await admin.from('item_plans').select('id').eq('user_id', userId).eq('entity_id', fireEntityId);
    const { data: leftWf } = await admin.from('workflows').select('id').eq('user_id', userId).eq('name', WF_NAME);
    ok('probe leftovers are ZERO (runs · fire record · workflow)',
      (leftRuns ?? []).length === 0 && (leftFire ?? []).length === 0 && (leftWf ?? []).length === 0,
      `${(leftRuns ?? []).length}/${(leftFire ?? []).length}/${(leftWf ?? []).length}`);
  }

  // ── SOURCE FLOORS ──────────────────────────────────────────────────────────────────────────
  const ledgerRoute = readFileSync('app/api/workflows/ledger/route.ts', 'utf8');
  const strip = readFileSync('components/workflows/workflows-ledger.tsx', 'utf8');
  const drawer = readFileSync('components/workflows/process-drawer.tsx', 'utf8');
  const detail = readFileSync('components/workflows/workflow-detail.tsx', 'utf8');
  const indexPage = readFileSync('app/(main)/workflows/page.tsx', 'utf8');
  const detailPage = readFileSync('app/(main)/workflows/[id]/page.tsx', 'utf8');

  console.log('\nP3 — THE SERVED CONTRACT (the ledger route):');
  ok('the route derives through the ONE module', ledgerRoute.includes('deriveProcessRows'));
  ok('…imported from the contract module', /process-state/.test(ledgerRoute));
  ok('`processes` rides the served JSON', /NextResponse\.json\(\{[^}]*\bprocesses\b/.test(ledgerRoute),
    'processes missing from the response payload');
  ok('the route fills stepsTotal from the workflow\'s own steps',
    ledgerRoute.includes('stepsTotalByWf') && /stepsTotal: stepsTotalByWf\.get/.test(ledgerRoute));
  ok('…and never leaves it at the module\'s placeholder 0 (falls back to stepsDone)',
    /stepsTotalByWf\.get\(p\.workflowId\) \?\? p\.stepsDone/.test(ledgerRoute));

  console.log('\nP4 — THE ONE-DERIVATION LAW (no surface computes its own bucket):');
  ok('the strip imports PROCESS_BUCKETS from the contract module',
    /import \{[^}]*PROCESS_BUCKETS[^}]*\} from '@\/lib\/workflows\/process-state'/.test(strip));
  ok('…and renders the buckets FROM it (never a local label list)',
    strip.includes('PROCESS_BUCKETS.filter('));
  ok('…bucketing on the SERVED state, never on a run status',
    strip.includes("p.state === 'needs_you'") && strip.includes("p.state === 'running'"));
  ok('the drawer consumes the contract type', drawer.includes("from '@/lib/workflows/process-state'"));
  ok('the deep-dive imports processStateOf + gateDeltaOf + PROCESS_BUCKETS from the module',
    /import \{[^}]*PROCESS_BUCKETS[^}]*gateDeltaOf[^}]*processStateOf[^}]*\} from '@\/lib\/workflows\/process-state'/.test(detail)
    || (detail.includes('PROCESS_BUCKETS') && detail.includes('gateDeltaOf') && detail.includes('processStateOf')
        && detail.includes("from '@/lib/workflows/process-state'")));
  ok('…and uses processStateOf to place runs on its own timeline (no second mapper)',
    detail.includes('processStateOf(r)'));
  {
    // The bug class: a surface re-implementing the status switch. No components/workflows file may
    // carry the mapper's own shape.
    const reimplemented = [['workflows-ledger.tsx', strip], ['process-drawer.tsx', drawer], ['workflow-detail.tsx', detail]]
      .filter(([, src]) => (src as string).includes("case 'succeeded'") || (src as string).includes("case 'awaiting_approval'"))
      .map(([n]) => n);
    ok('NO components/workflows file re-implements processStateOf', reimplemented.length === 0, reimplemented.join(', '));
  }
  {
    // THE SOURCE FLOOR (owner walk, Aug 19 — a real one-derivation violation): the deep-dive's
    // Timeline used to bucket every run through the CLIENT mapper, which cannot know a park
    // belongs to a teammate — it said "Needs my input" over a run the Work tab called "waiting on
    // <name>". Both tabs now read ONE map of the SERVED rows; the client mapper survives only as
    // the out-of-window fallback (older runs are terminal by construction).
    ok('the deep-dive builds ONE runId→ProcessRow map from the served processes',
      detail.includes('const runIdToProcessRow = useMemo(')
      && /new Map\(\(processes \?\? \[\]\)\.map\(\(p\) => \[p\.runId, p\]/.test(detail));
    ok('…and hands that same map to the Timeline tab (Work + Timeline, one source)',
      detail.includes('runIdToProcessRow={runIdToProcessRow}')
      && detail.includes('const served = runIdToProcessRow.get(r.id);'));
    ok('a run WITH a served row never touches processStateOf (the served state wins)',
      /const state: ProcessState = served \? served\.state : processStateOf\(r\)\.state;/.test(detail));
    ok('…and the fallback declares WHY it is safe (out-of-window runs are terminal)',
      detail.includes('THE SERVED ROW WINS. FALLBACK (safe by construction)'));
    {
      // Comment lines are prose about the law, not calls — count CODE only.
      const code = detail.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      ok('processStateOf has exactly ONE call site left in the deep-dive (the fallback)',
        (code.match(/processStateOf\(/g) ?? []).length === 1,
        String((code.match(/processStateOf\(/g) ?? []).length));
    }
    ok('Timeline group labels speak the SERVED words (a wait wears its name)',
      detail.includes('Waiting on ${names[0]}'));
  }

  console.log('\nP5 — THE ONE DOOR (approve/reject fires the one resume route):');
  {
    // RE-POINTED (Aug 19, owner walk fix): the ledger's WAITING ON YOU card section was DELETED
    // (it contradicted the strip on teammate gates), so the ledger has ZERO resume callers by
    // design. The doors today: the drawer + the commitment deep-dive's HANDOFF DECISION CARD
    // (components/home/item-detail.tsx) + the room card — all the one route.
    const itemDetail = readFileSync('components/home/item-detail.tsx', 'utf8');
    const files: Array<[string, string]> = [['workflows-ledger.tsx', strip], ['process-drawer.tsx', drawer], ['workflow-detail.tsx', detail], ['item-detail.tsx', itemDetail]];
    // Every fetch() URL across the workflows surfaces, extracted structurally.
    const urls: Array<{ file: string; url: string }> = [];
    for (const [name, src] of files) {
      for (const m of src.matchAll(/fetch\(\s*[`'"]([^`'"]+)[`'"]/g)) urls.push({ file: name, url: m[1] });
    }
    const resumeCalls = urls.filter((u) => u.url.includes('/resume'));
    ok('at least TWO callers post to the resume route (the drawer + the decision card)', resumeCalls.length >= 2,
      `${resumeCalls.length}: ${resumeCalls.map((u) => u.file).join(', ')}`);
    ok('the LEDGER itself has zero resume callers (the WAITING ON YOU section stays dead)',
      !resumeCalls.some((u) => u.file === 'workflows-ledger.tsx'), '');
    ok('every /resume call is the literal /api/workflows/runs/<runId>/resume shape',
      resumeCalls.every((u) => /^\/api\/workflows\/runs\/\$\{[^}]+\}\/resume$/.test(u.url)),
      resumeCalls.map((u) => u.url).join(' | '));
    // The law is about ENDPOINTS, so match the URL's LITERAL text only — `${handoff.workflowId}`
    // is a variable named after the domain, not a path segment (it false-fired on the gated-work
    // room's read-only run fetch). A real /approve or /handoff route literal still trips it.
    const otherApprovalDoors = urls.filter((u) =>
      !u.url.includes('/resume') && /approve|reject|decide|handoff/i.test(u.url.replace(/\$\{[^}]*\}/g, '')));
    ok('NO second approve/reject endpoint exists on these surfaces', otherApprovalDoors.length === 0,
      otherApprovalDoors.map((u) => `${u.file}:${u.url}`).join(', '));
  }

  console.log('\nP6 — THE CALM + STANDBY FLOORS:');
  ok('the strip renders only when something is live or freshly landed',
    /const showStrip = liveProcesses\.length > 0 \|\| recentlyDelivered\.length > 0/.test(strip));
  ok('…and it is GATED on that guard (a quiet account sees nothing)',
    /tab === 'workflows' && showStrip/.test(strip));
  ok('held_back never enters the strip (live = needs_you · running · waiting_on_others only)',
    /liveProcesses = processes\.filter\(\(p\) => p\.state === 'needs_you' \|\| p\.state === 'running' \|\| p\.state === 'waiting_on_others'\)/.test(strip)
    && !strip.includes("state === 'held_back'"));
  ok('delivered rides only as a chip count inside its window (never an attention row)',
    strip.includes('DELIVERED_WINDOW_MS') && !/stripRows = \[[\s\S]{0,240}'delivered'/.test(strip));
  // RE-POINTED (mockup-fidelity wave, Aug 19): the owner's mockup gave Work a process TABLE with
  // a 'Show completed' fold — held_back/delivered now RENDER, but only behind the explicit toggle,
  // never as active attention rows. The old "drops held_back entirely" law is superseded BY DESIGN;
  // the replacement pins the new law just as hard.
  ok('held_back is never an ACTIVE Work row (active = needs_you · running · waiting_on_others)',
    /const active = processes\.filter\(\(p\) => p\.state === 'needs_you' \|\| p\.state === 'running' \|\| p\.state === 'waiting_on_others'\)/.test(detail));
  ok('completed rows (delivered · held_back) render ONLY behind the Show-completed fold',
    /const completed = processes\.filter\(\(p\) => p\.state === 'delivered' \|\| p\.state === 'held_back'\)/.test(detail)
    && /const rows = showDone \? \[\.\.\.active, \.\.\.completed\] : active;/.test(detail));
  ok('an empty Work tab says so honestly (never a mute table)',
    detail.includes('Nothing is in flight right now.'));
  // RE-POINTED (frames arc Phase 1, Aug 19 — the owner ordered the arc; standby is over BY
  // DESIGN): the flag is ON, and the replacement law is the frames plan's law 1 — the tab is a
  // FILTER over frame-typed artifacts, never a second production machine. The deep gates live in
  // smoke-frames.ts; here we pin the flag + the filter grammar.
  ok('FRAMES is live behind its flag (the arc landed)', /const SHOW_FRAMES = true/.test(detail));
  ok('…and the tab only exists behind the flag', /if \(SHOW_FRAMES\)/.test(detail));
  // RE-POINTED (the gallery wave, Aug 19): FramesTab MOVED to components/frames/frames-tab.tsx —
  // the deep-dive keeps the flag, the gated registration and the mount; the FILTER law is asserted
  // where the filter now lives. Same law, same strength, correct address.
  {
    const framesTab = readFileSync('components/frames/frames-tab.tsx', 'utf8');
    ok('…and the Frames tab is a FILTER on frame-typed artifacts (law 1 — never a second machine)',
      /type [!=]== 'frame'/.test(framesTab) && /FramesTab/.test(detail)
      && detail.includes("from '@/components/frames/frames-tab'"));
  }
  ok('the bare /workflows page is not a second surface — it redirects to the Home view',
    indexPage.includes("redirect('/home?view=workflows')"));
  ok('the deep-dive page bounces an unreadable workflow to the same one surface',
    detailPage.includes("redirect('/home?view=workflows')"));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // P7 — A RUN NEEDS ITS MATERIAL (THE READINESS WAVE)
  // The pilot incident: a DRAFT reaction workflow ran with no triggering event; six steps
  // narrated their own emptiness and the "deliverable" was a failure report. THE LAW: unreadiness
  // is spoken BEFORE the work — on the ledger row, at the dispatcher, and at the door — through
  // ONE derivation (lib/workflows/readiness.ts). This section is that law's floor.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const {
    readinessOf, nothingToReactTo, emptyFirstMaterial, isStructurallyEmpty, READINESS_REASON_MAX,
  } = await import('../lib/workflows/readiness');
  type Feat = import('../lib/workspace/types').WorkspaceFeatures;
  const feats = (over: Partial<Feat> = {}): Feat =>
    ({ email: true, meetings: true, drive: true, agents: true, studio: true, home: true, ...over });
  const reasonOf = (r: ReturnType<typeof readinessOf>) => (r.ready ? null : r.reason);

  console.log('\nP7a — THE RULE TABLE (pure; first failing rule speaks):');
  ok('1 — no steps → "No steps yet — build it in Studio."',
    reasonOf(readinessOf({ status: 'active', steps: [] }, feats())) === 'No steps yet — build it in Studio.',
    String(reasonOf(readinessOf({ status: 'active', steps: [] }, feats()))));
  ok('2 — a draft → "Still a draft — finish it in Studio."',
    reasonOf(readinessOf({ status: 'draft', steps: [{ type: 'ai' }] }, feats())) === 'Still a draft — finish it in Studio.',
    String(reasonOf(readinessOf({ status: 'draft', steps: [{ type: 'ai' }] }, feats()))));
  ok('3 — a handoff with nobody behind it → "The \'Wait on a person\' step needs a person."',
    reasonOf(readinessOf({ status: 'active', steps: [{ type: 'ai' }, { type: 'handoff' }] }, feats()))
      === "The 'Wait on a person' step needs a person.",
    String(reasonOf(readinessOf({ status: 'active', steps: [{ type: 'handoff' }] }, feats()))));
  ok('…an ASSIGNED handoff is ready (the gate has a person)',
    readinessOf({ status: 'active', steps: [{ type: 'handoff', assignee_user_id: '00000000-0000-0000-0000-000000000001' }] }, feats()).ready === true);
  {
    const r = reasonOf(readinessOf(
      { status: 'active', steps: [{ type: 'tool', tool: 'get_emails', label: 'Pull the inbox' }] },
      feats({ email: false }),
    ));
    ok('4 — a feature-gated tool → "The <label> step needs <Feature> enabled."',
      r === 'The Pull the inbox step needs Email enabled.', String(r));
  }
  ok('…and the SAME step is ready when the feature is on',
    readinessOf({ status: 'active', steps: [{ type: 'tool', tool: 'get_emails', label: 'Pull the inbox' }] }, feats()).ready === true);
  ok('5 — a reaction with a blank `when` → "The trigger needs an event to react to."',
    reasonOf(readinessOf({ status: 'active', trigger: { type: 'reaction', when: '   ' }, steps: [{ type: 'ai' }] }, feats()))
      === 'The trigger needs an event to react to.',
    String(reasonOf(readinessOf({ status: 'active', trigger: { type: 'reaction' }, steps: [{ type: 'ai' }] }, feats()))));
  ok('…a reaction WITH a condition is ready',
    readinessOf({ status: 'active', trigger: { type: 'reaction', when: 'a tender lands' }, steps: [{ type: 'ai' }] }, feats()).ready === true);
  ok('THE READY CASE speaks no reason at all',
    JSON.stringify(readinessOf({ status: 'active', trigger: { type: 'schedule' }, steps: [{ type: 'tool', tool: 'web_search' }] }, feats()))
      === JSON.stringify({ ready: true }));
  ok('PAUSED IS READY — asleep is not unready',
    readinessOf({ status: 'paused', steps: [{ type: 'ai' }] }, feats()).ready === true);
  ok('…and so is an auto-paused workflow (any non-draft status)',
    readinessOf({ status: 'auto_paused', steps: [{ type: 'ai' }] }, feats()).ready === true);
  ok('ORDER IS SEVERITY — no-steps outranks draft',
    reasonOf(readinessOf({ status: 'draft', steps: [] }, feats())) === 'No steps yet — build it in Studio.');
  ok('…and the handoff outranks the feature rule (the human gate speaks first)',
    reasonOf(readinessOf({ status: 'active', steps: [{ type: 'tool', tool: 'get_emails', label: 'inbox' }, { type: 'handoff' }] }, feats({ email: false })))
      === "The 'Wait on a person' step needs a person.");
  ok('NULL features → rule 4 ABSTAINS (an unknown workspace never invents unreadiness)',
    readinessOf({ status: 'active', steps: [{ type: 'tool', tool: 'get_emails', label: 'inbox' }] }, null).ready === true);
  {
    const r = reasonOf(readinessOf(
      { status: 'active', steps: [{ type: 'tool', tool: 'get_emails', label: 'x'.repeat(200) }] },
      feats({ email: false }),
    )) ?? '';
    ok(`the reason stays ≤${READINESS_REASON_MAX} chars even with a 200-char step label`,
      r.length <= READINESS_REASON_MAX && r.endsWith('needs Email enabled.'), `${r.length}: ${r}`);
  }

  console.log('\nP7b — EMPTINESS + THE REFUSAL SENTENCES (pure):');
  ok('isStructurallyEmpty: null · undefined · "" · "   " · [] · {}',
    [null, undefined, '', '   ', [], {}].every((v) => isStructurallyEmpty(v)));
  ok('…and NOT: a "no new items" sentence (that is CONTENT, not emptiness)',
    isStructurallyEmpty('No new items this week.') === false);
  ok('…nor a populated array / object / number / false',
    ![[1], { a: 1 }, 0, false].some((v) => isStructurallyEmpty(v)));
  ok('emptyFirstMaterial speaks its exact sentence',
    emptyFirstMaterial('Pull the feed')
      === 'Step 1 (Pull the feed) returned nothing to work with — the run stopped rather than inventing a deliverable.',
    emptyFirstMaterial('Pull the feed'));
  ok('…and an unlabelled step still reads as a sentence',
    emptyFirstMaterial('').startsWith('Step 1 (the first step) returned nothing'), emptyFirstMaterial(''));
  // RE-POINTED (relay canvas W2): the sentence grew its second clause the day the material door
  // opened. The gate follows the words verbatim — a refusal is copy, and copy that drifts un-gated
  // is how a promise decays back into a lie.
  ok('nothingToReactTo names the trigger\'s own `when`',
    nothingToReactTo({ when: 'a tender lands' })
      === 'Nothing to react to — this workflow runs when a tender lands. It will run by itself when that happens — or Run it now with sample material to test.',
    nothingToReactTo({ when: 'a tender lands' }));
  ok('…falls back to the trigger LABEL, then to a plain phrase',
    nothingToReactTo({ label: 'On a new invoice' }).includes('runs when On a new invoice.')
    && nothingToReactTo(null).includes('runs when a matching event arrives.'),
    nothingToReactTo(null));
  // THE LYING-DOOR FLOOR (owner, Aug 20) — INVERTED, and the law is the SAME law.
  //
  // The floor was never "never say sample material". It is: A SPOKEN REMEDY MUST BE BACKED BY A REAL
  // DOOR. On Aug 20 there was no material door, so the phrase was the lie and its absence was the
  // gate. THE RELAY CANVAS W2 BUILT THE DOOR — `POST /api/workflows/[id]/run` accepts
  // `{ material }` and `run-material-sheet.tsx` is where a person hands it over, mounted by both
  // run affordances. So the same law now bites the other way: the refusal is the ONE place a person
  // is looking for that remedy, and staying silent about a door that exists is the new lie.
  //
  // Gated in BOTH directions, deliberately: the phrase must be present AND the affordance behind it
  // must still be in the tree. Delete the sheet or the route's `material` arg and this red goes off
  // — which is exactly the moment the sentence would have become a lie again.
  {
    const runRoute = readFileSync('app/api/workflows/[id]/run/route.ts', 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    const sheetPath = 'components/workflows/run-material-sheet.tsx';
    const sheetExists = existsSync(sheetPath);
    const mounts = ['components/workflows/workflows-ledger.tsx', 'components/workflows/workflow-detail.tsx']
      .filter((p) => existsSync(p) && readFileSync(p, 'utf8').includes('run-material-sheet'));
    ok('the refusal\'s "sample material" remedy is SPOKEN and BACKED by a real door',
      /sample material/i.test(nothingToReactTo({ when: 'a tender lands' }))
      && /material\?:\s*\{/.test(runRoute)
      && /materialBlock\(body\.material\)/.test(runRoute)
      && sheetExists && mounts.length >= 1,
      `sheet=${sheetExists} mounts=${mounts.length} route=${/materialBlock\(body\.material\)/.test(runRoute)}`);
  }

  // ── P7c–P7e — LIVE, at the door (probe host; every fixture swept) ──────────────────────────
  console.log('\nP7c/d/e — THE REFUSAL AT THE DOOR (live runs on the probe host):');
  const { runWorkflow } = await import('../lib/workflows/run-workflow');
  const readySince = new Date().toISOString();
  const liveIds: string[] = [];
  const NAME_PREFIX = `Probe readiness ${stamp}`;
  const mkWf = async (name: string, patch: Record<string, unknown>) => {
    const { data, error } = await admin.from('workflows').insert({
      user_id: userId, name, status: 'active',
      output_config: { destination: 'message' },
      ...patch,
    }).select('id').single();
    if (!data) { console.log(`  ✗ fixture "${name}" failed — ${error?.message}`); fail++; return null; }
    const id = (data as { id: string }).id;
    liveIds.push(id);
    return id;
  };

  try {
    // (c) THE RENÉ SHAPE: a real reaction workflow, run by hand, with nothing that happened.
    const reactWhen = 'a new tender matching our sectors arrives';
    const reactId = await mkWf(`${NAME_PREFIX} — reaction`, {
      trigger: { type: 'reaction', when: reactWhen, label: 'On a new tender' },
      steps: [
        { id: 's1', type: 'tool', tool: 'get_workflow_output', label: 'Prior output', config: {} },
        { id: 's2', type: 'ai', label: 'Write the brief', prompt: 'Summarise the material.' },
      ],
    });
    if (reactId) {
      const res = await runWorkflow({ workflowId: reactId, triggerSource: 'manual', isTest: true });
      const { data: row } = await admin.from('workflow_runs')
        .select('status, error, step_outputs, thread_id').eq('id', res.runId).maybeSingle();
      const r = (row ?? {}) as { status?: string; error?: string; step_outputs?: unknown[]; thread_id?: string | null };
      console.log(`    · refusal → ${r.status}: "${r.error}"`);
      ok('a reaction run with no event FAILS (an ordinary failed run — no new status)',
        res.status === 'failed' && r.status === 'failed', `${res.status}/${r.status}`);
      ok('…and the error IS the spoken nothing-to-react-to sentence, verbatim',
        r.error === nothingToReactTo({ when: reactWhen, label: 'On a new tender' }), String(r.error));
      ok('…no step ever ran (step_outputs empty)', (r.step_outputs ?? []).length === 0,
        String((r.step_outputs ?? []).length));
      ok('…no thread was created (the refusal is silent — nothing to narrate)',
        !r.thread_id, String(r.thread_id));
      const { data: threads } = await admin.from('work_threads').select('id, artifacts').eq('workflow_id', reactId);
      ok('…and the workflow owns ZERO threads and ZERO artifacts',
        (threads ?? []).length === 0, String((threads ?? []).length));
      const { count: sends } = await admin.from('email_sends')
        .select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', readySince);
      ok('…and the refusal sent NO email (the report-back is skipped whole)', (sends ?? 0) === 0, String(sends));
    }

    // (d) NOT READY at the door — the ledger's reason and the door's reason are the same words.
    const orphanId = await mkWf(`${NAME_PREFIX} — orphan handoff`, {
      trigger: { type: 'schedule', label: 'Weekly' },
      steps: [
        { id: 's1', type: 'tool', tool: 'get_workflow_output', label: 'Prior output', config: {} },
        { id: 's2', type: 'handoff', label: 'Wait on a person' },
      ],
    });
    if (orphanId) {
      const res = await runWorkflow({ workflowId: orphanId, triggerSource: 'manual', isTest: true });
      const { data: row } = await admin.from('workflow_runs')
        .select('status, error, step_outputs, thread_id').eq('id', res.runId).maybeSingle();
      const r = (row ?? {}) as { status?: string; error?: string; step_outputs?: unknown[]; thread_id?: string | null };
      console.log(`    · not-ready → ${r.status}: "${r.error}"`);
      ok('a not-ready workflow refuses at the door, failed',
        res.status === 'failed' && r.status === 'failed', `${res.status}/${r.status}`);
      ok('…with the READINESS reason verbatim (one derivation, ledger and door alike)',
        r.error === "The 'Wait on a person' step needs a person.", String(r.error));
      ok('…nothing ran and no thread exists', (r.step_outputs ?? []).length === 0 && !r.thread_id);
    }

    // (e) THE CONTROL — a ready manual workflow still runs and still produces. The floor must
    // refuse the empty, never the ordinary. (Zero AI, zero external: the tool answers locally and
    // the `message` home is the deliverable itself — no report-back pass.)
    const readyId = await mkWf(`${NAME_PREFIX} — control`, {
      trigger: { type: 'manual', label: 'On demand' },
      steps: [{ id: 's1', type: 'tool', tool: 'get_workflow_output', label: 'Prior output', config: {} }],
    });
    if (readyId) {
      const res = await runWorkflow({ workflowId: readyId, triggerSource: 'manual', isTest: true });
      const { data: row } = await admin.from('workflow_runs')
        .select('status, error, step_outputs, thread_id').eq('id', res.runId).maybeSingle();
      const r = (row ?? {}) as { status?: string; error?: string; step_outputs?: Array<{ output?: unknown }>; thread_id?: string | null };
      console.log(`    · control → ${r.status} (${(r.step_outputs ?? []).length} step outputs)`);
      ok('CONTROL: a ready run still SUCCEEDS (the floor refuses the empty, not the ordinary)',
        res.status === 'succeeded' && r.status === 'succeeded' && !r.error, `${res.status}/${r.status}/${r.error}`);
      ok('…and it produced real output through the ordinary path',
        (r.step_outputs ?? []).length === 1 && !isStructurallyEmpty((r.step_outputs ?? [])[0]?.output),
        JSON.stringify((r.step_outputs ?? [])[0]?.output).slice(0, 80));
      ok('…and it got its thread (the refusals above got none)', !!r.thread_id);
    }
  } finally {
    for (const id of liveIds) {
      const { data: th } = await admin.from('work_threads').select('id').eq('workflow_id', id);
      for (const t of (th ?? []) as Array<{ id: string }>) {
        await admin.from('work_messages').delete().eq('thread_id', t.id);
      }
      await admin.from('work_threads').delete().eq('workflow_id', id);
      await admin.from('workflow_runs').delete().eq('workflow_id', id);
      await admin.from('workflows').delete().eq('id', id);
    }
    const { data: leftWf } = await admin.from('workflows').select('id').eq('user_id', userId).like('name', `${NAME_PREFIX}%`);
    const { data: leftTh } = await admin.from('work_threads').select('id').in('workflow_id', liveIds.length ? liveIds : ['00000000-0000-0000-0000-000000000000']);
    const { data: leftRuns } = await admin.from('workflow_runs').select('id').in('workflow_id', liveIds.length ? liveIds : ['00000000-0000-0000-0000-000000000000']);
    ok('P7 probe leftovers are ZERO (workflows · threads · runs)',
      (leftWf ?? []).length === 0 && (leftTh ?? []).length === 0 && (leftRuns ?? []).length === 0,
      `${(leftWf ?? []).length}/${(leftTh ?? []).length}/${(leftRuns ?? []).length}`);
  }

  // ── P7f–P7k — SOURCE FLOORS (comment-stripped: prose about a law is not the law) ───────────
  const stripComments = (s: string) => s.split('\n')
    .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
    .join('\n');
  const runWf = readFileSync('lib/workflows/run-workflow.ts', 'utf8');
  const runWfCode = stripComments(runWf);
  const dispatch = readFileSync('app/api/cron/workflows-dispatch/route.ts', 'utf8');
  const dispatchCode = stripComments(dispatch);
  const wfGet = readFileSync('app/api/workflows/[id]/route.ts', 'utf8');
  const drawerCode = stripComments(drawer);
  const stripCode = stripComments(strip);
  const detailCode = stripComments(detail);

  console.log('\nP7f — THE RESUME EXEMPTION (a parked run is never re-refused):');
  // DECLARED RE-POINT (relay canvas W3): the exemption GREW a second resume flag —
  // `resumeSeeded` (a run continued past its ⧉ subprocess station). The law is unchanged and
  // strictly stronger: EVERY resume is exempt from the nothing-to-react-to refusal, because the
  // event rode in on the original run. Both flags are asserted, so neither can be dropped.
  ok('the reaction refusal is gated on !opts.resumeFromApproval (and !opts.resumeSeeded — W3)',
    /trig\?\.type === 'reaction' && !opts\.resumeFromApproval && !opts\.resumeSeeded && !\(opts\.triggerContext \?\? ''\)\.trim\(\)/.test(runWfCode),
    'the refusal condition does not carry BOTH resume exemptions');

  console.log('\nP7g — ONE DERIVATION (readinessOf is the only rule table):');
  ok('run-workflow refuses through readinessOf',
    /const \{ readinessOf[^}]*\} = await import\('\.\/readiness'\)/.test(runWfCode) && /if \(!r\.ready\) return refuse\(r\.reason\)/.test(runWfCode));
  ok('the dispatcher skips through readinessOf',
    /readinessOf/.test(dispatchCode) && dispatchCode.includes("@/lib/workflows/readiness"));
  ok('the ledger route serves readiness through readinessOf',
    /readiness: readinessOf\(/.test(stripComments(ledgerRoute)));
  ok('the workflow GET serves it too — top-level AND on the workflow (one value)',
    /const readiness = readinessOf\(/.test(stripComments(wfGet))
    && /workflow: \{ \.\.\.data,[^}]*readiness \}/.test(stripComments(wfGet))
    && /\n\s*readiness,\n/.test(stripComments(wfGet)));
  {
    // NO SECOND RULE TABLE: the sentences live in exactly one file.
    const { readdirSync, statSync } = await import('fs');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e.startsWith('.')) continue;
        const p = `${dir}/${e}`;
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(p)) continue;
        const src = stripComments(readFileSync(p, 'utf8'));
        if (src.includes('needs a person') || src.includes('No steps yet —')) hits.push(p);
      }
    };
    for (const root of ['lib', 'app', 'components']) walk(root);
    ok('the readiness sentences exist in exactly ONE file (no forked copy)',
      hits.length === 1 && hits[0] === 'lib/workflows/readiness.ts', hits.join(', '));
  }

  console.log('\nP7h — THE DISPATCHER SKIP (no doomed run row; the clock still rolls):');
  {
    const branch = dispatchCode.slice(dispatchCode.indexOf('if (!r.ready) {'));
    const body = branch.slice(0, branch.indexOf('continue;'));
    ok('the not-ready branch inserts NO run row',
      body.includes('if (!r.ready) {') && !body.includes("from('workflow_runs')"), body.length ? '' : 'branch not found');
    ok('…and it still advances next_run_at through the shared nextRunFromTrigger',
      body.includes('nextRunFromTrigger(wf.trigger') && body.includes('next_run_at:'));
    ok('…and the skip is counted honestly in the response (not_ready)',
      /not_ready: notReady\.length/.test(dispatchCode));
  }

  console.log('\nP7i — RUN NOW SPEAKS (the button answers; it never greys into a mystery):');
  {
    // RE-POINTED (relay canvas W2) to the runNow / startRun SPLIT. The LAW is untouched — no dead
    // buttons, readiness speaks FIRST — but the shape it lives in changed: the POST moved out of
    // runNow into startRun so THE MATERIAL DOOR (run-material-sheet) can sit between the two. The
    // old assertion looked for the POST inside runNow and could only ever go red once that
    // happened. The re-point asserts the ordering on the new shape, and adds the half the split
    // created: runNow must not POST at all, or the sheet could be bypassed by a second path.
    const fnBody = (src: string, name: string): string => {
      const at = src.indexOf(`const ${name} = useCallback(`);
      if (at < 0) return '';
      const rest = src.slice(at);
      const end = rest.indexOf('\n  }, [');
      return end > -1 ? rest.slice(0, end) : rest;
    };
    for (const [name, src] of [['workflows-ledger.tsx', stripCode], ['workflow-detail.tsx', detailCode]] as Array<[string, string]>) {
      const runNow = fnBody(src, 'runNow');
      const startRun = fnBody(src, 'startRun');
      const guard = runNow.search(/toast\((?:blocked|notReady)\)/);
      const sheet = runNow.search(/setMaterial(?:For|Open)\(/);
      const handoff = runNow.search(/startRun\(/);
      ok(`${name}: readiness is toasted in runNow BEFORE the sheet and before startRun (which owns the POST)`,
        guard > -1 && sheet > -1 && handoff > -1 && guard < sheet && guard < handoff
        && !/\/run`/.test(runNow) && /`\/api\/workflows\/[^`]*\/run`/.test(startRun),
        `guard@${guard} sheet@${sheet} startRun@${handoff} runNowPosts=${/\/run`/.test(runNow)} startRunPosts=${/`\/api\/workflows\/[^`]*\/run`/.test(startRun)}`);
      ok(`${name}: the guard RETURNS — a not-ready click never fires the run`,
        /toast\((?:blocked|notReady)\); return; \}/.test(runNow));
      ok(`${name}: readiness never becomes a \`disabled\` attribute (a dead button explains nothing)`,
        !/disabled=\{[^}]*(notReady|blocked)/.test(src));
    }
  }

  console.log('\nP7j — THE DRAWER\'S OBJECT (what is being approved, fetched once):');
  ok('the drawer reads previewFromOutput from handoff-context (never a forked preview rule)',
    /import \{ previewFromOutput \} from '@\/lib\/workflows\/handoff-context'/.test(drawerCode));
  {
    const runsFetches = [...drawerCode.matchAll(/fetch\(\s*`[^`]*\/runs`/g)].length;
    ok('exactly ONE runs-route fetch in the drawer (one run, one truth — Log and gate agree)',
      runsFetches === 1, String(runsFetches));
  }
  {
    const lines = drawerCode.split('\n');
    const mounts = lines.map((l, i) => [l, i] as const).filter(([l]) => l.includes('<GateObject'));
    const guarded = mounts.every(([, i]) =>
      lines.slice(Math.max(0, i - 20), i).some((l) => /waiting && !decided|awaitingApproval && !listCoversTheWait/.test(l)));
    ok('GateObject mounts ONLY inside a waiting / awaiting-approval render',
      mounts.length === 2 && guarded, `${mounts.length} mounts`);
  }
  {
    const fn = drawerCode.slice(drawerCode.indexOf('function GateObject('));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    ok('…and GateObject wires NO decision (it shows the object; Approve never waits on it)',
      !/decide\(|resume|onApprove|Approve|Reject/.test(body));
    ok('…a run it could not read renders nothing at all (additive by construction)',
      /if \(!preview\) return null;/.test(body));
  }

  console.log('\nP7k — ONE CLAIM PER ROW (the reason outranks the old segments):');
  ok('the ledger\'s draft segment is gated behind the not-ready reason',
    /w\.status === 'draft' && !notReady/.test(stripCode));
  ok('…and the state slot yields to the reason (running · reason · parked · last run)',
    /\) : notReady \? \(/.test(stripCode));

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
