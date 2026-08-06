// THE COMPUTE GATES (Arc 1 — docs/one-surface-plan.md § C-gates).
//   The sandbox capability's structural laws, asserted on source + the live executor:
//   C1 registry truth · C2 failure honesty · C3 one picker truth · C4 the locked room ·
//   C5 (env-gated) a real end-to-end job through the deployed service.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync, existsSync } from 'fs';

const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  // ── C1 · REGISTRY TRUTH: one map row, parity lawful, the plan cache self-invalidates. ──
  const { CAPABILITY_MAP, registryParity, PLAN_VERSION } = await import('../lib/work/surface-registry');
  const cap = CAPABILITY_MAP.run_compute;
  check('C1: run_compute is a registry capability — atomic, REVERSIBLE (the room cannot send), exposed to chief/coworker/workflow',
    !!cap && cap.built && cap.kind === 'atomic' && cap.irreversible === false &&
    (cap.exposure ?? []).join(',') === 'chief_of_staff,coworker,workflow');
  check('C1: registryParity stays lawful with the new row', registryParity().length === 0, registryParity().join('; '));
  check('C1: PLAN_VERSION bumped for the map change (≥5) — stale item plans self-invalidate', PLAN_VERSION >= 5);
  check('C1: TOOL_FEATURE carries run_compute (always-on; gates itself on env config)',
    src('lib/workspace/tool-capabilities.ts').includes('run_compute: null'));

  // ── C2 · FAILURE HONESTY: unconfigured/unreachable/failed NEVER fabricates a result. ──
  const savedUrl = process.env.COMPUTE_SERVICE_URL; const savedSecret = process.env.COMPUTE_SECRET;
  delete process.env.COMPUTE_SERVICE_URL; delete process.env.COMPUTE_SECRET;
  const { executeRunCompute } = await import('../lib/tools/compute');
  const unconfigured = await executeRunCompute({ script: 'print(1)' }, 'smoke-user', null as never);
  check('C2: an unconfigured service returns an HONEST refusal (nothing run, no fabricated result, tells the model not to estimate)',
    /not configured/i.test(unconfigured) && /nothing was run/i.test(unconfigured) && /do not estimate/i.test(unconfigured.replace(/NOT/g, 'not')));
  if (savedUrl) process.env.COMPUTE_SERVICE_URL = savedUrl;
  if (savedSecret) process.env.COMPUTE_SECRET = savedSecret;
  const toolSrc = src('lib/tools/compute.ts');
  check('C2: a non-zero exit is spoken as FAILED with nothing-produced (never partial-as-done); AI-side never invents outputs',
    toolSrc.includes('The script FAILED') && toolSrc.includes('never present partial results as done'));
  check('C2: declared inputs are a MANIFEST — a missing/unretrievable input REFUSES the run (no silent drop)',
    toolSrc.includes('was not found in the knowledge base — nothing was run') &&
    toolSrc.includes("can't be mounted into the sandbox yet"));

  // ── C3 · ONE PICKER TRUTH: the builder's two tool lists carry the tool identically. ──
  const builder = src('components/work/studio-builder.tsx');
  check('C3: run_compute in AVAILABLE_TOOLS + BOTH group lists (TOOL_GROUPS and InlineToolGrid) + icon + style',
    (builder.match(/run_compute/g)?.length ?? 0) >= 5 &&
    builder.includes("{ label: 'Compute',     ids: ['run_compute'] }"));
  check('C3: the chat surface mounts the same definition + a dispatch case; the step engine dispatches run_compute',
    src('app/api/work/threads/[id]/chat/route.ts').includes('runComputeDefinition') &&
    src('app/api/work/threads/[id]/chat/route.ts').includes("case 'run_compute'") &&
    src('lib/workflows/execute-step.ts').includes("case 'run_compute'"));

  // ── C4 · THE LOCKED ROOM: the service source carries the laws structurally. ──
  const svc = src('infra/compute/main.py');
  check('C4: the job container runs with NO network, read-only inputs, non-root grade caps (mem/cpu/pids), no-new-privileges',
    svc.includes('"--network", "none"') && svc.includes(':/job/inputs:ro') &&
    svc.includes('"--memory", "1g"') && svc.includes('"--pids-limit", "256"') &&
    svc.includes('no-new-privileges'));
  check('C4: wall-clock timeout enforced + a timed-out container is killed, never lingers',
    svc.includes('TimeoutExpired') && svc.includes('"docker", "kill"'));
  check('C4: output caps enforced service-side (bytes + file count) and bearer auth on /run',
    svc.includes('MAX_OUTPUT_BYTES') && svc.includes('MAX_OUTPUT_FILES') && svc.includes('Bearer {COMPUTE_SECRET}'));
  check('C4: job dirs are deleted after every run (nothing persists on the box)',
    svc.includes('shutil.rmtree(job_dir, ignore_errors=True)'));
  check('C4: the runner image is non-root with the data-work stdlib baked in (no network at runtime)',
    src('infra/compute/Dockerfile.runner').includes('USER jobrunner') &&
    src('infra/compute/Dockerfile.runner').includes('pandas'));

  // ── C5 · THE LIVE JOB (env-gated — runs only where the service is deployed+configured). ──
  if (process.env.COMPUTE_SERVICE_URL && process.env.COMPUTE_SECRET) {
    const script = [
      'import json',
      "nums = [3, 4, 5]",
      "total = sum(nums)",
      "assert total == 12  # the mechanical check IS the point",
      "with open('/job/out/result.json', 'w') as f: json.dump({'total': total}, f)",
      "print(f'checked: sum={total}')",
    ].join('\n');
    try {
      const res = await fetch(`${process.env.COMPUTE_SERVICE_URL.replace(/\/$/, '')}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.COMPUTE_SECRET}` },
        body: JSON.stringify({ job_id: `smoke-${Date.now()}`, script, files: [], timeout_s: 30 }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json();
      check('C5: a real job runs end-to-end — ok, checked stdout, one output file',
        res.ok && body.ok === true && String(body.stdout).includes('checked: sum=12') &&
        body.outputs?.length === 1 && body.outputs[0].name === 'result.json');
      const res2 = await fetch(`${process.env.COMPUTE_SERVICE_URL.replace(/\/$/, '')}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.COMPUTE_SECRET}` },
        body: JSON.stringify({ job_id: `smoke-net-${Date.now()}`, script: "import urllib.request\nurllib.request.urlopen('https://example.com', timeout=5)", files: [], timeout_s: 30 }),
        signal: AbortSignal.timeout(60_000),
      });
      const body2 = await res2.json();
      check('C5: the room is LOCKED — a script that tries the network FAILS (no exfiltration path exists)',
        body2.ok === false);
    } catch (e) {
      check('C5: live service reachable', false, e instanceof Error ? e.message : 'unreachable');
    }
  } else {
    console.log('· C5 (live job) skipped — COMPUTE_SERVICE_URL/COMPUTE_SECRET not set in this env');
  }

  // ── V · THE ARITHMETIC FLOOR (Arc 1 stage 2) — the code half is deterministic, gate it as such. ──
  const { runChecks, hasComputableSurface } = await import('../lib/prepare/verify-claims');
  const arith = (over: Partial<{ stated: number; quote: string }>) => runChecks(
    `Line items: 3, 4 and 5. ${over.quote ?? 'Total: 13'}.`,
    [{ kind: 'arith', quote: over.quote ?? 'Total: 13', op: 'sum', operands: [3, 4, 5], stated: over.stated ?? 13 }],
  );
  check('V1: a wrong stated total is CAUGHT with the exact numbers (12 vs 13)',
    arith({}).length === 1 && arith({})[0].expected === '12' && arith({})[0].stated === '13');
  check('V1: a correct total is CLEAN', arith({ quote: 'Total: 12', stated: 12 }).length === 0);
  check('V2: THE QUOTE LAW — a check whose quote is not verbatim in the artifact is IGNORED, never a mismatch',
    runChecks('Total: 13.', [{ kind: 'arith', quote: 'Grand total: 13', op: 'sum', operands: [3, 4, 5], stated: 13 }]).length === 0);
  check('V2: THE OPERAND LAW — an extractor-invented operand (not in the text) DROPS the check (a false revise can never fire)',
    runChecks('Revenue rose to 2.4M, up 18% on the year.',
      [{ kind: 'arith', quote: 'up 18% on the year', op: 'pct_change', operands: [2.9, 2.4], stated: 18 }]).length === 0);
  const wk = runChecks('Delivered Friday, 2026-08-06.',
    [{ kind: 'weekday', quote: 'Friday, 2026-08-06', date: '2026-08-06', weekday: 'friday' }]);
  check('V3: a date↔weekday mismatch is caught (2026-08-06 is a Thursday, not Friday)',
    wk.length === 1 && wk[0].expected.includes('Thursday'));
  const pct = (stated: number) => runChecks(`Revenue went from 2.1M to 2.4M, ${stated}% growth.`,
    [{ kind: 'arith', quote: `${stated}% growth`, op: 'pct_change', operands: [2.1, 2.4], stated }]);
  check('V4: rounding is honest (14.3% for 14.29% passes), a wrong number is not (18% is caught as ~14.29)',
    pct(14.3).length === 0 && pct(18).length === 1 && pct(18)[0].expected.startsWith('14.29'));
  check('V5: the density gate skips plain prose (zero-cost common case) but arms on numbers and on weekday+date',
    !hasComputableSurface('Thanks, sounds good — speak soon.') &&
    hasComputableSurface('Items 3, 4 and 5 sum to 12.') &&
    hasComputableSurface('See you Thursday, 2026-08-06.'));
  check('V6: the evaluator mounts the floor BETWEEN the structural floors and the reasoned review; a mismatch REVISES with the numbers',
    (() => { const ev = src('lib/prepare/evaluate.ts');
      return ev.includes('THE ARITHMETIC FLOOR') && ev.includes('verifyComputableClaims') &&
        ev.indexOf('THE ARITHMETIC FLOOR') > ev.indexOf('MECHANICAL TRUNCATION FLOOR') &&
        ev.indexOf('THE ARITHMETIC FLOOR') < ev.indexOf("The deal's constraints") &&
        ev.includes("The numbers don't check out"); })());
  check('V6: the AI half is failure-honest (outage → no mismatches, never a verdict) and quote-guarded via the ONE code half',
    (() => { const vc = src('lib/prepare/verify-claims.ts');
      return vc.includes('catch { return []; }') && vc.includes('THE QUOTE LAW') &&
        vc.includes('return runChecks(content, raw)'); })());

  // ── S3 · PRODUCE COMPUTES BEFORE IT WRITES (Arc 1 stage 3). ──
  const passSrc = src('lib/prepare/pass.ts');
  check('S3: the produce lane mounts computeForProduce AFTER the requirements resolution and its ask-gate, BEFORE any delegation',
    passSrc.includes('PRODUCE COMPUTES BEFORE IT WRITES') &&
    passSrc.indexOf('computeForProduce') > passSrc.indexOf('needs ${reqs.missing.length} input(s) from you') &&
    passSrc.indexOf('computeForProduce') < passSrc.indexOf("verdict.executor.kind === 'coworker' && verdict.executor.id"));
  check('S3: only kb-backed data files feed the sandbox (COMPUTABLE_EXT + source===kb); computed facts JOIN the envelope truth',
    passSrc.includes("h.file?.source === 'kb' && COMPUTABLE_EXT.test(h.file.filename)") &&
    passSrc.includes('artifactTruth = [artifactTruth, cf.facts].filter(Boolean)'));
  const cp = src('lib/prepare/compute-produce.ts');
  check('S3: the stage is honest — codegen may DECLINE, ONE capped repair, failure → LOGGED null (status quo, never a fabricated fact)',
    cp.includes('{"skip"') && cp.includes('ONE repair attempt') &&
    cp.includes('repair also failed, falling through') && cp.includes('catch { return null; }'));
  check('S3: the facts block DECLARES code provenance and forbids hand-recomputation',
    cp.includes('computed BY CODE in the sandbox') && cp.includes('never recompute them by hand'));
  check('S3: codegen carries THE CLOCK + the empty-filter law (found live: an assumed-year July filter printed a confident 0) — an empty-filter zero routes to repair, never into the facts',
    cp.includes('Today is ${day}') && cp.includes('NEVER assumes a year') &&
    cp.includes('WARNING: filter matched 0 rows') &&
    cp.includes('/WARNING: filter matched 0 rows|rows read: 0\\b/i.test(r)'));
  check('S3: codegen reads THE DATA PREVIEW (actual file heads from the KB — found live: a guessed column name KeyError\'d) and a run WITHOUT a FINDINGS report is a failure (warnings are not facts)',
    cp.includes('THE DATA PREVIEWS') && cp.includes('extracted_text') &&
    cp.includes('!/FINDINGS/i.test(r)'));

  // S3-LIVE (env-gated): a real CSV in the probe KB → codegen → sandbox → verified total in the facts.
  if (process.env.COMPUTE_SERVICE_URL && process.env.COMPUTE_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { resolveProbeUser } = await import('./probe-user');
    const probe = await resolveProbeUser(sb);
    const stamp = `smoke-s3-${Date.now()}`;
    const storagePath = `${probe}/${stamp}/transactions.csv`;
    let fileRowId: string | null = null;
    try {
      const csv = 'date,client,amount_eur\n2026-07-03,Acme,1200\n2026-07-18,Acme,2450\n2026-07-29,Acme,2500\n';
      const up = await sb.storage.from('drive-uploads').upload(storagePath, Buffer.from(csv), { contentType: 'text/csv', upsert: true });
      if (up.error) throw new Error(`upload: ${up.error.message}`);
      const { getOrCreateAugmtdSource } = await import('../lib/knowledge/indexer');
      const sourceId = await getOrCreateAugmtdSource(probe, sb);
      const ins = await sb.from('knowledge_files').insert({
        user_id: probe, source_id: sourceId, provider_file_id: stamp,
        filename: 'transactions.csv', mime_type: 'text/csv', storage_path: storagePath, size_bytes: csv.length,
        extracted_text: csv, // real ingested rows carry this — codegen's data preview reads it
      }).select('id').single();
      if (ins.error) throw new Error(`kb insert: ${ins.error.message}`);
      fileRowId = ins.data.id as string;
      const { computeForProduce } = await import('../lib/prepare/compute-produce');
      const cf = await computeForProduce(sb, probe, {
        title: 'Produce the July totals summary the client asked for, from the transactions sheet',
        judgeReason: 'the client asked for the July invoice total', requires: ['the totals summary'],
        files: [{ id: fileRowId, filename: 'transactions.csv' }],
      });
      check('S3-LIVE: the whole chain — codegen wrote a real script, the sandbox ran it over the REAL staged CSV, the facts carry the code-computed total (6150)',
        !!cf && /6,?150/.test(cf.facts) && cf.facts.includes('computed BY CODE'));
    } catch (e) {
      check('S3-LIVE: end-to-end computed-produce', false, e instanceof Error ? e.message : 'failed');
    } finally {
      // Leave nothing behind: the KB row, the storage object, and any sandbox outputs it indexed.
      if (fileRowId) await sb.from('knowledge_files').delete().eq('id', fileRowId);
      await sb.storage.from('drive-uploads').remove([storagePath]);
      await sb.from('knowledge_files').delete().eq('user_id', probe).like('provider_file_id', 'compute::%');
    }
  } else {
    console.log('· S3-LIVE skipped — COMPUTE_SERVICE_URL/COMPUTE_SECRET not set in this env');
  }

  // ── A · READ_ACTION_HISTORY (one-surface § context controls — the history read). ──
  check('A1: read_action_history is a registry capability — atomic, read-only, chief-of-staff exposure; parity stays lawful',
    (() => { const c = CAPABILITY_MAP.read_action_history;
      return !!c && c.built && c.kind === 'atomic' && !c.irreversible &&
        (c.exposure ?? []).includes('chief_of_staff') && registryParity().length === 0; })());
  check('A2: the conversation core mounts it — definition in CHIEF_TOOL_DEFS + a dispatch case',
    /CHIEF_TOOL_DEFS = \[[^\]]*readActionHistoryDefinition/.test(src('lib/converse/index.ts')) &&
    src('lib/converse/index.ts').includes("tool === 'read_action_history'"));
  check('A3: the digest declares its own boundary (through-the-platform only) and an unreadable ledger says so rather than guessing',
    src('lib/tools/action-history.ts').includes('mail sent directly from Gmail/Outlook outside') &&
    src('lib/tools/action-history.ts').includes('rather than guessing'));
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sbA = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { resolveProbeUser } = await import('./probe-user');
    const probeA = await resolveProbeUser(sbA);
    const { executeReadActionHistory } = await import('../lib/tools/action-history');
    const digest = await executeReadActionHistory({ days: 7 }, probeA, sbA);
    check('A4-LIVE: the ledger read returns an honest digest (zero AI) — content or an honest empty, always with the boundary line',
      typeof digest === 'string' && digest.length > 20 &&
      (digest.includes('Action ledger') || digest.includes('No recorded')) &&
      digest.includes('THROUGH the platform'));
  }

  // ── U · THE ONE-GROUNDING UNIFICATION (the Home ask reads the room's page). ──
  const { findEntityFocus } = await import('../lib/home/ask');
  const fents = [
    { id: 'e1', name: 'Meridian Audit', aliases: ['Meridian'] },
    { id: 'e2', name: 'AI Assessment', aliases: [] },          // all-generic — must NEVER match
    { id: 'e3', name: 'Baltra Pilot', aliases: null },
  ];
  check('U1: the focus match is STRICT — a named entity matches, an all-generic name never does, no name → null',
    findEntityFocus('what is the status on meridian?', fents)?.id === 'e1' &&
    findEntityFocus('how is our ai assessment going?', fents) === null &&
    findEntityFocus('what did I miss this week?', fents) === null &&
    findEntityFocus('anything new on the baltra pilot?', fents)?.id === 'e3');
  check('U2: the snapshot appends the FOCUSED WORK from the ONE room grounding, tags stripped (no minted wrong links), non-fatal',
    (() => { const a = src('lib/home/ask.ts');
      return a.includes('THE ONE-GROUNDING UNIFICATION') && a.includes('assembleRoomGrounding') &&
        a.includes("g.text.replace(/\\[(?:L|F)\\d+\\]\\s?/g, '')") &&
        a.includes('the focus is an enhancement'); })());
  check('U2: BOTH global call sites thread the question — answerHomeQuestion and the converse agent loop (with the widened slice)',
    src('lib/home/ask.ts').includes('buildBrainSnapshot(supabase, userId, question)') &&
    src('lib/converse/index.ts').includes('buildBrainSnapshot(client, userId, text)') &&
    src('lib/converse/index.ts').includes('.text.slice(0, 7000)'));
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sbU = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const AUser = '08fe4449-e5eb-431d-9156-02e9324e5903';
    const { data: topEnt } = await sbU.from('work_entities').select('id, name')
      .eq('user_id', AUser).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null)
      .order('last_event_at', { ascending: false }).limit(1).maybeSingle();
    if (topEnt?.name) {
      const { buildBrainSnapshot } = await import('../lib/home/ask');
      const snap = await buildBrainSnapshot(sbU, AUser, `what is the status on ${topEnt.name}?`);
      check(`U3-LIVE: a Home question naming a REAL entity ("${String(topEnt.name).slice(0, 30)}…") carries its full room page (zero AI, one read)`,
        snap.text.includes('THE FOCUSED WORK') && snap.text.includes('THE WORK:'));
    } else {
      console.log('· U3-LIVE skipped — no active entities on the live account');
    }
  }

  // ── PC · THE PROVENANCE CHIP (Arc 1 made visible — truth as UI, never text-matched). ──
  check('PC1: the sandbox stamps structurally — compute-produce returns the as-of stamp; the pass threads it into BOTH delegation doors as provenance.computed',
    src('lib/prepare/compute-produce.ts').includes('stamp: `computed in code from ${fileList}') &&
    (src('lib/prepare/pass.ts').match(/artifactTruth \|\| undefined, computedStamp/g)?.length ?? 0) === 2 &&
    src('lib/prepare/pass.ts').includes('computed: computedStamp'));
  check('PC2: the chip renders ONLY from the structural marker (prov?.computed), never inferred from deliverable content',
    src('components/home/item-detail.tsx').includes('prov?.computed && (') &&
    src('components/home/item-detail.tsx').includes('✓ computed in code') &&
    !src('components/home/item-detail.tsx').includes('d.content.includes(\'computed\')'));

  // ── ST · THE STANDING BINDING (Arc 2 stage 1 — a scheduled workflow IS a standing commitment). ──
  const st = src('lib/workflows/standing.ts');
  check('ST1: the binding\'s laws — ONE row per workflow, a human dismissal STICKS, non-standing closes honestly, orphans are cleaned',
    st.includes("eq('source', 'workflow').eq('source_id', wf.id)") &&
    st.includes('the decision sticks') &&
    st.includes("resolved_reason: 'standing task paused or unscheduled'") &&
    st.includes("resolved_reason: 'standing task removed'"));
  check('ST2: wired at BOTH doors — a successful run advances the due_date; the hourly dispatch is the self-healing convergent door',
    src('lib/workflows/run-workflow.ts').includes('syncStandingCommitment') &&
    src('app/api/cron/workflows-dispatch/route.ts').includes('syncAllStandingCommitments'));
  check('ST3: THE JUDGE FLOOR — a source=workflow commitment is judged none STRUCTURALLY (before any AI); the pass can never delegate it',
    src('lib/work/judge.ts').includes("String(c.source) === 'workflow'") &&
    src('lib/work/judge.ts').includes('a standing scheduled task'));
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sbS = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { resolveProbeUser } = await import('./probe-user');
    const probeS = await resolveProbeUser(sbS);
    const { syncStandingCommitment } = await import('../lib/workflows/standing');
    const wfId = `smoke-standing-${Date.now()}`;
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const wf = { id: wfId, user_id: probeS, name: 'Weekly market digest', status: 'active', trigger: { type: 'schedule' }, next_run_at: tomorrow };
    try {
      await syncStandingCommitment(sbS, wf, 'Max');
      const { data: r1 } = await sbS.from('commitments').select('id, status, due_date, counterparty, direction').eq('user_id', probeS).eq('source', 'workflow').eq('source_id', wfId).maybeSingle();
      await syncStandingCommitment(sbS, { ...wf, next_run_at: nextWeek }, 'Max');   // a run advanced the schedule
      const { data: r2 } = await sbS.from('commitments').select('id, due_date').eq('user_id', probeS).eq('source', 'workflow').eq('source_id', wfId).maybeSingle();
      await sbS.from('commitments').update({ status: 'dismissed' }).eq('id', r1!.id); // the human dismisses
      await syncStandingCommitment(sbS, wf, 'Max');                                  // the machine tries again
      const { data: rows } = await sbS.from('commitments').select('id, status').eq('user_id', probeS).eq('source', 'workflow').eq('source_id', wfId);
      check('ST4-LIVE: the binding round-trips — ONE open row (awaiting, dated to the next run) · a run ADVANCES it in place · a human dismissal STICKS (never resurrected, never duplicated)',
        r1?.status === 'open' && r1?.direction === 'awaiting' && r1?.due_date === tomorrow.slice(0, 10) &&
        r2?.id === r1?.id && r2?.due_date === nextWeek.slice(0, 10) &&
        rows?.length === 1 && rows[0].status === 'dismissed');
    } catch (e) {
      check('ST4-LIVE: standing binding round-trip', false, e instanceof Error ? e.message : 'failed');
    } finally {
      await sbS.from('commitments').delete().eq('user_id', probeS).eq('source', 'workflow').eq('source_id', wfId);
    }
  }

  // ── SC · THE SPEC CARD (Arc 2 stage 2 — saying prepares, committing stays explicit). ──
  const sc = src('lib/work/standing-spec.ts');
  check('SC1: propose_standing_task is a chief capability (reversible, studio-gated) mounted in the conversation core',
    CAPABILITY_MAP.propose_standing_task?.built === true && CAPABILITY_MAP.propose_standing_task.irreversible === false &&
    (CAPABILITY_MAP.propose_standing_task.exposure ?? []).join(',') === 'chief_of_staff' &&
    /CHIEF_TOOL_DEFS = \[[^\]]*proposeStandingTaskDefinition/.test(src('lib/converse/index.ts')) &&
    src('lib/converse/index.ts').includes("tool === 'propose_standing_task'"));
  check('SC2: SAYING PREPARES — the propose half creates NOTHING (no insert); the card lands as a pending component turn; the confirm route is the ONE creation door with an exactly-once guard',
    !sc.slice(0, sc.indexOf('confirmStandingSpec')).includes(".insert(") &&
    src('lib/converse/index.ts').includes("component: { key: 'standing_spec', state: { ...spec, status: 'pending' } }") &&
    src('app/api/tasks/standing/route.ts').includes("comp.state.status === 'confirmed'") &&
    src('app/api/tasks/standing/route.ts').includes('already: true'));
  check('SC3: the spec is CODE-VALIDATED — the cron must parse to a real first run (one repair, then honest error); the owner is a real coworker; failures never fabricate',
    sc.includes('nextRunFromTrigger') && sc.includes('YOUR PREVIOUS CRON WAS INVALID') &&
    sc.includes('could not derive a valid schedule') && sc.includes('no coworkers are set up yet'));
  check('SC4: the rail renders the card ONLY from the standing_spec component; Confirm posts the commit door; confirmed flips in place',
    src('components/home/item-rail.tsx').includes("t.component?.key === 'standing_spec'") &&
    src('components/home/item-rail.tsx').includes("fetch('/api/tasks/standing'") &&
    src('components/home/item-rail.tsx').includes('Confirm — start it') &&
    src('components/home/item-rail.tsx').includes("status === 'confirmed'"));
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sbC = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { resolveProbeUser } = await import('./probe-user');
    const probeC = await resolveProbeUser(sbC);
    const { buildStandingSpec } = await import('../lib/work/standing-spec');
    const specLive = await buildStandingSpec(sbC, probeC, 'I want a weekly market report on Portuguese energy every Monday morning');
    if ('error' in specLive && /no coworkers/.test(specLive.error)) {
      console.log('· SC5-LIVE skipped — the probe has no seeded workers');
    } else {
      check('SC5-LIVE: a real ask builds a validated spec — named, weekly-Monday cron with a REAL first run, owned by a real coworker; nothing was created',
        !('error' in specLive) && !!specLive.name && /^0 \d{1,2} \* \* 1$/.test(specLive.cron) &&
        !!specLive.firstRun && !!specLive.agentId);
    }
  }

  // ── RN · THE RUN LANDS IN THE ROOM + THE MISSED PROMISE + THE METHOD (Arc 2 stages 3–5). ──
  const stg = src('lib/workflows/standing.ts');
  check('RN1: runs narrate into the standing commitment\'s room — success (CoS voice, deduped per run, deliverable link) AND failure (honest turn + the debt stamps today)',
    stg.includes('narrateStandingRun') && stg.includes('`run:${run.runId}`') && stg.includes('`run-fail:${run.runId}`') &&
    stg.includes('ONE-NARRATOR LAW') && stg.includes('run FAILED') &&
    src('lib/workflows/run-workflow.ts').includes('narrateStandingRun(admin, wfRow, { ok: true') &&
    src('lib/workflows/run-workflow.ts').includes('{ ok: false, runId, threadId'));
  check('RN2: THE MISSED-PROMISE FLOOR — a PAST due_date is only advanced by a SUCCESSFUL run (the dispatcher\'s pre-advance can never hide a failing task)',
    stg.includes('fromSuccessfulRun') && stg.includes('duePast && !opts?.fromSuccessfulRun') &&
    src('lib/workflows/run-workflow.ts').includes('{ fromSuccessfulRun: true }'));
  check('RN4: ROOM FEEDBACK MUTATES THE METHOD — chief capability, commitment-room-scoped, source-verified, dated + tail-capped; the confirmed card carries the quiet method link',
    CAPABILITY_MAP.steer_standing_task?.built === true &&
    src('lib/converse/index.ts').includes("tool === 'steer_standing_task'") &&
    stg.includes("c.source !== 'workflow'") && stg.includes('STANDING FEEDBACK (') &&
    stg.includes('appended.length > 4000') &&
    src('components/home/item-rail.tsx').includes('/studio?workflow=${t.standingSpec.workflowId}'));
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sbR = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { resolveProbeUser } = await import('./probe-user');
    const probeR = await resolveProbeUser(sbR);
    const { syncStandingCommitment: syncR } = await import('../lib/workflows/standing');
    const wfIdR = `smoke-missed-${Date.now()}`;
    const tomorrowR = new Date(Date.now() + 86_400_000).toISOString();
    const yesterdayR = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const wfR = { id: wfIdR, user_id: probeR, name: 'Weekly digest', status: 'active', trigger: { type: 'schedule' }, next_run_at: tomorrowR };
    try {
      await syncR(sbR, wfR, 'Max');
      const { data: c0 } = await sbR.from('commitments').select('id').eq('user_id', probeR).eq('source', 'workflow').eq('source_id', wfIdR).single();
      await sbR.from('commitments').update({ due_date: yesterdayR }).eq('id', c0!.id); // a run was missed
      await syncR(sbR, wfR, 'Max');                                                    // the hourly healer ticks
      const { data: c1 } = await sbR.from('commitments').select('due_date').eq('id', c0!.id).single();
      await syncR(sbR, wfR, 'Max', { fromSuccessfulRun: true });                       // a real run lands
      const { data: c2 } = await sbR.from('commitments').select('due_date').eq('id', c0!.id).single();
      check('RN3-LIVE: the floor round-trips — the healer NEVER papers over a missed promise (due stays past); only a successful run advances it',
        c1?.due_date === yesterdayR && c2?.due_date === tomorrowR.slice(0, 10));
    } catch (e) {
      check('RN3-LIVE: missed-promise floor round-trip', false, e instanceof Error ? e.message : 'failed');
    } finally {
      await sbR.from('commitments').delete().eq('user_id', probeR).eq('source', 'workflow').eq('source_id', wfIdR);
    }
  }

  // ── D · ARC 1 CLOSE-OUT + ARC 3 STAGE 1. ──
  check('D1: a compute artifact enters ITS PROJECT\'S world — outputs stamp entity_id (caller-supplied, chained after the index, never guessed)',
    src('lib/tools/compute.ts').includes('entityId?: string | null') &&
    src('lib/tools/compute.ts').includes("update({ entity_id: config.entityId })") &&
    src('lib/prepare/pass.ts').includes('entityId: w.entity?.id ?? null') &&
    src('lib/prepare/compute-produce.ts').includes('entityId: args.entityId ?? null'));
  check('D2: THE DRIVE DEMOTION — Drive leaves the nav (the seat is retired, the route survives); Settings → Knowledge is the door',
    !src('components/sidebar-nav.tsx').includes("name: 'Drive'") &&
    src('components/sidebar-nav.tsx').includes('THE DRIVE DEMOTION') &&
    src('components/settings/settings-left-panel.tsx').includes("id: 'knowledge', label: 'Knowledge'") &&
    src('components/settings/settings-left-panel.tsx').includes("href: '/drive'"));
  check('D3: NO INTERIM ROOMS SURFACE (owner call Aug 6, twice) — no conversations strip, no rooms pills, no rooms fetch on the rail; conversations earn their seat at THE FOLD. The endpoint stands ready with the ladder laws',
    !existsSync('components/home/conversations-strip.tsx') &&
    !src('components/home/home-view.tsx').includes('ConversationsStrip') &&
    !src('components/sidebar-nav.tsx').includes('/api/rooms/recent') &&
    src('components/sidebar-nav.tsx').includes('The LEAN RAIL') &&
    src('app/api/rooms/recent/route.ts').includes(".eq('tracked', true)") &&
    src('app/api/rooms/recent/route.ts').includes('pinnedIds.has(k)'));
  check('D4: THE VOICE — the team\'s words (Home brief + room openings) wear the serif voice class; ONE class in globals, never on chrome',
    src('app/globals.css').includes('.font-voice') &&
    (src('components/briefing/briefing-view.tsx').match(/font-voice/g)?.length ?? 0) >= 6 &&
    (src('components/home/item-rail.tsx').match(/font-voice/g)?.length ?? 0) >= 2);

  // ── F · THE FOLD's ENABLING BRICKS (Arc 3). ──
  const ha = src('components/home/home-ask.tsx');
  check('F1: THE DURABLE HOME CHAT — every exchange persists as a `chat:<uuid>` loose room (history is the default), a reload rehydrates, "New" starts fresh while the old room stays durable; chatting mints no objects',
    ha.includes('THE DURABLE HOME CHAT') && ha.includes("`chat:${crypto.randomUUID()}`") &&
    ha.includes("persistTurn('user', question)") && ha.includes("persistTurn('system', d.answer") &&
    ha.includes('/api/room/turns?key=') &&
    ha.includes('localStorage.removeItem(CHAT_KEY_LS)') &&
    ha.includes('Persistence ≠ object'));
  check('F2: THE FOLD\'s config door — Settings → Team (roster/skills/tools belong to Settings; coworkers are executors in the work, not a destination)',
    src('components/settings/settings-left-panel.tsx').includes("id: 'team', label: 'Team'") &&
    src('components/settings/settings-left-panel.tsx').includes("href: '/workers'"));
  check('F3: THE CLAUDE-SHAPED CHAT — the takeover (62vh conversation column), THE HISTORY PICKER inside the panel (never a nav surface), answers in THE VOICE, chat rooms titled by their own first ask',
    src('components/home/home-ask.tsx').includes('max-h-[62vh]') &&
    src('components/home/home-ask.tsx').includes('THE HISTORY PICKER') &&
    src('components/home/home-ask.tsx').includes('loadRoom(c.key)') &&
    src('components/home/home-ask.tsx').includes('font-voice text-[14.5px] text-neutral-700') &&
    src('app/api/rooms/recent/route.ts').includes('THE CHAT HISTORY') &&
    src('app/api/rooms/recent/route.ts').includes("k.startsWith('chat:')"));

  // ── Report ──
  let pass = 0;
  for (const [n, ok, d] of out) {
    console.log(`${ok ? '✓' : '✗'} ${n}${!ok && d ? ` — ${d}` : ''}`);
    if (ok) pass++;
  }
  console.log(`\n${pass}/${out.length} gates`);
  process.exit(pass === out.length ? 0 : 1);
})();
