// ─── DEMO SEED for the owner's CV-TRIAGE whiteboard walk (v3, Aug 24) ────────────────────────
// TEMPORARY, never committed. Seeds ONE scenario on the OWNER'S real account — the whiteboard,
// end to end, inside current engine capabilities:
//
//   "CV Triage — Acme Group" (parent) + "Interview process — Acme" (child)
//
//   1. AN APPLICATION COMES IN     → three doors on the parent: the mail door (zero-AI filters:
//      sender domain + subject contains "application"), the FILE door (a judged "the file is a
//      candidate CV" — the door this seed exercises, three times), and the LOOP door (the child's
//      delivery re-fires the triage — René's cycle, by composition).
//   2. AUGMTD LINKS IT TO THE OPENING → the `case` station files each application under the job
//      opening it names. Two applications name the SAME opening, so run 2 MATCHES run 1's record:
//      that accumulation is what the comparison then reads.
//   3. AI CREATES THE COMPARISON   → grounded in the Hiring Policy pinned in the WORKS WITH tray,
//      and in every application already filed under the opening.
//      → YOUR APPROVAL             → the station parks the run and CARRIES ITS OBJECT (the
//        comparison rides the decision card, so the approver reads the work being gated).
//   4. THE INTERVIEW LEG (⧉)       → the child runs its own rail: interview questions grounded in
//      the pinned Interview Policy → a PREPARED scheduling email → the interview outcome. Its
//      delivery re-fires the parent through the loop door, and the outcome files under the SAME
//      opening.
//   5. AI PREPARES THE DECISION    → the internal decision record + the drafted email to the
//      advancing candidate + the decline drafts, delivered as a FRAME (output artifact_type
//      'frame' → the one production door's TIER 0 → the frame SERIES: one stable head per
//      workflow, versions underneath).
//
//   TWO SIMPLIFICATIONS, SPOKEN (not hidden):
//     · ONE approval, not the whiteboard's two. The engine's approval station is a single human
//       gate; the second (post-interview) decision rides the same one after the loop.
//     · The winner/loser emails are DRAFTS INSIDE THE GATED DELIVERABLE, never sends. Workflow
//       email sending exists, but THE HUMAN-IN-THE-LOOP LAW says no send fires without approval,
//       so for the walk the drafts live where the approver reads them.
//
// Run:   npx tsx --env-file=.env.local scripts/demo-processes-walk.ts
// Clean: npx tsx --env-file=.env.local scripts/demo-processes-walk.ts --clean
import { createClient } from '@supabase/supabase-js';
import { runWorkflow } from '../lib/workflows/run-workflow';

const DEMO_TAG = 'demo: processes walk';
/** Every knowledge doc this demo seeds wears this provider_file_id prefix — the teardown's handle. */
const DEMO_KB_PREFIX = 'demo-cv-triage/';
const OWNER_EMAIL = 'alextcollignon@gmail.com';
const RILEY_EMAIL = 'riley.demo@augmtd-internal.test';

