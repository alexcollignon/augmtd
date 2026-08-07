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
    src('components/one/all-conversations.tsx').includes("c.key.startsWith('inbox:') ? 'email'") &&
    src('components/one/all-conversations.tsx').includes("c.key.startsWith('commitment:') ? 'task'"));
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
    src('components/home/home-ask.tsx').includes('if (!autoOpened) { autoOpened = true;') &&
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

  // ── Report ──
  let pass = 0;
  for (const [n, ok, d] of out) {
    console.log(`${ok ? '✓' : '✗'} ${n}${!ok && d ? ` — ${d}` : ''}`);
    if (ok) pass++;
  }
  console.log(`\n${pass}/${out.length} gates`);
  process.exit(pass === out.length ? 0 : 1);
})();
