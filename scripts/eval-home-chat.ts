// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVAL — W22.C · THE HOME CHAT vs A PLAIN MODEL CALL (live AI when run with --yes).
//
// Owner: "test, smoke test across scenarios, based on the feedback shared, and even compare to calls
// to your own models." Every scenario (scripts/eval-home-chat.fixtures.ts) runs through TWO systems:
//   (A) AUGMTD   — the Home chat's real server entry: `converse(client, userId, {kind:'global'}, q,
//                  { history, skills })`, exactly what app/api/home/ask/route.ts calls (JSON path),
//                  in-process, as the PROBE HOST (scripts/probe-user.ts) through an RLS session minted
//                  for it (so the core reads under the same row-level security as the route). No
//                  roomKey is passed, so no room turn is persisted; the route's after() user-context
//                  lane is not run. Any card the core stores lands on the probe host only.
//   (B) BASELINE — the SAME conversation model (getAIClient(probe,'conversation')) called directly
//                  through lib/ai/factory.ts aiCreate with "You are a helpful assistant." + the same
//                  messages. No tools, no grounding.
// Then a JUDGE (the strongest standard-tier model, claude-sonnet-5 via the factory; override with
// --judge-model) scores each transcript 1-5 per rubric dimension, blind to which system wrote it, and
// deterministic checks run beside it. Tokens and cost are METERED at the OpenAI-SDK transport
// (scripts/lib/eval/meter.ts) — every call the core makes, including background ones.
//
// Output: scratchpad/w22-eval-<timestamp>.md (side-by-side table, per-dimension means, failures
// quoted, transcripts, total cost).
//
// Run:
//   npx tsx scripts/eval-home-chat.ts                      # DRY RUN: scenarios + cost estimate, spends nothing
//   npx tsx scripts/eval-home-chat.ts --yes                # live run (≈ €1.0 estimated for all, hard stop at --max-eur)
//   npx tsx scripts/eval-home-chat.ts --only a,b --system augmtd --yes
//   npx tsx scripts/eval-home-chat.ts --self-check         # zero AI, zero network: stubs through the harness
//   npx tsx scripts/eval-home-chat.ts --self-check --wire  # zero AI: the REAL core in-process on the probe
//                                                          # host, the model stubbed at the transport
// Flags: --only <ids|groups>  --system augmtd|baseline|both  --max-eur <n> (default 2)
//        --judge-model <model>  --no-judge  --client rls|admin (default rls)  --out <path>
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
config({ path: '.env.local' });
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SCENARIOS, selectScenarios } from './eval-home-chat.fixtures';
import {
  type Scenario, type SystemAdapter, type JudgeAdapter, type ChatTurn, type TurnOutput, type TurnSignals, type SystemId,
  estimateCost, runEval, renderReport, buildJudgePrompt, parseJudge,
} from './lib/eval/home-chat-harness';
import { installMeter, metered, orphanCalls, type MeterBucket, type StubFn } from './lib/eval/meter';
import { runSelfCheck } from './lib/eval/self-check';

// ── args ─────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string): string | null => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const only = opt('only')?.split(',') ?? null;
const systemArg = (opt('system') ?? 'both') as 'augmtd' | 'baseline' | 'both';
if (!['augmtd', 'baseline', 'both'].includes(systemArg)) { console.error('--system must be augmtd|baseline|both'); process.exit(2); }
const systemIds: SystemId[] = systemArg === 'both' ? ['augmtd', 'baseline'] : [systemArg];
const maxEur = Number(opt('max-eur') ?? '2');
const judgeModelOverride = opt('judge-model');
const useJudge = !flag('no-judge');
const clientMode = (opt('client') ?? 'rls') as 'rls' | 'admin';
const scenarios = selectScenarios(only);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

if (!scenarios.length) { console.error(`no scenario matches --only ${only?.join(',')} (have: ${SCENARIOS.map((s) => s.id).join(', ')})`); process.exit(2); }