const PARENT_NAME = 'CV Triage — Acme Group';
const CHILD_NAME = 'Interview process — Acme';
/** The clean is SCOPED to this demo's own two workflows — nothing else tagged is touched. */
const DEMO_NAMES = [PARENT_NAME, CHILD_NAME];

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const owner = users?.users?.find(u => u.email === OWNER_EMAIL);
  if (!owner) throw new Error('owner not found');

  // ── CLEAN (also the pre-flight for a reseed: idempotent, name-scoped, nothing else touched) ──
  /** Returns the ids it deleted, keyed by workflow name — a reseed REUSES them, so the walk's
   *  links (and the ids quoted in any brief) survive a clean+reseed cycle. */
  const clean = async (): Promise<Map<string, string>> => {
    const { data: wfs } = await admin.from('workflows').select('id, name')
      .eq('user_id', owner.id).eq('description', DEMO_TAG).in('name', DEMO_NAMES);
    const priorIds = new Map<string, string>();
    for (const w of (wfs ?? []) as Array<{ id: string; name: string }>) priorIds.set(w.name, w.id);
    const wfIds = [...priorIds.values()];
    if (wfIds.length) {
      // THE CASE REGISTRY GOES WITH THE DEMO. A demo must not leave `work_entities` rows behind —
      // the founded openings are read FROM THE INDEX before the index is deleted (after that there
      // is no way to find them). Everything hanging off a case goes with it.
      const caseEntityIds = new Set<string>();
      for (const wid of wfIds) {
        const { data: idx } = await admin.from('item_plans').select('entity_id')
          .eq('user_id', owner.id).eq('kind', 'workflow_case').like('entity_id', `${wid}:%`);
        for (const r of (idx ?? []) as Array<{ entity_id: string }>) {
          const eid = String(r.entity_id).slice(wid.length + 1);
          if (eid) caseEntityIds.add(eid);
        }
        for (const kind of ['workflow_case', 'reaction_fire'] as const) {
          await admin.from('item_plans').delete().eq('user_id', owner.id).eq('kind', kind).like('entity_id', `${wid}:%`);
        }
        for (const kind of ['workflow_limit', 'workflow_inputs', 'workflow_scope'] as const) {
          await admin.from('item_plans').delete().eq('user_id', owner.id).eq('kind', kind).eq('entity_id', wid);
        }
      }
      for (const eid of caseEntityIds) {
        await admin.from('entity_links').delete().eq('user_id', owner.id).eq('entity_id', eid);
        await admin.from('knowledge_files').update({ entity_id: null }).eq('user_id', owner.id).eq('entity_id', eid);
        await admin.from('room_turns').delete().eq('user_id', owner.id).eq('room_key', eid);
        await admin.from('item_plans').delete().eq('user_id', owner.id).eq('entity_id', eid);
        await admin.from('work_entities').delete().eq('user_id', owner.id).eq('id', eid);
      }
      if (caseEntityIds.size) console.log(`cleaned: ${caseEntityIds.size} founded case entities`);
      const { data: runs } = await admin.from('workflow_runs').select('id, thread_id').in('workflow_id', wfIds);
      const runIds = (runs ?? []).map(r => r.id as string);
      const threadIds = new Set<string>();
      for (const r of runs ?? []) if (r.thread_id) threadIds.add(r.thread_id as string);
      // The frame SERIES lives on the workflow's one persistent thread, which outlives any single
      // run — so the thread sweep is keyed on the workflow too, not only on the runs.
      const { data: wfThreads } = await admin.from('work_threads').select('id').in('workflow_id', wfIds);
      for (const t of (wfThreads ?? []) as Array<{ id: string }>) threadIds.add(t.id);
      for (const tid of threadIds) {
        // Artifact FILES + share rows go with their thread (frames live as storage objects, and a
        // frame_share row would otherwise keep serving a deleted demo frame's 404 forever).
        const { data: th } = await admin.from('work_threads').select('artifacts').eq('id', tid).maybeSingle();
        const arts = (th?.artifacts ?? []) as Array<{ id?: string; storage_path?: string; versions?: Array<{ storagePath?: string }> }>;
        const paths = [
          ...arts.map(a => a.storage_path),
          ...arts.flatMap(a => (a.versions ?? []).map(v => v.storagePath)),
        ].filter(Boolean) as string[];
        if (paths.length) await admin.storage.from('work-artifacts').remove(paths);
        const artIds = arts.map(a => a.id).filter(Boolean) as string[];
        if (artIds.length) await admin.from('item_plans').delete().eq('user_id', owner.id).eq('kind', 'frame_share').in('entity_id', artIds);
        await admin.from('work_messages').delete().eq('thread_id', tid);
        await admin.from('work_threads').delete().eq('id', tid);
      }
      await admin.from('workflow_notifications').delete().in('workflow_id', wfIds);
      if (runIds.length) {
        const { data: cs } = await admin.from('commitments').select('id, user_id').eq('source', 'handoff').in('source_id', runIds);
        for (const c of cs ?? []) {
          await admin.from('room_turns').delete().eq('user_id', c.user_id).like('room_key', `%${c.id}%`);
          await admin.from('commitments').delete().eq('id', c.id);
        }
        for (const rid of runIds) {
          await admin.from('item_plans').delete().eq('kind', 'handoff_nudge').like('entity_id', `${rid}%`);
          await admin.from('item_plans').delete().eq('kind', 'handoff_override').like('entity_id', `${rid}%`);
          await admin.from('item_plans').delete().eq('user_id', owner.id).eq('kind', 'run_case').eq('entity_id', rid);
          await admin.from('item_plans').delete().eq('user_id', owner.id).eq('kind', 'subprocess_link').like('entity_id', `${rid}%`);
          // The run rooms (comments + decision narrations) live under the CREATOR.
          await admin.from('room_turns').delete().eq('user_id', owner.id).eq('room_key', `run:${rid}`);
        }
        await admin.from('workflow_runs').delete().in('id', runIds);
      }
      // The approval park opens a STANDING commitment on the workflow (narrateApprovalAsk →
      // openStandingCommitment) and narrates the decision cards into ITS room. Both go.
      const { data: standing } = await admin.from('commitments').select('id, user_id').eq('source', 'workflow').in('source_id', wfIds);
      for (const s of (standing ?? []) as Array<{ id: string; user_id: string }>) {
        await admin.from('room_turns').delete().eq('user_id', s.user_id).like('room_key', `%${s.id}%`);
        await admin.from('commitments').delete().eq('id', s.id);
      }
      for (const wid of wfIds) {
        await admin.from('item_plans').delete().eq('user_id', owner.id).eq('kind', 'workflow_owner').eq('entity_id', wid);
        await admin.from('activity_events').delete().eq('user_id', owner.id).eq('type', 'workflow_owner_changed').eq('entity_id', wid);
        await admin.from('ai_usage_events').delete().eq('user_id', owner.id).eq('workflow_id', wid);
      }
      await admin.from('workflows').delete().in('id', wfIds);
    }
    // The knowledge docs (the two pinned policies + the three applications) — tag-scoped by their
    // provider_file_id prefix, so this stands even if the workflows were already gone.
    {
      const { data: kb } = await admin.from('knowledge_files').select('id')
        .eq('user_id', owner.id).like('provider_file_id', `${DEMO_KB_PREFIX}%`);
      const kbIds = (kb ?? []).map(f => f.id as string);
      if (kbIds.length) {
        await admin.from('knowledge_chunks').delete().in('file_id', kbIds);
        await admin.from('entity_links').delete().eq('user_id', owner.id).eq('item_kind', 'knowledge_file').in('item_id', kbIds);
        await admin.from('knowledge_files').delete().in('id', kbIds);
        console.log(`cleaned: ${kbIds.length} demo knowledge docs`);
      }
    }
    console.log(`cleaned: ${wfIds.length} demo workflows + fixtures`);
    return priorIds;
  };

  if (process.argv.includes('--clean')) {
    await clean();
    // Riley Demo was the assignee of the retired A–E scenarios. Nothing here uses her; the
    // teardown stays so a `--clean` still removes the demo member from the real workspace.
    const riley = users?.users?.find(u => u.email === RILEY_EMAIL);
    if (riley) {
      await admin.from('company_members').delete().eq('user_id', riley.id);
      await admin.from('profiles').delete().eq('id', riley.id);
      await admin.auth.admin.deleteUser(riley.id);
      console.log('Riley Demo removed');
    }
    return;
  }

  // A reseed starts from zero — yesterday's set goes first, and its IDS COME BACK.
  const priorIds = await clean();

  const { data: workers } = await admin.from('custom_agents').select('id, name, worker_role')
    .eq('user_id', owner.id).eq('is_worker', true).eq('is_active', true);
  const clara = (workers ?? []).find(w => w.worker_role === 'personal_assistant')?.id ?? null;

  const mk = async (name: string, agentId: string | null, trigger: object, steps: object[], extra: Record<string, unknown> = {}) => {
    const prior = priorIds.get(name);   // STABLE IDENTITY across clean+reseed.
    const { data, error } = await admin.from('workflows').insert({
      ...(prior ? { id: prior } : {}),
      user_id: owner.id, name, description: DEMO_TAG, status: 'active',
      trigger, steps, agent_id: agentId,
      output_config: { destination: 'message', report_mode: 'each_run' },
      ...extra,
    }).select('id').single();
    if (error || !data) throw new Error(`${name}: ${error?.message}`);
    return data.id as string;
  };
  const say = (id: string, label: string, text: string) =>
    ({ type: 'ai', id, label, model_tier: 'fast', output_format: 'markdown', prompt: `Output exactly the following text and nothing else:\n${text}` });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // THE RELAY CANVAS, END TO END. The child seeds FIRST — the parent's ⧉ station and its loop
  // door both need its id.
  //
  // THE SEAM CHOICE (recorded on purpose): the three applications arrive through the FILE door,
  // not through Run-now material. Material carries NO ATOM, so a material-seeded case would file
  // nothing and the case would stand empty — the accumulation the demo exists to show. A file
  // event does carry an atom, so this seeder mirrors the file door exactly: a real
  // `knowledge_files` row + the real `reaction_fire` record keyed to the run, then runWorkflow on
  // that run id. The case step then finds the atom the way a live fire would.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const { getOrCreateUploadSource } = await import('../lib/knowledge/indexer');
  const { writeWorkflowInputs, readWorkflowInputs } = await import('../lib/workflows/inputs');
  const { doorsForServing } = await import('../lib/workflows/trigger-sources');
  const { readCaseIndex, RUN_CASE_KIND } = await import('../lib/workflows/case-step');
  const uploadSourceId = await getOrCreateUploadSource(owner.id, admin);

  const mkKb = async (filename: string, text: string, summary: string) => {
    const { data, error } = await admin.from('knowledge_files').insert({
      user_id: owner.id, source_id: uploadSourceId,
      provider_file_id: `${DEMO_KB_PREFIX}${filename}`,
      filename, mime_type: 'text/plain', extracted_text: text, summary,
      indexed_at: new Date().toISOString(),
    }).select('id').single();
    if (error || !data) throw new Error(`kb "${filename}": ${error?.message}`);
    return data.id as string;
  };

  // ── THE CHILD — the real interview leg (three stations, one pinned policy) ──
  const wfFChild = await mk(CHILD_NAME, clara, { type: 'manual' }, [
    { type: 'ai', id: 'step_fc1', label: 'Prepare the interview questions', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'The candidate advancing to interview is named in the material above (the triage handed ' +
        'this process its comparison). Using ONLY the Interview Policy pinned to this workflow and ' +
        'what the comparison says about this candidate, write the interview plan: the panel, the ' +
        'timebox, and 6 questions — each one aimed at a specific claim or gap in their application. ' +
        'Name the candidate. Under 250 words. No new facts about the person.' },
    { type: 'ai', id: 'step_fc2', label: 'Draft the scheduling email', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'Draft (DO NOT SEND — this is a draft the human will review) the scheduling email to the ' +
        'candidate named above: subject line, then the body, offering the interview and two time ' +
        'windows next week, naming the panel and the format from the plan above. Sign it as the ' +
        'Acme Group hiring team. Head the block "PREPARED EMAIL — SCHEDULING (draft, not sent)".' },
    say('step_fc3', 'Record the interview outcome',
      'INTERVIEW OUTCOME — Senior Data Analyst (Acme Group)\n\n' +
      'Candidate: Maria Voss\nPanel: hiring manager + data lead\n\n' +
      'Strong SQL and dbt; walked the panel through a real warehouse migration end to end.\n' +
      'Communication clear, stakeholder examples concrete.\n' +
      'Gap: no dashboarding tool in the last two years — closeable in weeks.\n\n' +
      'Recommendation: ADVANCE to final round.'),
  ], { output_config: { destination: 'document', report_mode: 'each_run' } });

  // ── THE PARENT. Doors are authored to DISPLAY the full W1+W5 grammar; only the file door is
  // exercised by the seed (the mail door needs real mail, the loop door needs the child to run). ──
  const wfF = await mk(PARENT_NAME, clara, { type: 'manual' }, [
    { type: 'case', id: 'step_f1', label: 'File it under its record',
      case_instruction: 'the job opening named in the application' },
    { type: 'ai', id: 'step_f2', label: 'AI creates the comparison', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'One arriving application (the triggering event) against the hiring policy pinned to this ' +
        'workflow. In under 150 words: who just arrived, whether they clear the policy bar, and how ' +
        'they stand against EVERY other candidate already on this job opening — NAME each one you ' +
        'compare against (the case page above lists what this opening already holds; if it holds ' +
        'none, say so plainly). End with one line: advance, hold, or decline.' },
    { type: 'approval', id: 'step_f3', label: 'Your approval',
      instruction: 'Approve advancing this candidate to the interview process' },
    { type: 'workflow', id: 'step_f4', label: 'Interview process — Acme', workflow_id: wfFChild },
    { type: 'ai', id: 'step_f5', label: 'AI prepares the decision', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'Write the hiring decision record for this opening, from everything above: the application, ' +
        'the policy read, the comparison against the other candidates on this opening, and the ' +
        'interview outcome. Structure it exactly so:\n' +
        '1. "DECISION RECORD" — the opening, the candidates considered (one line each: evidence vs ' +
        'the policy bar), and the decision that follows.\n' +
        '2. "PREPARED EMAIL — OFFER TO ADVANCE (draft, not sent)" — subject + body to the advancing ' +
        'candidate.\n' +
        '3. "PREPARED EMAIL — DECLINE (draft, not sent)" — one per candidate not advancing, subject ' +
        '+ body, specific and kind.\n' +
        'Nothing is sent from here: these are drafts the human approves. Under 350 words total, no ' +
        'new facts.' },
  ], {
    triggers: [
      // The ZERO-AI door (W5): filters only, no judged `when` — it fires without spending a judge.
      { type: 'reaction', source: 'mail', filters: [
        { field: 'from_address', op: 'domain_is', value: 'acme-careers.test' },
        { field: 'subject', op: 'contains', value: 'application' },
      ] },
      { type: 'reaction', source: 'file', when: 'the file is a candidate CV' },
      // THE LOOP DOOR (René's cycle, by composition): the child's delivery re-fires the triage.
      { type: 'reaction', source: 'workflow', workflow_id: wfFChild,
        label: 'When the interview process delivers' },
    ],
    // THE DELIVERABLE IS A FRAME (frames arc, THE SERIES): an explicit artifact_type, not a title
    // word-lottery — materialize.ts TIER 0 + upsertFrameSeries give this workflow ONE stable head
    // that gains versions on every completed run.
    output_config: { destination: 'document', artifact_type: 'frame', report_mode: 'each_run' },
  });

  // ── THE INPUTS TRAYS — the standing policies every run reads (+ the material box on Run-now) ──
  const policyId = await mkKb('Hiring Policy — Acme.md',
    '# Hiring Policy — Acme Group\n\n' +
    '## The bar\n' +
    '- Senior Data Analyst: 4+ years analytics, fluent SQL, dbt or equivalent transformation work,\n' +
    '  one dashboarding tool in production, and evidence of talking to non-analysts.\n' +
    '- Backend Engineer: 4+ years services in production, one typed language, real on-call history.\n\n' +
    '## How we compare\n' +
    '- Compare candidates against the OPENING, never against each other in the abstract.\n' +
    '- A gap that closes in under a quarter is a note, not a rejection.\n' +
    '- Never rank on years alone; evidence outranks tenure.\n\n' +
    '## What we never do\n' +
    '- No decision on a single screen — every advance goes through the interview process.\n' +
    '- Personal data beyond name, role and evidence stays out of the written record.',
    'The Acme hiring bar, comparison rules and the never-do list.');
  const wroteInputs = await writeWorkflowInputs(admin, owner.id, wfF, {
    docs: [{ kbFileId: policyId, name: 'Hiring Policy — Acme.md' }], acceptMaterial: true,
  });
  if (!wroteInputs.ok) throw new Error(`inputs tray (parent): ${wroteInputs.error}`);

  const interviewPolicyId = await mkKb('Interview Policy — Acme.md',
    '# Interview Policy — Acme Group\n\n' +
    '## The panel\n' +
    '- Every interview runs with two people: the hiring manager and one practitioner from the team.\n' +
    '- 60 minutes, never longer. A second round is a decision, not a default.\n\n' +
    '## How we ask\n' +
    '- Every question aims at a CLAIM in the application or a GAP against the bar — no puzzles,\n' +
    '  no trivia, no whiteboard algorithms.\n' +
    '- At least two questions must ask the candidate to walk through work they actually shipped.\n' +
    '- One question always tests how they explain a number to someone who is not an analyst.\n\n' +
    '## Scheduling\n' +
    '- Offer two windows, never a single slot. State the panel and the format in the invitation.\n' +
    '- A candidate always knows who they will meet before they meet them.\n\n' +
    '## The write-up\n' +
    '- Evidence first, verdict last. Record the gap even when the recommendation is advance.',
    'How Acme runs interviews: panel, question rules, scheduling and the write-up.');
  const wroteChildInputs = await writeWorkflowInputs(admin, owner.id, wfFChild, {
    docs: [{ kbFileId: interviewPolicyId, name: 'Interview Policy — Acme.md' }], acceptMaterial: true,
  });
  if (!wroteChildInputs.ok) throw new Error(`inputs tray (child): ${wroteChildInputs.error}`);

  // The three applications. Two name the SAME opening (so run 2 must MATCH, not found).
  const APPS = [
    { candidate: 'Maria Voss', opening: 'Senior Data Analyst — Acme Group',
      summary: 'Senior Data Analyst application — 6y analytics, SQL + dbt, Metabase in production.',
      body:
        'APPLICATION\nPosition applied for: Senior Data Analyst — Acme Group\nCandidate: Maria Voss\n\n' +
        'Six years in analytics, the last three owning a dbt project of ~200 models.\n' +
        'SQL is the daily tool; built and maintained the Metabase layer the commercial team lives in.\n' +
        'Ran a weekly session walking non-analysts through the numbers.\n' +
        'Notice period: one month.' },
    { candidate: 'Tomas Berg', opening: 'Senior Data Analyst — Acme Group',
      summary: 'Senior Data Analyst application — 5y, strong SQL, dbt light, no dashboard ownership.',
      body:
        'APPLICATION\nPosition applied for: Senior Data Analyst — Acme Group\nCandidate: Tomas Berg\n\n' +
        'Five years in analytics across two marketplaces. Deep SQL, including query tuning at scale.\n' +
        'dbt used but never owned; the transformation layer belonged to another team.\n' +
        'No dashboarding tool owned in production — consumed them, did not build them.\n' +
        'Wrote the weekly commercial readout for two years.' },
    { candidate: 'Lena Okafor', opening: 'Backend Engineer — Acme Group',
      summary: 'Backend Engineer application — 7y Go/TypeScript services, real on-call history.',
      body:
        'APPLICATION\nPosition applied for: Backend Engineer — Acme Group\nCandidate: Lena Okafor\n\n' +
        'Seven years building services in Go and TypeScript, most recently payments infrastructure.\n' +
        'Carried the pager for three years; wrote the incident review process her team still uses.\n' +
        'Comfortable in Postgres internals; has run a zero-downtime migration on a live ledger.' },
  ];

  console.log('\nrunning the triage ×3 (the file door → the case layer → the approval park)…');
  type FRun = {
    candidate: string; runId: string; status: string; kbId: string;
    caseName: string | null; caseEntityId: string | null; founded: boolean; comparison: string;
  };
  const fRuns: FRun[] = [];
  for (const app of APPS) {
    const filename = `Application — ${app.candidate}.txt`;
    const kbId = await mkKb(filename, app.body, app.summary);

    // The run row + the real exactly-once fire record, exactly as a live file fire writes them.
    const { data: runRow, error: runErr } = await admin.from('workflow_runs').insert({
      workflow_id: wfF, user_id: owner.id, status: 'queued', triggered_by: 'event',
    }).select('id').single();
    if (runErr || !runRow) throw new Error(`run row: ${runErr?.message}`);
    const runId = (runRow as { id: string }).id;
    const context =
      `[THE TRIGGERING EVENT — this run fired because this arrived:]\n${filename}\n${app.body}`.slice(0, 2400);
    const nowIso = new Date().toISOString();
    await admin.from('item_plans').insert({
      user_id: owner.id, kind: 'reaction_fire', entity_id: `${wfF}:file:${kbId}`,
      tasks: { runId, reason: 'the file is a candidate CV', context, firedAt: nowIso, startedAt: nowIso },
    });

    const before = (await readCaseIndex(admin, owner.id, wfF)).length;
    const res = await runWorkflow({ workflowId: wfF, runId, triggerSource: 'event', triggerContext: context });
    const after = (await readCaseIndex(admin, owner.id, wfF)).length;

    const { data: stamp } = await admin.from('item_plans').select('tasks')
      .eq('user_id', owner.id).eq('kind', RUN_CASE_KIND).eq('entity_id', runId).maybeSingle();
    const caseTask = (stamp?.tasks ?? null) as { entityId?: string; name?: string } | null;
    // NOTE (Aug 24): the seeder used to stamp `knowledge_files.entity_id` here by hand, because the
    // room grounding reads a knowledge doc off that column while the case step filed only through
    // `entity_links`. THE ENGINE DOES IT NOW (lib/workflows/case-step.ts, fill-if-empty) — the
    // compensation is gone, and the assertion below proves the engine's stamp landed.
    const { data: runOut } = await admin.from('workflow_runs').select('step_outputs').eq('id', runId).maybeSingle();
    const outs = ((runOut?.step_outputs ?? []) as Array<{ step_id?: string; output?: unknown }>);
    const comparison = String(outs.find(o => o.step_id === 'step_f2')?.output ?? '');

    fRuns.push({
      candidate: app.candidate, runId, status: res.status, kbId,
      caseName: caseTask?.name ?? null, caseEntityId: caseTask?.entityId ?? null,
      founded: after > before, comparison,
    });
    console.log(`  ${app.candidate}: ${res.status} · case "${caseTask?.name ?? '—'}" (${after > before ? 'FOUNDED' : 'matched'})`);
  }

  // ── THE DELIVERABLE FRAME (the decision step's home) ────────────────────────────────────────
  // The three seeded runs are PARKED at the approval, so none of them has reached step_f5 — and a
  // deliverable that never ran must not be faked. What IS seeded is the SERIES HEAD, produced
  // through the SAME door a completed run uses (materializeDocument forceType 'frame' →
  // generateFrameHtml, which validates and repairs → upsertFrameSeries). It stands for the
  // previous cycle of this triage; the next completed run pushes it to `versions[]` and takes
  // its place, in place, on the same id.
  const DECISION_TEXT =
    'DECISION RECORD — Senior Data Analyst (Acme Group)\n\n' +
    'Opening: Senior Data Analyst — Acme Group\n' +
    'Policy bar: 4+ years analytics · fluent SQL · dbt or equivalent transformation work · one\n' +
    'dashboarding tool in production · evidence of talking to non-analysts.\n\n' +
    'CANDIDATES CONSIDERED\n' +
    '- Maria Voss — 6 years analytics; owned a ~200-model dbt project; built and maintained the\n' +
    '  Metabase layer the commercial team uses; ran a weekly session for non-analysts.\n' +
    '  Against the bar: clears all five. Interview: strong SQL and dbt, walked a real warehouse\n' +
    '  migration end to end; gap — no dashboarding tool in the last two years, closeable in weeks.\n' +
    '  Verdict: ADVANCE.\n' +
    '- Tomas Berg — 5 years analytics; deep SQL including tuning at scale; dbt used but never\n' +
    '  owned; no dashboarding tool owned in production; wrote the weekly commercial readout.\n' +
    '  Against the bar: clears years, SQL and communication; misses owned transformation work and\n' +
    '  production dashboarding.\n' +
    '  Verdict: DECLINE for this opening.\n\n' +
    'DECISION: advance Maria Voss to final round. Tomas Berg declined for this opening, kept warm\n' +
    'for the next analytics req.\n\n' +
    'PREPARED EMAIL — OFFER TO ADVANCE (draft, not sent)\n' +
    'To: Maria Voss\n' +
    'Subject: Next step — Senior Data Analyst at Acme Group\n' +
    'Hello Maria,\n' +
    'Thank you for the interview. The panel was clear: your dbt ownership and the way you walked us\n' +
    'through the warehouse migration are exactly what this role needs. We would like to move you to\n' +
    'the final round. We will follow up with two windows next week.\n' +
    '— Acme Group hiring team\n\n' +
    'PREPARED EMAIL — DECLINE (draft, not sent)\n' +
    'To: Tomas Berg\n' +
    'Subject: Your application — Senior Data Analyst at Acme Group\n' +
    'Hello Tomas,\n' +
    'Thank you for the time you put into this application. Your SQL depth stood out, and the weekly\n' +
    'commercial readout is real evidence of explaining numbers well. For this opening we needed\n' +
    'owned transformation work and a dashboard you built in production, and that is where the\n' +
    'comparison landed. We would like to keep your details for the next analytics opening.\n' +
    '— Acme Group hiring team\n\n' +
    'NOTHING ABOVE HAS BEEN SENT. Both emails are drafts inside this deliverable, waiting on the\n' +
    'human who approves it.';

  let frameLine = 'frame: not seeded';
  let frameHeadId: string | null = null;
  let frameValid = false;
  let frameTitle = '';
  try {
    const { data: parentThread } = await admin.from('work_threads')
      .select('id').eq('workflow_id', wfF).eq('user_id', owner.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!parentThread?.id) throw new Error('no persistent thread on the parent yet');
    const { materializeDocument } = await import('../lib/documents/materialize');
    const title = 'Candidate comparison — Senior Data Analyst (Acme Group)';
    console.log('\ngenerating the decision FRAME through the one production door…');
    const m = await materializeDocument(admin, owner.id, {
      title, content: DECISION_TEXT, request: title, forceType: 'frame',
    });
    if (m.type !== 'frame') throw new Error(`the frame lane declined — landed as "${m.type}"`);
    const { upsertFrameSeries } = await import('../lib/frames/series');
    const res = await upsertFrameSeries(admin, {
      userId: owner.id, threadId: parentThread.id as string, workflowId: wfF, runId: null,
      title, bytes: m.bytes, mime: m.mime, content: m.content,
      provenance: m.provenance ?? null,
    });
    frameHeadId = String(res.artifact.id);
    frameTitle = String(res.artifact.title ?? title);
    // READ IT BACK from storage and re-validate — the claim is the served bytes, not the call.
    const path = (res.artifact as { storage_path?: string }).storage_path ?? '';
    const { data: blob } = await admin.storage.from('work-artifacts').download(path);
    const html = blob ? await blob.text() : '';
    const { validateFrameHtml } = await import('../lib/frames/validate-frame');
    const verdict = validateFrameHtml(html);
    frameValid = verdict.ok === true;
    const why = verdict.ok ? 'OK' : `REJECTED: ${verdict.reasons.slice(0, 3).join(' · ')}`;
    frameLine = `/frames/${frameHeadId} — ${html.length} bytes, validator ${why}`;
  } catch (e) {
    frameLine = `frame: seeding failed — ${(e as Error).message}`;
  }

  // ── ASSERTIONS, printed. Nothing here is claimed that was not read back. ────────────────────
  const fIndex = await readCaseIndex(admin, owner.id, wfF);
  const analystRun = fRuns.find(r => r.candidate === 'Tomas Berg');
  const analystEntity = analystRun?.caseEntityId ?? null;
  const { count: analystLinks } = analystEntity
    ? await admin.from('entity_links').select('item_id', { count: 'exact', head: true })
        .eq('user_id', owner.id).eq('entity_id', analystEntity)
    : { count: null as number | null };
  const parked = fRuns.filter(r => r.status === 'awaiting_approval').length;
  const trayNow = await readWorkflowInputs(admin, owner.id, wfF);
  const childTray = await readWorkflowInputs(admin, owner.id, wfFChild);
  const { data: wfFRow } = await admin.from('workflows').select('trigger, triggers, output_config, steps').eq('id', wfF).single();
  const doors = doorsForServing(wfFRow as { trigger?: unknown; triggers?: unknown });
  // `doorsForServing` deliberately serves only {source,label,filters} — the binding lives on the
  // authored trigger, so THAT is what the bound-to-the-child assertion reads.
  const authored = ((wfFRow as { triggers?: Array<{ source?: string; workflow_id?: string }> })?.triggers ?? []);
  const loopDoor = authored.find(t => t.source === 'workflow');
  const parentSteps = ((wfFRow as { steps?: Array<{ id: string; type: string; label?: string }> })?.steps ?? []);
  const { data: childRow } = await admin.from('workflows').select('steps, output_config').eq('id', wfFChild).single();
  const childSteps = ((childRow as { steps?: Array<{ id: string; type: string; label?: string }> })?.steps ?? []);
  const namesBoth = (t: string) => /maria\s+voss/i.test(t) && /tomas\s+berg/i.test(t);
  const accumulationRun = fRuns.find(r => namesBoth(r.comparison)) ?? null;

  // THE ENGINE'S OWN STAMP: the filed CVs must be visible to the room grounding through
  // knowledge_files.entity_id (what lib/workflows/case-step.ts now writes, fill-if-empty).
  const stampChecks = await Promise.all(fRuns.map(async r => {
    const { data } = await admin.from('knowledge_files').select('entity_id').eq('id', r.kbId).maybeSingle();
    return (data as { entity_id: string | null } | null)?.entity_id === r.caseEntityId;
  }));

  // THE GATE CARRIES ITS OBJECT: read the SERVED approval card, not the DB raw.
  const { deriveProcessRows, parkedGateOf } = await import('../lib/workflows/process-state');
  const { data: liveRuns } = await admin.from('workflow_runs')
    .select('id, workflow_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
    .eq('workflow_id', wfF).order('created_at', { ascending: true });
  const rows = await deriveProcessRows(
    admin, owner.id,
    (liveRuns ?? []) as never,
    new Map([[wfF, { name: PARENT_NAME, steps: parentSteps as never }]]),
  );
  const needsYou = rows.filter(r => r.state === 'needs_you').length;
  const gateKinds = (liveRuns ?? []).map(r => parkedGateOf(r as never, parentSteps as never).kind);
  // THE GATE CARRIES ITS OBJECT: the process drawer derives the card's "What's being approved"
  // from the run's own step_outputs through `previewFromOutput` — so the assertion runs the SAME
  // derivation over the SAME served run rows, and demands the object NAME the candidate it gates.
  // (Note, recorded not papered over: the commitment-room approval card only exists for a
  // workflow with a STANDING binding — narrateApprovalAsk needs an open `source:'workflow'`
  // commitment, which a scheduled workflow has and an event-fired one does not. For these runs the
  // approval surface is the ledger row + the process drawer, which is where the object renders.)
  const { previewFromOutput } = await import('../lib/workflows/handoff-context');
  const gateObjects = fRuns.map(r => {
    const run = (liveRuns ?? []).find(x => (x as { id: string }).id === r.runId) as { step_outputs?: Array<{ output?: unknown }> } | undefined;
    const outs = run?.step_outputs ?? [];
    for (let i = outs.length - 1; i >= 0; i -= 1) {
      const p = previewFromOutput(outs[i]?.output);
      if (p) return { candidate: r.candidate, text: p.text };
    }
    return { candidate: r.candidate, text: '' };
  });
  const previewsCarryComparison = gateObjects.length === 3
    && gateObjects.every(g => g.text.length > 80
      && new RegExp(g.candidate.split(' ')[0], 'i').test(g.text));

  const check = (label: string, pass: boolean, detail: string) =>
    console.log(`  ${pass ? '✓' : '✗'} ${label} — ${detail}`);

  console.log('\nVERIFIED (read back live):');
  check('three runs parked at the approval', parked === 3, `${parked}/3 awaiting_approval`);
  check('the case index holds 2 records', fIndex.length === 2,
    fIndex.map(c => `"${c.caseName}"`).join(' · ') || '(none)');
  check('run 1 FOUNDED the analyst opening, run 2 MATCHED it',
    fRuns[0]?.founded === true && fRuns[1]?.founded === false
      && !!fRuns[0]?.caseEntityId && fRuns[0]?.caseEntityId === fRuns[1]?.caseEntityId,
    `Maria ${fRuns[0]?.founded ? 'founded' : 'matched'} · Tomas ${fRuns[1]?.founded ? 'founded' : 'matched'} · same case: ${fRuns[0]?.caseEntityId === fRuns[1]?.caseEntityId}`);
  check('run 3 opened its own record', fRuns[2]?.founded === true && fRuns[2]?.caseEntityId !== fRuns[0]?.caseEntityId,
    `"${fRuns[2]?.caseName ?? '—'}"`);
  check('the analyst opening holds 2 filed applications', analystLinks === 2, `${analystLinks ?? 0} entity_links`);
  check('the ENGINE stamped every filed CV onto its case (grounding visibility)',
    stampChecks.every(Boolean), `${stampChecks.filter(Boolean).length}/3 knowledge_files.entity_id`);
  check('a comparison NAMES both analyst candidates (the accumulation proof)', !!accumulationRun,
    accumulationRun ? `${accumulationRun.candidate}'s run` : 'no run named both — read the comparisons in the rooms');
  check('the parent tray serves the hiring policy', (trayNow?.docs.length ?? 0) === 1 && trayNow?.acceptMaterial === true,
    `${trayNow?.docs[0]?.name ?? '—'} · acceptMaterial ${trayNow?.acceptMaterial}`);
  check('the child tray serves the interview policy', (childTray?.docs.length ?? 0) === 1,
    `${childTray?.docs[0]?.name ?? '—'}`);
  check('the child holds the interview leg (3 stations)', childSteps.length === 3,
    childSteps.map(s => s.label).join(' → '));
  check('the parent reads like the whiteboard', parentSteps.length === 5,
    parentSteps.map(s => `${s.type}:${s.label}`).join(' → '));
  check('the doors serve with their filters', doors.length === 3 && (doors.find(d => d.source === 'mail')?.filters?.length ?? 0) === 2,
    doors.map(d => d.label).join(' | '));
  check('the loop door is bound to the child', loopDoor?.workflow_id === wfFChild, String(loopDoor?.workflow_id ?? '—'));
  check("the deliverable is a FRAME by declaration",
    (wfFRow as { output_config?: { artifact_type?: string } })?.output_config?.artifact_type === 'frame',
    JSON.stringify((wfFRow as { output_config?: unknown })?.output_config));
  check('the frame series head exists and its served HTML validates', frameValid, frameLine);
  check('the served process rows show three needs-you approvals',
    needsYou === 3 && gateKinds.filter(k => k === 'approval').length === 3,
    `${needsYou} needs_you · gates [${gateKinds.join(', ')}]`);
  check('every decision card CARRIES the comparison it gates', previewsCarryComparison,
    gateObjects.map(g => `${g.candidate}: ${g.text.length}ch`).join(' · '));

  console.log(`
Seeded: THE CV TRIAGE WHITEBOARD. The walk, surface by surface:

  1. STUDIO → "${PARENT_NAME}"
     · THE WHEN BLOCK wears THREE doors — how an application comes in:
         · the MAIL door with its filter chips (Sender domain is acme-careers.test · Subject
           contains "application") and NO judged condition: that door spends no AI;
         · the FILE door ("the file is a candidate CV") — a PDF/CV dropped in the folder;
         · the LOOP door ("When the interview process delivers") — the cycle closing on itself.
       (The whiteboard's third arrival, a manual upload, is the same file door by hand.)
     · Under the doors: the WORKS WITH tray (Hiring Policy — Acme.md pinned, material box on)
       and the throttle row ("Up to 20 event runs a day; extra ones wait for tomorrow").
     · Down the rail: ${parentSteps.map(s => s.label).join(' → ')}.
     · The output panel says FRAME: the decision ships as a living candidate-comparison frame.

  2. WORKFLOWS PAGE → THREE needs-you rows, one per application
     (${fRuns.map(r => r.candidate).join(' · ')}), each wearing the OPENING it was filed under.

  3. OPEN ${accumulationRun?.candidate ?? 'Tomas Berg'}'S RUN — the accumulation.
     The comparison names BOTH analyst candidates and weighs them against each other. That second
     name came from the OTHER run's filed application, through the case, not from this run's
     material. AUGMTD linked the application to the opening (step 2 of the whiteboard), and the
     opening is what the comparison reads.
     The decision card CARRIES the comparison — the approver reads the work being gated, comments
     in the run room, and approves or rejects there.

  4. APPROVE ${fRuns[0]?.candidate ?? 'Maria Voss'}'S RUN (hers is the one the comparison says advance).
     · The ⧉ station lights → "${CHILD_NAME}" runs its own rail:
         interview questions grounded in the pinned Interview Policy → a PREPARED SCHEDULING EMAIL
         (a draft, addressed to her, waiting on you) → the interview outcome.
     · The child's delivery re-fires the triage through the LOOP door (paced by the throttle,
       queued never dropped) → the re-fired run files the outcome under the SAME opening, because
       the outcome names it. That is the whiteboard's "interview conducted → feeds back".
     · The re-fired run reaches "AI prepares the decision": the DECISION RECORD, the OFFER draft
       to the advancing candidate, and the DECLINE drafts — and it ships as a FRAME.

  5. THE FRAME → the parent's deep-dive, Frames tab (or ${frameLine.split(' — ')[0]}).
     One card = one SERIES: "${frameTitle || 'Candidate comparison'}". The head id never changes;
     each completed run pushes the previous generation into the version picker and takes its place.
     Share from the full-screen view — a share is always a view of the PRESENT.

  6. THE RECORD ITSELF: "${fRuns[1]?.caseName ?? 'Senior Data Analyst — Acme Group'}" is an openable
     room holding everything filed under it — both applications, and after the loop the interview
     outcome too. ("${fRuns[2]?.caseName ?? 'Backend Engineer — Acme Group'}" is the second record —
     the proof the filing separates openings.)

  TWO SIMPLIFICATIONS, SAID OUT LOUD:
   · ONE approval, not the whiteboard's two. The engine has a single human gate per station; the
     post-interview decision rides the SAME gate after the loop closes, instead of a second one.
   · The emails to the winner and the losers are DRAFTS INSIDE THE DELIVERABLE, never sends.
     Workflow email sending exists, but no send fires without a human — so for this walk the
     drafts live where the approver reads them, in the gated decision record and its frame.

Clean up: npx tsx --env-file=.env.local scripts/demo-processes-walk.ts --clean`);
}
main().catch(e => { console.error(e); process.exit(1); });
