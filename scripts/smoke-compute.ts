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
  check('D2: THE FOLD IS WHOLESALE (the shell) — the old icon rail is DELETED; the layout mounts the one-surface sidebar; Workers/Chat/Drive have NO seats (routes survive); Settings carries the Knowledge + Team doors',
    !existsSync('components/sidebar-nav.tsx') &&
    src('app/(main)/layout.tsx').includes("from '@/components/one/one-sidebar'") &&
    !src('components/one/one-sidebar.tsx').includes("href=\"/workers\"") &&
    !src('components/one/one-sidebar.tsx').includes("href=\"/work\"") &&
    !src('components/one/one-sidebar.tsx').includes("href=\"/drive\"") &&
    src('components/settings/settings-left-panel.tsx').includes("id: 'knowledge', label: 'Knowledge'") &&
    src('components/settings/settings-left-panel.tsx').includes("id: 'team', label: 'Team'"));
  check('D3: THE CONVERSATION FRAME — the sidebar is owned by conversations (New chat · Pinned · Recent · All conversations · Sources), consuming the MERGED list; the ladder laws hold at the endpoint (tracked pins · conversed-in only · pinned excluded)',
    !existsSync('components/home/conversations-strip.tsx') &&
    src('components/one/one-sidebar.tsx').includes('New chat') &&
    src('components/one/one-sidebar.tsx').includes("fetch('/api/rooms/recent')") &&
    src('components/one/one-sidebar.tsx').includes('All conversations →') &&
    src('app/api/rooms/recent/route.ts').includes(".eq('tracked', true)") &&
    src('app/api/rooms/recent/route.ts').includes('pinnedIds.has(k)') &&
    src('app/api/rooms/recent/route.ts').includes('THE MERGED CONVERSATIONS'));
  check('D3b: ALL CONVERSATIONS is a real destination — the sidebar-reached lens; a chat row loads into the ONE Home panel (aug:open-chat), a room row opens its door; searchable, ?all=1 deep read',
    src('components/one/all-conversations.tsx').includes("fetch('/api/rooms/recent?all=1')") &&
    src('components/home/home-view.tsx').includes("view === 'conversations'") &&
    src('components/home/home-view.tsx').includes("CustomEvent('aug:open-chat'") &&
    src('components/home/home-ask.tsx').includes("addEventListener('aug:open-chat'") &&
    src('components/home/home-ask.tsx').includes("addEventListener('aug:new-chat'"));
  check('D4: THE VOICE — the team\'s words (Home brief + room openings) wear the serif voice class; ONE class in globals, never on chrome',
    src('app/globals.css').includes('.font-voice') &&
    (src('components/briefing/briefing-view.tsx').match(/font-voice/g)?.length ?? 0) >= 6 &&
    (src('components/home/item-rail.tsx').match(/font-voice/g)?.length ?? 0) >= 2);

  // ── F · THE FOLD's ENABLING BRICKS (Arc 3). ──
  const ha = src('components/home/home-ask.tsx');
  check('F1: THE DURABLE HOME CHAT — every exchange persists as a `chat:<uuid>` loose room (history is the default), a reload rehydrates, "New" starts fresh while the old room stays durable; chatting mints no objects',
    ha.includes('THE DURABLE HOME CHAT') && ha.includes("`chat:${crypto.randomUUID()}`") &&
    ha.includes("persistTurn('user', shown)") && ha.includes("persistTurn('system', d.answer") &&
    ha.includes('/api/room/turns?key=') &&
    src('components/one/one-sidebar.tsx').includes("localStorage.removeItem('aug-home-chat-key')") &&
    ha.includes('Persistence ≠ object'));
  check('F2: THE FOLD\'s config door — Settings → Team (roster/skills/tools belong to Settings; coworkers are executors in the work, not a destination; grounded Aug 6 — no href ejection)',
    src('components/settings/settings-left-panel.tsx').includes("id: 'team', label: 'Team'") &&
    !src('components/settings/settings-left-panel.tsx').includes("href: '/workers'"));
  check('F3: THE CLAUDE-SHAPED CHAT — a live conversation is a PAGE (centered reading column, thread fills the viewport, the deck steps aside via aug:chat-active; NO hover gating — hover-out never collapses it, leaving is the explicit Close/New), THE HISTORY PICKER inside the panel, answers in THE VOICE, chat rooms titled by their own first ask',
    src('components/home/home-ask.tsx').includes('const showThread = hasThread && open;') &&
    !src('components/home/home-ask.tsx').includes('onMouseLeave={() => setHovered(false)}') &&
    src('components/home/home-ask.tsx').includes('max-w-3xl mx-auto') &&
    src('components/home/home-ask.tsx').includes('max-h-[calc(100vh-250px)]') &&
    src('components/home/home-ask.tsx').includes('const onHomeReset = () => setOpen(false);') &&
    !src('components/home/home-ask.tsx').includes('> Close') &&
    src('components/home/home-ask.tsx').includes("CustomEvent('aug:chat-active'") &&
    src('components/home/home-view.tsx').includes("view === 'dashboard' && !chatActive") &&
    src('components/home/home-ask.tsx').includes('THE HISTORY PICKER DIED') &&
    !src('components/home/home-ask.tsx').includes('toggleHistory') &&
    src('components/home/home-view.tsx').includes('!projectDetailOpen && !chatActive') &&
    src('components/home/home-ask.tsx').includes('font-voice text-[14.5px] text-neutral-700') &&
    src('app/api/rooms/recent/route.ts').includes('THE CHAT HISTORY') &&
    src('app/api/rooms/recent/route.ts').includes("k.startsWith('chat:')"));

  // ── SH · THE SHELL'S CENTER + ONE NAME EVERYWHERE (Arc 3 S2). ──
  check('SH1: ONE NAME EVERYWHERE — Projects is ONE nav item (owner refinement Aug 7: the portfolio lens is the destination; the sidebar never carries the project LIST), never "pinned"; conversation rows wear CONCRETE product words (project/email/task/meeting/chat)',
    src('components/one/one-sidebar.tsx').includes('Projects is ONE menu item') &&
    !src('components/one/one-sidebar.tsx').includes('rooms.pinned.map') &&
    !src('components/one/one-sidebar.tsx').includes('>Pinned</div>') &&
    src('components/one/one-sidebar.tsx').includes('href="/home?view=projects"') &&
    // Aug 8: the KIND GLYPH + HOVER EXPAND — the row says what it is on sight and who/where on
    // approach ("with Clara" / "in EG Bank" / the kind word); plain chats stay quiet.
    src('components/one/one-sidebar.tsx').includes('group-hover/conv:max-h-4') &&
    src('app/api/rooms/recent/route.ts').includes('sub: `with ${') &&
    src('app/api/rooms/recent/route.ts').includes('sub: `in ${proj}`') &&
    // Aug 8 rework: the chip pills died — the CONCRETE words ride the server's sub line
    // (roomSub) rendered under every row; glyph + sub carry the kind.
    src('app/api/rooms/recent/route.ts').includes("k.startsWith('inbox:') ? 'email'") &&
    src('app/api/rooms/recent/route.ts').includes("k.startsWith('commitment:') ? 'task'") &&
    src('components/one/all-conversations.tsx').includes('{c.sub}'));
  check('SH5: A CLICK OPENS THE CONVERSATION — the open/new intents OPEN the panel (event same-page, sessionStorage intent cross-page; turns never load into a closed card); suggestions sit ABOVE the floor input',
    src('components/home/home-ask.tsx').includes("sessionStorage.getItem('aug-open-chat-intent')") &&
    src('components/home/home-ask.tsx').includes('loadRoom(key); setOpen(true);') &&
    src('components/one/one-sidebar.tsx').includes("sessionStorage.setItem('aug-open-chat-intent'") &&
    src('components/home/home-view.tsx').includes("sessionStorage.setItem('aug-open-chat-intent'") &&
    src('components/home/home-ask.tsx').includes('Suggestions ABOVE the input'));
  check('SH2: NO PROSE ON THE HOME (owner law, twice) — the deck IS the day; no briefing render, no voice teaser, no orb; the composed briefing still powers ordering (sentencedIds)',
    src('components/home/home-view.tsx').includes('NO PROSE ON THE HOME') &&
    !src('components/home/home-view.tsx').includes('<BriefingBlock') &&
    !src('components/home/home-view.tsx').includes('font-voice mt-2.5') &&
    src('components/home/home-view.tsx').includes('sentencedIds') &&
    src('components/one/one-home.tsx').includes('text-[20px] font-semibold tracking-tight') &&
    !src('components/home/home-view.tsx').includes('energy sphere'));
  check('SH4: THE COMPOSER IS THE FLOOR — bottom-docked (sticky, mt-auto), the takeover opening upward; the mid-page ask zone is gone',
    src('components/home/home-view.tsx').includes('THE COMPOSER IS THE FLOOR') &&
    src('components/home/home-view.tsx').includes('sticky bottom-0 mt-auto') &&
    !src('components/home/home-view.tsx').includes('<div className="mt-9 mb-6">'));
  check('SH3: ONE thread system — the SIDEBAR owns history (Recent + All conversations; the in-panel picker DIED Aug 7 as redundant)',
    src('components/one/one-sidebar.tsx').includes('/home?view=conversations') &&
    !src('components/home/home-ask.tsx').includes('/home?view=conversations'));

  check('SH6: THE DECK WEARS THE CARD GRAMMAR (Home only) — WorkRow variant="card": semantic state dot, the CTA speaks the JUDGED state ("Review & send" only when a draft truly exists — the July promise-lesson honored), one card stack',
    src('components/work/work-row.tsx').includes("variant?: 'row' | 'card'") &&
    src('components/work/work-row.tsx').includes("item.source === 'reply' ? 'Review & send →' : 'Review →'") &&
    src('components/work/work-row.tsx').includes('never a promise') &&
    src('components/one/one-home.tsx').includes('variant="card"') &&
    !src('components/home/home-view.tsx').includes('border-neutral-200/70 bg-white divide-y'));

  check('SH7: SOURCES HARMONIZATION — the meetings panel aligns to the one sub-panel system (204px), its section root is "All meetings" (never a second "Home"), and an empty inventory never narrates its own emptiness',
    src('components/meetings/meetings-left-panel.tsx').includes('w-[204px]') &&
    src('components/meetings/meetings-left-panel.tsx').includes('All meetings') &&
    !src('components/meetings/meetings-left-panel.tsx').includes('No projects with recordings yet') &&
    !src('components/meetings/meetings-left-panel.tsx').includes('>Home</span>'));

  check('F4: TEMPORARY CHAT — the ladder\'s explicit ephemeral opt-out: persistence structurally skipped, no room minted, honest "not saved" label, armable only pre-conversation, reset by New',
    src('components/home/home-ask.tsx').includes('if (temp) return;') &&
    src('components/home/home-ask.tsx').includes('Temporary — not saved') &&
    src('components/home/home-ask.tsx').includes('const onNew = () => { setTurns([]); setTemp(false); setScope(null);') &&
    src('components/home/home-ask.tsx').includes('!hasThread && suggestions.length > 0'));

  check('AB1: THE ABSORPTION brick 1 — an ADDRESSED message routes through the WORKER ENGINE (streamed SSE into the panel, author attribution, tool chips); the DM thread is get-or-created; the conversation lives in the worker\'s OWN store (never double-persisted); temporary mode skips addressing (the store would break the promise)',
    src('components/home/home-ask.tsx').includes('detectAddress') &&
    src('components/home/home-ask.tsx').includes("fetch(`/api/work/threads/${tid}/chat`") &&
    src('components/home/home-ask.tsx').includes("event.type === 'text'") &&
    src('components/home/home-ask.tsx').includes('never') &&
    src('components/home/home-ask.tsx').includes('if (!temp) {') &&
    src('components/home/home-ask.tsx').includes('t.author && <p'));

  check('AB2: THE ONE COMPOSER (workstream 3) — the Home floor mounts the SAME WorkerMentionInput the worker surfaces use (@ Coworkers/Tasks/Documents picker, attach, suggestion prefill); a coworker MENTION is the address; files follow the route — chat-attach on the addressed thread, the KNOWLEDGE BASE on the chief path; temporary mode refuses uploads (they would persist)',
    src('components/home/home-ask.tsx').includes('<WorkerMentionInput') &&
    src('components/home/home-ask.tsx').includes("mentions.find((m) => m.type === 'coworker')") &&
    src('components/home/home-ask.tsx').includes('/api/drive/upload/presign') &&
    src('components/home/home-ask.tsx').includes('chat-attach') &&
    src('components/home/home-ask.tsx').includes('temp && files.length') &&
    src('components/home/home-ask.tsx').includes('setPrefill(s.slice(0, -1)') &&
    !src('components/home/home-ask.tsx').includes('<input'));

  check('AB3: THE ABSORPTION brick 2 — coworker conversations LIST in the merged Recent/All (chat threads only, never run threads; temporary excluded) and OPEN in the ONE Home panel: worker mode loads the thread\'s own messages (work_messages stays the store — chief persistence structurally off), the DM pointer re-aims so the next message continues the SAME thread',
    src('app/api/rooms/recent/route.ts').includes('worker:${t.id}:${t.agent_id}') &&
    src('app/api/rooms/recent/route.ts').includes(".is('workflow_id', null)") &&
    src('components/one/all-conversations.tsx').includes("'coworker'") &&
    src('components/home/home-ask.tsx').includes('loadWorkerRoom') &&
    src('components/home/home-ask.tsx').includes('if (workerRoomRef.current) return;') &&
    src('components/home/home-ask.tsx').includes('localStorage.setItem(dmKey(agentId), tid)') &&
    src('components/home/home-ask.tsx').includes("startsWith('Chat with')"));

  check('ST8: THE STREAMING ASK — the chief path answers over SSE with live PROGRESS labels (the ONE progress channel in converse: tool labels speak consequence, fast-path + agent loop both emit); the panel\'s busy line speaks the stage; the JSON path survives for non-panel callers',
    src('app/api/home/ask/route.ts').includes('text/event-stream') &&
    src('app/api/home/ask/route.ts').includes('onProgress') &&
    src('lib/converse/index.ts').includes('TOOL_PROGRESS') &&
    src('lib/converse/index.ts').includes('progressLabelFor(call.function.name)') &&
    src('lib/converse/index.ts').includes('progressLabelFor(verdict.command.tool)') &&
    src('components/home/home-ask.tsx').includes('stream: true') &&
    src('components/home/home-ask.tsx').includes('setStage(ev.label)') &&
    src('components/home/home-ask.tsx').includes("{stage ?? 'Thinking…'}"));

  check('F7: THE SCOPE CHIP + THE ADOPTION CASCADE — the conversation header shows its scope ("No project · Add to…" / "<Project> ✓" = the room door), settable any time via the ONE picker grammar (ProjectPickerPanel, extracted and shared with the deck door); adopting MOVES the turns into the project room (chat:* only, idempotent narration at the seam), then the panel talks IN the room: turns persist to its key, answers ground entity-scoped through the one core',
    src('components/home/home-ask.tsx').includes("hasThread ? 'No project' : 'Project'") &&
    src('components/home/home-ask.tsx').includes('accessory={temp ? (') &&
    src('components/home/home-ask.tsx').includes("'/api/rooms/adopt'") &&
    src('components/home/home-ask.tsx').includes('entityId: scope.id') &&
    src('components/home/home-ask.tsx').includes('<ProjectPickerPanel') &&
    src('components/work/work-row.tsx').includes('export function ProjectPickerPanel') &&
    // v2 LINK MODEL (Aug 7 — add/CHANGE/REMOVE, owner ask): the binding (item_plans
    // kind 'room_scope') says where the conversation belongs; turns NEVER move; the seam
    // narration follows the binding; scope is SERVER TRUTH (GET), un-file is entityId:null.
    src('app/api/rooms/adopt/route.ts').includes("startsWith('chat:')") &&
    src('app/api/rooms/adopt/route.ts').includes("'room_scope'") &&
    src('app/api/rooms/adopt/route.ts').includes('adopt:${roomKey}') &&
    !src('app/api/rooms/adopt/route.ts').includes('.update({ room_key') &&
    src('app/api/rooms/adopt/route.ts').includes('export async function GET') &&
    src('components/home/home-ask.tsx').includes('void adopt(null)') &&
    src('components/home/home-ask.tsx').includes('roomKey: chatRoomKey(), role, text') &&
    src('app/api/home/ask/route.ts').includes("kind: 'entity'"));

  check('AB4: THE RAIL COMPOSER FOLD — the room\'s composer IS the one composer (WorkerMentionInput frameless; the bespoke textarea died); a coworker mention becomes the ADDRESS in the sent words (the delegate path speaks names), attach feeds the room\'s ingest funnel immediately, chips/offers still speak through send(raw)',
    src('components/home/item-rail.tsx').includes('<WorkerMentionInput') &&
    src('components/home/item-rail.tsx').includes('frameless') &&
    !src('components/home/item-rail.tsx').includes('<textarea') &&
    src('components/home/item-rail.tsx').includes("placeholder=\"Ask, correct, or hand off…\"") &&
    src('components/home/item-rail.tsx').includes('const send = async (raw: string)') &&
    src('components/home/item-rail.tsx').includes('for (const f of files) await attach(f)'));

  check('KN1: THE SLIM KNOWLEDGE PANEL — /drive survives as the Settings→Knowledge door but the folder grid is DELETED (drive-client gone); the page is the sovereignty/audit surface: one overview read (kind derives STRUCTURALLY from provider_file_id/source — meeting·attachment·upload·generated), indexing status honest (chunks>0), files name their project (entity_id), name+content search, explicit two-step remove, meeting notes managed from Meetings (never deletable here)',
    !existsSync('app/drive/drive-client.tsx') &&
    src('app/(main)/drive/page.tsx').includes("redirect('/settings?tab=knowledge')") &&
    src('app/(main)/settings/page.tsx').includes("tab === 'knowledge'") &&
    src('app/(main)/settings/page.tsx').includes('<KnowledgePanel />') &&
    !src('components/settings/settings-left-panel.tsx').includes("href: '/drive'") &&
    src('app/api/knowledge/overview/route.ts').includes("p.startsWith('transcript::')") &&
    src('app/api/knowledge/overview/route.ts').includes("deletable: kind !== 'meeting'") &&
    src('components/knowledge/knowledge-panel.tsx').includes('/api/knowledge/overview') &&
    src('components/knowledge/knowledge-panel.tsx').includes('/api/drive/search') &&
    src('components/knowledge/knowledge-panel.tsx').includes('confirmDel === f.id') &&
    src('components/knowledge/knowledge-panel.tsx').includes("f.indexed ? `indexed"));

  check('AB5: THE ABSORPTION brick 3 — the one surface OWNS its outputs: a coworker\'s DOCUMENT opens the SAME ThreadArtifactsPanel as a right-side overlay in the Home conversation (viewer/versions/download — never a page away; a loaded worker conversation surfaces its existing documents too); an EMAIL DRAFT mounts the SAME editable EmailDraftCard inline (the user-gated Send door); only registry renders still point at the worker page',
    src('components/home/home-ask.tsx').includes('<ThreadArtifactsPanel') &&
    src('components/home/home-ask.tsx').includes('<EmailDraftCard') &&
    src('components/home/home-ask.tsx').includes('openArtifact(c.art.tid, c.art.id)') &&
    // Aug 8 (the docked pane): EVERY arrival refreshes the pane to the newest version — the
    // edit loop ("make it shorter" updates the open document); no dim, no backdrop, non-modal.
    src('components/home/home-ask.tsx').includes('STAYS CURRENT') &&
    !src('components/home/home-ask.tsx').includes('bg-neutral-900/20') &&
    src('components/home/home-ask.tsx').includes("lg:mr-[608px]") &&
    src('components/home/home-ask.tsx').includes("drafts.push({ draft: event.draft, tid, agentId: w.id })") &&
    src('components/home/home-ask.tsx').includes('art: { tid, id: a.id }') &&
    !src('components/home/home-ask.tsx').includes("review & send on ${first}'s page"));

  check('DG1: THE DELIVERABLE GRAMMAR (owner call, Aug 6 — "shouldn\'t the report show in a right panel?") — a substantial composed deliverable (report/briefing/proposal past ~a screen) is PRODUCED as a document (generate_document DIRECTLY, no added clarification friction) with a 2-3 sentence chat summary, never pasted whole into chat; quick answers/short-form stay inline; the inline-era "content type alone is never enough" rule is DEAD in both the native prompt and the AgentOS prompts (parity rides the next box redeploy)',
    src('lib/work/chat-system-prompt.ts').includes('THE DELIVERABLE GRAMMAR') &&
    src('lib/work/chat-system-prompt.ts').includes('generate_document DIRECTLY') &&
    src('lib/work/chat-system-prompt.ts').includes('NEVER paste the full deliverable into chat') &&
    !src('lib/work/chat-system-prompt.ts').includes('Content type alone is never enough') &&
    src('infra/agentos/workers.py').includes('DELIVERABLE_GRAMMAR = """') &&
    (src('infra/agentos/workers.py').match(/\+ DELIVERABLE_GRAMMAR\}/g)?.length ?? 0) === 4);

  check('TM1: SETTINGS → TEAM GROUNDED (/workers kill-list item 1) — team CONFIG is a real Settings section (the grounded-door law: no href ejection); the roster expands per coworker into the SAME WorkerToolsTab/WorkerKnowledgeTab the worker page mounts (one truth), the skills library rides below; coworkers are talked to from conversations, configured here',
    !src('components/settings/settings-left-panel.tsx').includes("href: '/workers'") &&
    src('app/(main)/settings/page.tsx').includes("tab === 'team'") &&
    src('app/(main)/settings/page.tsx').includes('<TeamSection />') &&
    src('components/settings/team-section.tsx').includes('<WorkerToolsTab') &&
    src('components/settings/team-section.tsx').includes('<WorkerKnowledgeTab') &&
    src('components/settings/team-section.tsx').includes('<SkillsLibraryView'));

  check('RN1: THE RECOGNITION NUDGE (owner, Aug 7 — "will it suggest opening the project room?") — an unscoped Home ask that NAMES a registered project carries the deterministic focus match back (`focus` on both response paths, zero AI); the scope chip becomes an OFFER ("About X? · File it" + dismiss) — a suggestion, never an auto-file; one click runs the adoption cascade; the hint clears on New/chat-load/DM-load',
    src('app/api/home/ask/route.ts').includes('findEntityFocus') &&
    src('app/api/home/ask/route.ts').includes("scope.kind !== 'global'") &&
    src('components/home/home-ask.tsx').includes('About {scopeHint.name}? · File it') &&
    src('components/home/home-ask.tsx').includes('if (d.focus && !scope && !temp) setScopeHint(d.focus)') &&
    src('components/home/home-ask.tsx').includes('setScopeHint(null); void adopt(h)'));

  check('UX1: SPEAK CONSEQUENCE ON CONVERSATION VERBS (owner, Aug 7 — ""Clear" reads as delete; can he get it back?") — the room pair is self-explanatory (New session ↔ Earlier sessions, "Clear" dead); conversation delete is ARCHIVE with an Undo toast (chat: batch un-archive via /api/rooms/restore; coworker: soft status PATCH, never the hard DELETE)',
    src('components/home/item-rail.tsx').includes('>New session</button>') &&
    src('components/home/item-rail.tsx').includes('>Earlier sessions</button>') &&
    !src('components/home/item-rail.tsx').includes('>Clear</button>') &&
    src('components/one/all-conversations.tsx').includes("toast('Conversation deleted'") &&
    src('components/one/all-conversations.tsx').includes("'/api/rooms/restore'") &&
    src('components/one/all-conversations.tsx').includes("status: 'archived'") &&
    src('app/api/rooms/restore/route.ts').includes('archived_at: null') &&
    src('app/api/work/threads/[id]/route.ts').includes("status === 'archived' || status === 'active'"));

  check('UX2: THE PRE-FILED NEW CHAT + THE SEAM DOOR + PROJECT TAGS — the project room\'s "New chat" starts a Home conversation already scoped (intent → binding up front); the room\'s seam line is a clickable door (?chat= ref, handled in the panel); filed chats wear their project as a quiet tag in All conversations',
    src('components/entities/entity-room.tsx').includes("'aug-new-chat-scope'") &&
    src('components/home/home-ask.tsx').includes("sessionStorage.getItem('aug-new-chat-scope')") &&
    src('components/home/home-ask.tsx').includes(".get('chat')") &&
    src('app/api/rooms/adopt/route.ts').includes('/home?chat=') &&
    src('app/api/rooms/recent/route.ts').includes('projectOf') &&
    src('app/api/rooms/recent/route.ts').includes('sub: `in ${proj}`'));

  check('TF1: ONE DEED, ONE OBJECT (owner, Aug 7 — "CTA to check, action buttons, then again check CTA") — when the MOVE\'s target IS a prepared artifact on the rail, the two renderers MERGE into ONE action card (object + primary verb + ≤2 quiet variants ON the card); the duplicate stream card is suppressed; the banner+chips form survives only when nothing prepared matches',
    src('components/home/item-rail.tsx').includes('ONE DEED, ONE OBJECT') &&
    src('components/home/item-rail.tsx').includes('mergedArtKey') &&
    src('components/home/item-rail.tsx').includes('streamArts.filter') &&
    src('components/home/item-rail.tsx').includes('resp.offers.slice(0, 2)'));

  check('TF2: OPEN LANDS ON THE PREPARED THING — the merged card\'s click carries the STAGE INTENT: the room focuses the item WITH its stage raised (ItemDetail initialStage → composer/forward/invite up on arrival, the thread beneath); never the bare thread behind a "Prepared by Clara" promise',
    src('components/home/item-rail.tsx').includes('onStage?.(stageOfArtifactKey(mergedArt.key), respMoveTargetId)') &&
    src('components/home/item-detail.tsx').includes('initialStage?:') &&
    src('components/home/item-detail.tsx').includes('OPEN LANDS ON THE PREPARED THING') &&
    src('components/entities/entity-room.tsx').includes('focusStage') &&
    src('components/entities/entity-room.tsx').includes('initialStage={focusStage ?? undefined}'));

  check('TF3: THE ROOM WARM — hovering a project row prefetches the room\'s two payloads into the SAME LS keys the room hydrates from (a first open paints from cache like every later one); session-deduped',
    src('components/entities/entity-room.tsx').includes('export function warmEntityRoom') &&
    src('components/entities/entity-room.tsx').includes('roomWarmed.has(entityId)') &&
    src('components/entities/portfolio-view.tsx').includes('onMouseEnter={() => warmEntityRoom(e.id)}'));

  check('PF1: THE RECONCILE THROTTLE (found live, Aug 7 — reconcile burned 36-43s inside every brief load and every concurrent surface paid it again, queueing the whole DB behind it) — module-level per-user TTL (10 min) + single-flight (concurrent callers share ONE run); the sync-time resolver still fires real-time; `force` bypasses',
    src('lib/inbox/reconcile-replied.ts').includes('RECONCILE_TTL_MS') &&
    src('lib/inbox/reconcile-replied.ts').includes('reconcileInflight') &&
    src('lib/inbox/reconcile-replied.ts').includes('if (inflight) return inflight;') &&
    src('lib/inbox/reconcile-replied.ts').includes('force?: boolean'));

  check('PF2: THE INSTANT SERVE + THE SHEET (owner, Aug 7 — ""drafted" then takes too long"; "show the thread too") — a STORED prepared draft serves on the CACHED judgment alone (one read, no re-judge/resolution; a cached non-reply verdict still refuses — P2 holds, absent cache falls through to the full gate); the summoned stage is a bottom SHEET capped ~72% so the source thread stays visible above it',
    src('app/api/inbox/[id]/draft/route.ts').includes('THE INSTANT SERVE') &&
    src('app/api/inbox/[id]/draft/route.ts').includes("eq('kind', 'judgment').eq('entity_id', `inbox:${id}`)") &&
    src('app/api/inbox/[id]/draft/route.ts').includes("skipped: 'judged_none' });\n    }\n  }") &&
    src('components/home/item-detail.tsx').includes('THE STAGE IS A SHEET, NOT A CURTAIN') &&
    src('components/home/item-detail.tsx').includes('max-h-[72%]'));

  check('PR1: THE PRESENTATION LAW (owner, Aug 7 — "that grounding/reasoning needs to exist; there shouldn\'t be redundancy") — the no-redundancy composition lives in ONE module (lib/room/presentation: moveTargetId · mergedArtifactKey · stageOfArtifactKey · railCoversItem) consumed by BOTH panes; a deed presents exactly once BY CONSTRUCTION, never by per-pane suppression patches; no local re-derivation of the match remains',
    src('lib/room/presentation.ts').includes('THE PRESENTATION LAW') &&
    src('components/home/item-rail.tsx').includes("from '@/lib/room/presentation'") &&
    src('components/entities/entity-room.tsx').includes("from '@/lib/room/presentation'") &&
    src('components/entities/entity-room.tsx').includes('railCoversItem(rail?.move?.ref, focused.id)') &&
    !src('components/home/item-rail.tsx').includes(".split(':')[1] ?? null") &&
    !src('components/entities/entity-room.tsx').includes('rail.move.ref.includes'));

  check('WG1: THE WORKERS READ THE ONE GROUNDING (production-floor step 1) — a message NAMING a registered project pulls that project\'s FULL room page (the SAME assembleRoomGrounding the room/chief read) into the worker context on BOTH runtimes (native loop + AgentOS bridge); deterministic focus entry (the shared matcher, zero AI), tags stripped, THE ADDRESSED-NAME STRIP (found live: "Clara, report on EG Bank" matched the entity "Madalena Clara" — the envelope is never the subject)',
    src('lib/work/worker-grounding.ts').includes('THE WORKERS READ THE ONE GROUNDING') &&
    src('lib/work/worker-grounding.ts').includes('assembleRoomGrounding') &&
    src('lib/work/worker-grounding.ts').includes('THE ADDRESSED-NAME STRIP') &&
    src('lib/work/worker-grounding.ts').includes("replace(/\\[(?:L|F)\\d+\\]\\s?/g, '')") &&
    src('app/api/work/threads/[id]/chat/route.ts').includes('focusedProjectGrounding(adminClient, user.id, content, { excludeName: agent.name') &&
    src('lib/work/agentos-bridge.ts').includes('buildWorkerRunContext(adminClient, userId, agentId, message)') &&
    src('lib/work/agentos-bridge.ts').includes('buildWorkerRunContext(args.adminClient, args.userId, args.agentId, args.message)') &&
    src('lib/work/agentos-bridge.ts').includes('excludeName: agent?.name'));

  check('DS1: THE DISPATCHER + THE SENSIBLE ASK (owner: "agnostic — reasoning when it needs input; not asking for the sake of asking") — two REGISTRY capabilities (conversational: excluded from the plan classifier): assign_to_coworker ACTS on clear-fit production asks (reversible, visible attribution, never permission theater); offer_choices is the loop\'s ONE decision door (≤4 options, each tap SPEAKS its say — ephemeral, consumed on tap); loop terminates on options/delegated; live-verified: unaddressed produce ask → delegated to the right fit, plain question → no chips',
    src('lib/work/surface-registry.ts').includes('conversational?: boolean') &&
    src('lib/work/surface-registry.ts').includes('!c.conversational') &&
    src('lib/converse/index.ts').includes('assignToCoworkerDefinition, offerChoicesDefinition]') &&
    src('lib/converse/index.ts').includes("tool === 'assign_to_coworker'") &&
    src('lib/converse/index.ts').includes("tool === 'offer_choices'") &&
    src('lib/converse/index.ts').includes('out?.options || out?.delegated') &&
    src('lib/converse/index.ts').includes('Asking for the sake of asking is a failure') &&
    src('app/api/home/ask/route.ts').includes('turn.options?.length') &&
    src('components/home/home-ask.tsx').includes('options: undefined } : x)));') &&
    src('components/home/home-ask.tsx').includes('void handleSubmit(o.say, [])'));

  check('VL1: THE VERIFY LOOP ON CHAT DOCUMENTS + THE STRUCTURAL WORD-IS-DEED (production-floor step 3) — every chat-produced document passes the arithmetic floor (verify-claims BY CODE; a mismatch never blocks delivery but stamps qa_report AND is SAID in the coworker\'s summary — flagged never silent; floor outage speaks no verdict); the native loop\'s final reply CLAIMING a document with none produced gets ONE corrective round (produce it or restate — never ship the lie; regex verified 7/7 incl. the live case)',
    src('lib/work/generate-thread-document.ts').includes('THE VERIFY LOOP ON CHAT DOCUMENTS') &&
    src('lib/work/generate-thread-document.ts').includes('verifyComputableClaims') &&
    src('lib/work/generate-thread-document.ts').includes('qa_report') &&
    src('lib/work/generate-thread-document.ts').includes('qaNote}`') &&
    src('app/api/work/threads/[id]/chat/route.ts').includes('THE WORD IS THE DEED — STRUCTURAL') &&
    src('app/api/work/threads/[id]/chat/route.ts').includes('claimsDoc && allArtifactIds.length === 0 && !wordDeedCorrected') &&
    src('app/api/work/threads/[id]/chat/route.ts').includes('[SYSTEM CHECK — not the user]'));

  // ── PA · THE PRODUCTION ARC step 1 — the workflow step space joins the one registry ──
  {
    const { isWorkflowStepTool } = await import('../lib/work/surface-registry');
    const es = src('lib/workflows/execute-step.ts');
    const LEGACY = new Set(['linkedin_post', 'get_urgent_emails']);
    const caseIds = [...es.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1])
      .filter((id) => !['tool', 'ai', 'agent', 'approval', 'verify'].includes(id)); // step TYPES, not tool ids
    const unregistered = caseIds.filter((id) => !LEGACY.has(id) && !isWorkflowStepTool(id));
    const sb = src('components/work/studio-builder.tsx');
    const pickerIds = [...sb.matchAll(/\{ id: '([a-z_]+)', {1,10}label/g)].map((m) => m[1]);
    const pickerUnregistered = pickerIds.filter((id) => id !== 'linkedin_post' && !isWorkflowStepTool(id));
    check('PA1: THE WORKFLOW STEP SPACE ON THE ONE REGISTRY (production arc step 1) — every pipeline step id has a workflow-exposed capability row (executor cases + Studio picker cross-checked BY IMPORT, zero drift possible); the RUNTIME GATE refuses an unregistered tool step; workflow-only rows never leak into the item-plan classifier; slack_send is the irreversible send step (the coming approval gate\'s target)',
      caseIds.length >= 15 && pickerIds.length >= 12 &&
      unregistered.length === 0 && pickerUnregistered.length === 0 &&
      es.includes('THE REGISTRY GATE') &&
      es.includes('is not registered for workflows') &&
      isWorkflowStepTool('rss_feed') && isWorkflowStepTool('slack_send') && !isWorkflowStepTool('offer_choices') &&
      src('lib/work/surface-registry.ts').includes("exposure.length === 1 && c.exposure[0] === 'workflow'"));
    if (unregistered.length || pickerUnregistered.length) console.log('  unregistered:', unregistered, pickerUnregistered);
  }

  check('PA2: THE APPROVAL STEP — pause/resume, the Executor-validated shape (production arc step 2): an `approval` STEP TYPE parks the run (`awaiting_approval`, outputs snapshotted) and surfaces the ask (room `approval` component + commitment due TODAY); approve RESUMES past exactly that gate (later gates park again); reject ends honestly; test/cadence runs auto-pass (a paused simulation proves nothing); OPT-IN BY CONSTRUCTION (the pilot outcome contract — an existing workflow can never hit the branch); a park that cannot persist FAILS LOUDLY naming its migration',
    src('lib/workflows/types.ts').includes("interface ApprovalStep") &&
    src('lib/workflows/run-workflow.ts').includes("status: 'awaiting_approval', step_outputs: stepOutputs") &&
    src('lib/workflows/run-workflow.ts').includes('resumeApprovalAt') &&
    src('lib/workflows/run-workflow.ts').includes('auto-passed in test mode') &&
    src('lib/workflows/run-workflow.ts').includes('Apply migration 20260808_workflow_runs_approval_status.sql') &&
    src('lib/workflows/standing.ts').includes('narrateApprovalAsk') &&
    src('lib/workflows/standing.ts').includes("key: 'approval'") &&
    src('app/api/workflows/runs/[id]/resume/route.ts').includes("run.status !== 'awaiting_approval'") &&
    src('components/home/item-rail.tsx').includes('Approve — deliver it') &&
    src('components/home/item-rail.tsx').includes('Hold back') &&
    src('lib/workflows/generate-config.ts').includes('"type": "approval"') &&
    src('lib/workflows/generate-config.ts').includes('ONE GATE, CODE-ENFORCED') && // found live: a generated pipeline carried two approval gates
    existsSync('supabase/migrations/20260808_workflow_runs_approval_status.sql'));

  check('PA3: THE STRUCTURAL VERIFICATION GATE (production arc step 3) — `verify` is a STEP TYPE built into the engine (one versioned implementation; the AHK hand-built gate never copy-pasted again): the ARITHMETIC FLOOR runs FIRST (code-recomputed claims become MUST-FIX lines) then one persona-free reasoned pass (use_worker_identity:false through the ONE AI-step executor — clock/context ride along); generate-config emits it after synthesis for external-material pipelines and bans duplicate prose verifiers; E2E: wrong sum corrected · ungrounded claim deleted · structure intact',
    src('lib/workflows/types.ts').includes('interface VerifyStep') &&
    src('lib/workflows/execute-step.ts').includes('VERIFY_GATE_VERSION') &&
    src('lib/workflows/execute-step.ts').includes('COMPUTED BY CODE') &&
    src('lib/workflows/execute-step.ts').includes('use_worker_identity: false,\n    prompt: verifyGatePrompt') &&
    src('lib/workflows/execute-step.ts').includes("case 'verify': output = await executeVerifyStep") &&
    src('lib/workflows/generate-config.ts').includes('"type": "verify"') &&
    src('lib/workflows/generate-config.ts').includes('two competing verifiers'));

  // ── PA4 · THE ENTITY EDGE (production arc step 4) — workflows join the one brain. ──
  check('PA4a: the edge is wired at every seam (source parity) — both creation doors adopt (chat create_task + the builder save POST); generate-config drafts over the named project\'s room page AND the existing-tasks dup read (overlap_note informs, never blocks); run time inherits the scope into AI steps ONLY (the verify gate judges draft vs sources alone); the room\'s grounding lists its STANDING PRODUCTION (one section, visible to all reasoning)',
    src('app/api/workflows/route.ts').includes('adoptWorkflowEntity') && // the ONE create door adopts; every chat path creates THROUGH it since CS2

    src('lib/workflows/generate-config.ts').includes('workflowDraftGrounding') &&
    src('lib/workflows/entity-edge.ts').includes('THE GROUNDING BOUNDARY') && // draft = identity-level (~400 chars); the full page injects at RUN time only
    src('lib/workflows/entity-edge.ts').includes('block.slice(0, 700)') &&
    src('lib/workflows/generate-config.ts').includes('[EXISTING TASKS') &&
    src('lib/workflows/generate-config.ts').includes('overlap_note') &&
    src('lib/workflows/run-workflow.ts').includes('workflowRunGrounding') &&
    src('lib/workflows/execute-step.ts').includes("ctx.projectGrounding && step.use_worker_identity !== false") &&
    src('lib/room/grounding.ts').includes('STANDING PRODUCTION'));

  // ── PA5 · THE WORKFLOWS LEDGER (production arc step 5) — the production surface, ledger-led. ──
  check('PA5: THE WORKFLOWS LEDGER — Workflows is a sidebar door to a LEDGER-LED lens (what waits on you leads · what stands · what ran; live-verified on the served page with real production); creation is DESCRIBE→DRAFT→REVIEW→CONFIRM (the review card speaks plain grammar — steps, schedule, deliverable home, presenter chips, the amber overlap warning — and Confirm IS the deed); Studio stays ONE click deep as "Edit method", never the front door; approvals decide inline through the one resume route; THE CHECKPOINT: completed step outputs persist as a run advances (durable-execution practice — live progress readable, a crash leaves evidence)',
    src('components/one/one-sidebar.tsx').includes('/home?view=workflows') &&
    src('components/home/view-switcher.tsx').includes("'workflows'") &&
    src('components/home/home-view.tsx').includes("view === 'workflows'") &&
    src('components/workflows/workflows-ledger.tsx').includes('generate-from-description') &&
    src('components/workflows/workflows-ledger.tsx').includes('overlap_note') &&
    src('components/workflows/workflows-ledger.tsx').includes('Confirm — it goes live') &&
    src('components/workflows/workflows-ledger.tsx').includes('Approve — deliver it') &&
    src('components/workflows/workflows-ledger.tsx').includes('/studio?workflow=') &&
    src('app/api/workflows/ledger/route.ts').includes('awaiting') &&
    src('app/api/workflows/ledger/route.ts').includes('workflow_scope') &&
    src('lib/workflows/run-workflow.ts').includes('THE CHECKPOINT'));

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sbE = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { resolveProbeUser } = await import('./probe-user');
    const probeE = await resolveProbeUser(sbE);
    const stampE = `smoke-ee-${Date.now()}`;
    let entId: string | null = null; let wfId: string | null = null;
    try {
      const { data: ent, error: entErr } = await sbE.from('work_entities').insert({
        user_id: probeE, kind: 'initiative', name: 'Zephyrline Dossier', status: 'active', tracked: true,
        aliases: [], sig: stampE,
      }).select('id').single();
      if (entErr || !ent) throw new Error(`entity insert: ${entErr?.message}`);
      entId = ent.id as string;
      const { data: wf, error: wfErr } = await sbE.from('workflows').insert({
        user_id: probeE, name: `[${stampE}] Weekly Zephyrline digest`, status: 'paused',
        trigger: { type: 'manual' }, steps: [], output_config: { destination: 'message' },
      }).select('id').single();
      if (wfErr || !wf) throw new Error(`workflow insert: ${wfErr?.message}`);
      wfId = wf.id as string;

      const { adoptWorkflowEntity, getWorkflowScope, workflowsScopedToEntity, recognizeWorkflowEntity, workflowRunGrounding } =
        await import('../lib/workflows/entity-edge');
      const adopted = await adoptWorkflowEntity(sbE, probeE, wfId, 'Weekly digest of everything moving on the Zephyrline Dossier');
      const scope = await getWorkflowScope(sbE, probeE, wfId);
      const reverse = await workflowsScopedToEntity(sbE, probeE, entId);
      const noMatch = await recognizeWorkflowEntity(sbE, probeE, 'every monday summarize the latest economy news');
      check('PA4b-LIVE: the edge round-trip on the probe — a workflow naming a registered project ADOPTS it (deterministic matcher, scope persisted, via recognized); the reverse read finds the workflow from the entity; an all-generic request matches NOTHING',
        adopted?.id === entId && scope?.entityId === entId && scope?.via === 'recognized' &&
        reverse.some((r) => r.workflowId === wfId) && noMatch === null);

      const runG = await workflowRunGrounding(sbE, probeE, wfId);
      const { assembleRoomGrounding } = await import('../lib/room/grounding');
      const roomG = await assembleRoomGrounding(sbE, probeE, { kind: 'entity', entityId: entId });
      check('PA4c-LIVE: both directions ground — the run inherits the project\'s room page (named, capped, tags stripped) and the project\'s room grounding lists the standing workflow by name',
        !!runG && runG.includes('Zephyrline Dossier') && runG.includes('THE PROJECT THIS TASK SERVES') &&
        !!roomG?.text && roomG.text.includes('STANDING PRODUCTION') && roomG.text.includes('Weekly Zephyrline digest'));
    } catch (e) {
      check('PA4b-LIVE: entity-edge round-trip', false, e instanceof Error ? e.message : 'failed');
      check('PA4c-LIVE: both directions ground', false, 'skipped after failure');
    } finally {
      if (wfId) {
        await sbE.from('item_plans').delete().eq('user_id', probeE).eq('kind', 'workflow_scope').eq('entity_id', wfId);
        await sbE.from('workflows').delete().eq('id', wfId);
      }
      if (entId) await sbE.from('work_entities').delete().eq('id', entId);
    }
  } else {
    console.log('· PA4-LIVE skipped — SUPABASE_SERVICE_ROLE_KEY not set in this env');
  }

  // ── PA6 · STANDING REACTIONS (production arc step 6) — the brain as a trigger. ──
  check('PA6a: the reaction shape is wired at every seam — a `reaction` TRIGGER TYPE (judged condition in plain words; the deterministic-spine law: reasoning at the trigger EDGE, the fixed pipeline fires); judged at the sync tail AFTER recognition (scope = the entity edge); the triggering event rides EVERY AI step incl. the verify gate (it IS source material, unlike projectGrounding); the hourly dispatcher re-fires stale queued event-runs (a crashed tail never silently eats an event); generate-config births reactions from "when/whenever" requests; schedule/standing machinery ignores reactions (no next_run_at, no standing commitment)',
    src('lib/workflows/types.ts').includes("interface ReactionTrigger") &&
    src('lib/workflows/reactions.ts').includes('checkReactions') &&
    src('lib/workflows/reactions.ts').includes('DAILY_CAP') &&
    src('lib/email-sync/sync-emails.ts').includes('checkReactions') &&
    src('lib/workflows/execute-step.ts').includes('triggering_event') &&
    src('app/api/cron/workflows-dispatch/route.ts').includes('refireStaleEventRuns') &&
    src('lib/workflows/generate-config.ts').includes('"type": "reaction"') &&
    src('lib/workflows/standing.ts').includes("wf.trigger?.type === 'schedule'") &&
    src('app/api/workflows/ledger/route.ts').includes("trig?.type === 'reaction'"));

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const sbR6 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { resolveProbeUser } = await import('./probe-user');
    const probeR6 = await resolveProbeUser(sbR6);
    const stampR6 = `smoke-rx-${Date.now()}`;
    let wfId: string | null = null; const itemIds: string[] = [];
    try {
      const { data: wf } = await sbR6.from('workflows').insert({
        user_id: probeR6, name: `[${stampR6}] invoice reaction`, status: 'active',
        trigger: { type: 'reaction', when: 'an invoice arrives asking the user to pay', label: 'When an invoice lands' },
        steps: [{ type: 'ai', id: 's1', label: 'Summarize', prompt: 'Summarize the triggering event in one line.', model_tier: 'fast' }],
        output_config: { destination: 'message' },
      }).select('id').single();
      wfId = wf!.id as string;
      const sinceIso = new Date(Date.now() - 60_000).toISOString();
      for (const [title, body] of [
        ['Invoice #4417 — payment due', 'Please find attached invoice #4417 for 850 EUR, due within 14 days. Kindly arrange payment.'],
        ['Lunch on Friday?', 'Hey! Are you free for lunch on Friday around noon?'],
      ]) {
        const { data: it } = await sbR6.from('inbox_items').insert({
          user_id: probeR6, source: 'email', work_title: title, status: 'pending',
          source_data: { subject: title, snippet: body, from_name: 'Acme Billing', is_from_user: false },
        }).select('id').single();
        itemIds.push(it!.id as string);
      }
      const { checkReactions } = await import('../lib/workflows/reactions');
      const r1 = await checkReactions(sbR6, probeR6, sinceIso);
      const { data: queued } = await sbR6.from('workflow_runs').select('id, status, triggered_by').eq('workflow_id', wfId);
      const { data: fireRows } = await sbR6.from('item_plans').select('entity_id, tasks').eq('user_id', probeR6).eq('kind', 'reaction_fire');
      const fires = (fireRows ?? []) as Array<{ entity_id: string; tasks: { context?: string } }>;
      const r2 = await checkReactions(sbR6, probeR6, sinceIso); // idempotence: same window, no new fire
      check('PA6b-LIVE: the reaction fires on the probe — the invoice CLEARLY matching the condition fires (queued event-run + exactly-once record carrying the trigger context); the lunch note does NOT; the same window re-checked fires NOTHING (dedupe holds)',
        r1?.fired === 1 && (queued ?? []).length === 1 && (queued?.[0] as { triggered_by?: string })?.triggered_by === 'event' &&
        fires.length === 1 && fires[0].entity_id === `${wfId}:inbox:${itemIds[0]}` &&
        !!fires[0].tasks?.context?.includes('Invoice #4417') &&
        r2?.fired === 0);
    } catch (e) {
      check('PA6b-LIVE: standing reaction fire', false, e instanceof Error ? e.message : 'failed');
    } finally {
      if (wfId) {
        await sbR6.from('workflow_runs').delete().eq('workflow_id', wfId);
        await sbR6.from('workflows').delete().eq('id', wfId);
        await sbR6.from('item_plans').delete().eq('user_id', probeR6).eq('kind', 'reaction_fire');
      }
      for (const id of itemIds) await sbR6.from('inbox_items').delete().eq('id', id);
    }
  } else {
    console.log('· PA6-LIVE skipped — SUPABASE_SERVICE_ROLE_KEY not set in this env');
  }

  check('PA5b: THE LEDGER REWORK (owner review, Aug 9) — the recent trail is GROUPED per workflow (deltas speak: failures itemize, held-backs count, repeat successes collapse to "N runs · last <date>"); "open" opens THE DELIVERABLE in the docked viewer (the same ThreadArtifactsPanel as the Home chat — never a /workers chat page); row verbs are VISIBLE with a WORDED "Edit method" (a hidden door is no door); THE GALLERY seeds describe→draft (category chips + outcome-worded cards; project-suggestion cards removed by owner call); the review card offers Adjust in Studio (saved as DRAFT, nothing live) and the page carries a build-from-scratch Studio door; the presenter chips died (a workflow is system-owned — the voice is a detail, defaulted silently, changeable in Studio); delegations append to ONE standing "Handed to <Name>" thread per worker (never a thread per hand-off) and hand-off threads are excluded from the conversations list (a conversation requires the user\'s voice)',
    src('components/workflows/workflows-ledger.tsx').includes('ThreadArtifactsPanel') &&
    src('components/workflows/workflows-ledger.tsx').includes('see the latest') &&
    src('components/workflows/workflows-ledger.tsx').includes('Edit in Studio') &&
    src('components/workflows/workflows-ledger.tsx').includes('TEMPLATES') &&
    src('components/workflows/workflows-ledger.tsx').includes('Adjust in Studio') &&
    src('components/workflows/workflows-ledger.tsx').includes('build one from scratch in Studio') &&
    src('app/api/workflows/ledger/route.ts').includes('failures') &&
    src('lib/home/delegate.ts').includes('ONE STANDING HAND-OFF THREAD') &&
    src('app/api/rooms/recent/route.ts').includes("not('title', 'like', 'Handed to %')") &&
    src('components/workflows/workflows-ledger.tsx').includes('Really delete?') &&
    src('components/workflows/workflows-ledger.tsx').includes('function RunAudit') &&
    src('components/workflows/workflows-ledger.tsx').includes('from=workflows') &&
    src('app/studio/studio-page-client.tsx').includes('backTo') &&
    src('app/studio/studio-page-client.tsx').includes("'Untitled workflow'"));

  check('CS1: THE SEEN SIGNAL MIGRATED + THE RUNS BADGE (coherence slice #1, Aug 10) — reviewed_at is stamped by the NEW surface (opening the Runs lens marks all; opening a deliverable marks that workflow) through ONE route, which also clears the sidebar unread badge (the same fact feeds auto-pause — one mechanic, not three); the badge is a QUIET count (indigo, never red — a delivered briefing is good news); auto-pause speaks its reason in the ledger ("paused itself — runs went unopened") instead of a generic "paused"; scheduled output NEVER touches conversations (origin decides the surface)',
    src('app/api/workflows/runs/reviewed/route.ts').includes("is('reviewed_at', null)") &&
    src('components/workflows/workflows-ledger.tsx').includes('markReviewed') &&
    src('components/workflows/workflows-ledger.tsx').includes("tab === 'activity') markReviewed()") &&
    src('components/workflows/workflows-ledger.tsx').includes('paused itself — runs went unopened') &&
    src('app/api/rooms/recent/route.ts').includes('workflowsUnread') &&
    src('components/one/one-sidebar.tsx').includes('workflowsUnread') &&
    src('app/api/rooms/recent/route.ts').includes(".is('workflow_id', null)"));

  check('CS2: THE ONE CREATION CARD (coherence slice #2, Aug 10) — one intent, one card, one home: coworker create_task DRAFTS (marker in the tool result — parsed runtime-side on BOTH runtimes, never model-echoed base64) and inserts NOTHING (saying prepares, committing stays explicit — E2E-proven on the probe: draft parsed, agent_id + token riding, zero rows); the Home chief\'s global propose renders the SAME card INLINE (no room pointer, no "which project?" dead end — cards travel, objects don\'t); Confirm fires the ONE create door (POST /api/workflows, where adoption lives); a confirmed card is a receipt across reloads (token-consumed), linking the ledger; the still-active /workers chat renders the card too',
    src('lib/tools/worker-tasks.ts').includes('encodeWorkflowDraftMarker') &&
    (() => { const wt = src('lib/tools/worker-tasks.ts');
      const body = wt.slice(wt.indexOf('export async function executeCreateTask'), wt.indexOf('export async function executeGetTask'));
      return body.includes('encodeWorkflowDraftMarker') && !body.includes('.insert('); })() &&
    src('lib/workflows/draft-marker.ts').includes('parseWorkflowDraftMarker') &&
    src('app/api/work/threads/[id]/chat/route.ts').includes("send({ type: 'workflow_draft'") &&
    src('lib/work/agentos-bridge.ts').includes('parseWorkflowDraftMarkerB') &&
    src('lib/converse/index.ts').includes('workflowDraft: { ...g, token:') &&
    src('app/api/home/ask/route.ts').includes('turn.workflowDraft') &&
    src('components/workflows/workflow-draft-card.tsx').includes('Confirm — it goes live') &&
    src('components/workflows/workflow-draft-card.tsx').includes('aug-wfdraft-done') &&
    src('components/home/home-ask.tsx').includes('WorkflowDraftCard') &&
    src('components/workers/tabs/worker-chat-tab.tsx').includes('WorkflowDraftCard'));

  check('CS3: THE TEAM FACEPILE (coherence slice #4, Aug 10) — presence in the sidebar FOOTER (global chrome; deliberately NOT the island — views-of-here — and NOT nav): facepile → ONE popover with a line of REAL state per coworker (read from run checkpoints: "Running X · step 3 of 13" / "Delivered N today" / "Ready"), a Chat verb (opens the DM conversation through the same door as addressing by name), and the Settings→Team door; Settings→Team already carries roster + per-worker Tools + Knowledge&skills + the library (slice #3, verified standing)',
    src('app/api/workers/presence/route.ts').includes('step ') &&
    src('components/one/one-sidebar.tsx').includes('Your team') &&
    src('components/one/one-sidebar.tsx').includes('aug:dm-worker') &&
    src('components/one/one-sidebar.tsx').includes('Manage in Settings') &&
    src('components/home/home-ask.tsx').includes("addEventListener('aug:dm-worker'") &&
    src('components/settings/team-section.tsx').includes('WorkerToolsTab') &&
    src('components/settings/team-section.tsx').includes('SkillsLibraryView'));

  check('CS4: /WORKERS IS RETIRED (coherence slice #5, Aug 10 — the kill list, closed) — the route redirects; OLD DEEP LINKS KEEP WORKING (?worker&thread → the Home conversation opener, so every report-back email ever sent still lands somewhere true); every link GENERATOR repointed (run links, standing narrations, the rail\'s artifact chip, the registry card) to /home?chat=worker:…; the seam door opens worker: keys; entry/fallback redirects land on /home (join · suspended · onboarding · feature gates); Studio\'s default way back is the ledger; the Home\'s "From your team" feed DIED (origin decides the surface — Runs+badge · deck debt · conversations · the facepile carry its jobs)',
    src('app/(main)/workers/page.tsx').includes('redirect(`/home?chat=worker:') &&
    src('components/home/home-ask.tsx').includes("chatParam?.startsWith('worker:')") &&
    src('lib/workflows/run-workflow.ts').includes('/home?chat=worker:') &&
    src('lib/workflows/standing.ts').includes('/home?chat=worker:') &&
    src('components/home/item-rail.tsx').includes('/home?chat=worker:') &&
    !src('components/home/home-view.tsx').includes('<TeamFeed') &&
    src('app/studio/studio-page-client.tsx').includes("backTo ?? '/home?view=workflows'") &&
    src('app/onboarding/page.tsx').includes("redirect('/home')"));

  check('CS5: THE CONVERGENCE KIT + THE DAY-STATE BLOCK (initiative loop STEP 0, Aug 10 — "facts are shared everywhere; depth stays with the role") — ONE compact judged day-state (derived from the SAME spine the deck renders, cached 10 min, ~500 chars) injected into BOTH worker runtimes so a DM answer about the day can never contradict the deck/chief; DM mode is LEGIBLE (persistent "Chat with X" header · "Message X…" placeholder · mention copy says what it does there) and gets New session (fresh thread, relationship persists); an empty DM opens with the narrator line, never a dead click',
    src('lib/home/day-state.ts').includes('getSharedDayState') &&
    src('lib/home/day-state.ts').includes('buildWorkItems') &&
    src('lib/home/day-state.ts').includes('day_state') &&
    src('app/api/work/threads/[id]/chat/route.ts').includes('getSharedDayState') &&
    src('lib/work/agentos-bridge.ts').includes('getSharedDayState') &&
    src('components/home/home-ask.tsx').includes('Message Clara') === false && // dynamic, never hardcoded
    src('components/home/home-ask.tsx').includes('workerRoomRef.current ? `Message ') &&
    src('components/home/home-ask.tsx').includes('New session') &&
    src('components/home/home-ask.tsx').includes('This is your direct line to'));

  check('AN1: THE ANTICIPATION PASS (the initiative loop, Aug 10) — proactivity beyond arrivals: the pass walks TIME (meetings next 36h linked to a room → the prep brief EXISTS before the ask, one reasoned pass over the room page, narrated with its BECAUSE line leading; due-soon ≤48h unprepared → the SAME judge-gated prepareOneItem runs early — anticipation moves the clock, never bypasses the judge); trust rules structural: hard caps per run, 6h self-gate, exactly-once fire records, silence is a valid verdict; the "Prep ready" chip on This-week opens the room where the prep waits. E2E on the probe: brief fired + because leads + chip resolves + TTL gate + fire dedupe all held',
    src('lib/home/anticipation.ts').includes('runAnticipationPass') &&
    src('lib/home/anticipation.ts').includes('MAX_BRIEFS_PER_RUN') &&
    src('lib/home/anticipation.ts').includes('because') &&
    src('lib/home/anticipation.ts').includes('prepareOneItem') &&
    src('app/api/home/brief/route.ts').includes('runAnticipationPass') &&
    src('app/api/home/horizon/route.ts').includes('prepReadyEvents') &&
    src('components/home/home-view.tsx').includes('Prep ready'));

  check('CS6: THE WORKFLOWS TIDY (trailing items, Aug 10) — workflow_notifications writes DIED with the feed that read them (deliveries → Runs + badge; failures → deck debt; the opted-in Slack DM stays); "digest" retired from generated configs (back-compat reads stay); a REACTION said in a project room falls through to the one creation card instead of a cron-only "can\'t set that up" (steer passes workflowDraft; the rail renders the same card); teammates\' shared workflows list read-only in the ledger with owner attribution; the box\'s create_task docstring says DRAFT-for-confirm (never "created")',
    !src('lib/workflows/run-workflow.ts').includes("from('workflow_notifications').insert") &&
    src('lib/workflows/generate-config.ts').includes('"digest" is retired') &&
    src('lib/converse/index.ts').includes('falls through to the one creation card') &&
    src('app/api/items/steer/route.ts').includes('turn.workflowDraft') &&
    src('components/home/item-rail.tsx').includes('WorkflowDraftCard') &&
    src('app/api/workflows/ledger/route.ts').includes('TEAMMATES') &&
    src('components/workflows/workflows-ledger.tsx').includes('Team workflows') &&
    src('infra/agentos/tools_tasks.py').includes('NEVER say') &&
    src('infra/agentos/tools_tasks.py').includes('DRAFT a scheduled automation task'));

  check('AN2: THE SILENCE WATCH (the initiative loop, Aug 10) — absence as an event: a counterparty who OWES the user, quiet ≥7 days (the check is REAL — any voice on the thread inside the window skips, so a recent reply OR the user\'s own recent chase both stand down), gets the judge-gated chase machinery on their item (quiet ≠ settled; anticipation never bypasses the judge); re-fires only after another full quiet window; hard cap per run. E2E on the probe: a 10-day-quiet awaiting commitment fired one chase with its because ("owes you and the thread has been quiet ~10 days"); the re-fire window held',
    src('lib/home/anticipation.ts').includes('THE SILENCE WATCH') &&
    src('lib/home/anticipation.ts').includes('QUIET_DAYS') &&
    src('lib/home/anticipation.ts').includes('MAX_CHASES_PER_RUN') &&
    src('lib/home/anticipation.ts').includes("direction', 'awaiting'") &&
    src('lib/home/anticipation.ts').includes('someone spoke recently') &&
    src('lib/home/anticipation.ts').includes('quiet ~'));

  // ── AO · ARTIFACTS-INTO-ORIGIN (proactivity completion #1, Aug 9). ──
  check('AO1: THE DISPATCHED DELIVERABLE COMES HOME — substantial delegated production materializes as a REAL document artifact on the delegation thread (the SAME textToDocContent/uploadArtifact primitives as workflow runs — one shared module, run-workflow imports it too, never two diverging copies); the artifact rides the ConverseTurn back into the conversation that asked (Home chat renders its card AND opens the viewer; the room rail carries the door chip); a short answer or an ask stays text. E2E-proven live on the probe: real .docx in storage, card on the turn',
    src('lib/workflows/doc-content.ts').includes('export function textToDocContent') &&
    src('lib/workflows/run-workflow.ts').includes("from '@/lib/workflows/doc-content'") &&
    src('lib/home/delegate.ts').includes('ARTIFACTS-INTO-ORIGIN') &&
    src('lib/home/delegate.ts').includes('output.length >= 600') &&
    src('lib/converse/index.ts').includes('artifact: { ...out.artifact, agentName') &&
    src('app/api/home/ask/route.ts').includes('turn.artifact') &&
    src('app/api/items/steer/route.ts').includes('turn.artifact') &&
    src('components/home/home-ask.tsx').includes('void openArtifact(d.artifact.threadId, d.artifact.id)') &&
    src('components/home/item-rail.tsx').includes('d.artifact?.id'));

  check('AO2: THE ADDRESSED-COWORKER FLOOR (found live: "Sofia, put together…" became a to-do on the user\'s OWN plate) — a message OPENING with a real coworker\'s name IS a hand-off (deterministic, roster-read, never a hardcoded name list), and a delegate verdict OUTRANKS a command verdict (the classifier returned BOTH and the command fast-path ran first — the second face of the same bug)',
    src('lib/converse/index.ts').includes('THE ADDRESSED-COWORKER FLOOR') &&
    src('lib/converse/index.ts').includes("eq('is_worker', true)") &&
    src('lib/converse/index.ts').includes('if (verdict.delegate) verdict.command = null;'));

  // ── CH · CONVERSE HISTORY (the amnesia class, Aug 10 — found live: "yes please" → "I don't
  // have enough context"; a reformat request couldn't see the answer it was reformatting; the
  // honesty-floor pointer rode a format exchange as a non-sequitur). ──
  check('CH1: THE PANEL TRANSCRIPT — the chat panel\'s own conversation reaches EVERY converse path, not just the question path: the router classifies with it, the agent loop carries it as REAL messages (full fidelity, never a squeezed grounding block), and a delegation hand-off carries the conversation so a task worded "do it" resolves. E2E replay of the live four-turn failure: scripts/smoke-converse-history.ts (reformat delivered · "yes please" resolved · "ask sofia to do it" delegated to Sofia)',
    src('lib/converse/index.ts').includes('function panelTranscript') &&
    src('lib/converse/index.ts').includes('[dlg.transcript, panelTranscript(opts.history)]') &&
    src('lib/converse/index.ts').includes('classifyTurn(client, userId, scope,') &&
    src('lib/converse/index.ts').includes('materialNames ? `${text}') &&
    src('lib/converse/index.ts').includes('...(history ?? []).slice(-8).map((t) => ({ role: t.role, content:') &&
    src('lib/converse/index.ts').includes('THE CONVERSATION THIS CAME FROM') &&
    src('lib/converse/index.ts').includes('verdict.delegate.task, text, transcript, material)'));

  check('CH2: THE HONESTY-FLOOR MISFIRE GATE — the registry pointer is a RECALL rescue: it fires only when the DENIAL SENTENCE itself names something the registry holds; a capability/format denial whose message merely contains project names never grows a "(a known body of work)" pointer; plural matches get plural grammar',
    src('lib/converse/index.ts').includes('THE MISFIRE GATE') &&
    src('lib/converse/index.ts').includes('denialNamesEntity') &&
    src('lib/converse/index.ts').includes('DENIAL_RE.test(s)') &&
    src('lib/converse/index.ts').includes('Their work lives on those projects'));

  check('CH3: DRAG-AND-DROP ATTACH on every chat box — the ONE composer (WorkerMentionInput: Home chat, room rail, coworker DM) and the legacy /work ChatInputBar both accept dropped files through the SAME onAttach door as the paperclip (same accepted types, same cap), with a visible drop overlay; a depth counter survives child enter/leave churn',
    src('components/workers/worker-mention-input.tsx').includes('DRAG-AND-DROP ATTACH') &&
    src('components/workers/worker-mention-input.tsx').includes('Drop files to attach') &&
    src('components/workers/worker-mention-input.tsx').includes('DROP_CLAIMED') &&
    src('components/work/chat-input-bar.tsx').includes('Drop files to attach') &&
    src('components/work/chat-input-bar.tsx').includes('MAX_ATTACHMENTS - attachments.length'));

  check('CH4: THE PRODUCTION HAND-OFF (found live: a pasted questionnaire + "please fill this in" returned the bare "I couldn\'t finish that one." while a competitor returned a finished document) — (1) THE PASTE CEILING DIED: the Home ask door accepts 20k chars (was a silent slice(0,500) — the brain answered a request it never saw) and the steer door matches; route budget 180s so a synchronous hand-off is never killed; (2) production without a named coworker DELEGATES to the fit (classifier rule); (3) loop exhaustion = the work + full material handed to Sofia automatically, never a shrug; (4) the delegation prompt mandates [CONFIRM: …] slots inside deliverables — a marked slot beats a dropped question; (5) long pastes collapse in the bubble (presentation only); the filing nudge never decorates an empty answer. E2E replay T5: delegated=Sofia, real artifact, 27 [CONFIRM] marks',
    src('app/api/home/ask/route.ts').includes('slice(0, 20000)') &&
    src('app/api/home/ask/route.ts').includes('maxDuration = 180') &&
    src('app/api/items/steer/route.ts').includes('slice(0, 20000)') &&
    src('lib/converse/index.ts').includes('AND for PRODUCED work') &&
    src('lib/converse/index.ts').includes('THE EXHAUSTION HAND-OFF') &&
    src('lib/converse/index.ts').includes('exhausted: !applied.length') &&
    src('lib/home/delegate.ts').includes('[CONFIRM: <what\'s needed>]') &&
    src('components/home/home-ask.tsx').includes('function UserBubble') &&
    src('app/api/home/ask/route.ts').includes('focus && turn.say?.trim()'));

  check('CH5: THE ATTACHED MATERIAL + TOKEN STREAMING + THE FORMAT-FLOOR FIX (Aug 10 night) — (1) attachment text extracts SYNCHRONOUSLY (/api/home/extract-attach) and rides the ask itself: the classifier sees the names, the loop carries the material as its own turn, a delegation carries it whole — never a race against KB background indexing (E2E T6: delegated with material); (2) the agent loop STREAMS its answer (content deltas → SSE token events → the live preview; done stays authoritative; NUL sentinel clears pre-tool preamble; 15s SSE ping keeps long hand-offs alive) — E2E T7 streams >40 chars through the loop\'s exact client+tools; (3) aiCreate strips response_format json_object for Anthropic endpoints (their compat API began rejecting it — 400 "Input should be json_schema" — which broke EVERY json-shaped call routed to Claude, incl. the Home question path); (4) attach doors accept everything the extractor reads (pptx/xlsx/csv/doc added server + composers + presign extension-fallback for unreliable browser mimes) and the WHOLE WINDOW is the drop zone (a missed drop never navigates away); rejected files say so out loud',
    src('app/api/home/extract-attach/route.ts').includes('extractTextFromAttachment') &&
    src('lib/converse/index.ts').includes('THE ATTACHED MATERIAL') &&
    src('lib/converse/index.ts').includes('material I attached') &&
    src('lib/converse/index.ts').includes('onToken(delta.content)') &&
    src('app/api/home/ask/route.ts').includes("{ type: 'token', t }") &&
    src('app/api/home/ask/route.ts').includes("send({ type: 'ping' })") &&
    src('lib/ai/factory.ts').includes("includes('anthropic.com')") &&
    src('app/api/work/threads/[id]/chat-attach/route.ts').includes('presentationml.presentation') &&
    src('app/api/drive/upload/presign/route.ts').includes('MIME_BY_EXT') &&
    src('components/workers/worker-mention-input.tsx').includes("window.addEventListener('drop'") &&
    src('components/work/chat-input-bar.tsx').includes("window.addEventListener('drop'") &&
    src('components/home/home-ask.tsx').includes('liveText'));

  // ── SV · THE SOVEREIGN DOOR (the corporate tier, Aug 10 — leak audit first). ──
  check('SV1: THE SOVEREIGN LEAK AUDIT — a workspace with the email feature OFF has NO mailbox-auth surface: the Home first look pivots to the agent-team CTA (brief serves mail.emailFeature; the connect-inbox branch requires it), Settings hides the Email tab AND bounces direct ?tab=email navigation, /inbox stays feature-guarded (guardFeaturePage), the sidebar Inbox source stays feature-gated, and the CHIEF\'S TOOLSET drops mailbox verbs (get_emails/send_prepared_reply/prepare_forward mapped to the email feature in the ONE map; agentLoop filters its defs) — the model cannot offer what the workspace does not hold. Workflow email SENDING (Resend, stated addresses) stays — the boundary is auth connections only. E2E on the probe workspace: flag flip propagated through getWorkspaceFeatures and restored',
    src('app/api/home/brief/route.ts').includes('emailFeature: feats?.email !== false') &&
    src('components/home/home-view.tsx').includes('mail.emailFeature === false') &&
    src('components/home/home-view.tsx').includes('Set up your agent team') &&
    src('app/(main)/settings/page.tsx').includes("tab === 'email' && !emailEnabled") &&
    src('components/settings/settings-left-panel.tsx').includes("emailEnabled || item.id !== 'email'") &&
    src('app/(main)/inbox/page.tsx').includes("guardFeaturePage('email')") &&
    src('components/one/one-sidebar.tsx').includes('features.email && (') &&
    src('lib/workspace/tool-capabilities.ts').includes("send_prepared_reply: 'email'") &&
    src('lib/converse/index.ts').includes('toolDefs = CHIEF_TOOL_DEFS.filter'));

  check('SV2: THE BRANDED ENTRY + THE SAFE-DATA MARK — app.augmtd.ai/<slug> is a client\'s own front door (root catch-all; route precedence keeps real routes ahead; unknown slug → /login): co-branded header (client logo from companies.settings.branding × ours), email+password ONLY (no OAuth anywhere on the page), the three steps visible (email → password & workspace code → set up your agents); an authed non-member skips to the code step; a member bounces /home; signup email-confirm returns to the SAME landing (auth/callback ?next=, relative paths only). The sidebar carries the co-brand logo and the sovereign footer mark ("Private environment", email-feature-off workspaces). Verified live: unauthenticated 200 with name+steps+mark, unknown slug 307 → /login, authed non-member renders the code step (screenshot)',
    src('app/[slug]/page.tsx').includes("ilike('slug', slug)") &&
    src('app/[slug]/page.tsx').includes("mode = 'code'") &&
    src('components/auth/corporate-entry.tsx').includes('Set up your agents') &&
    !src('components/auth/corporate-entry.tsx').includes('signInWithOAuth') &&
    src('components/auth/corporate-entry.tsx').includes('auth/callback?next=/') &&
    src('app/auth/callback/route.ts').includes("next.startsWith('/') && !next.startsWith('//')") &&
    src('components/one/one-sidebar.tsx').includes('brandLogo') &&
    src('components/one/one-sidebar.tsx').includes('Private environment') &&
    src('app/(main)/layout.tsx').includes('sovereign = features.email === false'));

  check('SV3: THE PLATFORM-ADMIN SOVEREIGN CONTROLS — spinning up a corporate client is a two-minute operation: THE CORPORATE SWITCH per workspace row (one click = email feature OFF = the sovereign mode; emerald shield when on, with plain-language tooltips both ways); THE BRANDED-ENTRY editor in the expanded row (entry link app.augmtd.ai/<slug> click-to-copy · client logo URL · tagline → PATCH merges settings.branding, never clobbering other settings; logo validated URL-or-app-path); alignment: the vestigial Home feature pill hidden (nothing gates on it; key kept for stored data), bg-primary-* tokens replaced with the kit\'s indigo. NOTE: visually verified by the owner\'s superadmin login (the dedicated superadmin account is not available to automation)',
    src('app/platform-admin/platform-admin-client.tsx').includes('THE CORPORATE SWITCH') &&
    src('app/platform-admin/platform-admin-client.tsx').includes("handleToggleFeature(company.id, 'email', company.features.email === false)") &&
    src('app/platform-admin/platform-admin-client.tsx').includes('function BrandingEditor') &&
    src('app/platform-admin/platform-admin-client.tsx').includes("FEATURE_KEYS.filter(k => k !== 'home')") &&
    !src('app/platform-admin/platform-admin-client.tsx').includes('bg-primary-50') &&
    src('app/api/platform-admin/companies/[id]/route.ts').includes('branding') &&
    src('app/api/platform-admin/companies/[id]/route.ts').includes('never replacing other settings'));

  // ── Report ──
  let pass = 0;
  for (const [n, ok, d] of out) {
    console.log(`${ok ? '✓' : '✗'} ${n}${!ok && d ? ` — ${d}` : ''}`);
    if (ok) pass++;
  }
  console.log(`\n${pass}/${out.length} gates`);
  process.exit(pass === out.length ? 0 : 1);
})();
