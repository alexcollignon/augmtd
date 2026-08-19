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
import { readFileSync } from 'fs';
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
    const otherApprovalDoors = urls.filter((u) => !u.url.includes('/resume') && /approve|reject|decide|handoff/i.test(u.url));
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
  ok('the deep-dive drops held_back from Work', detail.includes("p.state !== 'held_back'"));
  ok('empty buckets return null in BOTH deep-dive tables',
    (detail.match(/if \(!rows\.length\) return null;/g) ?? []).length >= 2,
    String((detail.match(/if \(!rows\.length\) return null;/g) ?? []).length));
  ok('FRAMES stays on standby (flag off)', /const SHOW_FRAMES = false/.test(detail));
  ok('…and the tab only exists behind the flag', /if \(SHOW_FRAMES\)/.test(detail));
  ok('the bare /workflows page is not a second surface — it redirects to the Home view',
    indexPage.includes("redirect('/home?view=workflows')"));
  ok('the deep-dive page bounces an unreadable workflow to the same one surface',
    detailPage.includes("redirect('/home?view=workflows')"));

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
