// ─── DEMO SEED: THE CV TRIAGE, ON A REAL PILOT ACCOUNT ──────────────────────────────────────────
// TEMPORARY, never committed. Seeds ONE additive scenario on René Bohnsack's REAL account and lets
// THE WORKFLOW FIND HIS APPLICATIONS ITSELF — no hand-picked fires.
//
//   "CV Triage — AI Education Fellow" (parent) + "Interview process — AI Education Fellow" (child)
//
// THE SEAM (owner correction, Aug 24): the applications are NOT hand-fired. After seeding, the real
// discovery door runs over his existing inbox:
//   · one call to the production entry `checkReactions` (a rewound sinceIso) — the exact seam the
//     sync tail uses, reported with its own considered/fired numbers; then
//   · a BACKLOG WALK in 30-item chunks through `checkSourceReactions(admin, uid, 'mail', events)` —
//     the SAME runDoors loop: same judge, same filters, same throttle, same exactly-once records,
//     same material lane. Only the candidate ENUMERATION is widened, because `checkReactions`
//     caps its own read at 30 rows with no ordering (measured: his Jul/Aug application items never
//     appear in that unordered first page). The events are built by a VERBATIM copy of
//     checkReactions' own mapper, so what the judge sees is byte-identical to production.
// Fires land as queued runs (fireReaction's `after()` has no request scope in a script). They are
// then started oldest-first through the SAME context the fire record carries — the engine's own
// backstop path (`refireStaleEventRuns`), inlined so the walk is deterministic.
//
// HARD RULES honoured: additive only · nothing sends (both homes are `document`) · no existing
// workflow, inbox item, email or entity is modified · `--clean` removes exactly what was seeded.
//
// Run:   npx tsx --env-file=.env.local scripts/demo-cv-triage-rene.ts
// Clean: npx tsx --env-file=.env.local scripts/demo-cv-triage-rene.ts --clean
import { createClient } from '@supabase/supabase-js';

const DEMO_TAG = 'demo: cv triage';
const DEMO_KB_PREFIX = 'demo-cv-triage-rene/';
const USER_EMAIL = 'rene@zeroto100.ai';

const PARENT_NAME = 'CV Triage — AI Education Fellow';
const CHILD_NAME = 'Interview process — AI Education Fellow';
const DEMO_NAMES = [PARENT_NAME, CHILD_NAME];

/** The backlog walk's floor — his oldest application inbox_item was created 2026-07-27. */
const BACKLOG_SINCE = '2026-07-27T00:00:00Z';
const CHUNK = 30; // checkReactions' own batch size.

type RunDetail = { runId: string; itemId: string; sender: string; status: string; caseName: string | null; caseEntityId: string | null; caseCard: string; comparison: string };

/** THE DISCOVERY — the workflow finds the applications itself. Re-runnable: the exactly-once fire
 *  records mean an already-fired item is never re-judged into a second run. */