function printPlan(): void {
  const est = estimateCost(scenarios, systemIds, useJudge);
  console.log(`\nW22.C — Home chat vs plain model call · ${scenarios.length} scenario(s) · systems: ${systemIds.join(' + ')} · judge: ${useJudge ? (judgeModelOverride ?? 'conversation model (claude-sonnet-5 on standard)') : 'off'}`);
  console.log('\n  id   turns  title');
  for (const s of scenarios) console.log(`  ${s.id.padEnd(4)} ${String(s.turns.length).padStart(5)}  ${s.title}`);
  console.log(`\nESTIMATE (conservative, claude-sonnet-5 rates €1.85/€9.20 per 1M in/out):`);
  console.log(`  ${est.turns} system turns + ${est.judgeCalls} judge calls`);
  if (systemIds.includes('augmtd')) console.log(`  AUGMTD   ≈ €${est.augmtdEur.toFixed(2)}  (grounding + classifier + agent loop per turn)`);
  if (systemIds.includes('baseline')) console.log(`  baseline ≈ €${est.baselineEur.toFixed(2)}`);
  if (useJudge) console.log(`  judge    ≈ €${est.judgeEur.toFixed(2)}`);
  console.log(`  TOTAL    ≈ €${est.totalEur.toFixed(2)}   (hard stop: --max-eur ${maxEur})`);
}

// ── Supabase: admin (probe resolution, ground truth, factory config) + the RLS session shim ──────
function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The route passes the user's cookie-bound RLS client to converse(). In-process we mint the same
 *  thing for the PROBE HOST: a magic-link token (admin API, no email is sent) verified into a session,
 *  and a client carrying that access token. Falls back to the service-role client (logged). */
async function probeRlsClient(admin: SupabaseClient, email: string): Promise<{ client: SupabaseClient; mode: 'rls' | 'admin'; note?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return { client: admin, mode: 'admin', note: 'NEXT_PUBLIC_SUPABASE_ANON_KEY missing' };
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { client: admin, mode: 'admin', note: `generateLink failed: ${error?.message ?? 'no token'}` };
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (e2 || !v?.session?.access_token) return { client: admin, mode: 'admin', note: `verifyOtp failed: ${e2?.message ?? 'no session'}` };
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${v.session.access_token}` } },
  });
  return { client, mode: 'rls' };
}

/** The probe host's real data, for the judge on work-grounded asks (explicit selects, errors surfaced). */
async function probeGroundTruth(admin: SupabaseClient, userId: string): Promise<string> {
  const lines: string[] = [];
  const now = Date.now();
  const inbox = await admin.from('inbox_items').select('id, status, source, created_at, subject:source_data->>subject', { count: 'exact' })
    .eq('user_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(10);
  lines.push(inbox.error ? `inbox_items pending: unknown (${inbox.error.message})`
    : `inbox_items pending: ${inbox.count ?? inbox.data?.length ?? 0}${(inbox.data ?? []).map((r) => `\n  - [${r.source}] ${String((r as { subject?: string }).subject ?? '(no subject)').slice(0, 90)} (${String(r.created_at).slice(0, 10)})`).join('')}`);
  const com = await admin.from('commitments').select('id, description, due_date, direction', { count: 'exact' })
    .eq('user_id', userId).eq('status', 'open').limit(10);
  lines.push(com.error ? `commitments open: unknown (${com.error.message})`
    : `commitments open: ${com.count ?? com.data?.length ?? 0}${(com.data ?? []).map((r) => `\n  - ${String(r.description ?? '').slice(0, 90)}${r.due_date ? ` (due ${String(r.due_date).slice(0, 10)})` : ''}`).join('')}`);
  const cal = await admin.from('calendar_events').select('id, title, start_time', { count: 'exact' })
    .eq('user_id', userId).gte('start_time', new Date(now - 2 * 864e5).toISOString()).lte('start_time', new Date(now + 864e5).toISOString())
    .order('start_time', { ascending: true }).limit(10);
  lines.push(cal.error ? `calendar events (−2d…+1d): unknown (${cal.error.message})`
    : `calendar events (−2d…+1d): ${cal.count ?? cal.data?.length ?? 0}${(cal.data ?? []).map((r) => `\n  - ${String(r.title ?? '(untitled)').slice(0, 90)} @ ${String(r.start_time).slice(0, 16)}`).join('')}`);
  lines.push(`today: ${new Date(now).toISOString().slice(0, 10)}`);
  return lines.join('\n');
}

// ── metering → TurnOutput ────────────────────────────────────────────────────────────────────────
type Priced = { promptTokens: number; completionTokens: number; costEur: number; calls: number; unmetered: number; models: string[] };
async function price(bucket: MeterBucket, from = 0): Promise<Priced> {
  const { estimateCostEur } = await import('../lib/ai/pricing');
  const calls = bucket.calls.slice(from);
  const out: Priced = { promptTokens: 0, completionTokens: 0, costEur: 0, calls: calls.length, unmetered: 0, models: [] };
  for (const c of calls) {
    out.promptTokens += c.promptTokens; out.completionTokens += c.completionTokens;
    if (c.metered) out.costEur += estimateCostEur(c.model, c.promptTokens, c.completionTokens); else out.unmetered++;
    if (!out.models.includes(c.model)) out.models.push(c.model);
  }
  return out;
}
/** Every bucket a turn used, so calls that land AFTER the turn returned are still billed at the end. */
const buckets: Array<{ label: string; bucket: MeterBucket; counted: number }> = [];

const CARD_KEYS = ['invite', 'emailDraft', 'bulkDeed', 'collection', 'event', 'change', 'workflowDraft', 'artifact', 'artifacts', 'files', 'options'];
/** What rode beside the answer — read loosely, so the rebuilt core's shape changes do not break the eval. */
export function signalsOf(turn: Record<string, unknown>): TurnSignals {
  const present = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
  const cards = CARD_KEYS.filter((k) => present(turn[k]));
  const stage = turn.openStage as { stage?: string } | null | undefined;
  if (stage?.stage) cards.push(`openStage:${stage.stage}`);
  const sideEffects: string[] = [];
  const commit = turn.commit as { kind?: string } | null | undefined;
  if (commit) sideEffects.push(`commit:${commit.kind ?? 'unknown'}`);
  for (const a of (Array.isArray(turn.applied) ? turn.applied : []) as Array<{ tool?: string }>) sideEffects.push(`applied:${a?.tool ?? 'unknown'}`);
  const del = turn.delegated as { agentName?: string } | null | undefined;
  if (del) sideEffects.push(`delegated:${del.agentName ?? 'coworker'}`);
  return { cards, sideEffects };
}

// ── the systems ──────────────────────────────────────────────────────────────────────────────────
type LooseConverse = (client: SupabaseClient, userId: string, scope: { kind: 'global' }, text: string,
  opts: { history?: Array<{ role: 'user' | 'assistant'; text: string }>; skills?: unknown }) => Promise<Record<string, unknown>>;

async function augmtdSystem(client: SupabaseClient, userId: string): Promise<SystemAdapter> {
  const { converse } = await import('../lib/converse');
  let resolveSkills: ((c: SupabaseClient, u: string) => Promise<unknown>) | null = null;
  try {
    const m = await import('../lib/skills/for-turn');
    resolveSkills = (c, u) => m.resolveSkillsForTurn(c, u, { kind: 'chief' }, undefined);
  } catch { /* the skills resolver is optional to the eval */ }
  const { getAIClient } = await import('../lib/ai/factory');
  const { model } = await getAIClient(userId, 'conversation', client);
  return {
    id: 'augmtd', label: 'AUGMTD Home chat (converse, global scope)', model: `${model} + router/grounding`,
    async turn(history: ChatTurn[], userText: string, scenario: Scenario): Promise<TurnOutput> {
      const t0 = Date.now();
      // Mirror the route's own input shaping (question ≤ 20k chars, history turns ≤ 8k).
      const q = userText.trim().slice(0, 20000);
      const hist = history.map((h) => ({ role: h.role, text: h.text.slice(0, 8000) }));
      const { result, bucket } = await metered(async () => {
        const skills = resolveSkills ? await resolveSkills(client, userId).catch(() => undefined) : undefined;
        return (converse as unknown as LooseConverse)(client, userId, { kind: 'global' }, q, { history: hist, ...(skills ? { skills } : {}) });
      });
      const latencyMs = Date.now() - t0;
      buckets.push({ label: `${scenario.id}/augmtd`, bucket, counted: bucket.calls.length });
      const p = await price(bucket);
      return {
        text: String(result?.say ?? ''), latencyMs, promptTokens: p.promptTokens, completionTokens: p.completionTokens,
        costEur: p.costEur, calls: p.calls, unmeteredCalls: p.unmetered, models: p.models, signals: signalsOf(result ?? {}),
      };
    },
  };
}

async function baselineSystem(admin: SupabaseClient, userId: string): Promise<SystemAdapter> {
  const { getAIClient, aiCreate } = await import('../lib/ai/factory');
  const { client: ai, model } = await getAIClient(userId, 'conversation', admin);
  return {
    id: 'baseline', label: 'Baseline (same model, "You are a helpful assistant.")', model,
    async turn(history: ChatTurn[], userText: string, scenario: Scenario): Promise<TurnOutput> {
      const t0 = Date.now();
      const { result, bucket } = await metered(() => aiCreate(ai, {
        model, max_tokens: 2048,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          ...history.map((h) => ({ role: h.role, content: h.text })),
          { role: 'user', content: userText },
        ],
      }));
      const latencyMs = Date.now() - t0;
      buckets.push({ label: `${scenario.id}/baseline`, bucket, counted: bucket.calls.length });
      const p = await price(bucket);
      return {
        text: String(result.choices?.[0]?.message?.content ?? ''), latencyMs, promptTokens: p.promptTokens, completionTokens: p.completionTokens,
        costEur: p.costEur, calls: p.calls, unmeteredCalls: p.unmetered, models: p.models, signals: { cards: [], sideEffects: [] },
      };
    },
  };
}

async function factoryJudge(admin: SupabaseClient, userId: string): Promise<JudgeAdapter> {
  const { getAIClient, aiCreate } = await import('../lib/ai/factory');
  const resolved = await getAIClient(userId, 'conversation', admin);
  const model = judgeModelOverride ?? resolved.model;
  return {
    model,
    async judge(input) {
      const { system, user } = buildJudgePrompt(input);
      const { result, bucket } = await metered(() => aiCreate(resolved.client, {
        model, max_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }));
      buckets.push({ label: `${input.scenario.id}/judge`, bucket, counted: bucket.calls.length });
      const p = await price(bucket);
      const parsed = parseJudge(String(result.choices?.[0]?.message?.content ?? ''));
      return { ...parsed, costEur: p.costEur, promptTokens: p.promptTokens, completionTokens: p.completionTokens };
    },
  };
}

// ── the transport stub for --self-check --wire (zero AI; the real core, the model faked) ─────────
const wireStub: StubFn = (params) => {
  const msgs = (params.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const all = msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))).join('\n');
  if (/strict evaluator of an AI work assistant/.test(all)) {
    return { content: JSON.stringify({ scores: { instruction_following: 3, no_false_refusal: 3, conciseness: 3 }, failures: [], notes: 'stub judge' }) };
  }
  if (/\bJSON\b/.test(all) || (params.response_format as { type?: string } | undefined)?.type === 'json_object') return { content: '{}' };
  return { content: 'Stub answer from the transport. What is the one task you would like to start with?' };
};

// ── main ────────────────────────────────────────────────────────────────────────────────────────
async function writeReport(body: string, name: string): Promise<string> {
  const out = opt('out') ?? path.join(process.cwd(), 'scratchpad', name);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, body);
  return out;
}

async function main() {
  // 1 · pure self-check: stubs through the harness, zero AI, zero network.
  if (flag('self-check') && !flag('wire')) {
    const { report, problems } = await runSelfCheck(scenarios);
    const out = await writeReport(report, `w22-eval-selfcheck-${stamp}.md`);
    console.log(`self-check report → ${out}`);
    if (problems.length) { console.log(`✗ SELF-CHECK FAILED:\n  - ${problems.join('\n  - ')}`); process.exit(1); }
    console.log(`✓ self-check: ${scenarios.length} scenarios, good stub passes every deterministic check, refusing stub fails, judge prompt/parse round-trips, report complete.`);
    return;
  }

  printPlan();
  const wire = flag('self-check') && flag('wire');
  if (!wire && !flag('yes')) {
    console.log('\nDRY RUN — nothing spent. Re-run with --yes to spend (the orchestrator runs it).');
    return;
  }

  // 2 · the meter goes in BEFORE the first factory client is built (see meter.ts).
  installMeter(wire ? { stub: wireStub } : {});
  const admin = adminClient();
  const { resolveProbeUser, PROBE_EMAIL } = await import('./probe-user');
  const userId = await resolveProbeUser(admin);
  const session = clientMode === 'rls' ? await probeRlsClient(admin, PROBE_EMAIL) : { client: admin, mode: 'admin' as const, note: 'requested' };
  console.log(`\nprobe host ${userId.slice(0, 8)} · converse client: ${session.mode}${session.note ? ` (${session.note})` : ''}${wire ? ' · MODEL STUBBED at the transport (zero AI)' : ''}`);

  const systems: SystemAdapter[] = [];
  if (systemIds.includes('augmtd')) systems.push(await augmtdSystem(session.client, userId));
  if (systemIds.includes('baseline')) systems.push(await baselineSystem(admin, userId));
  const judge = useJudge ? await factoryJudge(admin, userId) : null;

  const result = await runEval({
    scenarios, systems, judge, budgetEur: maxEur,
    groundTruth: () => probeGroundTruth(admin, userId),
    log: (l) => console.log(l),
  });

  // Calls that landed after their turn returned (background work the turn started) are billed too.
  let late = 0, lateCalls = 0;
  for (const b of buckets) {
    if (b.bucket.calls.length > b.counted) { const p = await price(b.bucket, b.counted); late += p.costEur; lateCalls += p.calls; }
  }
  const orphans = orphanCalls();
  const orphanCost = (await price({ calls: orphans })).costEur;
  result.totalCostEur += late + orphanCost;

  const notes = [
    `AUGMTD entry: \`converse(client, probeUserId, { kind: 'global' }, q, { history, skills })\` — the call app/api/home/ask/route.ts makes (JSON path), in-process on the probe host; converse client = **${session.mode}**${session.note ? ` (${session.note})` : ''}.`,
    'No roomKey → no room turn persisted; the route\'s after() user-context lane and skill offer are not run (answer path only).',
    `Background calls billed after their turn: ${lateCalls} (€${late.toFixed(4)}); calls outside any turn: ${orphans.length} (€${orphanCost.toFixed(4)}).`,
    ...(wire ? ['**WIRE SELF-CHECK — the model was stubbed at the transport. Scores are meaningless; this proves the in-process entry, metering and report.**'] : []),
  ];
  const report = renderReport(result, { title: wire ? 'W22.C — wire self-check (real core, stubbed model)' : undefined, notes });
  const out = await writeReport(report, wire ? `w22-eval-wire-${stamp}.md` : `w22-eval-${stamp}.md`);
  console.log(`\nreport → ${out}\nTOTAL metered cost: €${result.totalCostEur.toFixed(4)}${result.budgetHit ? ' (BUDGET HIT — some runs skipped)' : ''}`);
  if (wire) {
    const aug = result.scenarios.flatMap((s) => s.runs.augmtd?.outputs ?? []);
    const errs = aug.filter((o) => o.error);
    const wired = aug.length > 0 && errs.length === 0;
    console.log(wired ? `✓ wire: the real core answered ${aug.length} turn(s) in-process through the metered transport.`
      : `✗ wire: ${errs.length} error(s)${errs[0] ? ` — ${errs[0].error}` : ''}${aug.some((o) => o.calls === 0) ? ' · some turns made no model call' : ''}`);
    if (!wired) process.exitCode = 1;
  }
}

main().then(() => { if (!process.exitCode) process.exit(0); else process.exit(process.exitCode); }, (e) => { console.error(e); process.exit(1); });