async function runDiscovery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any, userId: string, parent: string,
): Promise<RunDetail[]> {
  const { RUN_CASE_KIND } = await import('../lib/workflows/case-step');
  // ════════════════════════════════════════════════════════════════════════════════════════════
  // THE DISCOVERY — the workflow finds the applications itself.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const { checkReactions, checkSourceReactions } = await import('../lib/workflows/reactions');

  // (a) THE PRODUCTION ENTRY, verbatim. Rewound window; whatever it can reach, it reaches.
  console.log(`\n[a] checkReactions(sinceIso=${BACKLOG_SINCE}) — the production seam…`);
  const prodPass = await checkReactions(admin, userId, BACKLOG_SINCE);
  console.log(`    -> ${JSON.stringify(prodPass)}`);

  // (b) THE BACKLOG WALK. The events are built by THE REAL MAPPER, imported (Aug 24 — the
  //     verbatim copy that used to live here drifted the moment the mapper was fixed, which is
  //     exactly the class this walk exists to test). Only the ENUMERATION is widened, because
  //     checkReactions caps its own read at 30 unordered rows.
  const { mailEventFromItem } = await import('../lib/workflows/reactions');

  const { data: backlog } = await admin.from('inbox_items')
    .select('id, work_title, source_data, created_at')
    .eq('user_id', userId).eq('source', 'email')
    .gte('created_at', BACKLOG_SINCE).order('created_at', { ascending: true }).limit(2000);
  const eligible = ((backlog ?? []) as Array<Record<string, unknown>>).filter((it) => {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    if (sd.is_from_user === true) return false;
    const u = (sd.understanding ?? {}) as { bulk?: boolean };
    return u.bulk !== true;
  });
  const { data: linkRows } = await admin.from('entity_links').select('item_id, entity_id')
    .eq('user_id', userId).eq('item_kind', 'inbox_item')
    .in('item_id', eligible.map(i => String(i.id))).not('entity_id', 'is', null);
  const entityByItem = new Map<string, string>();
  for (const l of (linkRows ?? []) as Array<{ item_id: string; entity_id: string }>) entityByItem.set(l.item_id, l.entity_id);

  console.log(`\n[b] the backlog walk — ${eligible.length} eligible items since ${BACKLOG_SINCE.slice(0, 10)}, in chunks of ${CHUNK}`);
  const totals = { considered: 0, fired: 0, deferred: 0 };
  for (let i = 0; i < eligible.length; i += CHUNK) {
    const slice = eligible.slice(i, i + CHUNK)
      .map(mailEventFromItem)
      .map(e => ({ ...e, entityId: entityByItem.get(e.id) ?? null }));
    const res = await checkSourceReactions(admin, userId, 'mail', slice as never);
    if (res) { totals.considered += res.considered; totals.fired += res.fired; totals.deferred += res.deferred; }
    process.stdout.write(`    chunk ${Math.floor(i / CHUNK) + 1}: ${JSON.stringify(res)}\n`);
  }
  console.log(`    -> walk totals ${JSON.stringify(totals)}`);

  // ── WHICH ITEMS THE DOOR CHOSE, in the judge's own words ─────────────────────────────────────
  const { data: fires } = await admin.from('item_plans').select('entity_id, tasks, created_at')
    .eq('user_id', userId).eq('kind', 'reaction_fire').like('entity_id', `${parent}:%`)
    .order('created_at', { ascending: true });
  type Fire = { entity_id: string; tasks: { runId?: string; reason?: string; context?: string; startedAt?: string; deferred?: boolean } };
  const fireRows = (fires ?? []) as Fire[];
  const itemIdOf = (key: string) => key.split(':').slice(2).join(':');
  const { data: firedItems } = await admin.from('inbox_items')
    .select('id, work_title, source_data')
    .in('id', fireRows.map(f => itemIdOf(f.entity_id)));
  const titleOf = new Map<string, string>();
  const senderOf = new Map<string, string>();
  for (const it of (firedItems ?? []) as Array<{ id: string; work_title: string; source_data: Record<string, unknown> }>) {
    titleOf.set(it.id, String(it.work_title ?? ''));
    senderOf.set(it.id, String((it.source_data as { from_address?: string })?.from_address ?? ''));
  }
  console.log(`\nTHE DOOR FIRED ${fireRows.length} of ${totals.considered + (prodPass?.considered ?? 0)} considered:`);
  for (const f of fireRows) {
    const iid = itemIdOf(f.entity_id);
    console.log(`  · ${senderOf.get(iid) || iid} — "${titleOf.get(iid) ?? '?'}"\n      judge: ${f.tasks?.reason ?? '—'}`);
  }

  // ── START THE QUEUED RUNS (the engine's own backstop path, oldest fire first) ─────────────────
  const { runWorkflow } = await import('../lib/workflows/run-workflow');
  console.log('\nstarting the queued event runs (oldest first — run 1 founds the case, later runs match it)…');
  const started: Array<{ runId: string; itemId: string; status: string }> = [];
  const START_CAP = 12; // a seeder's own guardrail on a REAL account — the rest stay queued, said out loud.
  for (const f of fireRows) {
    if (started.length >= START_CAP) { console.log(`  · ${itemIdOf(f.entity_id)}: left QUEUED (seeder start cap ${START_CAP})`); continue; }
    if (f.tasks?.deferred === true) { console.log(`  · ${itemIdOf(f.entity_id)}: DEFERRED by the throttle — the drain owns it`); continue; }
    const runId = f.tasks?.runId;
    if (!runId) continue;
    const { data: row } = await admin.from('workflow_runs').select('status').eq('id', runId).maybeSingle();
    if ((row as { status?: string } | null)?.status !== 'queued') continue;
    const res = await runWorkflow({
      workflowId: parent, runId, triggerSource: 'event', triggerContext: f.tasks?.context,
    });
    started.push({ runId, itemId: itemIdOf(f.entity_id), status: res.status });
    console.log(`  · ${senderOf.get(itemIdOf(f.entity_id)) || itemIdOf(f.entity_id)}: ${res.status}`);
  }

  // ── READ BACK what each run did ───────────────────────────────────────────────────────────────
  const { data: runRowsRaw } = await admin.from('workflow_runs')
    .select('id, step_outputs')
    .eq('workflow_id', parent).order('created_at', { ascending: true });
  const runRows = (runRowsRaw ?? []) as Array<{ id: string; step_outputs?: Array<{ step_id?: string; output?: unknown }> }>;
  const outputsOf = (rid: string) => (runRows.find(r => r.id === rid)?.step_outputs ?? []);
  const details: Array<{ runId: string; itemId: string; sender: string; status: string; caseName: string | null; caseEntityId: string | null; caseCard: string; comparison: string }> = [];
  for (const s of started) {
    const outs = outputsOf(s.runId);
    const { data: stamp } = await admin.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', RUN_CASE_KIND).eq('entity_id', s.runId).maybeSingle();
    const ct = ((stamp as { tasks?: unknown } | null)?.tasks ?? null) as { entityId?: string; name?: string } | null;
    details.push({
      runId: s.runId, itemId: s.itemId, sender: senderOf.get(s.itemId) || s.itemId, status: s.status,
      caseName: ct?.name ?? null, caseEntityId: ct?.entityId ?? null,
      caseCard: String(outs.find(o => o.step_id === 'step_p1')?.output ?? ''),
      comparison: String(outs.find(o => o.step_id === 'step_p2')?.output ?? ''),
    });
  }
  return details;
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: prof } = await admin.from('profiles').select('id, full_name').eq('email', USER_EMAIL).maybeSingle();
  const userId = (prof as { id?: string } | null)?.id;
  if (!userId) throw new Error(`no profile for ${USER_EMAIL}`);

  // ── CLEAN — scoped by NAME + the demo tag + the demo KB prefix. Never his data. ───────────────
  const clean = async (): Promise<Map<string, string>> => {
    const { data: wfs } = await admin.from('workflows').select('id, name')
      .eq('user_id', userId).eq('description', DEMO_TAG).in('name', DEMO_NAMES);
    const priorIds = new Map<string, string>();
    for (const w of (wfs ?? []) as Array<{ id: string; name: string }>) priorIds.set(w.name, w.id);
    const wfIds = [...priorIds.values()];
    if (wfIds.length) {
      // The case registry goes with the demo — read the founded entities FROM the index first.
      const caseEntityIds = new Set<string>();
      for (const wid of wfIds) {
        const { data: idx } = await admin.from('item_plans').select('entity_id')
          .eq('user_id', userId).eq('kind', 'workflow_case').like('entity_id', `${wid}:%`);
        for (const r of (idx ?? []) as Array<{ entity_id: string }>) {
          const eid = String(r.entity_id).slice(wid.length + 1);
          if (eid) caseEntityIds.add(eid);
        }
        for (const kind of ['workflow_case', 'reaction_fire'] as const) {
          await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', kind).like('entity_id', `${wid}:%`);
        }
        for (const kind of ['workflow_limit', 'workflow_inputs', 'workflow_scope'] as const) {
          await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', kind).eq('entity_id', wid);
        }
      }
      for (const eid of caseEntityIds) {
        // ONLY links THIS demo wrote (via 'workflow_case'). His own links are never touched.
        await admin.from('entity_links').delete()
          .eq('user_id', userId).eq('entity_id', eid).eq('via', 'workflow_case');
        await admin.from('knowledge_files').update({ entity_id: null }).eq('user_id', userId).eq('entity_id', eid);
        await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', eid);
        await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', eid);
        await admin.from('work_entities').delete().eq('user_id', userId).eq('id', eid);
      }
      if (caseEntityIds.size) console.log(`cleaned: ${caseEntityIds.size} founded case entities`);

      const { data: runs } = await admin.from('workflow_runs').select('id, thread_id').in('workflow_id', wfIds);
      const runIds = (runs ?? []).map(r => r.id as string);
      const threadIds = new Set<string>();
      for (const r of runs ?? []) if (r.thread_id) threadIds.add(r.thread_id as string);
      const { data: wfThreads } = await admin.from('work_threads').select('id').in('workflow_id', wfIds);
      for (const t of (wfThreads ?? []) as Array<{ id: string }>) threadIds.add(t.id);
      for (const tid of threadIds) {
        const { data: th } = await admin.from('work_threads').select('artifacts').eq('id', tid).maybeSingle();
        const arts = (th?.artifacts ?? []) as Array<{ id?: string; storage_path?: string; versions?: Array<{ storagePath?: string }> }>;
        const paths = [
          ...arts.map(a => a.storage_path),
          ...arts.flatMap(a => (a.versions ?? []).map(v => v.storagePath)),
        ].filter(Boolean) as string[];
        if (paths.length) await admin.storage.from('work-artifacts').remove(paths);
        const artIds = arts.map(a => a.id).filter(Boolean) as string[];
        if (artIds.length) await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'frame_share').in('entity_id', artIds);
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
          await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'run_case').eq('entity_id', rid);
          await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'subprocess_link').like('entity_id', `${rid}%`);
          await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', `run:${rid}`);
        }
        await admin.from('workflow_runs').delete().in('id', runIds);
      }
      const { data: standing } = await admin.from('commitments').select('id, user_id').eq('source', 'workflow').in('source_id', wfIds);
      for (const s of (standing ?? []) as Array<{ id: string; user_id: string }>) {
        await admin.from('room_turns').delete().eq('user_id', s.user_id).like('room_key', `%${s.id}%`);
        await admin.from('commitments').delete().eq('id', s.id);
      }
      for (const wid of wfIds) {
        await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'workflow_owner').eq('entity_id', wid);
        await admin.from('activity_events').delete().eq('user_id', userId).eq('type', 'workflow_owner_changed').eq('entity_id', wid);
        await admin.from('ai_usage_events').delete().eq('user_id', userId).eq('workflow_id', wid);
      }
      await admin.from('workflows').delete().in('id', wfIds);
    }
    {
      const { data: kb } = await admin.from('knowledge_files').select('id')
        .eq('user_id', userId).like('provider_file_id', `${DEMO_KB_PREFIX}%`);
      const kbIds = (kb ?? []).map(f => f.id as string);
      if (kbIds.length) {
        await admin.from('knowledge_chunks').delete().in('file_id', kbIds);
        await admin.from('entity_links').delete().eq('user_id', userId).eq('item_kind', 'knowledge_file').in('item_id', kbIds);
        await admin.from('knowledge_files').delete().in('id', kbIds);
        console.log(`cleaned: ${kbIds.length} demo knowledge docs`);
      }
    }
    console.log(`cleaned: ${wfIds.length} demo workflows + fixtures`);
    return priorIds;
  };

  if (process.argv.includes('--clean')) { await clean(); return; }

  // ── --rediscover: RE-AUTHOR THE DOOR AND WALK THE BACKLOG AGAIN ───────────────────────────────
  // The first condition ("applies to a job / sends their CV") was too narrow for a real mailbox:
  // it missed two of his three live candidates, whose newest thread message is a LATER-STAGE reply
  // (a design-rationale answer, a proposal follow-up) rather than an arrival. Re-authoring the door
  // is authoring, not hand-firing — the same judge re-reads the same backlog, and the exactly-once
  // records mean already-fired items are never re-fired.
  const REDISCOVER = process.argv.includes('--rediscover');
  const WIDER_WHEN =
    'an email from someone who is a CANDIDATE in a hiring or fellowship process with the recipient — ' +
    'an application or expression of candidacy, a CV, cover letter, portfolio or work sample, a ' +
    'submitted test task, or a follow-up from that same candidate about their own application or ' +
    'next steps. NOT: internal team mail, vendor or client mail, newsletters, or applications for ' +
    'funding, grants, tenders or programmes rather than for a role.';

  if (REDISCOVER) {
    const { data: wf } = await admin.from('workflows').select('id, triggers')
      .eq('user_id', userId).eq('description', DEMO_TAG).eq('name', PARENT_NAME).single();
    const parentId = (wf as { id: string }).id;
    const trig = ((wf as { triggers?: Array<Record<string, unknown>> }).triggers ?? []).map(t =>
      t.source === 'mail' ? { ...t, when: WIDER_WHEN } : t);
    await admin.from('workflows').update({ triggers: trig }).eq('id', parentId);
    console.log('door re-authored. walking the backlog again…');
    await runDiscovery(admin, userId, parentId);
    return;
  }

  // ── THE UNTOUCHED CENSUS (before) ─────────────────────────────────────────────────────────────
  const censusWorkflows = async () => {
    const { data } = await admin.from('workflows').select('id, name, status, description, steps, trigger, triggers')
      .eq('user_id', userId).neq('description', DEMO_TAG).order('created_at');
    return JSON.stringify(data);
  };
  const APPLICANT_ITEMS = [
    '77a318a0-bfcb-40ca-a6c1-3a2903f75832', // Jorge Farromba
    '2602257e-b50f-486b-8f15-e4cc3161c49e', // Jacqueline Graça
    '549e9d05-3940-496d-9cf8-21bc9d5dcc10', // Márcia Marranita
  ];
  const censusItems = async () => {
    const { data } = await admin.from('inbox_items').select('id, status, work_state, rule_type, work_title')
      .in('id', APPLICANT_ITEMS).order('id');
    const { data: links } = await admin.from('entity_links').select('item_id, entity_id, via')
      .eq('user_id', userId).eq('item_kind', 'inbox_item').in('item_id', APPLICANT_ITEMS).order('item_id');
    return JSON.stringify({ items: data, links });
  };
  const beforeWorkflows = await censusWorkflows();
  const beforeItems = await censusItems();
  const { count: sendsBefore } = await admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', userId);

  const priorIds = await clean();

  const { data: workers } = await admin.from('custom_agents').select('id, name, worker_role')
    .eq('user_id', userId).eq('is_worker', true).eq('is_active', true);
  const clara = (workers ?? []).find(w => w.worker_role === 'personal_assistant')?.id ?? null;

  const mk = async (name: string, agentId: string | null, trigger: object, steps: object[], extra: Record<string, unknown> = {}) => {
    const prior = priorIds.get(name);
    const { data, error } = await admin.from('workflows').insert({
      ...(prior ? { id: prior } : {}),
      user_id: userId, name, description: DEMO_TAG, status: 'active',
      trigger, steps, agent_id: agentId,
      output_config: { destination: 'message', report_mode: 'each_run' },
      ...extra,
    }).select('id').single();
    if (error || !data) throw new Error(`${name}: ${error?.message}`);
    return data.id as string;
  };

  const { getOrCreateUploadSource } = await import('../lib/knowledge/indexer');
  const { writeWorkflowInputs, readWorkflowInputs } = await import('../lib/workflows/inputs');
  const { doorsForServing } = await import('../lib/workflows/trigger-sources');
  const { readCaseIndex, RUN_CASE_KIND } = await import('../lib/workflows/case-step');
  const uploadSourceId = await getOrCreateUploadSource(userId, admin);

  const mkKb = async (filename: string, text: string, summary: string) => {
    const { data, error } = await admin.from('knowledge_files').insert({
      user_id: userId, source_id: uploadSourceId,
      provider_file_id: `${DEMO_KB_PREFIX}${filename}`,
      filename, mime_type: 'text/plain', extracted_text: text, summary,
      indexed_at: new Date().toISOString(),
    }).select('id').single();
    if (error || !data) throw new Error(`kb "${filename}": ${error?.message}`);
    return data.id as string;
  };

  // ── THE CHILD ─────────────────────────────────────────────────────────────────────────────────
  const child = await mk(CHILD_NAME, clara, { type: 'manual' }, [
    { type: 'ai', id: 'step_c1', label: 'Prepare the interview questions', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'The candidate advancing to interview is named in the material above (the triage handed this ' +
        'process its comparison). Using ONLY the hiring policy pinned to this workflow and what the ' +
        'comparison actually says about this candidate, write the interview plan: the panel, the ' +
        'timebox, and 6 questions — each aimed at a specific claim or gap in their application. Name ' +
        'the candidate. Under 250 words. Invent no facts about the person.' },
    { type: 'ai', id: 'step_c2', label: 'Draft the scheduling email', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'Draft (DO NOT SEND — this is a draft a human will review) the scheduling email to the ' +
        'candidate named above: subject line, then body, offering the interview and two time windows ' +
        'next week, naming the panel and format from the plan above. Head the block ' +
        '"PREPARED EMAIL — SCHEDULING (draft, not sent)".' },
    { type: 'ai', id: 'step_c3', label: 'Record the interview outcome', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'Write the interview OUTCOME TEMPLATE for this candidate: the opening, the panel, one ' +
        'evidence line per question area from the plan LEFT BLANK for the interviewer to fill, and a ' +
        'recommendation line. Head it "INTERVIEW OUTCOME (to be completed by the panel)". Record no ' +
        'outcome that has not happened — this is the form, not a verdict.' },
  ], { output_config: { destination: 'document', report_mode: 'each_run' } });

  // ── THE PARENT ────────────────────────────────────────────────────────────────────────────────
  const parent = await mk(PARENT_NAME, clara, { type: 'manual' }, [
    { type: 'case', id: 'step_p1', label: 'File it under its record',
      case_instruction: 'the job opening the application names' },
    { type: 'ai', id: 'step_p2', label: 'AI creates the comparison', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'One arriving application (the triggering event) against the hiring policy pinned to this ' +
        'workflow. In under 180 words: who just arrived, what evidence their own words carry, whether ' +
        'they clear the policy bar, and how they stand against EVERY other candidate already on this ' +
        'job opening — NAME each one you compare against (the case page above lists what this opening ' +
        'already holds; if it holds none, say so plainly rather than inventing rivals). Judge only ' +
        'from what is actually in front of you; where the application text is thin or an attachment ' +
        'was not readable, SAY SO instead of guessing. End with one line: advance, hold, or decline.' },
    { type: 'approval', id: 'step_p3', label: 'Your approval',
      instruction: 'Approve advancing this candidate to the interview process' },
    { type: 'workflow', id: 'step_p4', label: CHILD_NAME, workflow_id: child },
    { type: 'ai', id: 'step_p5', label: 'AI prepares the decision', model_tier: 'fast',
      output_format: 'markdown',
      prompt:
        'Write the hiring decision record for this opening from everything above: the application, ' +
        'the policy read, the comparison against the other candidates on this opening, and the ' +
        'interview leg. Structure it exactly so:\n' +
        '1. "DECISION RECORD" — the opening, the candidates considered (one line each: evidence vs ' +
        'the policy bar), and the decision that follows.\n' +
        '2. "PREPARED EMAIL — OFFER TO ADVANCE (draft, not sent)" — subject + body.\n' +
        '3. "PREPARED EMAIL — DECLINE (draft, not sent)" — one per candidate not advancing, subject ' +
        '+ body, specific and kind.\n' +
        'Nothing is sent from here: these are drafts the human approves. Under 350 words, no new facts.' },
  ], {
    triggers: [
      // THE LIVE DOOR — judged, NO filters: his applicants come from anywhere.
      { type: 'reaction', source: 'mail',
        when: 'an email in which someone applies to a job, offers their candidacy, or sends their CV, ' +
              'cover letter, portfolio or a task submission as part of a hiring process' },
      { type: 'reaction', source: 'file', when: 'the file is a candidate CV' },
      { type: 'reaction', source: 'workflow', workflow_id: child,
        label: 'When the interview process delivers' },
    ],
    output_config: { destination: 'document', artifact_type: 'frame', report_mode: 'each_run' },
  });

  // ── THE WORKS WITH TRAY ───────────────────────────────────────────────────────────────────────
  // GENERIC by design: no invented facts about his organisation — only what the role itself needs.
  const policyId = await mkKb('Hiring Policy — AI Education Fellow.md',
    '# Hiring Policy — AI Education Fellow\n\n' +
    '## What the role needs\n' +
    '- Working fluency with AI tools, and the judgement to say where a model helps and where it does not.\n' +
    '- Education / learning-design craft: turning a subject into a path someone can actually walk.\n' +
    '- Content ability: writing, structuring and presenting material that reads clearly.\n' +
    '- Evidence of having SHIPPED something teachable — a course, a module, a walkthrough, a workshop.\n' +
    '- Ability to explain a technical idea to a non-technical audience.\n\n' +
    '## How we compare\n' +
    '- Compare every candidate against the OPENING, never against each other in the abstract.\n' +
    '- Evidence outranks tenure; a demonstrated artifact outranks a claim.\n' +
    '- A gap that closes in under a quarter is a note, not a rejection.\n' +
    '- If the application material is thin or unreadable, say so — never fill it in by inference.\n\n' +
    '## What we never do\n' +
    '- No decision on a single screen — every advance goes through the interview process.\n' +
    '- No email leaves this process without a human approving it.\n' +
    '- Personal data beyond name, role and evidence stays out of the written record.',
    'The AI Education Fellow bar, comparison rules and the never-do list.');
  const trayP = await writeWorkflowInputs(admin, userId, parent, {
    docs: [{ kbFileId: policyId, name: 'Hiring Policy — AI Education Fellow.md' }], acceptMaterial: true,
  });
  if (!trayP.ok) throw new Error(`inputs tray (parent): ${trayP.error}`);
  const trayC = await writeWorkflowInputs(admin, userId, child, {
    docs: [{ kbFileId: policyId, name: 'Hiring Policy — AI Education Fellow.md' }], acceptMaterial: true,
  });
  if (!trayC.ok) throw new Error(`inputs tray (child): ${trayC.error}`);

  const details = await runDiscovery(admin, userId, parent);


  const { data: runRows } = await admin.from('workflow_runs')
    .select('id, workflow_id, status, triggered_by, step_outputs, error, started_at, completed_at, created_at')
    .eq('workflow_id', parent).order('created_at', { ascending: true });
  const started = details;

  // ── THE FRAME SERIES HEAD — through the ONE production door, from the RUNS' OWN outputs ──────
  // The runs are parked at the approval, so no run has reached the decision step. Nothing is
  // invented: the head's content is the comparisons these runs actually produced, verbatim.
  let frameLine = 'frame: not seeded';
  let frameValid = false;
  let frameHeadId: string | null = null;
  try {
    const { data: parentThread } = await admin.from('work_threads')
      .select('id').eq('workflow_id', parent).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!parentThread?.id) throw new Error('no persistent thread on the parent yet');
    const body =
      'CANDIDATE COMPARISON — AI Education Fellow\n\n' +
      'Assembled from the triage runs currently WAITING ON APPROVAL. Every line below is the\n' +
      'comparison step\'s own output for that application. Nothing here has been sent, and no\n' +
      'decision has been taken — the decision record is produced only after a human approves.\n\n' +
      details.map(d =>
        `── ${d.sender} ──\nFiled under: ${d.caseName ?? '(no case named)'}\n${d.caseCard}\n\n${d.comparison}\n`,
      ).join('\n');
    const { materializeDocument } = await import('../lib/documents/materialize');
    const title = 'Candidate comparison — AI Education Fellow';
    console.log('\ngenerating the comparison FRAME through the one production door…');
    const m = await materializeDocument(admin, userId, { title, content: body, request: title, forceType: 'frame' });
    if (m.type !== 'frame') throw new Error(`the frame lane declined — landed as "${m.type}"`);
    const { upsertFrameSeries } = await import('../lib/frames/series');
    const r = await upsertFrameSeries(admin, {
      userId, threadId: parentThread.id as string, workflowId: parent, runId: null,
      title, bytes: m.bytes, mime: m.mime, content: m.content, provenance: m.provenance ?? null,
    });
    frameHeadId = String(r.artifact.id);
    const path = (r.artifact as { storage_path?: string }).storage_path ?? '';
    const { data: blob } = await admin.storage.from('work-artifacts').download(path);
    const html = blob ? await blob.text() : '';
    const { validateFrameHtml } = await import('../lib/frames/validate-frame');
    const verdict = validateFrameHtml(html);
    frameValid = verdict.ok === true;
    frameLine = `/frames/${frameHeadId} — ${html.length} bytes, validator ${verdict.ok ? 'OK' : `REJECTED: ${verdict.reasons.slice(0, 3).join(' · ')}`}`;
  } catch (e) {
    frameLine = `frame: seeding failed — ${(e as Error).message}`;
  }

  // ── VERIFY ────────────────────────────────────────────────────────────────────────────────────
  const index = await readCaseIndex(admin, userId, parent);
  const parked = details.filter(d => d.status === 'awaiting_approval').length;
  const trayNow = await readWorkflowInputs(admin, userId, parent);
  const childTray = await readWorkflowInputs(admin, userId, child);
  const { data: pRow } = await admin.from('workflows').select('trigger, triggers, output_config, steps, status').eq('id', parent).single();
  const doors = doorsForServing(pRow as { trigger?: unknown; triggers?: unknown });
  const authored = ((pRow as { triggers?: Array<{ source?: string; workflow_id?: string }> })?.triggers ?? []);
  const loopDoor = authored.find(t => t.source === 'workflow');
  const pSteps = ((pRow as { steps?: Array<{ id: string; type: string; label?: string }> })?.steps ?? []);
  const { data: cRow } = await admin.from('workflows').select('steps, output_config').eq('id', child).single();
  const cSteps = ((cRow as { steps?: Array<{ id: string; type: string; label?: string }> })?.steps ?? []);

  const { deriveProcessRows, parkedGateOf } = await import('../lib/workflows/process-state');
  const rows = await deriveProcessRows(admin, userId, (runRows ?? []) as never,
    new Map([[parent, { name: PARENT_NAME, steps: pSteps as never }]]));
  const needsYou = rows.filter(r => r.state === 'needs_you').length;
  const gateKinds = (runRows ?? []).map(r => parkedGateOf(r as never, pSteps as never).kind);

  const { count: sendsAfter } = await admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const afterWorkflows = await censusWorkflows();
  const afterItems = await censusItems();

  const check = (label: string, pass: boolean, detail: string) =>
    console.log(`  ${pass ? '✓' : '✗'} ${label} — ${detail}`);

  console.log('\nVERIFIED (read back live):');
  check('every started run parked at the approval', parked === started.length && started.length > 0,
    `${parked}/${started.length} awaiting_approval`);
  check('the served process rows show needs-you approvals', needsYou === started.length,
    `${needsYou} needs_you · gates [${gateKinds.join(', ')}]`);
  check('the case index holds records', index.length > 0,
    index.map(c => `"${c.caseName}"`).join(' · ') || '(none)');
  check('the parent tray serves the hiring policy',
    (trayNow?.docs.length ?? 0) === 1 && trayNow?.acceptMaterial === true,
    `${trayNow?.docs[0]?.name ?? '—'} · acceptMaterial ${trayNow?.acceptMaterial}`);
  check('the child tray serves the policy too', (childTray?.docs.length ?? 0) === 1, `${childTray?.docs[0]?.name ?? '—'}`);
  check('the parent reads like the whiteboard', pSteps.length === 5, pSteps.map(s => `${s.type}:${s.label}`).join(' → '));
  check('the child holds the interview leg', cSteps.length === 3, cSteps.map(s => s.label).join(' → '));
  check('three doors serve', doors.length === 3, doors.map(d => `${d.source}`).join(' | '));
  check('the loop door is bound to the child', loopDoor?.workflow_id === child, String(loopDoor?.workflow_id ?? '—'));
  check('the deliverable is a FRAME by declaration',
    (pRow as { output_config?: { artifact_type?: string } })?.output_config?.artifact_type === 'frame',
    JSON.stringify((pRow as { output_config?: unknown })?.output_config));
  check('the frame series head exists and its served HTML validates', frameValid, frameLine);
  check('the LIVE DOOR is active', (pRow as { status?: string })?.status === 'active', String((pRow as { status?: string })?.status));
  check('NOTHING SENT', sendsBefore === sendsAfter, `email_sends ${sendsBefore} → ${sendsAfter}`);
  check('his other workflows untouched', beforeWorkflows === afterWorkflows, beforeWorkflows === afterWorkflows ? '4 rows byte-identical' : 'DIFF — investigate');
  check('the applicant inbox items + their links untouched', beforeItems === afterItems,
    beforeItems === afterItems ? 'status/state/links byte-identical' : 'DIFF — investigate');

  console.log('\nPER-RUN RECORD:');
  for (const d of details) {
    console.log(`\n  ${d.sender}  (run ${d.runId}) — ${d.status}`);
    console.log(`    case: ${d.caseName ?? '—'} (${d.caseEntityId ?? '—'})`);
    console.log(`    card: ${d.caseCard}`);
    console.log(`    comparison:\n      ${d.comparison.replace(/\n/g, '\n      ').slice(0, 1400)}`);
  }
  console.log(`\nframe: ${frameLine}`);
  console.log(`\nparent=${parent}\nchild=${child}\npolicy kb=${policyId}`);
  console.log(`\nClean up: npx tsx --env-file=.env.local scripts/demo-cv-triage-rene.ts --clean`);
}
main().catch(e => { console.error(e); process.exit(1); });
