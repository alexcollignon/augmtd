// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RELAY SUITE (permanent, W1 + W2 of THE RELAY CANVAS — docs/relay-canvas-plan.md "GATES").
// A law is only alive while a gate enforces it. The laws this suite makes un-decayable:
//   N  THE ONE READER — normalizeTriggers is pure and total: the legacy reaction folds to a mail
//      door, a schedule is NEVER promoted out of triggers[] (law 6), garbage is dropped and nothing
//      is invented, a legacy fold + an authored copy read as ONE door, an absent column is fine.
//   S  THE ONE SANITISER — a model-emitted door is a WISH: registry · feature · condition · the
//      by-name binding ladder (exact → unique containment → refuse ambiguity → refuse self) ·
//      law 6's schedule refusal. Every drop is SPOKEN (the needs_person_note idiom).
//   R  READINESS RULE 5 — a door that cannot fire says so, in the pinned sentences.
//   F  THE FIRE FLOORS (live) — exactly-once per SOURCE TOKEN (mail keeps its historical `inbox`;
//      changing it would re-fire every already-handled email), the `workflow` source is STRUCTURAL
//      (no judge in the path), THE SELF-LOOP FLOOR, a second delivery fires again, and the
//      pre-migration degradation is silent (no throw, no fire, legacy mail still discovered).
//   D  THE DESTROYER FLOOR — no path in Studio writes `trigger` while dropping the doors.
//   P  THE FOUR-DOOR PARITY SWEEP — describe-it · coworker chat · Studio · the create/serve routes
//      all read and write the SAME schema through the same two modules (law 1).
//   H  THE HUMAN-ACT + TEST FLOORS — the `file` door lives at the upload seam and nowhere else;
//      the workflow door fires only from a real (non-test) delivery; every seam is host-safe.
//
// W2 (appended below, its own banner): I the store · B the block · M the material door · X the
// matured file door · T the threading · U the surfaces · Q parity. W1's sections above are
// untouched — a wave adds its floor, it never edits the previous wave's.
//
// MIGRATION-AWARE BY CONSTRUCTION: `workflows.triggers` is the arc's one additive column. Where it
// exists the live door gates run against real stored doors; where it does not, the SAME assertions
// run with the engine driven through a fixture Proxy that answers only the door-discovery select,
// and the documented degradation (silent no-op, legacy-mail-only) is asserted natively. Every
// section prints which mode it ran in.
//
// W3 (its own banner further down): SP the subprocess station · RL René's loop.
// W3b (THE THROTTLE, NEVER A SHREDDER): TL the clamp + the store · TD live deferral · TR the drain
// and its atomic claim · TB the drain/backstop partition · TS the serving + parity floors.
//
// ⚠️ THE HARNESS LESSON (W3b — the root of a whole red suite, recorded so it cannot recur):
// AN IN-PROCESS ENV FENCE PLUS A MODULE-LEVEL CLIENT CACHE IS A POISONED PROCESS. This suite used
// to delete the provider keys from its OWN process to prove a structural path spends nothing. Once
// the throttle moved BEHIND the judge (W3b), section F began crossing judgeCandidates while the
// fence was up — and `lib/ai/factory`'s module-level clientCache memoised the KEYLESS client for
// the rest of the run, so every later live AI gate 401'd. Restoring the keys afterwards cannot
// help: the cache is keyed on the user, not the env. THE RULE: a fence lives in a CHILD PROCESS
// with poisoned env (the frames suite's L3 pattern), or the fixtures are refitted so no judge is
// ever reached. Never `delete process.env[...]` in a suite that will later call AI.
//
// Run: npx tsx --env-file=.env.local scripts/smoke-relay.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import {
  TRIGGER_SOURCES, normalizeTriggers, doorsForServing, doorLabel, triggerSource,
  isTriggerSourceKey, type ReactionDoor,
} from '../lib/workflows/trigger-sources';
import { authorDoors, matchWorkflowByName, doorsForStorage, doorNote, describeDoors } from '../lib/workflows/author-doors';
import { readinessOf, READINESS_REASON_MAX } from '../lib/workflows/readiness';
import type { WorkspaceFeatures } from '../lib/workspace/types';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Prose about a law is not the law — every source floor reads CODE only. */
const stripComments = (s: string) => s.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');

const feats = (over: Partial<WorkspaceFeatures> = {}): WorkspaceFeatures =>
  ({ email: true, meetings: true, drive: true, agents: true, studio: true, home: true, ...over });
const reasonOf = (r: ReturnType<typeof readinessOf>) => (r.ready ? null : r.reason);

// ── THE FIXTURE PROXY ────────────────────────────────────────────────────────────────────────────
// The door seams discover their workflows with ONE select on `workflows`. When the additive column
// is absent (or when we want to PROVE the documented degradation on an environment where it is
// present), this Proxy answers exactly that select and delegates literally everything else — the
// fire's run row, the exactly-once record, the scope and cap reads — to the real client. The engine
// under test is the real engine; only the discovery row is a fixture.
type QueryResult = { data: unknown; error: unknown };
function workflowsSelectStub(real: SupabaseClient, answer: (cols: string) => QueryResult) {
  let cols = '';
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['eq', 'or', 'in', 'not', 'limit', 'gte', 'lt', 'order', 'is', 'like', 'neq']) q[m] = chain;
  q.select = (c: string) => { cols = c; return q; };
  q.single = () => q;
  q.maybeSingle = () => q;
  q.then = (res: (v: QueryResult) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(answer(cols)).then(res, rej);
  // Writes are never fixtures — a fire must land in the real tables so it can be asserted and swept.
  q.insert = (...a: unknown[]) => (real.from('workflows') as unknown as Record<string, (...x: unknown[]) => unknown>).insert(...a);
  q.update = (...a: unknown[]) => (real.from('workflows') as unknown as Record<string, (...x: unknown[]) => unknown>).update(...a);
  q.delete = (...a: unknown[]) => (real.from('workflows') as unknown as Record<string, (...x: unknown[]) => unknown>).delete(...a);
  return q;
}

function doorProxy(real: SupabaseClient, answer: (cols: string) => QueryResult): SupabaseClient {
  return new Proxy(real as unknown as Record<string, unknown>, {
    get(target, prop, recv) {
      if (prop === 'from') {
        return (table: string) => (table === 'workflows'
          ? workflowsSelectStub(real, answer)
          : (real.from as (t: string) => unknown)(table));
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as SupabaseClient;
}

const WIDE = (cols: string) => cols.includes('triggers');

async function main() {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // N — THE ONE READER (pure)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nN — normalizeTriggers (pure; mode: pure):');
  {
    const legacy = normalizeTriggers({ trigger: { type: 'reaction', when: 'a tender lands', label: 'On a tender' } });
    ok('LEGACY FOLD — a pre-W1 reaction reads as manual primary + ONE mail door',
      legacy.primary.type === 'manual' && legacy.doors.length === 1 && legacy.doors[0].source === 'mail',
      JSON.stringify(legacy));
    ok('…carrying its condition and its label verbatim (behaviour preserved exactly)',
      legacy.doors[0].when === 'a tender lands' && legacy.doors[0].label === 'On a tender',
      JSON.stringify(legacy.doors[0]));
    ok('…and the legacy label never leaks onto the primary (a manual primary is unlabelled)',
      legacy.primary.label === undefined, JSON.stringify(legacy.primary));
  }
  {
    const sched = normalizeTriggers({ trigger: { type: 'schedule', cron: '0 9 * * 1', timezone: 'Europe/Lisbon', label: 'Mondays' } });
    ok('a schedule is carried VERBATIM on the primary (the dispatcher clock is untouched)',
      sched.primary.type === 'schedule' && sched.primary.cron === '0 9 * * 1'
      && sched.primary.timezone === 'Europe/Lisbon' && sched.primary.label === 'Mondays', JSON.stringify(sched.primary));
    ok('…and a schedule never becomes a door', sched.doors.length === 0, JSON.stringify(sched.doors));
  }
  {
    // LAW 6 — one schedule, and it lives on `trigger`. A schedule-shaped entry in triggers[] has no
    // source key, so it is dropped by the same rule that drops garbage: never promoted, never merged.
    const n = normalizeTriggers({
      trigger: { type: 'manual' },
      triggers: [{ type: 'schedule', cron: '0 6 * * *' }, { source: 'schedule', cron: '0 7 * * *' }],
    });
    ok('LAW 6 — a schedule-shaped entry in triggers[] is NEVER promoted to the primary',
      n.primary.type === 'manual' && n.primary.cron === undefined, JSON.stringify(n.primary));
    ok('…and it is not kept as a door either', n.doors.length === 0, JSON.stringify(n.doors));
  }
  {
    const n = normalizeTriggers({
      triggers: [
        { source: 'linkedin', when: 'someone posts' },   // not in the registry
        { source: 'file' },                              // no condition — still a door, readiness speaks
        'nonsense', 42, null, { when: 'no source at all' },
        { source: 'meeting', when: 'it was a client call', label: 'After a client call' },
      ],
    });
    ok('unknown sources and garbage are DROPPED, nothing invented',
      n.doors.length === 2 && n.doors.map((d) => d.source).join(',') === 'file,meeting', JSON.stringify(n.doors));
    ok('…every survivor is stamped {type:\'reaction\'} (one stored shape)',
      n.doors.every((d) => d.type === 'reaction'), JSON.stringify(n.doors));
    ok('…and optional fields ride only when present (no empty-string noise)',
      n.doors[0].when === undefined && n.doors[1].label === 'After a client call', JSON.stringify(n.doors));
  }
  {
    const n = normalizeTriggers({
      trigger: { type: 'reaction', when: 'a tender lands' },
      triggers: [{ source: 'mail', when: 'A TENDER LANDS' }, { source: 'mail', when: 'a tender lands' }],
    });
    ok('DEDUPE — the legacy fold and an authored copy of the same door read as ONE',
      n.doors.length === 1, JSON.stringify(n.doors));
  }
  {
    const n = normalizeTriggers({
      triggers: [
        { source: 'workflow', workflow_id: 'wf-a' }, { source: 'workflow', workflow_id: 'wf-a' },
        { source: 'workflow', workflow_id: 'wf-b' },
      ],
    });
    ok('…dedupe keys on (source, when, workflow_id) — two DIFFERENT bindings both survive',
      n.doors.length === 2 && n.doors[1].workflow_id === 'wf-b', JSON.stringify(n.doors));
  }
  ok('an ABSENT / null / garbage column is tolerated (the migration may not be applied)',
    [undefined, null, {}, { triggers: null }, { triggers: 'oops' }, { triggers: {} }]
      .every((wf) => {
        const n = normalizeTriggers(wf as { trigger?: unknown; triggers?: unknown });
        return n.primary.type === 'manual' && n.doors.length === 0;
      }));
  {
    const served = doorsForServing({
      trigger: { type: 'reaction', when: 'a tender lands' },
      triggers: [{ source: 'workflow', workflow_id: 'wf-a' }, { source: 'file', when: 'it is a signed contract' }],
    });
    ok('doorsForServing labels every door FROM THE REGISTRY (law 3)',
      served.length === 3
      && served[0].label === 'When a tender lands'
      && served[1].label === (triggerSource('workflow')?.label ?? '')
      && served[2].label === 'When it is a signed contract',
      JSON.stringify(served));
    ok('…and serves the source key beside it (the surface never re-derives a catalogue)',
      served.map((s) => s.source).join(',') === 'mail,workflow,file', JSON.stringify(served));
  }
  ok('every registry row is complete (key · label · icon · feature · needsWhen)',
    TRIGGER_SOURCES.every((s) => !!s.key && !!s.label && !!s.icon && s.feature !== undefined && typeof s.needsWhen === 'boolean')
    && TRIGGER_SOURCES.length === new Set(TRIGGER_SOURCES.map((s) => s.key)).size,
    JSON.stringify(TRIGGER_SOURCES.map((s) => s.key)));
  ok('isTriggerSourceKey answers only for registry keys',
    TRIGGER_SOURCES.every((s) => isTriggerSourceKey(s.key)) && !isTriggerSourceKey('slack') && !isTriggerSourceKey(null));
  ok('doorLabel degrades honestly for a door with neither label nor condition',
    doorLabel({ type: 'reaction', source: 'file' }) === (triggerSource('file')?.label ?? ''),
    doorLabel({ type: 'reaction', source: 'file' }));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // SHARED PROBE STATE
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const userId = await resolveProbeUser(admin);
  const stamp = Date.now();
  const PFX = `Probe relay ${stamp}`;

  // THE MIGRATION PROBE — one read decides how the live sections run.
  const colProbe = await admin.from('workflows').select('id, triggers').limit(1);
  const HAS_COLUMN = !(colProbe.error && String((colProbe.error as { code?: string }).code) === '42703');
  if (colProbe.error && !HAS_COLUMN) console.log(`    · workflows.triggers: ABSENT (${(colProbe.error as { code?: string }).code})`);
  console.log(`\n    · MIGRATION STATE: workflows.triggers is ${HAS_COLUMN ? 'APPLIED' : 'NOT APPLIED'} in this environment`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // S — THE ONE SANITISER (pure ladder + the one roster read)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nS — THE ONE SANITISER (authorDoors; mode: live DB roster read):');
  const sIds: string[] = [];
  const NAME_ONE = `${PFX} Candidate screening`;
  const NAME_TWIN = `${PFX} Twin brief`;
  try {
    const mk = async (name: string) => {
      const { data } = await admin.from('workflows').insert({
        user_id: userId, name, status: 'active', trigger: { type: 'manual' }, steps: [],
      }).select('id').single();
      const id = (data as { id: string } | null)?.id ?? null;
      if (id) sIds.push(id); else { console.log(`  ✗ fixture "${name}" failed`); fail++; }
      return id;
    };
    const oneId = await mk(NAME_ONE);
    await mk(NAME_TWIN);
    await mk(NAME_TWIN);

    console.log('  · the pure by-name ladder (matchWorkflowByName):');
    {
      const roster = [{ id: 'a', name: 'Weekly market brief' }, { id: 'b', name: 'Candidate screening' }, { id: 'c', name: 'Candidate screening' }];
      ok('exact (case/space-insensitive) resolves',
        matchWorkflowByName([roster[0], roster[1]], '  WEEKLY   Market Brief ')?.id === 'a');
      ok('unique containment resolves', matchWorkflowByName([roster[0], roster[1]], 'market brief')?.id === 'a');
      ok('AMBIGUITY IS A REFUSAL — two tasks with the same name resolve to nothing',
        matchWorkflowByName(roster, 'Candidate screening') === null);
      ok('…and an ambiguous containment refuses too (never guess which pipeline feeds which)',
        matchWorkflowByName([{ id: 'a', name: 'Brief EN' }, { id: 'b', name: 'Brief PT' }], 'Brief') === null);
      ok('an empty roster or an empty name refuses', matchWorkflowByName([], 'x') === null && matchWorkflowByName(roster, '   ') === null);
    }

    console.log('  · the ladder through the sanitiser:');
    {
      const r = await authorDoors([{ source: 'linkedin', when: 'someone posts' }], { supabase: admin, userId });
      ok('(1) REGISTRY — an unknown source is dropped AND spoken',
        r.doors.length === 0 && r.notes.length === 1 && r.notes[0].includes('linkedin'), JSON.stringify(r));
    }
    {
      const r = await authorDoors([{ source: 'file', when: 'it is a signed contract' }], {
        supabase: admin, userId, features: feats({ drive: false }),
      });
      ok('(2) FEATURE — a door on an OFF feature is dropped AND spoken',
        r.doors.length === 0 && (r.notes[0] ?? '').includes('A file lands in Knowledge'), JSON.stringify(r));
    }
    {
      const r = await authorDoors([{ source: 'file', when: 'it is a signed contract' }], { supabase: admin, userId, features: null });
      ok('…and UNKNOWN features ABSTAIN (never invent a refusal)', r.doors.length === 1, JSON.stringify(r));
    }
    {
      const r = await authorDoors([{ source: 'meeting', when: '  ' }], { supabase: admin, userId, features: feats() });
      ok('(3) CONDITION — a judged door with a blank `when` is dropped AND spoken',
        r.doors.length === 0 && (r.notes[0] ?? '').includes('tell me what has to be true'), JSON.stringify(r));
    }
    {
      const r = await authorDoors([{ source: 'workflow', workflow_name: NAME_ONE }], { supabase: admin, userId, features: feats() });
      ok('(4) BINDING — an exact workflow NAME resolves to the user\'s own id (the model never emits ids)',
        r.doors.length === 1 && r.doors[0].workflow_id === oneId, JSON.stringify(r));
      ok('…and the door wears a spoken label naming the task',
        (r.doors[0]?.label ?? '').includes('Candidate screening'), String(r.doors[0]?.label));
    }
    {
      const r = await authorDoors([{ source: 'workflow', workflow_name: 'Candidate screening' }], { supabase: admin, userId, features: feats() });
      ok('…unique CONTAINMENT resolves', r.doors.length === 1 && r.doors[0].workflow_id === oneId, JSON.stringify(r));
    }
    {
      const r = await authorDoors([{ source: 'workflow', workflow_name: NAME_TWIN }], { supabase: admin, userId, features: feats() });
      ok('…AMBIGUITY is refused AND spoken (two tasks share the name)',
        r.doors.length === 0 && (r.notes[0] ?? '').includes(NAME_TWIN), JSON.stringify(r));
    }
    {
      const r = await authorDoors([{ source: 'workflow', workflow_name: NAME_ONE }], {
        supabase: admin, userId, features: feats(), selfWorkflowId: oneId,
      });
      ok('…SELF is refused AND spoken (law 5\'s circular floor, at the authoring door)',
        r.doors.length === 0 && (r.notes[0] ?? '').includes("can't be triggered by itself"), JSON.stringify(r));
    }
    {
      const r = await authorDoors([{ source: 'workflow' }], { supabase: admin, userId, features: feats() });
      ok('…a workflow door with no name at all is dropped AND spoken',
        r.doors.length === 0 && (r.notes[0] ?? '').includes('name the task'), JSON.stringify(r));
    }
    {
      const r = await authorDoors([
        { type: 'schedule', cron: '0 9 * * *' },
        { source: 'schedule', when: 'every morning' },
        { source: 'mail', when: 'it is a job application', cron: '0 9 * * *' },
      ], { supabase: admin, userId, features: feats() });
      ok('(5) LAW 6 — every schedule-shaped entry is refused AND spoken, never merged into a door',
        r.doors.length === 0 && r.notes.length >= 1 && r.notes.every((n) => n.includes('only one schedule')),
        JSON.stringify(r));
    }
    {
      const r = await authorDoors([
        { source: 'mail', when: 'it is a job application' },
        { source: 'mail', when: 'it is a job application' },
        { source: 'file', when: 'the file is a CV', label: 'CV uploaded' },
      ], { supabase: admin, userId, features: feats(), existing: [{ type: 'reaction', source: 'mail', when: 'it is a job application' }] });
      ok('SURVIVORS ARE NORMALIZED — the one reader has the last word (dedupe across existing+new)',
        r.doors.length === 2 && r.doors.every((d) => d.type === 'reaction')
        && r.doors.map((d) => d.source).join(',') === 'mail,file', JSON.stringify(r.doors));
      ok('…and EXISTING doors survive an additive author (nothing the user didn\'t mention is lost)',
        r.doors[0].when === 'it is a job application', JSON.stringify(r.doors[0]));
    }
    ok('garbage input authors nothing and says nothing (silence is not a drop)',
      JSON.stringify(await authorDoors('not an array', { supabase: admin, userId })) === JSON.stringify({ doors: [], notes: [] }));
    ok('doorsForStorage stores NULL for empty (the discovery read stays narrow) and the array otherwise',
      doorsForStorage([]) === null && (doorsForStorage([{ type: 'reaction', source: 'mail', when: 'x' }]) ?? []).length === 1);
    ok('doorNote joins DISTINCT notes and stays null when there is nothing to say',
      doorNote([]) === null && doorNote(['a', 'a', 'b']) === 'a b');
    ok('describeDoors says "none" rather than nothing at all',
      describeDoors([]) === 'none' && describeDoors([{ type: 'reaction', source: 'mail', when: 'a tender lands' }]) === 'When a tender lands');
  } finally {
    for (const id of sIds) await admin.from('workflows').delete().eq('id', id);
    const { data: left } = await admin.from('workflows').select('id').eq('user_id', userId).like('name', `${PFX}%`);
    ok('S probe leftovers are ZERO', (left ?? []).length === 0, String((left ?? []).length));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // R — READINESS RULE 5 (pure)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nR — READINESS: THE DOORS (rule 5; mode: pure):');
  const steps = [{ type: 'ai', label: 'Write it' }];
  ok('a JUDGED door with a blank `when` → the pinned legacy sentence',
    reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'file', when: '  ' }] }, feats()))
      === 'The trigger needs an event to react to.',
    String(reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'file' }] }, feats()))));
  ok('…the legacy reaction trigger reaches the SAME sentence through the fold (one rule, both shapes)',
    reasonOf(readinessOf({ status: 'active', steps, trigger: { type: 'reaction', when: '' } }, feats()))
      === 'The trigger needs an event to react to.');
  ok('a WORKFLOW door with nothing bound → its own sentence',
    reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'workflow' }] }, feats()))
      === "The 'when another workflow delivers' door needs a workflow.",
    String(reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'workflow' }] }, feats()))));
  ok('…a BOUND workflow door is ready (and needs no condition — it is structural)',
    readinessOf({ status: 'active', steps, triggers: [{ source: 'workflow', workflow_id: 'wf-a' }] }, feats()).ready === true);
  ok('a door whose SOURCE feature is off → the feature grammar',
    reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'file', when: 'it is a signed contract' }] }, feats({ drive: false })))
      === 'The A file lands in Knowledge door needs Knowledge enabled.',
    String(reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'file', when: 'it is a signed contract' }] }, feats({ drive: false })))));
  ok('…and it stays inside the ledger-row budget',
    (reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'meeting', when: 'it was a client call' }] }, feats({ meetings: false }))) ?? '').length
      <= READINESS_REASON_MAX);
  ok('NULL features → the door feature rule ABSTAINS (an unknown workspace invents no unreadiness)',
    readinessOf({ status: 'active', steps, triggers: [{ source: 'file', when: 'it is a signed contract' }] }, null).ready === true);
  ok('a workspace with the feature ON is ready on the same door',
    readinessOf({ status: 'active', steps, triggers: [{ source: 'file', when: 'it is a signed contract' }] }, feats()).ready === true);
  ok('FIRST OFFENDING DOOR SPEAKS (authoring order), and a good door never masks a bad one',
    reasonOf(readinessOf({ status: 'active', steps, triggers: [{ source: 'mail', when: 'a tender lands' }, { source: 'workflow' }] }, feats()))
      === "The 'when another workflow delivers' door needs a workflow.");
  ok('a garbage door list is simply no doors (rule 5 never throws)',
    readinessOf({ status: 'active', steps, triggers: 'oops' }, feats()).ready === true);
  ok('ORDER IS SEVERITY — the orphan handoff still outranks a broken door',
    reasonOf(readinessOf({ status: 'active', steps: [{ type: 'handoff' }], triggers: [{ source: 'workflow' }] }, feats()))
      === "The 'Wait on a person' step needs a person.");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // F — THE FIRE FLOORS (live; migration-aware)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const { checkSourceReactions } = await import('../lib/workflows/reactions');
  const FPFX = `Probe relay fire ${stamp}`;
  const fireIds: string[] = [];
  const capKeys: string[] = [];
  // ⚠️ THE AI FENCE LIVES IN A CHILD PROCESS — see THE HARNESS LESSON at the top of this file.
  // It is applied below to the ONE gate that needs it (the structural door's zero-AI proof).
  // Nothing in THIS process ever loses its keys.
  let fenceScript: string | null = null;
  const limitKeys: string[] = [];

  try {
    const mkWf = async (name: string, doors: ReactionDoor[] | null) => {
      const { data, error } = await admin.from('workflows').insert({
        user_id: userId, name, status: 'active', trigger: { type: 'manual' }, steps: [],
        // Steps are EMPTY on purpose: if a host ever did run one of these, readiness refuses it at
        // the door — a probe fixture can never produce work.
        ...(HAS_COLUMN && doors ? { triggers: doors } : {}),
      }).select('id').single();
      const id = (data as { id: string } | null)?.id ?? null;
      if (!id) { console.log(`  ✗ fire fixture "${name}" failed — ${error?.message}`); fail++; }
      else fireIds.push(id);
      return id;
    };
    const legacyWf = async (name: string, when: string) => {
      const { data } = await admin.from('workflows').insert({
        user_id: userId, name, status: 'active', trigger: { type: 'reaction', when }, steps: [],
      }).select('id').single();
      const id = (data as { id: string } | null)?.id ?? null;
      if (id) fireIds.push(id); else { console.log(`  ✗ legacy fixture "${name}" failed`); fail++; }
      return id;
    };

    const upId = await mkWf(`${FPFX} upstream`, null);
    const boundId = await mkWf(`${FPFX} bound`, upId ? [{ type: 'reaction', source: 'workflow', workflow_id: upId }] : null);
    const selfId = await mkWf(`${FPFX} self`, null);
    if (selfId && HAS_COLUMN) {
      await admin.from('workflows').update({ triggers: [{ type: 'reaction', source: 'workflow', workflow_id: selfId }] }).eq('id', selfId);
    }
    const fileId = await mkWf(`${FPFX} file door`, [{ type: 'reaction', source: 'file', when: 'the file is a probe fixture' }]);
    const meetId = await mkWf(`${FPFX} meeting door`, [{ type: 'reaction', source: 'meeting', when: 'it was a probe call' }]);
    const mailId = await legacyWf(`${FPFX} legacy mail`, 'it is a probe email');

    /** The fixture rows the Proxy answers the discovery select with. */
    const fixtureRow = (id: string | null, doors: ReactionDoor[]) =>
      ({ id, name: 'fixture', trigger: { type: 'manual' }, triggers: doors });

    /** Put a workflow AT its throttle (W3b): a limit of 1 plus one already-STARTED fire record.
     *  Whatever the judge decides below, nothing can START — so the token gates never depend on a
     *  model's verdict, and the section starts no runs it would then have to reason about. */
    const seedAtLimit = async (wfId: string) => {
      limitKeys.push(wfId);
      await admin.from('item_plans').insert({
        user_id: userId, kind: 'workflow_limit', entity_id: wfId, tasks: { dailyFires: 1 },
      });
      const key = `${wfId}:seed:${stamp}`;
      capKeys.push(key);
      await admin.from('item_plans').insert({
        user_id: userId, kind: 'reaction_fire', entity_id: key,
        tasks: { runId: null, reason: 'throttle seed', startedAt: new Date().toISOString() },
      });
    };
    const seedFire = async (key: string) => {
      capKeys.push(key);
      await admin.from('item_plans').insert({ user_id: userId, kind: 'reaction_fire', entity_id: key, tasks: { runId: null, reason: 'exactly-once seed' } });
    };
    const runsOf = async (wfId: string) => {
      const { data } = await admin.from('workflow_runs').select('id, triggered_by').eq('workflow_id', wfId);
      return (data ?? []) as Array<{ id: string; triggered_by: string }>;
    };

    // ── THE STRUCTURAL DOOR, once per available mode ──────────────────────────────────────────
    const modes: Array<{ tag: string; client: SupabaseClient }> = [];
    if (HAS_COLUMN) modes.push({ tag: 'live (stored triggers)', client: admin });
    modes.push({
      tag: 'fixture-proxy (migration-absent pattern)',
      client: doorProxy(admin, (cols) => ({
        data: WIDE(cols)
          ? [fixtureRow(boundId, [{ type: 'reaction', source: 'workflow', workflow_id: upId! }]),
             fixtureRow(selfId, [{ type: 'reaction', source: 'workflow', workflow_id: selfId! }])]
          : [],
        error: null,
      })),
    });

    for (const mode of modes) {
      console.log(`\nF — THE WORKFLOW DOOR (structural, no judge) [mode: ${mode.tag}]:`);
      const evA = randomUUID(), evB = randomUUID(), evC = randomUUID();
      const before = (await runsOf(boundId!)).length;

      const r1 = await checkSourceReactions(mode.client, userId, 'workflow',
        [{ id: evA, sourceId: upId!, title: `${FPFX} upstream`, gist: 'the upstream delivered' }]);
      ok('an upstream delivery FIRES the bound workflow', r1?.fired === 1, JSON.stringify(r1));
      ok('…and it STARTED (the throttle is nowhere near its floor on a fresh fixture)',
        r1?.fired === 1 && (r1?.deferred ?? 0) === 0, JSON.stringify(r1));
      {
        const { data: rec } = await admin.from('item_plans').select('entity_id, tasks')
          .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', `${boundId}:workflow:${evA}`).maybeSingle();
        ok('THE EXACTLY-ONCE TOKEN is the literal `:workflow:` key', !!rec, `${boundId}:workflow:${evA}`);
        ok('…and the match reason is the engine\'s own words, not a model\'s',
          (rec?.tasks as { reason?: string } | undefined)?.reason === 'the upstream workflow delivered',
          String((rec?.tasks as { reason?: string } | undefined)?.reason));
        if (rec) capKeys.push(`${boundId}:workflow:${evA}`);
      }
      ok('…exactly ONE queued event run was enqueued', (await runsOf(boundId!)).length === before + 1,
        `${(await runsOf(boundId!)).length} vs ${before}`);
      ok('THE SELF-LOOP FLOOR — the self-naming workflow was NOT fired by that delivery',
        (await runsOf(selfId!)).length === 0, String((await runsOf(selfId!)).length));

      const r2 = await checkSourceReactions(mode.client, userId, 'workflow',
        [{ id: evB, sourceId: selfId!, title: `${FPFX} self`, gist: 'its own delivery' }]);
      ok('THE SELF-LOOP FLOOR — a workflow\'s OWN delivery never opens its own door',
        r2?.fired === 0 && (await runsOf(selfId!)).length === 0, JSON.stringify(r2));

      const r3 = await checkSourceReactions(mode.client, userId, 'workflow',
        [{ id: evA, sourceId: upId!, title: `${FPFX} upstream`, gist: 'the same delivery again' }]);
      ok('EXACTLY-ONCE — replaying the SAME delivery fires nothing',
        r3?.fired === 0 && (await runsOf(boundId!)).length === before + 1, JSON.stringify(r3));

      const r4 = await checkSourceReactions(mode.client, userId, 'workflow',
        [{ id: evC, sourceId: upId!, title: `${FPFX} upstream`, gist: 'a second delivery' }]);
      ok('…but a SECOND delivery (a new run id) fires again',
        r4?.fired === 1 && (await runsOf(boundId!)).length === before + 2, JSON.stringify(r4));
      capKeys.push(`${boundId}:workflow:${evC}`);
    }

    // ── THE ZERO-AI PROOF, IN A CHILD PROCESS ─────────────────────────────────────────────────
    // The `workflow` source is STRUCTURAL: no judge is in its path. The proof is a fire with the
    // provider keys POISONED — but the poison must never touch THIS process (the harness lesson at
    // the top of the file), so it is applied to a fresh process's env before a single app module
    // loads. The parent then reads the fire's real record out of the real table.
    if (HAS_COLUMN && boundId && upId) {
      console.log('\nF — THE STRUCTURAL DOOR IS ZERO-AI [mode: child process, poisoned env]:');
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs/promises');
      const evZ = randomUUID();
      capKeys.push(`${boundId}:workflow:${evZ}`);
      fenceScript = 'scripts/.smoke-relay-zeroai.tmp.ts';
      await fs.writeFile(fenceScript, [
        `// TEMPORARY child of scripts/smoke-relay.ts (F). Deleted by the parent's finally block.`,
        `for (const k of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','AWS_BEDROCK_ACCESS_KEY_ID','AWS_BEDROCK_SECRET_ACCESS_KEY','AZURE_OPENAI_API_KEY']) {`,
        `  delete process.env[k];`,
        `}`,
        `import { createClient } from '@supabase/supabase-js';`,
        `import { checkSourceReactions } from '@/lib/workflows/reactions';`,
        `(async () => {`,
        `  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);`,
        `  const r = await checkSourceReactions(admin, ${JSON.stringify(userId)}, 'workflow', [{`,
        `    id: ${JSON.stringify(evZ)}, sourceId: ${JSON.stringify(upId)},`,
        `    title: 'probe upstream', gist: 'the upstream delivered',`,
        `  }]);`,
        `  console.log('__RELAY_ZEROAI__' + JSON.stringify(r ?? {}));`,
        `})().catch((e) => { console.log('__RELAY_ZEROAI__' + JSON.stringify({ threw: String(e && e.message || e) })); });`,
      ].join('\n'), 'utf8');

      let child: { fired?: number; deferred?: number; considered?: number; threw?: string } = {};
      try {
        const raw = execSync(`npx tsx --env-file=.env.local ${fenceScript}`, {
          cwd: process.cwd(), encoding: 'utf8', timeout: 240_000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const line = raw.split('\n').find((l) => l.includes('__RELAY_ZEROAI__'));
        child = line ? JSON.parse(line.slice(line.indexOf('__RELAY_ZEROAI__') + '__RELAY_ZEROAI__'.length)) : {};
      } catch (e) {
        child = { threw: `child process failed: ${(e as Error).message.slice(0, 200)}` };
      }
      ok('WITH EVERY PROVIDER KEY REMOVED the upstream delivery still FIRES (a judged path could not have matched)',
        !child.threw && child.fired === 1, child.threw ?? JSON.stringify(child));
      const { data: zrec } = await admin.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', `${boundId}:workflow:${evZ}`).maybeSingle();
      ok('…leaving a real fire record whose reason is the ENGINE\'s own words, never a model\'s',
        (zrec?.tasks as { reason?: string } | undefined)?.reason === 'the upstream workflow delivered',
        String((zrec?.tasks as { reason?: string } | undefined)?.reason));
    }

    // ── THE SOURCE TOKENS (deterministic: the fixtures sit AT their throttle) ───────────────────
    const tokenMode = HAS_COLUMN ? 'live (stored triggers)' : 'fixture-proxy (migration-absent pattern)';
    console.log(`\nF — THE SOURCE TOKENS (exactly-once keys) [mode: ${tokenMode} · mail: live legacy]:`);
    const tokenClient = HAS_COLUMN ? admin : doorProxy(admin, (cols) => ({
      data: WIDE(cols)
        ? [fixtureRow(fileId, [{ type: 'reaction', source: 'file', when: 'the file is a probe fixture' }]),
           fixtureRow(meetId, [{ type: 'reaction', source: 'meeting', when: 'it was a probe call' }])]
        : [],
      error: null,
    }));
    for (const id of [fileId, meetId, mailId]) if (id) await seedAtLimit(id);

    for (const [source, wfId, token, client] of [
      ['file', fileId, 'file', tokenClient],
      ['meeting', meetId, 'meeting', tokenClient],
      ['mail', mailId, 'inbox', admin],
    ] as Array<['file' | 'meeting' | 'mail', string, string, SupabaseClient]>) {
      const fresh = randomUUID(), seeded = randomUUID(), wrong = randomUUID();
      const runsBeforeToken = (await runsOf(wfId)).filter(r => r.triggered_by === 'event').length;
      const rFresh = await checkSourceReactions(client, userId, source, [{ id: fresh, title: 'probe', gist: 'probe event' }]);
      // THE TOKEN LAW is a PRE-JUDGE fact: discovery and candidacy are decided by the exactly-once
      // key alone. The fixture sits AT its throttle, so whatever the judge says, nothing STARTS —
      // the assertion never rides a model's verdict.
      ok(`${source}: the door is DISCOVERED and the event considered (the exactly-once key is fresh)`,
        rFresh?.considered === 1 && rFresh?.fired === 0, JSON.stringify(rFresh));
      ok(`${source}: …and AT THE THROTTLE nothing started — a matched event would only be queued`,
        (await runsOf(wfId)).filter(r => r.triggered_by === 'event').length
          === runsBeforeToken + (rFresh?.deferred ?? 0),
        `${(await runsOf(wfId)).length} runs · deferred ${rFresh?.deferred}`);

      await seedFire(`${wfId}:${token}:${seeded}`);
      const rSeeded = await checkSourceReactions(client, userId, source, [{ id: seeded, title: 'probe', gist: 'probe event' }]);
      ok(`${source}: a fire record on the literal \`:${token}:\` key SUPPRESSES the event`,
        rSeeded?.considered === 0 && rSeeded?.fired === 0, JSON.stringify(rSeeded));

      if (source === 'mail') {
        // The historical token is load-bearing: every pre-W1 record uses `inbox`. A record under the
        // REGISTRY key must not suppress — if it did, the token had silently changed and every
        // already-handled email would re-fire exactly once.
        await seedFire(`${wfId}:mail:${wrong}`);
        const rWrong = await checkSourceReactions(client, userId, 'mail', [{ id: wrong, title: 'probe', gist: 'probe event' }]);
        ok('mail: a record under the REGISTRY key `:mail:` does NOT suppress (the token is historical)',
          rWrong?.considered === 1, JSON.stringify(rWrong));
      }
    }

    // ── THE DEGRADATION (documented: silent no-op, legacy-mail-only) ────────────────────────────
    const degTag = HAS_COLUMN ? 'degradation-simulated (42703 proxy)' : 'native (column absent)';
    console.log(`\nF — PRE-MIGRATION DEGRADATION [mode: ${degTag}]:`);
    {
      // The wide select 42703s exactly as it does before the migration; the legacy fallback answers
      // with the one shape that existed pre-W1 — a mail reaction trigger.
      const degraded = doorProxy(admin, (cols) => (WIDE(cols)
        ? { data: null, error: { code: '42703', message: 'column workflows.triggers does not exist' } }
        : { data: [{ id: mailId, name: `${FPFX} legacy mail`, trigger: { type: 'reaction', when: 'it is a probe email' } }], error: null }));

      // THE NEW-DOOR HALF is where "zero runs" is the law: the three new sources must not exist at
      // all before the migration. (The mail half below is scoped separately — the legacy door IS
      // discovered there, and a discovered door is allowed to queue.)
      const runsBefore = (await admin.from('workflow_runs').select('id').in('workflow_id', fireIds)).data?.length ?? 0;
      for (const source of ['file', 'meeting', 'workflow'] as const) {
        const r = await checkSourceReactions(degraded, userId, source,
          [{ id: randomUUID(), sourceId: upId!, title: 'probe', gist: 'probe event' }]);
        ok(`${source}: a NEW door is a SILENT no-op before the migration (no throw, no fire)`, r === null, JSON.stringify(r));
      }
      const runsAfter = (await admin.from('workflow_runs').select('id').in('workflow_id', fireIds)).data?.length ?? 0;
      ok('…and the degraded NEW-DOOR pass created ZERO runs', runsAfter === runsBefore, `${runsBefore} → ${runsAfter}`);

      const rMail = await checkSourceReactions(degraded, userId, 'mail', [{ id: randomUUID(), title: 'probe', gist: 'probe event' }]);
      ok('mail: the LEGACY reaction is still discovered through the fallback (behaviour preserved)',
        rMail?.considered === 1, JSON.stringify(rMail));
      ok('…and it STARTS nothing — the legacy fixture is at its throttle, so a match could only queue',
        (rMail?.fired ?? 0) === 0, JSON.stringify(rMail));
    }
  } finally {
    if (fenceScript) {
      const fs = await import('node:fs/promises');
      await fs.rm(fenceScript, { force: true });
      ok('the zero-AI child script is removed', !(await fs.stat(fenceScript).then(() => true).catch(() => false)));
    }
    for (const id of fireIds) {
      await admin.from('workflow_runs').delete().eq('workflow_id', id);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'reaction_fire').like('entity_id', `${id}:%`);
      await admin.from('workflows').delete().eq('id', id);
    }
    for (const id of limitKeys) {
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'workflow_limit').eq('entity_id', id);
    }
    for (const k of capKeys) await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', k);
    const { data: leftWf } = await admin.from('workflows').select('id').eq('user_id', userId).like('name', `${FPFX}%`);
    const { data: leftRuns } = await admin.from('workflow_runs').select('id')
      .in('workflow_id', fireIds.length ? fireIds : ['00000000-0000-0000-0000-000000000000']);
    const { data: leftFires } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', 'reaction_fire').gte('created_at', new Date(stamp - 60_000).toISOString());
    const { data: leftLimits } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', 'workflow_limit').gte('created_at', new Date(stamp - 60_000).toISOString());
    ok('F probe leftovers are ZERO (workflows · runs · fire records · limit rows)',
      (leftWf ?? []).length === 0 && (leftRuns ?? []).length === 0
      && (leftFires ?? []).length === 0 && (leftLimits ?? []).length === 0,
      `${(leftWf ?? []).length}/${(leftRuns ?? []).length}/${(leftFires ?? []).length}/${(leftLimits ?? []).length}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // SOURCE FLOORS (comment-stripped)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const studio = readFileSync('components/work/studio-builder.tsx', 'utf8');
  const studioCode = stripComments(studio);
  const reactionsSrc = stripComments(readFileSync('lib/workflows/reactions.ts', 'utf8'));
  const genCfg = readFileSync('lib/workflows/generate-config.ts', 'utf8');
  const genCfgCode = stripComments(genCfg);
  const workerTasks = stripComments(readFileSync('lib/tools/worker-tasks.ts', 'utf8'));
  const wfPost = stripComments(readFileSync('app/api/workflows/route.ts', 'utf8'));
  const wfPatch = stripComments(readFileSync('app/api/workflows/[id]/route.ts', 'utf8'));
  const draftCard = stripComments(readFileSync('components/workflows/workflow-draft-card.tsx', 'utf8'));
  const runWfCode = stripComments(readFileSync('lib/workflows/run-workflow.ts', 'utf8'));
  const driveConfirm = stripComments(readFileSync('app/api/drive/upload/confirm/route.ts', 'utf8'));
  const botManager = stripComments(readFileSync('lib/integrations/meeting-bot/bot-manager.ts', 'utf8'));

  console.log('\nD — THE DESTROYER FLOOR (Studio never writes `trigger` while dropping doors; mode: source):');
  ok('setPrimary FOLDS a legacy reaction into `triggers` in the SAME state write',
    /const setPrimary = useCallback\(\(t: WorkflowTrigger\) => \{[\s\S]{0,400}?normalizeTriggers\(w\)[\s\S]{0,120}?return \{ \.\.\.w, trigger: t, triggers: doors \};/.test(studioCode),
    'setPrimary does not carry the fold');
  ok('…and it leaves the doors alone when there is nothing to migrate',
    /if \(w\.trigger\?\.type !== 'reaction'\) return \{ \.\.\.w, trigger: t \};/.test(studioCode));
  ok('setDoors retires the legacy carrier only AFTER the fold is in the list it was handed',
    /const setDoors = useCallback\(\(doors: ReactionDoor\[\]\) => \{[\s\S]{0,400}?triggers: doors,[\s\S]{0,240}?trigger: w\.trigger\?\.type === 'reaction' \? \{ type: 'manual' \} : w\.trigger,/.test(studioCode));
  {
    const body = studioCode.slice(studioCode.indexOf('const save = useCallback('));
    const saveBody = body.slice(0, body.indexOf('}, [workflow]);'));
    ok('save() derives BOTH halves from ONE normalized read (they can never shear)',
      /const \{ primary, doors \} = normalizeTriggers\(workflow\);/.test(saveBody));
    ok('…and the PATCH body carries BOTH `trigger` and `triggers`',
      /trigger: triggerToSave,/.test(saveBody) && /\n\s*triggers: doors,/.test(saveBody));
    ok('…and a response that omits the additive column never erases what we just wrote',
      /setWorkflow\(saved\.triggers === undefined \? \{ \.\.\.saved, triggers: doors \} : saved\);/.test(saveBody));
  }
  ok('THE OVERWRITE BUTTONS ARE GONE — no bare `onChange({ type: \'manual\' })` trigger-type button survives',
    !/onChange\(\{\s*type:\s*'manual'\s*\}\)/.test(studioCode) && !/onChange\(\{\s*type:\s*'reaction'/.test(studioCode));
  ok('…and nothing in the builder authors a reaction onto `trigger` any more',
    !/trigger:\s*\{\s*type:\s*'reaction'/.test(studioCode));
  ok('the doors picker renders FROM THE REGISTRY (law 3)',
    /TRIGGER_SOURCES\.map\(src =>/.test(studioCode) && studioCode.includes("from '@/lib/workflows/trigger-sources'"));
  ok('…with NO hardcoded source list anywhere in the file',
    !/\[\s*'mail'\s*,/.test(studioCode) && !/\[\s*'file'\s*,/.test(studioCode),
    'a literal source array survives in studio-builder');
  ok('…and the picker gates each row on the registry\'s own feature key',
    /const allowed = src\.feature === null \|\| features\[src\.feature\] !== false;/.test(studioCode));
  ok('the rail\'s WHEN summary reads the same one reader (no second door derivation)',
    /const \{ primary, doors \} = normalizeTriggers\(workflow\);/.test(studioCode.slice(studioCode.indexOf('function whenEntries('))));

  console.log('\nP — THE FOUR-DOOR PARITY SWEEP (one schema, four doors; mode: source):');
  ok('DOOR 1 (describe-it): generate-config authors through THE ONE SANITISER',
    /import \{ authorDoors[^}]*\} from '@\/lib\/workflows\/author-doors'/.test(genCfgCode)
    && /await authorDoors\(generated\.triggers, \{ supabase, userId, features \}\)/.test(genCfgCode));
  ok('…its prompt INTERPOLATES the registry catalogue (no hardcoded prose)',
    genCfg.includes('${renderDoorCatalogue()}'));
  ok('…and no registry label is typed by hand anywhere in the file',
    TRIGGER_SOURCES.every((s) => !genCfg.includes(s.label)),
    TRIGGER_SOURCES.filter((s) => genCfg.includes(s.label)).map((s) => s.label).join(', '));
  ok('…and it emits the doors + the spoken drop note on the draft',
    /triggers: doors,/.test(genCfgCode) && /needs_door_note: needsDoorNote,/.test(genCfgCode));
  ok('…a sanitiser failure never loses the draft (the pipeline stands, doors empty)',
    /catch \{[\s\S]{0,160}?doors = \[\];/.test(genCfgCode));
  ok('DOOR 2 (coworker chat): create_task takes `trigger_doors`, update_task takes add/remove',
    /trigger_doors: \{/.test(workerTasks) && /add_trigger_doors: \{/.test(workerTasks) && /remove_trigger_doors: \{/.test(workerTasks));
  ok('…their descriptions are RENDERED from the registry (doorCatalogueOneLine), never typed',
    (workerTasks.match(/\$\{doorCatalogueOneLine\(\)\}/g) ?? []).length >= 3
    && TRIGGER_SOURCES.every((s) => !workerTasks.includes(s.label)));
  ok('…and BOTH executors sanitise through authorDoors (a chat wish is never stored raw)',
    (workerTasks.match(/await authorDoors\(/g) ?? []).length === 2, String((workerTasks.match(/await authorDoors\(/g) ?? []).length));
  ok('…update_task is ADDITIVE (existing doors ride in) and refuses SELF',
    /existing: doors,\n\s*selfWorkflowId: taskId,/.test(workerTasks));
  ok('…and it stores through doorsForStorage (normalized, or NULL when empty)',
    /update\.triggers = doorsForStorage\(doors\);/.test(workerTasks));
  ok('…a workspace without the column is SAID, not silently ignored',
    /if \(!raw\.ok\) \{[\s\S]{0,200}?event doors aren't available in this workspace/.test(workerTasks));
  {
    const insert = wfPost.slice(wfPost.indexOf('.insert({'), wfPost.indexOf(".select('*')"));
    ok('DOOR 3 (POST /api/workflows): the doors write is SEPARATE from the insert',
      !insert.includes('triggers'), 'triggers rides the creating insert — a 42703 would cost the workflow');
    const after = wfPost.slice(wfPost.indexOf("if (body.triggers !== undefined && data)"));
    const block = after.slice(0, after.indexOf('\n  }\n'));
    ok('…it normalizes through THE ONE READER before storing',
      /const \{ doors \} = normalizeTriggers\(\{ triggers: body\.triggers \}\);/.test(block));
    ok('…it is a best-effort UPDATE wrapped in try/catch (a 42703 costs the doors, never the creation)',
      block.includes('try {') && block.includes("from('workflows')") && block.includes('.update({ triggers')
      && /catch \(e\) \{[\s\S]{0,160}?doors not persisted/.test(block));
    ok('…and it stores NULL for empty, so `triggers is not null` stays a real discovery filter',
      /triggers: doors\.length \? doors : null/.test(block));
  }
  ok('DOOR 3b (PATCH): stored normalized, NULL when empty',
    /const doors = normalizeTriggers\(\{ triggers: body\.triggers \}\)\.doors;/.test(wfPatch)
    && /update\.triggers = doors\.length \? doors : null;/.test(wfPatch));
  ok('DOOR 4 (serving): the workflow GET and the ledger both serve doorsForServing',
    /doorsForServing\(\{ trigger: data\.trigger, triggers: data\.triggers \}\)/.test(wfPatch)
    && stripComments(readFileSync('app/api/workflows/ledger/route.ts', 'utf8')).includes('doorsForServing('));
  ok('THE CREATION CARD carries `triggers` into the Confirm body (a said door survives creation)',
    /\.\.\.\(draft\.triggers\?\.length \? \{ triggers: draft\.triggers \} : \{\}\)/.test(draftCard));
  ok('…and it SPEAKS a refused door (the needs-note law, not a silent absence)',
    /draft\.needs_door_note && \(/.test(draftCard) && /\{draft\.needs_door_note\}/.test(draftCard));
  ok('…and it renders the doors beside the trigger (the card says how the work starts)',
    /draft\.triggers!\.map\(/.test(draftCard));

  console.log('\nH — THE HUMAN-ACT + TEST FLOORS (mode: source, repo-wide):');
  {
    // A file "LANDS in Knowledge" is a HUMAN act. Every other writer of knowledge_files (workflow
    // artifacts, meeting transcripts) must NOT be a door — that loop nobody authored.
    const { readdirSync, statSync } = await import('fs');
    const callers: Array<{ file: string; sources: string[] }> = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e.startsWith('.')) continue;
        const p = `${dir}/${e}`;
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(p)) continue;
        const src = stripComments(readFileSync(p, 'utf8'));
        if (!/checkSourceReactions\(/.test(src)) continue;
        if (/export async function checkSourceReactions\(/.test(src)) continue; // the module itself
        const sources = [...src.matchAll(/checkSourceReactions\([^,]+,[^,]+,\s*'([a-z]+)'/g)].map((m) => m[1]);
        callers.push({ file: p, sources });
      }
    };
    for (const root of ['lib', 'app', 'components', 'scripts']) walk(root);
    const prod = callers.filter((c) => !c.file.startsWith('scripts/'));
    const fileCallers = prod.filter((c) => c.sources.includes('file')).map((c) => c.file);
    ok('the `file` door fires from the UPLOAD confirm route and NOWHERE else',
      fileCallers.length === 1 && fileCallers[0] === 'app/api/drive/upload/confirm/route.ts', fileCallers.join(', '));
    ok('the indexer paths (indexArtifact / knowledge indexing) are NOT doors',
      !stripComments(readFileSync('lib/knowledge/indexer.ts', 'utf8')).includes('checkSourceReactions'));
    ok('the `meeting` door fires only from the ONE completion point',
      prod.filter((c) => c.sources.includes('meeting')).map((c) => c.file).join(',') === 'lib/integrations/meeting-bot/bot-manager.ts');
    ok('the `workflow` door fires only from the run success tail',
      prod.filter((c) => c.sources.includes('workflow')).map((c) => c.file).join(',') === 'lib/workflows/run-workflow.ts');
    ok('…and there are exactly THREE production fire seams (one per new source)',
      prod.length === 3, prod.map((c) => c.file).join(', '));
  }
  {
    // THE TEST FLOOR, asserted STRUCTURALLY: brace-match the `if (!opts.isTest)` block and prove the
    // seam sits inside it — a test run delivers nothing and must therefore fire nothing.
    const seamAt = runWfCode.indexOf("checkSourceReactions(admin, workflow.user_id, 'workflow'");
    const blockOf = (start: number) => {
      let depth = 0;
      for (let i = runWfCode.indexOf('{', start); i < runWfCode.length; i++) {
        if (runWfCode[i] === '{') depth++;
        else if (runWfCode[i] === '}') { depth--; if (depth === 0) return runWfCode.slice(start, i); }
      }
      return '';
    };
    // The file holds several test guards — the law is that SOME `if (!opts.isTest)` block ENCLOSES
    // the seam, so every occurrence is brace-matched and the enclosing one is the one that counts.
    let guarded = '';
    for (const m of runWfCode.matchAll(/if \(!opts\.isTest\) \{/g)) {
      const body = blockOf(m.index!);
      if (body.includes("checkSourceReactions(admin, workflow.user_id, 'workflow'")) { guarded = body; break; }
    }
    ok('…the seam exists at all (the run success tail carries the workflow door)', seamAt > -1);
    ok('the workflow fire seam sits INSIDE `if (!opts.isTest)` (test mode fires nothing)',
      guarded.includes("checkSourceReactions(admin, workflow.user_id, 'workflow'"), 'seam is outside the test guard');
    ok('…and the whole file has exactly ONE such call (no second, unguarded seam)',
      (runWfCode.match(/checkSourceReactions\(/g) ?? []).length === 1);
    ok('…the event id is the RUN\'s and the sourceId is the WORKFLOW\'s (a second delivery can fire)',
      /id: runId,\s*sourceId: workflow\.id,/.test(guarded));
  }
  {
    const seam = (src: string, name: string, needle: string) => {
      const at = src.indexOf(needle);
      const before = src.slice(Math.max(0, at - 900), at);
      const afterTxt = src.slice(at, at + 900);
      ok(`${name}: the seam is host-safe (try/catch around the call)`,
        at > -1 && before.lastIndexOf('try {') > before.lastIndexOf('function ') && /catch/.test(afterTxt), `at ${at}`);
    };
    seam(driveConfirm, 'upload confirm', "checkSourceReactions(adminClient, user.id, 'file'");
    seam(botManager, 'meeting completion', "checkSourceReactions(supabase, userId, 'meeting'");
    seam(runWfCode, 'run success tail', "checkSourceReactions(admin, workflow.user_id, 'workflow'");
    ok('upload confirm defers the door to after() (the upload never waits on a reaction)',
      /after\(async \(\) => \{[\s\S]{0,900}?checkSourceReactions\(adminClient, user\.id, 'file'/.test(driveConfirm));
    ok('meeting completion prefers after() and falls back to inline when there is no request scope',
      /after\(fire\);/.test(botManager) && /catch \{[\s\S]{0,200}?await fire\(\);/.test(botManager));
    ok('every seam is NON-FATAL by contract (checkSourceReactions itself swallows and logs)',
      /export async function checkSourceReactions\([\s\S]{0,400}?try \{[\s\S]{0,400}?\} catch \(e\) \{[\s\S]{0,160}?return null;/.test(reactionsSrc));
  }
  ok('THE HISTORICAL MAIL TOKEN is pinned in code (changing it would re-fire every handled email)',
    /return source === 'mail' \? 'inbox' : source;/.test(reactionsSrc));
  {
    const branch = reactionsSrc.slice(reactionsSrc.indexOf("const matched = door.source === 'workflow'"));
    const structural = branch.slice(0, branch.indexOf(': await judgeCandidates('));
    ok('THE STRUCTURAL BRANCH calls no judge and no AI (composition is deterministic)',
      structural.length > 0 && !/judgeCandidates|aiCreate|getAIClient/.test(structural), structural.slice(0, 120));
    ok('…and THE SELF-LOOP FLOOR is code, not prose',
      /\(c\.sourceId \?\? ''\) !== wf\.id/.test(structural));
  }
  ok('discovery reads THE ONE READER (a legacy row and an authored row are indistinguishable)',
    /const \{ doors \} = normalizeTriggers\(r as \{ trigger\?: unknown; triggers\?: unknown \}\);/.test(reactionsSrc));
  ok('…and the widened select falls back to legacy-only when the column is absent',
    /if \(wide\.error\) \{[\s\S]{0,400}?\.eq\('trigger->>type', 'reaction'\)/.test(reactionsSrc));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ██ W2 — THE INPUTS TRAY + THE MATERIAL DOOR (docs/relay-canvas-plan.md, law 7) ██
  //
  //   I  THE STORE — `null` means NEVER CONFIGURED (an absence that carries meaning), a pinned doc
  //      is the caller's OWN (a foreign id is dropped and counted, never stored), the stored name
  //      is the FILE'S own, and EMPTY IS DELETED so a stale row never masquerades as config.
  //   B  THE BLOCK — one `[WORKFLOW INPUTS]` section carrying EXCERPT_RULE, every cut whitespace-
  //      bounded and DECLARED, EVERY pinned doc represented under a tight budget, and a doc with
  //      nothing in hand NAMED honestly (an absent doc reads as "no such rule exists").
  //   M  THE MATERIAL DOOR — a reaction workflow refuses with the sentence that now EARNS its
  //      second clause; handed material it RUNS, and the material reaches the ai step.
  //   X  THE MATURED FILE DOOR — the listener is an EXPLICIT ARGUMENT (the shared indexer can
  //      never guess a caller is a door), it fires once after extraction with the content in hand,
  //      and a same-content re-upload lands the SAME exactly-once key.
  //   T  THE THREADING — the block rides the system-prompt channel, never previousOutputs, and
  //      inherits that channel's ONE exclusion (the verify gate).
  //   U  THE SURFACES — one sheet, two mounts, readiness first; the tray saves beside the doors.
  //   Q  PARITY — four doors, one schema, ONE name ladder.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const {
    readWorkflowInputs, writeWorkflowInputs, buildInputsBlock, materialBlock,
    MATERIAL_MAX_CHARS, INPUTS_KIND,
  } = await import('../lib/workflows/inputs');
  const { EXCERPT_MARK, EXCERPT_RULE: XRULE } = await import('../lib/utils/clip-for-prompt');

  const IPFX = `Probe relay inputs ${stamp}`;
  const inputWfIds: string[] = [];
  const kbIds: string[] = [];
  /** A long, sentence-shaped body: the clip law is only visible on text that has boundaries. */
  const LONG = 'The standing rule is that every candidate is scored on the same five axes. '.repeat(90);

  try {
    // ── fixtures: two real workflows + two real knowledge files (one indexed, one not) ──────────
    const mkInputWf = async (name: string) => {
      const { data, error } = await admin.from('workflows').insert({
        user_id: userId, name, status: 'active', trigger: { type: 'manual' }, steps: [],
      }).select('id').single();
      const id = (data as { id: string } | null)?.id ?? null;
      if (!id) { console.log(`  ✗ inputs fixture "${name}" failed — ${error?.message}`); fail++; }
      else inputWfIds.push(id);
      return id;
    };
    const { getOrCreateUploadSource } = await import('../lib/knowledge/indexer');
    const uploadSourceId = await getOrCreateUploadSource(userId, admin);
    const mkKb = async (filename: string, text: string | null, contentHash?: string) => {
      const { data, error } = await admin.from('knowledge_files').insert({
        user_id: userId, source_id: uploadSourceId,
        provider_file_id: `probe-relay-w2/${stamp}/${filename}`,
        filename, mime_type: 'text/plain', extracted_text: text,
        ...(contentHash ? { content_hash: contentHash } : {}),
      }).select('id').single();
      const id = (data as { id: string } | null)?.id ?? null;
      if (!id) { console.log(`  ✗ kb fixture "${filename}" failed — ${error?.message}`); fail++; }
      else kbIds.push(id);
      return id;
    };

    const trayWf = await mkInputWf(`${IPFX} tray`);
    const policyId = await mkKb('Scoring policy.txt', LONG);
    const templateId = await mkKb('Report template.txt', 'Section 1. Section 2. Section 3.');
    const unindexedId = await mkKb('Still extracting.txt', null);

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // I — THE STORE (live: item_plans on the probe host)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nI — THE INPUTS STORE (mode: live DB, item_plans kind `workflow_inputs`):');
    ok('NEVER CONFIGURED reads as `null` (the absence IS the answer, not an empty tray)',
      (await readWorkflowInputs(admin, userId, trayWf!)) === null);

    {
      const w = await writeWorkflowInputs(admin, userId, trayWf!, {
        docs: [{ kbFileId: policyId, name: 'whatever the caller typed' }, { kbFileId: templateId, name: '' }],
        acceptMaterial: true,
      });
      ok('a write ROUNDTRIPS through the read (docs in authoring order + the material flag)',
        w.ok === true && (await readWorkflowInputs(admin, userId, trayWf!))?.docs.map(d => d.kbFileId).join(',') === `${policyId},${templateId}`,
        JSON.stringify(w));
      ok('…and acceptMaterial survives as a real boolean',
        (await readWorkflowInputs(admin, userId, trayWf!))?.acceptMaterial === true);
      ok('THE STORED NAME IS THE FILE\'S OWN — a hand-written label can never misname a real document',
        (await readWorkflowInputs(admin, userId, trayWf!))?.docs[0].name === 'Scoring policy.txt',
        String((await readWorkflowInputs(admin, userId, trayWf!))?.docs[0].name));
    }
    {
      const foreign = randomUUID();
      const w = await writeWorkflowInputs(admin, userId, trayWf!, {
        docs: [{ kbFileId: policyId, name: 'x' }, { kbFileId: foreign, name: 'someone else\'s policy' }],
        acceptMaterial: false,
      });
      ok('A PINNED DOC IS THE CALLER\'S OWN — a foreign kbFileId is DROPPED and COUNTED',
        w.ok === true && w.dropped === 1 && w.inputs?.docs.length === 1, JSON.stringify(w));
      const read = await readWorkflowInputs(admin, userId, trayWf!);
      ok('…and the foreign id never reaches the store at all',
        !(read?.docs ?? []).some(d => d.kbFileId === foreign), JSON.stringify(read?.docs));
    }
    {
      const w = await writeWorkflowInputs(admin, userId, trayWf!, { docs: [], acceptMaterial: true });
      ok('acceptMaterial ALONE is real configuration (a tray with no docs still exists)',
        w.ok === true && w.inputs?.acceptMaterial === true && (await readWorkflowInputs(admin, userId, trayWf!))?.acceptMaterial === true,
        JSON.stringify(w));
    }
    {
      const { data: before } = await admin.from('item_plans').select('entity_id, kind')
        .eq('user_id', userId).eq('kind', INPUTS_KIND).eq('entity_id', trayWf!).maybeSingle();
      ok('IT LIVES IN item_plans (no migration — the workflow_owner / frame_share precedent)',
        !!before && before.kind === INPUTS_KIND && before.entity_id === trayWf, JSON.stringify(before));
      const w = await writeWorkflowInputs(admin, userId, trayWf!, { docs: [], acceptMaterial: false });
      const { data: after } = await admin.from('item_plans').select('entity_id')
        .eq('user_id', userId).eq('kind', INPUTS_KIND).eq('entity_id', trayWf!).maybeSingle();
      ok('EMPTY IS DELETED — the row is removed, so `null` keeps meaning "never configured"',
        w.ok === true && w.inputs === null && !after && (await readWorkflowInputs(admin, userId, trayWf!)) === null,
        JSON.stringify(w));
    }
    ok('a read for a workflow that never had a tray never throws (a store outage is "no tray")',
      (await readWorkflowInputs(admin, userId, randomUUID())) === null);

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // B — THE BLOCK (live reads of real knowledge rows; the excerpt law is asserted on real text)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nB — THE INPUTS BLOCK (mode: live — real knowledge_files rows, zero AI):');
    ok('no docs → NO BLOCK (nothing to say is said by saying nothing)',
      (await buildInputsBlock(admin, userId, [])) === null
      && (await buildInputsBlock(admin, userId, [], 5_000)) === null);
    {
      const block = (await buildInputsBlock(admin, userId, [{ kbFileId: templateId!, name: 'Report template.txt' }])) ?? '';
      ok('the block wears its header AND the EXCERPT_RULE (the reader is told what a mark means)',
        block.startsWith('[WORKFLOW INPUTS — reference material pinned to this workflow]') && block.includes(XRULE),
        block.slice(0, 80));
      ok('…and it says these are the STANDING reference, not the run\'s new material',
        /they are not the run's new material/.test(block));
    }
    {
      // A tight budget over two docs forces a real cut on the long one — the clip must land on a
      // boundary and DECLARE itself, and the second doc must still be there.
      const block = (await buildInputsBlock(admin, userId, [
        { kbFileId: policyId!, name: 'Scoring policy.txt' },
        { kbFileId: templateId!, name: 'Report template.txt' },
      ], 1_200)) ?? '';
      ok('EVERY pinned doc is represented under a TIGHT budget (the tail is never dropped)',
        block.includes('— Scoring policy.txt:') && block.includes('— Report template.txt:'), block.slice(0, 200));
      const body = block.slice(block.indexOf('— Scoring policy.txt:\n') + '— Scoring policy.txt:\n'.length);
      const chunk = body.slice(0, body.indexOf(EXCERPT_MARK)).trim();
      ok('…the long doc\'s cut is DECLARED with EXCERPT_MARK', body.includes(EXCERPT_MARK), body.slice(0, 120));
      ok('…and the cut is WHITESPACE-HONEST (it is a real prefix ending on a boundary, never mid-word)',
        chunk.length > 0 && LONG.startsWith(chunk) && (/[.\s]$/.test(chunk) || /\s/.test(LONG.charAt(chunk.length))),
        JSON.stringify(chunk.slice(-40)));
      ok('…and the short doc that FITS is carried clean (no mark where nothing was removed)',
        block.includes('— Report template.txt:\nSection 1. Section 2. Section 3.'), block.slice(-120));
    }
    {
      const block = (await buildInputsBlock(admin, userId, [
        { kbFileId: unindexedId!, name: 'Still extracting.txt' },
        { kbFileId: templateId!, name: 'Report template.txt' },
      ])) ?? '';
      ok('A DOC WITH NOTHING IN HAND SAYS SO — never silently absent (absence reads as "no such rule")',
        block.includes('— Still extracting.txt — not yet indexed; its content is not in hand.')
        && block.includes('— Report template.txt:'), block.slice(0, 300));
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // M — THE MATERIAL DOOR
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nM — THE MATERIAL DOOR (materialBlock; mode: pure):');
    ok('nothing worth carrying → no block (null / blank / whitespace-only)',
      [null, undefined, {}, { text: '' }, { text: '   \n\t ' }].every(m => materialBlock(m as { text?: string }) === null));
    {
      const b = materialBlock({ text: 'The candidate has eight years in credit risk.', name: 'a pasted CV' }) ?? '';
      ok('a named block declares WHAT it is, at run time, and carries EXCERPT_RULE',
        b.startsWith('[MANUAL MATERIAL — provided at run time: a pasted CV]') && b.includes(XRULE)
        && b.endsWith('The candidate has eight years in credit risk.'), b.slice(0, 70));
      ok('…and an unnamed block is still honest about being run-time material',
        (materialBlock({ text: 'x' }) ?? '').startsWith('[MANUAL MATERIAL — provided at run time]'));
    }
    {
      const huge = 'A sentence of perfectly ordinary reference text. '.repeat(900); // ≫ 20k
      const b = materialBlock({ text: huge }) ?? '';
      const body = b.slice(b.indexOf(XRULE) + XRULE.length).trim();
      const chunk = body.slice(0, body.indexOf(EXCERPT_MARK)).trim();
      ok(`THE ${MATERIAL_MAX_CHARS.toLocaleString()}-CHAR CUT IS DECLARED, never a silent chop`,
        huge.length > MATERIAL_MAX_CHARS && body.includes(EXCERPT_MARK), `${huge.length} chars`);
      ok('…and it is whitespace-honest (a real prefix, ending on a boundary)',
        chunk.length > 0 && chunk.length <= MATERIAL_MAX_CHARS && huge.startsWith(chunk)
        && (/[.\s]$/.test(chunk) || /\s/.test(huge.charAt(chunk.length))), JSON.stringify(chunk.slice(-40)));
    }

    console.log('\nM — MATERIAL ⇒ A REACTION RUN PROCEEDS (mode: LIVE runs on the probe host; the echo run makes ONE cheap fast-tier AI call):');
    {
      const { runWorkflow } = await import('../lib/workflows/run-workflow');
      const { nothingToReactTo } = await import('../lib/workflows/readiness');
      const REACT_WHEN = 'a probe application arrives';
      const echoSteps = [{
        id: 's1', type: 'ai', label: 'Echo', model_tier: 'fast',
        prompt: 'The triggering event contains a line beginning with CODEWORD:. Reply with ONLY the single word that follows it. No punctuation, no other text.',
      }];
      const { data: rWf } = await admin.from('workflows').insert({
        user_id: userId, name: `${IPFX} reaction`, status: 'active',
        output_config: { destination: 'message' },
        trigger: { type: 'reaction', when: REACT_WHEN, label: 'On a probe application' },
        steps: echoSteps,
      }).select('id').single();
      const reactId = (rWf as { id: string } | null)?.id ?? null;
      if (reactId) inputWfIds.push(reactId);

      if (reactId) {
        const bare = await runWorkflow({ workflowId: reactId, triggerSource: 'manual', isTest: true });
        const { data: bareRow } = await admin.from('workflow_runs')
          .select('status, error, step_outputs').eq('id', bare.runId).maybeSingle();
        const b = (bareRow ?? {}) as { status?: string; error?: string; step_outputs?: unknown[] };
        ok('WITHOUT material a reaction run REFUSES with the new sentence, VERBATIM',
          b.status === 'failed' && b.error === nothingToReactTo({ when: REACT_WHEN, label: 'On a probe application' }),
          String(b.error));
        ok('…and the second clause is the one THE MATERIAL DOOR earned back',
          (b.error ?? '').endsWith('— or Run it now with sample material to test.'), String(b.error));
        ok('…and ZERO steps ran (no AI was spent on an empty run)',
          (b.step_outputs ?? []).length === 0, String((b.step_outputs ?? []).length));

        const withMat = await runWorkflow({
          workflowId: reactId, triggerSource: 'manual', isTest: true,
          triggerContext: materialBlock({ text: 'CODEWORD: ZEPHYRLIGHT\nEverything after this line is filler.', name: 'a pasted note' })!,
        });
        const { data: matRow } = await admin.from('workflow_runs')
          .select('status, error, step_outputs').eq('id', withMat.runId).maybeSingle();
        const m = (matRow ?? {}) as { status?: string; error?: string; step_outputs?: Array<{ output?: unknown }> };
        ok('WITH material the SAME reaction workflow RUNS (the refusal is keyed on the context, not the trigger)',
          m.status === 'succeeded' && !m.error, `${m.status}/${m.error}`);
        ok('…and THE MATERIAL REACHED THE AI STEP (the code word came back out)',
          String((m.step_outputs ?? [])[0]?.output ?? '').includes('ZEPHYRLIGHT'),
          String((m.step_outputs ?? [])[0]?.output).slice(0, 80));
      }
    }

    console.log('\nM — THE RUN ROUTE (mode: source):');
    {
      const runRoute = stripComments(readFileSync('app/api/workflows/[id]/run/route.ts', 'utf8'));
      ok('POST /run accepts `{ material: { text, name? } }` and blocks it through materialBlock',
        /material\?:\s*\{\s*text\?: string;\s*name\?: string\s*\}/.test(runRoute)
        && /const material = materialBlock\(body\.material\);/.test(runRoute));
      ok('…and it rides as triggerContext, only when there is something (never an empty context)',
        /\.\.\.\(material \? \{ triggerContext: material \} : \{\}\)/.test(runRoute));
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // X — THE MATURED FILE DOOR
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nX — THE FILE DOOR MATURES (mode: source + LIVE indexer seam via the content-hash path, zero AI):');
    {
      const indexerSrc = stripComments(readFileSync('lib/knowledge/indexer.ts', 'utf8'));
      const confirmSrc = stripComments(readFileSync('app/api/drive/upload/confirm/route.ts', 'utf8'));
      ok('THE LISTENER IS AN EXPLICIT ARGUMENT — the shared indexer can never guess a caller is a door',
        /onIndexed\?: \(info: \{ fileId: string; extractedText: string \| null \}\) => Promise<void>;/.test(indexerSrc)
        && /const \{ buffer, filename, mimeType, userId, storagePathInBucket, folderId, onIndexed \} = params;/.test(indexerSrc));
      ok('…and it is best-effort at every exit (a throwing listener never fails the indexing)',
        /try \{ await onIndexed\(\{ fileId, extractedText \}\); \}[\s\S]{0,120}?catch \(err\)/.test(indexerSrc));
      ok('THE MOMENT MOVED — the announce sits AFTER the extracted_text upsert (content in hand, not a filename)',
        indexerSrc.indexOf('await announce(fileId, cleanText);') > indexerSrc.indexOf("const fileId = fileRows[0].id;"),
        'announce precedes the upsert');
      ok('…and the upload confirm passes the listener, putting the CONTENT HEAD in the gist',
        /onIndexed: async \(\{ fileId, extractedText \}\) => \{/.test(confirmSrc)
        && /const head = String\(extractedText \?\? ''\)/.test(confirmSrc)
        && /clipForPrompt\(head, 400\)/.test(confirmSrc)
        && /gist: `\$\{label\}\\n\$\{body\}`/.test(confirmSrc));
      ok('…and the event id is the knowledge_files id (so a re-upload of the same bytes reuses the key)',
        /id: fileId, title: filename,/.test(confirmSrc));
      {
        // THE HUMAN-ACT LAW, W2 EDITION: every OTHER caller of the shared indexer passes NO listener
        // — a workflow-made or chat-attached file structurally cannot fire workflows.
        const { readdirSync, statSync } = await import('fs');
        const callers: string[] = [];
        const walk = (dir: string) => {
          for (const e of readdirSync(dir)) {
            if (e === 'node_modules' || e.startsWith('.')) continue;
            const p = `${dir}/${e}`;
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!/\.tsx?$/.test(p) || p === 'lib/knowledge/indexer.ts') continue;
            if (/indexUploadedFile\(/.test(stripComments(readFileSync(p, 'utf8')))) callers.push(p);
          }
        };
        for (const root of ['lib', 'app', 'components']) walk(root);
        const withListener = callers.filter(p => /onIndexed/.test(stripComments(readFileSync(p, 'utf8'))));
        ok('ONLY the human-upload confirm opts INTO the door — every other indexUploadedFile caller passes none',
          callers.length >= 2 && withListener.length === 1 && withListener[0] === 'app/api/drive/upload/confirm/route.ts',
          `callers: ${callers.join(', ')} | listeners: ${withListener.join(', ')}`);
      }
      ok('the exactly-once TOKEN literal is unchanged (`:file:` — a token change re-fires history)',
        /return source === 'mail' \? 'inbox' : source;/.test(reactionsSrc));
    }
    {
      // LIVE, ZERO AI: a pre-seeded content_hash row means BOTH indexUploadedFile calls take the
      // already-in-hand short-circuit — which is EXACTLY the path a same-content re-upload takes.
      // (The fresh-extraction path costs a summary + embeddings, so its ordering is asserted by
      // source above; this proves the listener CONTRACT and the key identity on real calls.)
      const { createHash } = await import('crypto');
      const { indexUploadedFile } = await import('../lib/knowledge/indexer');
      const bytes = Buffer.from(`Probe relay W2 ${stamp}. The candidate has eight years in credit risk.`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const seededId = await mkKb('Re-upload probe.txt', 'The candidate has eight years in credit risk.', hash);
      const heard: Array<{ fileId: string; extractedText: string | null }> = [];
      const listen = async (i: { fileId: string; extractedText: string | null }) => { heard.push(i); };
      const idA = await indexUploadedFile({
        buffer: bytes, filename: 'Re-upload probe.txt', mimeType: 'text/plain', userId,
        storagePathInBucket: `probe-relay-w2/${stamp}/reupload`, onIndexed: listen,
      }, admin);
      ok('THE LISTENER FIRES ONCE, with the row id and the CONTENT (not just a filename)',
        heard.length === 1 && heard[0].fileId === seededId
        && (heard[0].extractedText ?? '').includes('eight years in credit risk'), JSON.stringify(heard));
      const idB = await indexUploadedFile({
        buffer: bytes, filename: 'Re-upload probe.txt', mimeType: 'text/plain', userId,
        storagePathInBucket: `probe-relay-w2/${stamp}/reupload-again`, onIndexed: listen,
      }, admin);
      ok('A SAME-CONTENT RE-UPLOAD announces the SAME id — so it lands the SAME exactly-once key',
        idA === idB && idB === seededId && heard.length === 2 && heard[1].fileId === heard[0].fileId,
        `${idA} / ${idB}`);
      {
        // …and the reaction layer then SUPPRESSES it, live: one fire record on `<wf>:file:<id>`
        // and the second announcement is not even considered a candidate.
        const doorWf = await mkInputWf(`${IPFX} file door`);
        if (doorWf && HAS_COLUMN) {
          await admin.from('workflows').update({
            triggers: [{ type: 'reaction', source: 'file', when: 'it is a probe fixture' }],
          }).eq('id', doorWf);
        }
        const client = HAS_COLUMN ? admin : doorProxy(admin, (cols) => ({
          data: WIDE(cols) ? [{ id: doorWf, name: 'fixture', trigger: { type: 'manual' },
            triggers: [{ type: 'reaction', source: 'file', when: 'it is a probe fixture' }] }] : [],
          error: null,
        }));
        const key = `${doorWf}:file:${idA}`;
        await admin.from('item_plans').insert({
          user_id: userId, kind: 'reaction_fire', entity_id: key,
          tasks: { runId: null, reason: 'exactly-once seed' },
        });
        const r = await checkSourceReactions(client, userId, 'file',
          [{ id: idA, title: 'Re-upload probe.txt', gist: 'the same bytes again' }]);
        ok(`…and the re-announcement is SUPPRESSED at the door [mode: ${HAS_COLUMN ? 'live stored door' : 'fixture-proxy'}]`,
          r?.considered === 0 && r?.fired === 0, JSON.stringify(r));
        await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', key);
      }
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // T — THE THREADING FLOORS (source)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nT — THE THREADING (the block rides the system-prompt channel; mode: source):');
    {
      const execCode = stripComments(readFileSync('lib/workflows/execute-step.ts', 'utf8'));
      ok('the tray is read and built ONCE per run (not per step)',
        (runWfCode.match(/buildInputsBlock\(/g) ?? []).length === 1
        && (runWfCode.match(/readWorkflowInputs\(/g) ?? []).length === 1);
      ok('…and only when the tray actually has docs (a never-configured workflow builds nothing)',
        /if \(inputs\?\.docs\.length\) \{/.test(runWfCode));
      ok('IT JOINS THE projectGrounding CHANNEL — the system-prompt append, not previousOutputs',
        /const aiContext = \[projectGrounding, inputsBlock\]\.filter\(Boolean\)\.join\('\\n\\n'\) \|\| null;/.test(runWfCode)
        && /projectGrounding: aiContext,/.test(runWfCode));
      ok('…and previousOutputs still carries ONLY the step outputs (the tray can never be middle-cut away)',
        /previousOutputs: stepOutputs,/.test(runWfCode) && !/previousOutputs: \[[^\]]*inputsBlock/.test(runWfCode)
        && !/stepOutputs\.push\(\{[^}]*inputsBlock/.test(runWfCode));
      ok('THE VERIFY-GATE EXCLUSION IS INHERITED — the channel is withheld from use_worker_identity:false',
        /if \(ctx\.projectGrounding && step\.use_worker_identity !== false\) \{/.test(execCode)
        && (execCode.match(/systemPrompt \+= `\\n\\n\$\{ctx\.projectGrounding\}`;/g) ?? []).length === 1);
      ok('…and a tray that cannot be read never fails a run (non-fatal by contract)',
        /let inputsBlock: string \| null = null;\s*try \{[\s\S]{0,500}?\} catch \{/.test(runWfCode));
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // U — THE SURFACE FLOORS (source)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nU — THE SURFACES (one sheet, two mounts, readiness first; mode: source):');
    {
      const body = studioCode.slice(studioCode.indexOf('const save = useCallback('));
      const saveBody = body.slice(0, body.indexOf('}, [workflow]);'));
      ok('THE TRAY SAVES BESIDE THE DOORS — `inputs` rides the same PATCH as trigger/triggers',
        /trigger: triggerToSave,/.test(saveBody) && /\n\s*triggers: doors,/.test(saveBody)
        && /\.\.\.\(workflow\.inputs \? \{ inputs: workflow\.inputs \} : \{\}\)/.test(saveBody));
      ok('…UNDEFINED IS NEVER SENT (an unhydrated tray must not let a save wipe what we never read)',
        !/\n\s*inputs: workflow\.inputs,/.test(saveBody));
      ok('…and a response that omits `inputs` never erases what we just wrote',
        /if \(saved\.inputs === undefined && workflow\.inputs !== undefined\)/.test(saveBody));
    }
    {
      // The tray's OWN region: InputsTray + InputsDocPicker, bounded at the next top-level
      // function — a repo-wide grep would count every other component's routes as the tray's.
      const trayAt = studioCode.indexOf('function InputsTray(');
      const pickerAt = studioCode.indexOf('function InputsDocPicker(', trayAt);
      const endAt = studioCode.indexOf('\nfunction ', pickerAt + 1);
      const trayCode = studioCode.slice(trayAt, endAt > -1 ? endAt : undefined);
      ok('THE PICKER REUSES THE ONE KNOWLEDGE SOURCE (the @-mention endpoint), never a second KB door',
        /\/api\/workers\/mentions\?types=document/.test(trayCode)
        && (trayCode.match(/`\/api\/[a-z]/g) ?? []).length === 1,
        (trayCode.match(/`\/api\/[a-z][^`]*`/g) ?? []).join(', '));
      ok('…and the tray renders NOTHING until it has been READ (undefined ≠ "configured with nothing")',
        /if \(inputs === undefined\) return null;/.test(trayCode));
    }
    {
      const sheet = stripComments(readFileSync('components/workflows/run-material-sheet.tsx', 'utf8'));
      const ledgerC = stripComments(readFileSync('components/workflows/workflows-ledger.tsx', 'utf8'));
      const detailC = stripComments(readFileSync('components/workflows/workflow-detail.tsx', 'utf8'));
      ok('ONE SHEET, TWO MOUNTS — the same component behind both run affordances',
        /<RunMaterialSheet/.test(ledgerC) && /<RunMaterialSheet/.test(detailC)
        && /export default function RunMaterialSheet\(/.test(sheet));
      ok('…and BOTH mounts read THE ONE PREDICATE (asksForMaterial), never a local rule',
        /asksForMaterial\(\{/.test(ledgerC) && /asksForMaterial\(\{/.test(detailC)
        && /export function asksForMaterial\(/.test(sheet));
      ok('ONE CAP, ONE HOME — the sheet IMPORTS MATERIAL_MAX_CHARS, it never re-declares a limit',
        /import \{ MATERIAL_MAX_CHARS \} from '@\/lib\/workflows\/inputs';/.test(sheet)
        && !/(const|let)\s+MATERIAL_MAX_CHARS/.test(sheet)
        && !/\b20[_,]?000\b/.test(sheet));
      ok('READINESS SPEAKS FIRST in both mounts (the sheet never stands in front of a refusal)',
        [ledgerC, detailC].every((src) => {
          const at = src.indexOf('const runNow = useCallback(');
          const fn = src.slice(at, at + Math.max(0, src.slice(at).indexOf('\n  }, [')));
          const guard = fn.search(/toast\((?:blocked|notReady)\)/);
          const sheetOpen = fn.search(/setMaterial(?:For|Open)\(/);
          return at > -1 && guard > -1 && sheetOpen > -1 && guard < sheetOpen;
        }));
    }
    {
      const ledgerRouteCode = stripComments(readFileSync('app/api/workflows/ledger/route.ts', 'utf8'));
      ok('THE LEDGER SERVES inputs.acceptMaterial per row, read from the ONE store',
        /\.eq\('kind', 'workflow_inputs'\)/.test(ledgerRouteCode)
        && /inputs: \{ acceptMaterial: materialWfIds\.has\(w\.id\) \}/.test(ledgerRouteCode));
      ok('…and the deep-dive GET serves the WHOLE tray through readWorkflowInputs',
        /const \{ readWorkflowInputs \} = await import\('@\/lib\/workflows\/inputs'\);/.test(wfPatch)
        && /const inputs = await readWorkflowInputs\(/.test(wfPatch));
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // Q — PARITY (four doors, one schema, ONE name ladder)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nQ — THE FOUR-DOOR PARITY SWEEP, INPUTS EDITION (mode: source):');
    {
      const authorSrc = stripComments(readFileSync('lib/workflows/author-doors.ts', 'utf8'));
      ok('ONE NAME LADDER — authorInputs and matchWorkflowByName both go through resolveByName',
        /function resolveByName<T extends NamedRow>/.test(authorSrc)
        && /return resolveByName\(rows, spoken\)\.hit;/.test(authorSrc)
        && /const m = resolveByName\(roster, spoken\);/.test(authorSrc));
      ok('…and there is no SECOND ladder in the module (no forked exact/contains matcher)',
        (authorSrc.match(/\.includes\(want\)/g) ?? []).length === 1, 'a second containment matcher exists');
      ok('…and a resolved doc carries THE FILE\'S OWN NAME, never the spoken rendering',
        /docs\.push\(\{ kbFileId: m\.hit\.id, name: m\.hit\.name \}\);/.test(authorSrc));
      ok('…and inputsForStorage keeps NULL meaning "never configured" (notes are speech, not config)',
        /return \(inputs\.docs\.length \|\| inputs\.acceptMaterial\)[\s\S]{0,120}?: null;/.test(authorSrc));
    }
    ok('DOOR 1 (describe-it): generate-config emits input_doc_names THROUGH the one resolver',
      /"input_doc_names": \[\]/.test(genCfg)
      && /const \{ authorInputs, inputNote, inputsForStorage \} = await import\('@\/lib\/workflows\/author-doors'\);/.test(genCfgCode)
      && /doc_names: generated\.input_doc_names, accept_material: generated\.accept_material/.test(genCfgCode));
    ok('…and needs_input_note is a SIBLING channel of needs_door_note (two refusals, two sentences)',
      /needs_door_note: needsDoorNote,/.test(genCfgCode) && /needs_input_note: needsInputNote,/.test(genCfgCode)
      && /inputs,/.test(genCfgCode));
    ok('…and a resolver outage costs the tray, never the draft',
      /\} catch \{\s*inputs = null;\s*\}/.test(genCfgCode));
    ok('…and BOTH amber blocks render on the draft card (a refused door AND a missing document speak)',
      /\{draft\.needs_door_note\}/.test(draftCard) && /\{draft\.needs_input_note\}/.test(draftCard));
    ok('DOOR 2 (coworker chat): create_task takes input_doc_names + input_accept_material',
      /input_doc_names: \{/.test(workerTasks) && /input_accept_material: \{/.test(workerTasks));
    ok('…and update_task is ADDITIVE (add/remove verbs, existing docs ride in — never a full replace)',
      /add_input_docs: \{/.test(workerTasks) && /remove_input_docs: \{/.test(workerTasks)
      && /existing: docs, acceptMaterialDefault: current\?\.acceptMaterial \?\? false/.test(workerTasks));
    ok('…and an UNSAID accept_material never silently closes a door opened in Studio',
      /acceptMaterialDefault: current\?\.acceptMaterial \?\? false/.test(workerTasks));
    {
      const insert = wfPost.slice(wfPost.indexOf('.insert({'), wfPost.indexOf(".select('*')"));
      const after = wfPost.slice(wfPost.indexOf('if (body.inputs !== undefined && data) {'));
      const block = after.slice(0, after.indexOf('\n  }\n'));
      ok('DOOR 3 (POST /api/workflows): the tray write is SEPARATE from the insert, and AFTER it',
        !insert.includes('inputs') && wfPost.indexOf('if (body.inputs !== undefined && data) {') > wfPost.indexOf('.insert({'),
        'inputs rides the creating insert');
      ok('…isolated and best-effort (a store failure costs the tray, never the workflow)',
        block.includes('try {') && /writeWorkflowInputs\(supabase, user\.id, \(data as \{ id: string \}\)\.id, body\.inputs\)/.test(block)
        && /catch \(e\) \{[\s\S]{0,160}?inputs not persisted/.test(block));
      ok('…and DOOR 3b (PATCH) writes through the SAME store function, never a second writer',
        /const res = await writeWorkflowInputs\(supabase, user\.id, id, inputsBody\);/.test(wfPatch)
        && /delete update\.inputs;/.test(wfPatch));
    }
    ok('THE CREATION CARD carries `inputs` into the Confirm body (a pinned doc survives creation)',
      /\.\.\.\(draft\.inputs \? \{ inputs: draft\.inputs \} : \{\}\)/.test(draftCard));
  } finally {
    for (const id of inputWfIds) {
      await admin.from('work_threads').delete().eq('workflow_id', id);
      await admin.from('workflow_runs').delete().eq('workflow_id', id);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', id);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'reaction_fire').like('entity_id', `${id}:%`);
      await admin.from('workflows').delete().eq('id', id);
    }
    for (const id of kbIds) {
      await admin.from('knowledge_chunks').delete().eq('file_id', id);
      await admin.from('knowledge_files').delete().eq('id', id);
    }
    const { data: leftWf } = await admin.from('workflows').select('id').eq('user_id', userId).like('name', `${IPFX}%`);
    const { data: leftKb } = await admin.from('knowledge_files').select('id')
      .eq('user_id', userId).like('provider_file_id', `probe-relay-w2/${stamp}/%`);
    const { data: leftTray } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', INPUTS_KIND)
      .in('entity_id', inputWfIds.length ? inputWfIds : ['00000000-0000-0000-0000-000000000000']);
    ok('W2 probe leftovers are ZERO (workflows · knowledge files · tray rows)',
      (leftWf ?? []).length === 0 && (leftKb ?? []).length === 0 && (leftTray ?? []).length === 0,
      `${(leftWf ?? []).length}/${(leftKb ?? []).length}/${(leftTray ?? []).length}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ██ W3 — THE SUBPROCESS STATION (docs/relay-canvas-plan.md, law 5:
  //         "A SUBPROCESS IS A HANDOFF TO A MACHINE") ██
  //
  //   SP  THE STATION LIVES — real parent/child runs on the probe host: the park at the ⧉ station,
  //       the insert-first claim carrying THE BATON, the child fired exactly once, the resume that
  //       passes NO human gate, the atomic claim that fences a second completion, the honest
  //       failure, test mode's stand-in, the three door refusals VERBATIM, the stranded-park sweep,
  //       and THE STALE-CHILD BATON (a re-fired child carries the link row's stored context).
  //   RL  RENÉ'S LOOP — two linear pipelines composing into a CYCLE with no loop engine: A parks on
  //       B, B's delivery both RESUMES A and fires A's "when another workflow delivers" door.
  //       ⚠️ THE CEILING IS THE THROTTLE, NOT A CYCLE DETECTOR — asserted live (W3b: at the limit
  //       the next lap is RECORDED and QUEUED, never dropped).
  //   SF  SOURCE FLOORS — the machine gate carries NO human verbs, the ledger's approval debt
  //       excludes it, the resume route 409s it with its sentence, resumeSeeded passes no gate,
  //       readiness rules 6–7 (and 1–5 untouched), the parked-gate precedence, ONE name ladder,
  //       the fireable-set alignment, needs_step_note as a THIRD sibling, and Studio's honest
  //       exclusions.
  //
  // W1's and W2's sections above are untouched — a wave adds its floor, it never edits the
  // previous wave's.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const {
    resumeParentsOf, sweepStrandedSubprocessParks, checkSubprocessDoor, testModeSubprocessOutput,
    subprocessRefusal, subprocessFailure, batonFor, linkEntityId, SUBPROCESS_LINK_KIND,
  } = await import('../lib/workflows/subprocess');
  const { parkedGateOf, deriveProcessRows } = await import('../lib/workflows/process-state');
  const { authorSubprocessSteps, stepNote, MAX_SUBPROCESS } = await import('../lib/workflows/author-doors');
  const { runWorkflow: runWf } = await import('../lib/workflows/run-workflow');
  const { refireStaleEventRuns } = await import('../lib/workflows/reactions');

  const WPFX = `Probe relay W3 ${stamp}`;
  const w3WfIds: string[] = [];
  const w3Start = new Date(Date.now() - 10_000).toISOString();
  /** Code words: the ONLY honest way to prove a payload actually travelled a seam. */
  const CHILD_WORD = 'LUMENFALL';   // the child's deliverable
  const SWEEP_WORD = 'GLASSWEIR';   // a stranded child's stored output
  const BATON_WORD = 'THORNGLASS';  // the baton a stale child must be re-fired with

  type W3Out = { step_id: string; step_type: string; label: string; output: unknown; error?: string };
  type W3Run = {
    id: string; workflow_id: string; status: string; error: string | null;
    step_outputs: W3Out[] | null; triggered_by: string | null;
    started_at: string | null; completed_at: string | null; created_at: string;
  };

  const aiStep = (id: string, label: string, prompt: string) =>
    ({ id, type: 'ai', label, model_tier: 'fast', prompt });
  const stationStep = (id: string, label: string, workflowId: string) =>
    ({ id, type: 'workflow', label, workflow_id: workflowId });
  const ECHO_CHILD = `Reply with ONLY the single word ${CHILD_WORD}. No punctuation, no other text.`;
  const CARRY = 'The previous step output contains exactly one word written in CAPITAL letters. '
    + 'Reply with ONLY that word. No punctuation, no other text.';

  const mkW3 = async (
    name: string, steps: unknown[], opts?: { status?: string; triggers?: ReactionDoor[] },
  ): Promise<string | null> => {
    const { data, error } = await admin.from('workflows').insert({
      user_id: userId, name, status: opts?.status ?? 'active',
      trigger: { type: 'manual' }, steps, output_config: { destination: 'message' },
      ...(HAS_COLUMN && opts?.triggers ? { triggers: opts.triggers } : {}),
    }).select('id').single();
    const id = (data as { id: string } | null)?.id ?? null;
    if (!id) { console.log(`  ✗ W3 fixture "${name}" failed — ${error?.message}`); fail++; }
    else w3WfIds.push(id);
    return id;
  };
  const w3Run = async (runId: string): Promise<W3Run | null> => {
    const { data } = await admin.from('workflow_runs')
      .select('id, workflow_id, status, error, step_outputs, triggered_by, started_at, completed_at, created_at')
      .eq('id', runId).maybeSingle();
    return (data ?? null) as W3Run | null;
  };
  const w3Runs = async (wfId: string): Promise<W3Run[]> => {
    const { data } = await admin.from('workflow_runs')
      .select('id, workflow_id, status, error, step_outputs, triggered_by, started_at, completed_at, created_at')
      .eq('workflow_id', wfId).order('created_at', { ascending: true });
    return ((data ?? []) as W3Run[]);
  };
  const w3Link = async (parentRunId: string, stepId: string) => {
    const { data } = await admin.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', SUBPROCESS_LINK_KIND)
      .eq('entity_id', linkEntityId(parentRunId, stepId)).maybeSingle();
    return (data ?? null) as { entity_id: string; tasks: Record<string, unknown> } | null;
  };
  const outText = (o?: W3Out) => (typeof o?.output === 'string' ? o.output : JSON.stringify(o?.output ?? ''));

  try {
    // ════════════════════════════════════════════════════════════════════════════════════════════
    // SP — THE STATION LIVES (real runs on the probe host; FOUR cheap fast-tier AI calls in total)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nSP1 — PARK · FIRE · RESUME, end to end (mode: LIVE runs on the probe host):');
    const childName = `${WPFX} interview`;
    const childId = await mkW3(childName, [aiStep('c1', 'Interview note', ECHO_CHILD)]);
    // THE STATION IS STEP ONE ON PURPOSE: the trailing step is the only honest proof that the
    // resume continued PAST the station carrying the child's deliverable in hand.
    const parentId = await mkW3(`${WPFX} triage`, [
      stationStep('p1', childName, childId!),
      aiStep('p2', 'Carry it forward', CARRY),
    ]);
    let sp1ParentRunId = '';
    let sp1ChildRunId = '';
    if (childId && parentId) {
      const res = await runWf({ workflowId: parentId, triggerSource: 'manual' });
      sp1ParentRunId = res.runId;
      ok('the parent\'s own call RETURNS the park (awaiting_approval — the human-gate machinery, reused)',
        res.status === 'awaiting_approval', `${res.status}/${res.error ?? ''}`);

      const link = await w3Link(sp1ParentRunId, 'p1');
      ok('THE LINK ROW landed at `<parentRunId>:<stepId>` (item_plans kind `subprocess_link`)',
        !!link, linkEntityId(sp1ParentRunId, 'p1'));
      ok('…carrying the child workflow id and the child RUN id (the resume reads the link BY it)',
        link?.tasks?.childWorkflowId === childId && typeof link?.tasks?.childRunId === 'string',
        JSON.stringify(link?.tasks ?? {}));
      sp1ChildRunId = String(link?.tasks?.childRunId ?? '');
      ok('…and THE BATON as actually handed over is STORED on the row (the fire is auditable)',
        String(link?.tasks?.context ?? '').startsWith(`[SUBPROCESS — invoked by ${WPFX} triage]`),
        String(link?.tasks?.context ?? '').slice(0, 60));
      ok('…excerpt-honest by construction — the rule rides the baton\'s HEADER, never its tail',
        String(link?.tasks?.context ?? '').includes(XRULE));

      const childRuns = await w3Runs(childId);
      ok('THE CHILD FIRED EXACTLY ONCE', childRuns.length === 1, String(childRuns.length));
      ok('…as an EVENT run (the ledger sees a queued row before it runs)',
        childRuns[0]?.triggered_by === 'event', String(childRuns[0]?.triggered_by));
      ok('…and it is the run the link row bound', childRuns[0]?.id === sp1ChildRunId);
      ok('…and it delivered (its own rail, its own gate, its own steps)',
        childRuns[0]?.status === 'succeeded', `${childRuns[0]?.status}/${childRuns[0]?.error ?? ''}`);

      const parent = await w3Run(sp1ParentRunId);
      const outs = parent?.step_outputs ?? [];
      ok('THE PARENT RESUMED AND COMPLETED (the child\'s completion is what continues it)',
        parent?.status === 'succeeded', `${parent?.status}/${parent?.error ?? ''}`);
      ok('THE STATION\'S OUTPUT IS THE CHILD\'S DELIVERABLE',
        outText(outs[0]).includes(CHILD_WORD), outText(outs[0]).slice(0, 80));
      ok('…typed `workflow`, labelled with the station\'s own label (a surface renders it lookup-free)',
        outs[0]?.step_type === 'workflow' && outs[0]?.step_id === 'p1' && outs[0]?.label === childName,
        JSON.stringify({ t: outs[0]?.step_type, l: outs[0]?.label }));
      ok('…appended EXACTLY ONCE (a resumed run never re-runs the steps it already passed)',
        outs.filter((o) => o.step_id === 'p1').length === 1, String(outs.length));
      ok('THE STEP AFTER THE STATION RAN, with the deliverable in hand',
        outs.length === 2 && outText(outs[1]).includes(CHILD_WORD), outText(outs[1]).slice(0, 80));
      ok('NO HUMAN GATE WAS PASSED — no approval marker anywhere in the parent\'s outputs',
        !outs.some((o) => outText(o).includes('[Approved')), JSON.stringify(outs.map(outText).map((t) => t.slice(0, 20))));
    }

    console.log('\nSP1b — resumeSeeded PASSES NO GATE (a later approval still parks; mode: LIVE):');
    let sp1bRunId = '';
    if (childId) {
      const gatedId = await mkW3(`${WPFX} triage with a gate`, [
        stationStep('g1', childName, childId),
        { id: 'g2', type: 'approval', label: 'Your approval', instruction: 'Say go before it ships.' },
        aiStep('g3', 'Never reached', CARRY),
      ]);
      if (gatedId) {
        const res = await runWf({ workflowId: gatedId, triggerSource: 'manual' });
        sp1bRunId = res.runId;
        const row = await w3Run(sp1bRunId);
        ok('the station resumed the run and it PARKED AGAIN at the human gate (never passed it)',
          row?.status === 'awaiting_approval' && (row?.step_outputs ?? []).length === 1,
          `${row?.status}/${(row?.step_outputs ?? []).length}`);
        ok('…and the seeded station output is still the child\'s deliverable',
          outText((row?.step_outputs ?? [])[0]).includes(CHILD_WORD));
        const { data: gwf } = await admin.from('workflows').select('steps').eq('id', gatedId).maybeSingle();
        const gate = parkedGateOf({ step_outputs: (row?.step_outputs ?? []) as never }, ((gwf as { steps?: unknown } | null)?.steps ?? null) as never);
        ok('THE PARKED GATE now reads `approval` — a HUMAN holds this one', gate.kind === 'approval', gate.kind);
        const rows = await deriveProcessRows(admin, userId, [row] as never, new Map([[row!.workflow_id, { name: 'x', steps: (gwf as { steps?: unknown } | null)?.steps }]]) as never);
        ok('…and it derives as needs_you (the owner\'s attention, unlike a ⧉ park)',
          rows[0]?.state === 'needs_you' && !rows[0]?.waitingOn, JSON.stringify(rows[0]?.state));
      }
    }

    console.log('\nSP2 — THE ATOMIC CLAIM (a second completion claims nothing; mode: LIVE):');
    if (sp1ChildRunId && sp1ParentRunId) {
      const before = JSON.stringify(await w3Run(sp1ParentRunId));
      const again = await resumeParentsOf(admin, sp1ChildRunId, { ok: true, deliverable: 'A SECOND DELIVERY' });
      ok('a second resumeParentsOf on the SAME child resumes nothing and fails nothing',
        again.resumed.length === 0 && again.failed.length === 0, JSON.stringify(again));
      ok('…and the parent run is BYTE-IDENTICAL (the claim is the fence, not a guard clause)',
        JSON.stringify(await w3Run(sp1ParentRunId)) === before);
    }

    console.log('\nSP3 — A FAILED CHILD NEVER STRANDS ITS PARENT (mode: LIVE):');
    {
      // A child that cannot run at all: readiness refuses it at ITS door, and that refusal is what
      // the parent must hear — one terminal end reporting back through the ONE seam.
      const emptyChildId = await mkW3(`${WPFX} empty child`, []);
      const p3 = await mkW3(`${WPFX} parent of an empty child`, [
        stationStep('f1', `${WPFX} empty child`, emptyChildId!),
        aiStep('f2', 'Never reached', CARRY),
      ]);
      if (p3 && emptyChildId) {
        const res = await runWf({ workflowId: p3, triggerSource: 'manual' });
        const row = await w3Run(res.runId);
        const childRow = (await w3Runs(emptyChildId))[0];
        const expected = subprocessFailure(`${WPFX} empty child`, { ok: false, error: childRow?.error ?? '' });
        ok('the child refused honestly (readiness spoke at its own door)',
          childRow?.status === 'failed' && childRow?.error === 'No steps yet — build it in Studio.',
          String(childRow?.error));
        ok('THE PARENT FAILED with the spoken sentence, VERBATIM',
          row?.status === 'failed' && row?.error === expected, `${row?.error} :: ${expected}`);
        ok('…and ZERO steps re-ran (the park\'s snapshot is exactly what the failure kept)',
          (row?.step_outputs ?? []).length === 0, String((row?.step_outputs ?? []).length));
      }
    }

    console.log('\nSP4 — TEST MODE NEVER FIRES THE CHILD (mode: LIVE, zero AI):');
    if (childId) {
      const before = (await w3Runs(childId)).length;
      const p4 = await mkW3(`${WPFX} test-mode parent`, [stationStep('t1', childName, childId)]);
      if (p4) {
        const res = await runWf({ workflowId: p4, triggerSource: 'manual', isTest: true });
        const row = await w3Run(res.runId);
        ok('THE CHILD WAS NOT FIRED (no new run row on it)',
          (await w3Runs(childId)).length === before, `${before} → ${(await w3Runs(childId)).length}`);
        ok('…and no claim was written either (a test never mounts the exactly-once contract)',
          (await w3Link(res.runId, 't1')) === null);
        ok('the run CONTINUED — it did not park (a paused simulation proves nothing)',
          row?.status === 'succeeded', `${row?.status}/${row?.error ?? ''}`);
        ok('THE STAND-IN WEARS ITS PREFIX — the child\'s last real delivery, said to be exactly that',
          outText((row?.step_outputs ?? [])[0]).startsWith(`[from ${childName}'s last delivery — test mode]`),
          outText((row?.step_outputs ?? [])[0]).slice(0, 70));
        ok('…and it carries that delivery\'s own bytes', outText((row?.step_outputs ?? [])[0]).includes(CHILD_WORD));
      }
    }

    console.log('\nSP5 — THE DOOR REFUSALS, VERBATIM (mode: LIVE, zero AI):');
    {
      const deepId = await mkW3(`${WPFX} deep child`, [aiStep('d1', 'Deep', ECHO_CHILD)]);
      const nestedId = await mkW3(`${WPFX} nested child`, [stationStep('n1', `${WPFX} deep child`, deepId!)]);
      const draftId = await mkW3(`${WPFX} draft child`, [aiStep('r1', 'Draft', ECHO_CHILD)], { status: 'draft' });
      const ghost = randomUUID();

      const cases: Array<[string, string, string]> = [
        ['missing', ghost, subprocessRefusal('The missing one', "doesn't exist")],
        ['draft', draftId!, subprocessRefusal('The draft one', 'is a draft')],
        ['depth cap', nestedId!, subprocessRefusal('The nested one', 'itself contains a process step — one level deep only')],
      ];
      const labels = ['The missing one', 'The draft one', 'The nested one'];
      for (let i = 0; i < cases.length; i++) {
        const [what, target, expected] = cases[i];
        const p = await mkW3(`${WPFX} refusal ${what}`, [
          stationStep('x1', labels[i], target),
          aiStep('x2', 'Never reached', CARRY),
        ]);
        if (!p) continue;
        const res = await runWf({ workflowId: p, triggerSource: 'manual' });
        const row = await w3Run(res.runId);
        ok(`${what}: the run REFUSES with the door's sentence, verbatim`,
          row?.status === 'failed' && row?.error === expected, `${row?.error} :: ${expected}`);
        ok(`${what}: nothing was claimed (a station never parks on a door that cannot open)`,
          (await w3Link(res.runId, 'x1')) === null);
      }
      ok('DEPTH CAP: the nested child never fired', (await w3Runs(nestedId!)).length === 0);
      ok('…and neither did the workflow behind it (no run reached the second level)',
        (await w3Runs(deepId!)).length === 0);
      ok('…and the DRAFT child never fired either', (await w3Runs(draftId!)).length === 0);
      // The pure half of the same law: the door check is async because ownership/status/depth are
      // facts only the database holds.
      const self = await checkSubprocessDoor(admin, userId, { label: 'Itself', workflow_id: parentId! }, parentId!);
      ok('SELF-REFERENCE is refused at the door in READINESS\' OWN WORDS (one sentence, two homes)',
        !self.ok && self.reason === "A workflow can't include itself as a step.", JSON.stringify(self));
      const ok1 = await checkSubprocessDoor(admin, userId, { label: 'Fine', workflow_id: childId! }, parentId!);
      ok('…and a real, active, flat child of the caller\'s own OPENS the door',
        ok1.ok === true && ok1.ok && ok1.child.id === childId, JSON.stringify(ok1));
    }

    console.log('\nSP6 — THE SWEEP repairs a stranded park, idempotently (mode: LIVE, zero AI):');
    {
      const sweepChildId = await mkW3(`${WPFX} sweep child`, [aiStep('s1', 'Echo', ECHO_CHILD)]);
      const sweepParentId = await mkW3(`${WPFX} sweep parent`, [stationStep('s1', 'Sweep station', sweepChildId!)]);
      // A LOST RESUME, by hand: the child is terminally done, the parent is still parked, and
      // nothing ever claimed it — the crash between the child's tail and the parent's claim.
      const { data: cr } = await admin.from('workflow_runs').insert({
        workflow_id: sweepChildId, user_id: userId, status: 'succeeded', triggered_by: 'event',
        step_outputs: [{ step_id: 's1', step_type: 'ai', label: 'Echo', output: SWEEP_WORD }],
        completed_at: new Date().toISOString(),
      }).select('id').single();
      const { data: pr } = await admin.from('workflow_runs').insert({
        workflow_id: sweepParentId, user_id: userId, status: 'awaiting_approval', triggered_by: 'manual',
        step_outputs: [], started_at: new Date().toISOString(),
      }).select('id').single();
      const strandedChild = (cr as { id: string } | null)?.id ?? '';
      const strandedParent = (pr as { id: string } | null)?.id ?? '';
      await admin.from('item_plans').insert({
        user_id: userId, kind: SUBPROCESS_LINK_KIND, entity_id: linkEntityId(strandedParent, 's1'),
        tasks: {
          parentRunId: strandedParent, stepId: 's1', childRunId: strandedChild,
          childWorkflowId: sweepChildId, firedAt: new Date().toISOString(),
        },
      });

      // BEFORE the repair: this is what every surface must read while a station holds the line.
      {
        const parked = await w3Run(strandedParent);
        const { data: swf } = await admin.from('workflows').select('name, steps').eq('id', sweepParentId).maybeSingle();
        const steps = (swf as { steps?: unknown } | null)?.steps ?? null;
        const gate = parkedGateOf({ step_outputs: (parked?.step_outputs ?? []) as never }, steps as never);
        ok('THE PARKED GATE reads `subprocess` — the wait belongs to a MACHINE, not a person',
          gate.kind === 'subprocess' && gate.stepId === 's1' && gate.label === 'Sweep station'
          && gate.childWorkflowId === sweepChildId, JSON.stringify(gate));
        const rows = await deriveProcessRows(admin, userId, [parked] as never,
          new Map([[sweepParentId!, { name: `${WPFX} sweep parent`, steps }]]) as never);
        ok('…so it derives as waiting_on_others FOR THE OWNER TOO (never anyone\'s needs_you)',
          rows[0]?.state === 'waiting_on_others', String(rows[0]?.state));
        ok('…wearing the SURFACE DISCRIMINATOR role `process` (a facepile of a process name is a lie)',
          rows[0]?.waitingOn?.role === 'process' && rows[0]?.waitingOn?.name === 'Sweep station',
          JSON.stringify(rows[0]?.waitingOn));
        ok('…and it speaks no reason (there is nothing for a human to do about it)', !rows[0]?.reason);
      }

      const first = await sweepStrandedSubprocessParks(admin);
      ok('THE SWEEP repaired the stranded park', first.includes(strandedParent), JSON.stringify(first.slice(0, 3)));
      const repaired = await w3Run(strandedParent);
      ok('…the parent completed', repaired?.status === 'succeeded', `${repaired?.status}/${repaired?.error ?? ''}`);
      ok('…with the child\'s stored deliverable as the station\'s output, typed `workflow`',
        (repaired?.step_outputs ?? [])[0]?.step_type === 'workflow'
        && outText((repaired?.step_outputs ?? [])[0]).includes(SWEEP_WORD),
        outText((repaired?.step_outputs ?? [])[0]).slice(0, 60));
      const second = await sweepStrandedSubprocessParks(admin);
      ok('A SECOND PASS IS A NO-OP for the same park (the atomic claim, again)',
        !second.includes(strandedParent), JSON.stringify(second.slice(0, 3)));
      ok('…and the repaired run is untouched by it', (await w3Run(strandedParent))?.status === 'succeeded');
    }

    console.log('\nSP7 — THE STALE-CHILD BATON (a re-fired child carries the link row\'s context; mode: LIVE):');
    {
      const staleChildId = await mkW3(`${WPFX} stale child`, [aiStep('e1', 'Echo the code word',
        'The context contains a line beginning with CODEWORD:. Reply with ONLY the single word that follows it. No punctuation, no other text.')]);
      const { data: sc } = await admin.from('workflow_runs').insert({
        workflow_id: staleChildId, user_id: userId, status: 'queued', triggered_by: 'event',
        created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      }).select('id').single();
      const staleRunId = (sc as { id: string } | null)?.id ?? '';
      const baton = `${batonFor(`${WPFX} triage`, [])}\nCODEWORD: ${BATON_WORD}`;
      // The link row is the ONLY place this child's context lives — a subprocess child writes no
      // `reaction_fire` record, which is exactly the hole the lookup closes.
      await admin.from('item_plans').insert({
        user_id: userId, kind: SUBPROCESS_LINK_KIND, entity_id: linkEntityId(sp1ParentRunId || randomUUID(), 's7'),
        tasks: {
          parentRunId: sp1ParentRunId, stepId: 's7', childRunId: staleRunId,
          childWorkflowId: staleChildId, firedAt: new Date().toISOString(), context: baton,
        },
      });
      ok('the stale child has NO reaction_fire record (the class the lookup exists for)',
        ((await admin.from('item_plans').select('id').eq('user_id', userId)
          .eq('kind', 'reaction_fire').eq('tasks->>runId', staleRunId)).data ?? []).length === 0);

      // THE RECORDING PROXY: the backstop's re-fire rides `after()`, which cannot run outside a
      // request scope — so the LOOKUP is what a host-safe gate can observe, and it is the whole
      // fix. Every read is the real client's.
      const seen: string[] = [];
      const wrapQ = (obj: Record<string, unknown>, table: string): Record<string, unknown> =>
        new Proxy(obj, {
          get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
              if (p === 'eq') seen.push(`${table}.${String(args[0])}=${String(args[1])}`);
              const out = (v as (...a: unknown[]) => unknown).apply(t, args);
              return (out && typeof out === 'object' && typeof (out as Record<string, unknown>).eq === 'function')
                ? wrapQ(out as Record<string, unknown>, table) : out;
            };
          },
        });
      const recorder = new Proxy(admin as unknown as Record<string, unknown>, {
        get(target, prop, recv) {
          if (prop === 'from') return (table: string) => wrapQ((admin.from as (t: string) => unknown)(table) as Record<string, unknown>, table);
          const v = Reflect.get(target, prop, recv);
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }) as unknown as SupabaseClient;

      // ⚠️ RE-POINTED with the harness repair (W3b): these two lines used to assert the re-fire
      // NEVER HAPPENED — that was collateral of the old in-process AI fence (a poisoned client
      // cache made the inline re-fire die and throw). In a healthy process the fallback path
      // (`after` has no request scope → run it inline) does exactly what it promises: the stale
      // child is re-fired, WITH its baton, and completes. That is the stronger truth, so it is
      // what the gate now pins.
      let threw: string | null = null;
      try { await refireStaleEventRuns(recorder); } catch (e) { threw = String((e as Error).message ?? e); }
      const backstopped = await w3Run(staleRunId);
      ok('THE BACKSTOP RE-FIRED the stale child and it RAN (a crashed tail never silently eats an event)',
        backstopped?.status === 'succeeded', `${backstopped?.status}/${backstopped?.error ?? ''}`);
      ok('…carrying THE BATON it had to go looking for — the code word came back out of the child\'s step',
        outText((backstopped?.step_outputs ?? [])[0]).includes(BATON_WORD),
        outText((backstopped?.step_outputs ?? [])[0]).slice(0, 60));
      ok('THE FIRST LOOKUP is the reaction_fire record — and it MISSES for a subprocess child',
        seen.some((s) => s === `item_plans.kind=reaction_fire`) && seen.includes(`item_plans.tasks->>runId=${staleRunId}`),
        JSON.stringify(seen.slice(0, 12)));
      ok('THE FALLBACK LOOKUP reads the SUBPROCESS LINK ROW by the child run id (the orchestrator\'s fix)',
        seen.includes('item_plans.kind=subprocess_link') && seen.includes(`item_plans.tasks->>childRunId=${staleRunId}`),
        JSON.stringify(seen.slice(-6)));
      ok('…and the backstop lane NEVER THROWS at its caller (the dispatcher is non-fatal by contract)',
        threw === null, String(threw).slice(0, 80));

      // THE CODE WORD, live: the context that lookup returns IS the parent's baton, and it reaches
      // the child's step as its trigger event.
      const { data: lr } = await admin.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', SUBPROCESS_LINK_KIND).eq('tasks->>childRunId', staleRunId).maybeSingle();
      const stored = String((lr?.tasks as { context?: string } | undefined)?.context ?? '');
      ok('the looked-up context IS the stored baton (the parent\'s material, not an empty run)',
        stored.includes(BATON_WORD) && stored.startsWith('[SUBPROCESS — invoked by'), stored.slice(0, 50));
      const refired = await runWf({ workflowId: staleChildId!, runId: staleRunId, triggerSource: 'event', triggerContext: stored });
      const refiredRow = await w3Run(refired.runId);
      ok('THE RE-FIRED CHILD RECEIVED THE BATON — the code word came back out of its step',
        outText((refiredRow?.step_outputs ?? [])[0]).includes(BATON_WORD),
        outText((refiredRow?.step_outputs ?? [])[0]).slice(0, 60));
      ok('SOURCE: the value the fallback assigns is the SAME variable handed to the re-fired run',
        /if \(!context\) \{[\s\S]{0,500}?'subprocess_link'[\s\S]{0,300}?context = \(linkRow\?\.tasks[\s\S]{0,400}?triggerContext: context \}\)/.test(reactionsSrc));
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // RL — RENÉ'S LOOP (the finale): two linear pipelines, one cycle, no loop engine.
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log(`\nRL — RENÉ'S LOOP [mode: ${HAS_COLUMN ? 'LIVE (stored doors — the full cycle runs)' : 'SUBPROCESS HALF ONLY (workflows.triggers absent — the door cannot be stored)'}]:`);
    {
      const bName = `${WPFX} rene interview`;
      const bId = await mkW3(bName, [aiStep('b1', 'Interview', ECHO_CHILD)]);
      // A parks on B (⧉) AND opens its door on B's delivery — the SAME two pipelines forming the
      // cycle. A carries no ai step of its own: its deliverable IS the station's output.
      const aId = await mkW3(`${WPFX} rene triage`, [stationStep('a1', bName, bId!)], {
        triggers: [{ type: 'reaction', source: 'workflow', workflow_id: bId! }] as ReactionDoor[],
      });

      if (aId && bId) {
        // ── ITERATION 1 ────────────────────────────────────────────────────────────────────────
        const r1 = await runWf({ workflowId: aId, triggerSource: 'manual' });
        const aRuns1 = await w3Runs(aId);
        const bRuns1 = await w3Runs(bId);
        ok('A parked at its ⧉ station and B ran inside it', r1.status === 'awaiting_approval' && bRuns1.length === 1,
          `${r1.status}/${bRuns1.length}`);
        ok('B DELIVERED', bRuns1[0]?.status === 'succeeded', `${bRuns1[0]?.status}/${bRuns1[0]?.error ?? ''}`);
        ok('(1) B\'s delivery RESUMED A — it completed with B\'s deliverable as its station output',
          aRuns1[0]?.status === 'succeeded' && outText((aRuns1[0]?.step_outputs ?? [])[0]).includes(CHILD_WORD),
          `${aRuns1[0]?.status}`);
        if (HAS_COLUMN) {
          ok('(2) …AND the SAME delivery opened A\'s door — a SECOND A run exists (THE CYCLE)',
            aRuns1.length === 2, String(aRuns1.length));
          const second = aRuns1.find((r) => r.id !== aRuns1[0]?.id);
          ok('…the second A run is an EVENT run (it came through the door, not by hand)',
            second?.triggered_by === 'event', String(second?.triggered_by));
          const key = `${aId}:workflow:${bRuns1[0]?.id}`;
          const { data: fire } = await admin.from('item_plans').select('entity_id, tasks')
            .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', key).maybeSingle();
          ok('…carrying the door\'s own fire record, keyed by the DELIVERING RUN', !!fire, key);
          ok('…with the engine\'s own words as the reason (structural composition, never a judge)',
            (fire?.tasks as { reason?: string } | undefined)?.reason === 'the upstream workflow delivered');

          // EXACTLY ONCE UNDER COMPOSITION — replaying B's delivery fires nothing; A's own
          // delivery never opens A's door (the self-loop guard holds inside a cycle too).
          const replay = await checkSourceReactions(admin, userId, 'workflow',
            [{ id: bRuns1[0]!.id, sourceId: bId, title: bName, gist: 'the same delivery again' }]);
          ok('NO THIRD FIRE — replaying B\'s delivery fires nothing (exactly-once holds under composition)',
            replay?.fired === 0 && (await w3Runs(aId)).length === 2, JSON.stringify(replay));
          const selfEcho = await checkSourceReactions(admin, userId, 'workflow',
            [{ id: aRuns1[0]!.id, sourceId: aId, title: 'A', gist: 'A\'s own delivery' }]);
          ok('THE SELF-LOOP GUARD holds inside the cycle — A\'s own delivery never opens A\'s door',
            selfEcho?.fired === 0 && (await w3Runs(aId)).length === 2, JSON.stringify(selfEcho));

          // ── ITERATION 2 — the composed loop's next lap, driven exactly as the dispatcher's
          // backstop would drive the queued event run (a script has no request scope, so the
          // inline after() attempt never ran; the queued row is the honest hand-off point).
          const { data: fr } = await admin.from('item_plans').select('tasks')
            .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', key).maybeSingle();
          const ctx = String((fr?.tasks as { context?: string } | undefined)?.context ?? '');
          await runWf({ workflowId: aId, runId: second!.id, triggerSource: 'event', triggerContext: ctx });
          const aRuns2 = await w3Runs(aId);
          const bRuns2 = await w3Runs(bId);
          ok('LAP 2: the second A run parked on B again, B ran again, and A resumed again',
            bRuns2.length === 2 && aRuns2.filter((r) => r.status === 'succeeded').length === 2,
            `${bRuns2.length}B/${aRuns2.filter((r) => r.status === 'succeeded').length}A`);
          ok('…and B\'s second delivery opened A\'s door a SECOND time — a THIRD A run (the loop turns)',
            aRuns2.length === 3, String(aRuns2.length));

          // ── THE CYCLE DEFERS AT THE THROTTLE (W3b — re-pointed from "the cycle stops at the
          // cap"). Same law, LOSSLESS form: nothing in the engine detects "A → B → A", and what
          // bounds René's loop is the per-workflow daily THROTTLE on door fires. At the limit the
          // next lap is still RECORDED and still QUEUED — it just doesn't start today.
          const { data: firesToday } = await admin.from('item_plans').select('entity_id')
            .eq('user_id', userId).eq('kind', 'reaction_fire').like('entity_id', `${aId}:%`);
          const fireCount = (firesToday ?? []).length;
          ok('the loop\'s laps ARE door fires — one per B delivery, counted on A', fireCount === 2, String(fireCount));
          // Pin A's throttle at exactly what it has already spent today: the next lap is at the line.
          await admin.from('item_plans').insert({
            user_id: userId, kind: 'workflow_limit', entity_id: aId, tasks: { dailyFires: fireCount },
          });
          const runsAtCeiling = (await w3Runs(aId)).length;
          const evLap = randomUUID();
          const capped = await checkSourceReactions(admin, userId, 'workflow',
            [{ id: evLap, sourceId: bId, title: bName, gist: 'a third delivery, at the throttle' }]);
          ok(`AT THE THROTTLE (${fireCount}/day here) the next lap DEFERS — considered, never dropped`,
            capped?.fired === 0 && capped?.deferred === 1 && (capped?.considered ?? 0) >= 1, JSON.stringify(capped));
          const lapKey = `${aId}:workflow:${evLap}`;
          const { data: lapRec } = await admin.from('item_plans').select('tasks')
            .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', lapKey).maybeSingle();
          const lapTasks = (lapRec?.tasks ?? null) as { deferred?: boolean; runId?: string; startedAt?: string } | null;
          ok('…its exactly-once record EXISTS and wears `deferred:true` (the lap is remembered)',
            lapTasks?.deferred === true && !lapTasks?.startedAt, JSON.stringify(lapTasks));
          const lapRuns = await w3Runs(aId);
          ok('…and its run row EXISTS, queued and NOT started (a shredder would have neither)',
            lapRuns.length === runsAtCeiling + 1
            && lapRuns.find(r => r.id === lapTasks?.runId)?.status === 'queued',
            `${lapRuns.length} vs ${runsAtCeiling}`);
          ok('THE CEILING IS THE THROTTLE, NOT A CYCLE DETECTOR — the engine holds no ancestry/chain guard',
            /readFireLimits/.test(reactionsSrc) && /FIRE_LIMIT_DEFAULT/.test(reactionsSrc)
            && !/DAILY_CAP/.test(reactionsSrc)
            && !/cycleDetect|ancestor|chainDepth|visitedWorkflows/i.test(reactionsSrc));
          ok('…and the pacing is SPOKEN as a queue, never as a loss ("queued for the drain")',
            /queued for the drain/.test(reactionsSrc));
          console.log('    · FINDING (for the spec): a composed A→B→A cycle is THROTTLED, never dropped — bounded per day by the per-workflow fire limit, with every extra lap recorded and queued for the drain. There is still no cycle detector; the self-loop guard covers self-naming doors only.');
          await admin.from('item_plans').delete().eq('user_id', userId)
            .eq('kind', 'workflow_limit').eq('entity_id', aId);
        } else {
          ok('(2) THE DOOR HALF is not assertable before the migration (declared, never faked)', true);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // SF — SOURCE FLOORS (comment-stripped: prose about a law is not the law)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    const drawerSrc = stripComments(readFileSync('components/workflows/process-drawer.tsx', 'utf8'));
    const ledgerSrc = stripComments(readFileSync('app/api/workflows/ledger/route.ts', 'utf8'));
    const resumeSrc = stripComments(readFileSync('app/api/workflows/runs/[id]/resume/route.ts', 'utf8'));
    const subprocessSrc = stripComments(readFileSync('lib/workflows/subprocess.ts', 'utf8'));
    const authorSrc = stripComments(readFileSync('lib/workflows/author-doors.ts', 'utf8'));
    const stateSrc = stripComments(readFileSync('lib/workflows/process-state.ts', 'utf8'));

    console.log('\nSF — THE MACHINE GATE HAS NO HUMAN VERBS (mode: source):');
    {
      const stationAt = drawerSrc.indexOf('<SubprocessStation');
      const approveAt = drawerSrc.indexOf('Approve — deliver it');
      ok('the ⧉ station renders BEFORE the verb block, out of the human-gate branch entirely',
        stationAt > 0 && approveAt > stationAt, `${stationAt}/${approveAt}`);
      ok('…reached by a STRUCTURAL type check on the step, never a label or a state guess',
        /if \(s\.type === 'workflow'\) \{[\s\S]{0,200}?<SubprocessStation/.test(drawerSrc));
      const body = drawerSrc.slice(drawerSrc.indexOf('function SubprocessStation('));
      const station = body.slice(0, body.indexOf('\nfunction '));
      ok('SubprocessStation carries NO Approve / Reject / Nudge / Reassign',
        !/Approve|Reject|Nudge|Reassign/.test(station), station.slice(0, 0) || 'a human verb leaked into the machine gate');
      ok('…and NO GateObject (nothing is being decided, so the gate\'s object never mounts)',
        !station.includes('GateObject'));
      ok('…it owes the reader exactly two things: that a process is running, and a door into it',
        /is running inside this process/.test(station) && /Open \{name\} →/.test(station));
      ok('the ⧉ mark is the station\'s own word on the surface', station.includes('⧉ {name}'));
    }

    console.log('\nSF — NO LYING DOOR (the ledger and the resume route; mode: source):');
    ok('the ledger\'s AWAITING list EXCLUDES a ⧉ park (never an Approve row for a wait nobody holds)',
      /const awaiting = runs\.filter\(r => r\.status === 'awaiting_approval'\)\.filter\(r => \{[\s\S]{0,320}?steps\[\(r\.step_outputs \?\? \[\]\)\.length\]\?\.type !== 'workflow';/.test(ledgerSrc));
    ok('the resume route refuses a ⧉ park through the SAME derivation (parkedGateOf, not a copy)',
      /parkedGateOf\(/.test(resumeSrc) && /if \(gate\.kind === 'subprocess'\)/.test(resumeSrc));
    ok('…with 409 and the sentence that says whose wait it is',
      /waiting on the '\$\{gate\.label\}' process, not on you — it continues by itself when that delivers\.`,\s*\}, \{ status: 409 \}\)/.test(resumeSrc));
    ok('…and a REJECTION still reports back (a held-back child never strands its parent)',
      /resumeParentsOf\(admin, runId, \{ ok: false \}\)/.test(resumeSrc));

    console.log('\nSF — resumeSeeded PASSES NO GATE (mode: source):');
    ok('the human-gate scan is fenced to resumeFromApproval ALONE',
      /if \(opts\.resumeFromApproval\) \{\s*for \(let j = stepOutputs\.length; j < steps\.length; j\+\+\) \{[\s\S]{0,240}?resumeApprovalAt = j;/.test(runWfCode));
    ok('…so on the seeded path resumeApprovalAt stays -1 and no gate index can match',
      /let resumeApprovalAt = -1;/.test(runWfCode));
    ok('…and both flags seed the SAME outputs (one snapshot, two doors — never two seeders)',
      /if \(\(opts\.resumeFromApproval \|\| opts\.resumeSeeded\) && runId\)/.test(runWfCode));
    {
      const seeded = [...subprocessSrc.matchAll(/resumeSeeded: true/g)].length;
      ok('THE ONLY setter of resumeSeeded is the subprocess resume itself',
        seeded === 1 && !/resumeSeeded/.test(stripComments(readFileSync('app/api/workflows/runs/[id]/resume/route.ts', 'utf8'))),
        String(seeded));
      ok('…and it NEVER sets resumeFromApproval in the same call',
        !/resumeSeeded: true[\s\S]{0,80}resumeFromApproval|resumeFromApproval[\s\S]{0,80}resumeSeeded: true/.test(subprocessSrc));
      // FOUR terminal ends, ONE seam (the definition reads `const notifySubprocessParent = async (`,
      // so every match below is a CALL): refusal · thread failure · step failure · success.
      ok('EVERY terminal end of a run reports back (refusal · thread failure · step failure · success)',
        (runWfCode.match(/await notifySubprocessParent\(/g) ?? []).length === 4,
        String((runWfCode.match(/await notifySubprocessParent\(/g) ?? []).length));
      ok('…the success end hands over the very deliverable the run just materialised',
        /await notifySubprocessParent\(runId, \{ ok: true, deliverable: finalText \}\);/.test(runWfCode));
      ok('…and every other end hands over an honest failure, never silence',
        (runWfCode.match(/await notifySubprocessParent\([^)]*\{ ok: false/g) ?? []).length === 3);
    }

    console.log('\nSF — READINESS rules 6 and 7 (mode: pure):');
    {
      const r6 = readinessOf({ id: 'w1', status: 'active', steps: [{ type: 'workflow', label: 'Interview', workflow_id: '' }] }, null);
      ok('rule 6 — an unbound ⧉ station names ITSELF in the refusal',
        reasonOf(r6) === "The 'Interview' process step needs a workflow.", String(reasonOf(r6)));
      ok('…and a bound one abstains',
        readinessOf({ id: 'w1', status: 'active', steps: [{ type: 'workflow', label: 'Interview', workflow_id: 'w2' }] }, null).ready);
      const r7 = readinessOf({ id: 'w1', status: 'active', steps: [{ type: 'workflow', label: 'Itself', workflow_id: 'w1' }] }, null);
      ok('rule 7 — a workflow naming ITSELF is refused, purely',
        reasonOf(r7) === "A workflow can't include itself as a step.", String(reasonOf(r7)));
      ok('…in the SAME sentence the async door check speaks (one law, two homes)',
        subprocessSrc.includes(`"A workflow can't include itself as a step."`));
      ok('rule 6 respects the budget on a long label',
        (reasonOf(readinessOf({ id: 'w1', status: 'active', steps: [{ type: 'workflow', label: 'x'.repeat(200), workflow_id: '' }] }, null)) ?? '').length <= READINESS_REASON_MAX);
      // RULES 1–5 UNTOUCHED: order IS severity, and the new rules sit at the END of the table.
      ok('rule 1 still outranks 6 (no steps speaks first)',
        reasonOf(readinessOf({ id: 'w1', status: 'active', steps: [] }, null)) === 'No steps yet — build it in Studio.');
      ok('rule 2 still outranks 6 (a draft speaks first)',
        reasonOf(readinessOf({ id: 'w1', status: 'draft', steps: [{ type: 'workflow', workflow_id: '' }] }, null)) === 'Still a draft — finish it in Studio.');
      ok('rule 3 still outranks 6 (an orphan handoff speaks first)',
        reasonOf(readinessOf({ id: 'w1', status: 'active', steps: [{ type: 'handoff', assignee_user_id: '' }, { type: 'workflow', workflow_id: '' }] }, null))
        === "The 'Wait on a person' step needs a person.");
      ok('rule 5 still outranks 6 (a door that cannot fire speaks first)',
        reasonOf(readinessOf({ id: 'w1', status: 'active', triggers: [{ source: 'workflow' }], steps: [{ type: 'workflow', workflow_id: '' }] }, null))
        === "The 'when another workflow delivers' door needs a workflow.");
      ok('a flat, bound, active workflow with a ⧉ station is READY', readinessOf({ id: 'w1', status: 'active', steps: [{ type: 'workflow', label: 'Interview', workflow_id: 'w2' }] }, feats()).ready);
    }

    console.log('\nSF — THE PARKED-GATE PRECEDENCE (mode: pure):');
    {
      const steps = [{ id: 'a', type: 'verify', label: 'Check' }, { id: 'b', type: 'workflow', label: 'Interview', workflow_id: 'w2' }];
      const blocked = parkedGateOf({ step_outputs: [{ verdict: { status: 'blocked' } }] as never }, steps as never);
      ok('a BLOCKED verify tail still outranks the ⧉ station (the guardrail hold is the owner\'s)',
        blocked.kind === 'guardrail', blocked.kind);
      const sub = parkedGateOf({ step_outputs: [{ output: 'x' }] as never }, steps as never);
      ok('…and with a clean tail the next step decides — here, `subprocess`',
        sub.kind === 'subprocess' && sub.label === 'Interview' && sub.childWorkflowId === 'w2', JSON.stringify(sub));
      const handoff = parkedGateOf({ step_outputs: [] as never }, [{ id: 'h', type: 'handoff', assignee_user_id: 'u1', assignee_name: 'Sam' }] as never);
      ok('…a handoff still reads `handoff` (its assignee untouched)', handoff.kind === 'handoff' && handoff.assigneeUserId === 'u1');
      ok('…and an approval still reads `approval`',
        parkedGateOf({ step_outputs: [] as never }, [{ id: 'ap', type: 'approval' }] as never).kind === 'approval');
      ok('ONLY the ⧉ station sets the surface discriminator `role: \'process\'`',
        (stateSrc.match(/role: 'process'/g) ?? []).length === 1);
    }

    console.log('\nSF — THE PARITY HALF: ONE LADDER, ONE FIREABLE SET, A THIRD SIBLING (mode: source + live roster):');
    ok('authorSubprocessSteps resolves BY NAME through the SHARED resolveByName ladder',
      /const m = resolveByName\(fireable, spoken\);/.test(authorSrc) && /const asDraft = resolveByName\(drafts, spoken\);/.test(authorSrc));
    ok('THE FIREABLE SET matches the runtime door EXACTLY (anything not a draft)',
      /const fireable = roster\.filter\(\(w\) => w\.status !== 'draft'\);/.test(authorSrc)
      && /if \(row\.status === 'draft'\) return \{ ok: false, reason: subprocessRefusal\(label, 'is a draft'\) \};/.test(subprocessSrc));
    ok('…and the DEPTH CAP is read from the same roster query it resolves through',
      /nested: Array\.isArray\(w\.steps\)/.test(authorSrc));
    ok('the survivor wears THE CHILD\'S REAL NAME, never the spoken rendering',
      /label: m\.hit\.name,\s*workflow_id: m\.hit\.id,/.test(authorSrc));
    ok('needs_step_note is a THIRD SIBLING — generate-config emits it beside the door and input notes',
      /needs_step_note\?: string \| null;/.test(genCfgCode) && /needs_step_note: needsStepNote,/.test(genCfgCode));
    ok('…coworker chat speaks it in its own clause (a door\'s field never carries a step\'s refusal)',
      /needs_step_note\?: string \| null;/.test(workerTasks) && /const stepNoteText = generated\.needs_step_note/.test(workerTasks)
      && /needs_step_note: generated\.needs_step_note \?\? null,/.test(workerTasks));
    ok('…and the draft card renders ALL THREE amber blocks, each its own channel',
      /draft\.needs_door_note &&/.test(draftCard) && /draft\.needs_input_note &&/.test(draftCard) && /draft\.needs_step_note &&/.test(draftCard));
    ok('THE ⧉ CARD WORD says what it is — a whole process of the user\'s own, not another step',
      /if \(s\.type === 'workflow'\) return `⧉ \$\{s\.label \|\| 'a process'\} \(a process of its own\)`;/.test(draftCard));
    {
      // LIVE: the ladder against the real roster this section just built (zero AI).
      const authored = await authorSubprocessSteps([
        { id: 'k1', type: 'workflow', workflow_name: `${WPFX} interview` },
        { id: 'k2', type: 'ai', label: 'Write it', prompt: 'x' },
      ], { supabase: admin, userId });
      const seat = authored.steps.find((s) => s.type === 'workflow') as { workflow_id?: string; label?: string } | undefined;
      ok('LIVE: a NAMED process of the user\'s own is seated by id, labelled with the roster\'s spelling',
        seat?.workflow_id === childId && seat?.label === `${WPFX} interview`, JSON.stringify(seat));
      const draftWant = await authorSubprocessSteps(
        [{ id: 'k1', type: 'workflow', workflow_name: `${WPFX} draft child` }], { supabase: admin, userId });
      ok('LIVE: a DRAFT gets its own sentence ("I couldn\'t find it" would be a lie)',
        draftWant.steps.length === 0 && /is still a draft, so it can't run inside another process yet/.test(stepNote(draftWant.notes) ?? ''),
        String(stepNote(draftWant.notes)));
      const nestedWant = await authorSubprocessSteps(
        [{ id: 'k1', type: 'workflow', workflow_name: `${WPFX} nested child` }], { supabase: admin, userId });
      ok('LIVE: the DEPTH CAP is spoken at authoring time, not left to fire time',
        nestedWant.steps.length === 0 && /only nest one level deep/.test(stepNote(nestedWant.notes) ?? ''),
        String(stepNote(nestedWant.notes)));
      const selfWant = await authorSubprocessSteps(
        [{ id: 'k1', type: 'workflow', workflow_name: `${WPFX} interview` }],
        { supabase: admin, userId, selfWorkflowId: childId! });
      ok('LIVE: a process pointed at ITSELF is left out, said plainly',
        selfWant.steps.length === 0 && /can't run itself as a step/.test(stepNote(selfWant.notes) ?? ''),
        String(stepNote(selfWant.notes)));
      const many = await authorSubprocessSteps(
        Array.from({ length: MAX_SUBPROCESS + 1 }, (_, i) => ({ id: `m${i}`, type: 'workflow', workflow_name: `${WPFX} interview` })),
        { supabase: admin, userId });
      ok(`LIVE: the ceiling holds at MAX_SUBPROCESS (${MAX_SUBPROCESS}) and says what it dropped`,
        many.steps.length === MAX_SUBPROCESS && /I kept the first/.test(stepNote(many.notes) ?? ''),
        `${many.steps.length}`);
      const unknown = await authorSubprocessSteps(
        [{ id: 'k1', type: 'workflow', workflow_name: `${WPFX} no such process at all` }], { supabase: admin, userId });
      ok('LIVE: an INVENTED process is never created — it is dropped with a sentence',
        unknown.steps.length === 0 && /I couldn't find a process called/.test(stepNote(unknown.notes) ?? ''),
        String(stepNote(unknown.notes)));
    }

    console.log('\nSF — STUDIO: the ⧉ block, honest exclusions, ONE step list (mode: source):');
    ok('the picker offers the station as a first-class block',
      /\{ type: 'workflow' as const, Icon: Square2StackIcon,\s*label: 'Include a process',\s*disabled: false \}/.test(studioCode));
    ok('the rail renders a COMPOUND ⧉ block for it (not a step card, not a pill)',
      /step\.type === 'workflow' \? \(\s*<SubprocessFlowBlock/.test(studioCode));
    ok('…which wears its OWN receipt when nothing is picked (law 4, the amber hint idiom)',
      /const picked = !!step\.workflow_id;/.test(studioCode) && /no process chosen yet/.test(studioCode));
    ok('THE EXCLUSIONS ARE NAMED, NOT HIDDEN — all three reasons ride the disabled row',
      /this one — a process cannot contain itself/.test(studioCode)
      && /\(still a draft — nothing to deliver back yet\)/.test(studioCode)
      && /\(contains a process — one level deep\)/.test(studioCode));
    ok('…and a refused row is DISABLED, never absent (a missing name reads as a bug)',
      /const disabled = !!r\.refusal;/.test(studioCode) && /disabled=\{disabled\}/.test(studioCode));
    ok('the pick writes BOTH the binding and the child\'s own name in one move',
      /onUpdate\(\{ workflow_id: r\.id, label: r\.name \}\)/.test(studioCode));
    ok('THE ONE STEP LIST — the ⧉ picker reads the same served workflows the `workflow` door does',
      (studioCode.match(/function useWorkflowOptions\(/g) ?? []).length === 1
      && (studioCode.match(/= useWorkflowOptions\(\);/g) ?? []).length === 2,
      `${(studioCode.match(/= useWorkflowOptions\(\);/g) ?? []).length} consumers`);
    {
      const gateBody = studioCode.slice(studioCode.indexOf('function seatGate('));
      const seat = gateBody.slice(0, gateBody.indexOf('\nfunction '));
      ok('seatGate is UNTOUCHED by the new type — it moves the verify station and nothing else',
        !seat.includes("'workflow'") && /verify/.test(seat));
    }
  } finally {
    // ── ZERO LEFTOVERS: every run, thread, link row and fire record this section created ────────
    for (const id of w3WfIds) {
      const { data: rs } = await admin.from('workflow_runs').select('id').eq('workflow_id', id);
      for (const r of ((rs ?? []) as Array<{ id: string }>)) {
        await admin.from('item_plans').delete().eq('user_id', userId)
          .eq('kind', SUBPROCESS_LINK_KIND).like('entity_id', `${r.id}:%`);
      }
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'reaction_fire').like('entity_id', `${id}:%`);
      await admin.from('work_threads').delete().eq('workflow_id', id);
      await admin.from('workflow_runs').delete().eq('workflow_id', id);
      await admin.from('workflows').delete().eq('id', id);
    }
    // The SP7 link row hangs off an EARLIER parent run id — sweep the section's window instead.
    await admin.from('item_plans').delete().eq('user_id', userId)
      .eq('kind', SUBPROCESS_LINK_KIND).gte('created_at', w3Start);
    await admin.from('item_plans').delete().eq('user_id', userId)
      .eq('kind', 'reaction_fire').gte('created_at', w3Start);

    const { data: leftWf } = await admin.from('workflows').select('id').eq('user_id', userId).like('name', `${WPFX}%`);
    const { data: leftRuns } = await admin.from('workflow_runs').select('id')
      .in('workflow_id', w3WfIds.length ? w3WfIds : ['00000000-0000-0000-0000-000000000000']);
    const { data: leftLinks } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', SUBPROCESS_LINK_KIND).gte('created_at', w3Start);
    const { data: leftFires } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', 'reaction_fire').gte('created_at', w3Start);
    ok('W3 probe leftovers are ZERO (workflows · runs · link rows · fire records — the composed loop included)',
      (leftWf ?? []).length === 0 && (leftRuns ?? []).length === 0
      && (leftLinks ?? []).length === 0 && (leftFires ?? []).length === 0,
      `${(leftWf ?? []).length}/${(leftRuns ?? []).length}/${(leftLinks ?? []).length}/${(leftFires ?? []).length}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ██ W3b — THE THROTTLE, NEVER A SHREDDER (docs/relay-canvas-plan.md "W3b") ██
  //
  //   TL  THE CLAMP TABLE + THE STORE — one clamp, floors 1–100, and ABSENT MEANS DEFAULT (writing
  //       the default DELETES the row, so the platform default can move without a migration).
  //   TD  LIVE DEFERRAL — at the limit a matched event is RECORDED and QUEUED, never dropped.
  //   TR  THE DRAIN — oldest-first, bounded by the day's remaining headroom, with an ATOMIC start
  //       claim only one caller can win.
  //   TB  THE PARTITION — the drain owns unstarted runs, the stale-run backstop owns runs whose
  //       START was lost; one flag decides, so they can never double-start a run.
  //   TS  SERVING + PARITY — the number reaches every door of law 1 and is written by ONE writer.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const {
    clampFireLimit, readFireLimit, readFireLimits, writeFireLimit, fireLimitClampNote,
    FIRE_LIMIT_DEFAULT, FIRE_LIMIT_MIN, FIRE_LIMIT_MAX, FIRE_LIMIT_KIND,
  } = await import('../lib/workflows/fire-limit');
  const { drainDeferredFires } = await import('../lib/workflows/reactions');

  const TPFX = `Probe relay W3b ${stamp}`;
  const tWfIds: string[] = [];
  const tPlanKeys: Array<{ kind: string; entity_id: string }> = [];
  const tStart = new Date(Date.now() - 5_000).toISOString();
  const YESTERDAY = new Date(Date.now() - 30 * 60 * 60_000).toISOString();

  const tFire = async (key: string) => {
    const { data } = await admin.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', key).maybeSingle();
    return (data?.tasks ?? null) as
      { runId?: string; deferred?: boolean; startedAt?: string; resolvedAt?: string } | null;
  };
  const tRuns = async (wfId: string) => {
    const { data } = await admin.from('workflow_runs').select('id, status, triggered_by, created_at')
      .eq('workflow_id', wfId).order('created_at', { ascending: true });
    return (data ?? []) as Array<{ id: string; status: string; triggered_by: string; created_at: string }>;
  };
  const mkT = async (name: string, triggers?: ReactionDoor[]) => {
    const { data, error } = await admin.from('workflows').insert({
      user_id: userId, name, status: 'active', trigger: { type: 'manual' }, steps: [],
      output_config: { destination: 'message' },
      ...(HAS_COLUMN && triggers ? { triggers } : {}),
    }).select('id').single();
    const id = (data as { id: string } | null)?.id ?? null;
    if (!id) { console.log(`  ✗ W3b fixture "${name}" failed — ${error?.message}`); fail++; }
    else tWfIds.push(id);
    return id;
  };

  try {
    // ════════════════════════════════════════════════════════════════════════════════════════════
    // TL — THE CLAMP TABLE + THE STORE
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nTL — THE CLAMP TABLE (mode: pure):');
    ok(`the floors are the SYSTEM's — ${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX}, default ${FIRE_LIMIT_DEFAULT}`,
      FIRE_LIMIT_MIN === 1 && FIRE_LIMIT_MAX === 100 && FIRE_LIMIT_DEFAULT === 20,
      `${FIRE_LIMIT_MIN}/${FIRE_LIMIT_MAX}/${FIRE_LIMIT_DEFAULT}`);
    ok('0 CLAMPS UP to the floor and SAYS so (never a silent refusal, never a zero that shreds)',
      clampFireLimit(0).value === FIRE_LIMIT_MIN && clampFireLimit(0).clamped === true,
      JSON.stringify(clampFireLimit(0)));
    ok('250 clamps DOWN to the ceiling and says so',
      clampFireLimit(250).value === FIRE_LIMIT_MAX && clampFireLimit(250).clamped === true,
      JSON.stringify(clampFireLimit(250)));
    ok('a number INSIDE the floors passes through untouched and unspoken',
      clampFireLimit(7).value === 7 && clampFireLimit(7).clamped === false, JSON.stringify(clampFireLimit(7)));
    ok('ABSENCE IS NOT A CLAMP — null/undefined/NaN/an object read as the default, silently',
      [null, undefined, NaN, {}].every((v) =>
        clampFireLimit(v).value === FIRE_LIMIT_DEFAULT && clampFireLimit(v).clamped === false),
      JSON.stringify([clampFireLimit(null), clampFireLimit({})]));
    // An empty string is the ONE non-number that coerces (Number('') === 0). It lands on the FLOOR,
    // never on zero — a zero limit would be the shredder this whole arc exists to kill. Every door
    // guards `!== ''` before calling, so this is belt-and-braces, and it is asserted as such.
    ok('THE FLOOR IS THE FLOOR — an empty/zero-ish value can never produce a limit of 0',
      clampFireLimit('').value === FIRE_LIMIT_MIN && clampFireLimit(0).value === FIRE_LIMIT_MIN
      && clampFireLimit(-5).value === FIRE_LIMIT_MIN,
      JSON.stringify([clampFireLimit(''), clampFireLimit(0), clampFireLimit(-5)]));
    ok('a numeric STRING is a number (the surfaces hand over text fields)',
      clampFireLimit(' 12 ').value === 12 && clampFireLimit(' 12 ').clamped === false);
    ok('a fraction is ROUNDED, and rounding IS a move worth saying',
      clampFireLimit(7.4).value === 7 && clampFireLimit(7.4).clamped === true, JSON.stringify(clampFireLimit(7.4)));
    ok('the clamp NOTE names the floors and quotes what was asked for',
      fireLimitClampNote(250, 100).includes('250')
      && fireLimitClampNote(250, 100).includes(`${FIRE_LIMIT_MIN}–${FIRE_LIMIT_MAX}`)
      && fireLimitClampNote(250, 100).includes('100'), fireLimitClampNote(250, 100));

    console.log('\nTL — THE STORE (absent means default; mode: live store):');
    {
      const widA = randomUUID(), widB = randomUUID();
      tPlanKeys.push({ kind: FIRE_LIMIT_KIND, entity_id: widA }, { kind: FIRE_LIMIT_KIND, entity_id: widB });
      ok('an unwritten workflow reads the DEFAULT, marked as such',
        (await readFireLimit(admin, userId, widA)).dailyFires === FIRE_LIMIT_DEFAULT
        && (await readFireLimit(admin, userId, widA)).isDefault === true);
      const w1 = await writeFireLimit(admin, userId, widA, 5);
      ok('a written number ROUNDTRIPS and stops being the default',
        w1.ok && (await readFireLimit(admin, userId, widA)).dailyFires === 5
        && (await readFireLimit(admin, userId, widA)).isDefault === false, JSON.stringify(w1));
      const wHigh = await writeFireLimit(admin, userId, widA, 500);
      ok('an out-of-range write CLAMPS at the store and reports it (the door can speak)',
        wHigh.ok && wHigh.clamped === true && wHigh.fireLimit.dailyFires === FIRE_LIMIT_MAX,
        JSON.stringify(wHigh));
      const wDef = await writeFireLimit(admin, userId, widA, FIRE_LIMIT_DEFAULT);
      const { data: rowAfter } = await admin.from('item_plans').select('id')
        .eq('user_id', userId).eq('kind', FIRE_LIMIT_KIND).eq('entity_id', widA);
      ok('WRITING THE DEFAULT DELETES THE ROW — there is no stored "unset", so the default can move',
        wDef.ok && wDef.fireLimit.isDefault === true && (rowAfter ?? []).length === 0,
        `${JSON.stringify(wDef)} · rows ${(rowAfter ?? []).length}`);
      await writeFireLimit(admin, userId, widA, 3);
      const batch = await readFireLimits(admin, userId, [widA, widB]);
      ok('THE BATCH READ fills EVERY id — a workflow with no row is present, wearing the default',
        batch.get(widA)?.dailyFires === 3 && batch.get(widA)?.isDefault === false
        && batch.get(widB)?.dailyFires === FIRE_LIMIT_DEFAULT && batch.get(widB)?.isDefault === true,
        JSON.stringify([...batch.entries()]));
      ok('…and an empty id list is an empty map, never a throw',
        (await readFireLimits(admin, userId, [])).size === 0);
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // TD — LIVE DEFERRAL (the whole law in one pass)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    let bId: string | null = null;
    const evs: string[] = [];
    if (HAS_COLUMN) {
      console.log('\nTD — AT THE LIMIT, RECORDED AND QUEUED (mode: LIVE, structural door — zero AI):');
      const upId = await mkT(`${TPFX} upstream`);
      bId = await mkT(`${TPFX} bound`, upId ? [{ type: 'reaction', source: 'workflow', workflow_id: upId }] : undefined);
      if (upId && bId) {
        tPlanKeys.push({ kind: FIRE_LIMIT_KIND, entity_id: bId });
        await writeFireLimit(admin, userId, bId, 2);
        for (let i = 0; i < 4; i++) evs.push(randomUUID());
        const res = await checkSourceReactions(admin, userId, 'workflow',
          evs.map((id) => ({ id, sourceId: upId, title: `${TPFX} upstream`, gist: 'the upstream delivered' })));
        ok('FOUR events, a limit of TWO — two STARTED, two DEFERRED, none lost',
          res?.considered === 4 && res?.fired === 2 && res?.deferred === 2, JSON.stringify(res));

        const recs = await Promise.all(evs.map((id) => tFire(`${bId}:workflow:${id}`)));
        ok('ALL FOUR wrote their exactly-once record (a deferral is remembered exactly like a start)',
          recs.every((r) => !!r && typeof r.runId === 'string'), JSON.stringify(recs.map((r) => !!r)));
        ok('…the first two wear `startedAt` and NO deferred flag',
          recs.slice(0, 2).every((r) => r?.deferred !== true && !!r?.startedAt),
          JSON.stringify(recs.slice(0, 2)));
        ok('…the last two wear `deferred:true` and NO startedAt (queued, not started)',
          recs.slice(2).every((r) => r?.deferred === true && !r?.startedAt),
          JSON.stringify(recs.slice(2)));
        const runs = await tRuns(bId);
        ok('ALL FOUR have a real run row — the deferred ones are visible in the ledger, not invisible',
          runs.length === 4 && runs.every((r) => r.triggered_by === 'event'), `${runs.length}`);
        ok('…and the two deferred runs are still `queued` (recorded ≠ running)',
          recs.slice(2).every((r) => runs.find((x) => x.id === r?.runId)?.status === 'queued'),
          JSON.stringify(runs.map((r) => r.status)));

        const replay = await checkSourceReactions(admin, userId, 'workflow',
          evs.map((id) => ({ id, sourceId: upId, title: `${TPFX} upstream`, gist: 'the same deliveries again' })));
        ok('REPLAY defers nothing and fires nothing — exactly-once covers a DEFERRED event too',
          replay?.considered === 0 && replay?.fired === 0 && replay?.deferred === 0, JSON.stringify(replay));
        ok('…and the queue did not grow', (await tRuns(bId)).length === 4, String((await tRuns(bId)).length));
      }
    } else {
      console.log('\nTD — skipped: workflows.triggers is absent, so a stored door cannot exist (declared, never faked)');
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // TR — THE DRAIN (oldest-first, bounded by headroom, claimed atomically)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    if (HAS_COLUMN && bId && evs.length === 4) {
      console.log('\nTR — THE DRAIN (mode: LIVE):');
      const keyOf = (i: number) => `${bId}:workflow:${evs[i]}`;
      // Backdate the two STARTED records out of today: the day's headroom reopens, exactly as
      // tomorrow's dispatcher would find it. The queue itself is untouched.
      for (const i of [0, 1]) {
        await admin.from('item_plans').update({ created_at: YESTERDAY })
          .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', keyOf(i));
      }
      await writeFireLimit(admin, userId, bId, 1);

      await drainDeferredFires(admin);
      const after1 = [await tFire(keyOf(2)), await tFire(keyOf(3))];
      ok('WITH HEADROOM FOR ONE the drain starts EXACTLY the oldest queued event',
        after1[0]?.deferred === false && !!after1[0]?.startedAt, JSON.stringify(after1[0]));
      ok('…and the younger one is left waiting, still `deferred:true` (paced, not lost)',
        after1[1]?.deferred === true && !after1[1]?.startedAt, JSON.stringify(after1[1]));

      await drainDeferredFires(admin);
      ok('A SECOND DRAIN AT THE LIMIT starts NOTHING — the drain respects the same throttle it serves',
        (await tFire(keyOf(3)))?.deferred === true, JSON.stringify(await tFire(keyOf(3))));

      // Reopen the headroom the drained run just spent — the next day, in one line.
      await admin.from('item_plans').update({ created_at: YESTERDAY })
        .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', keyOf(2));
      await drainDeferredFires(admin);
      const after3 = await tFire(keyOf(3));
      ok('WHEN HEADROOM REOPENS the rest of the queue drains — nothing was ever lost',
        after3?.deferred === false && !!after3?.startedAt, JSON.stringify(after3));

      const before4 = JSON.stringify([await tFire(keyOf(2)), await tFire(keyOf(3))]);
      await drainDeferredFires(admin);
      ok('AN EMPTY DRAIN IS A NO-OP (idempotent — a second pass touches nothing of ours)',
        JSON.stringify([await tFire(keyOf(2)), await tFire(keyOf(3))]) === before4);

      // ── THE ATOMIC START CLAIM, driven directly ─────────────────────────────────────────────
      const claimKey = `${bId}:workflow:${randomUUID()}`;
      tPlanKeys.push({ kind: 'reaction_fire', entity_id: claimKey });
      await admin.from('item_plans').insert({
        user_id: userId, kind: 'reaction_fire', entity_id: claimKey,
        tasks: { runId: null, reason: 'claim probe', deferred: true },
      });
      const claim = () => admin.from('item_plans')
        .update({ tasks: { runId: null, reason: 'claim probe', deferred: false, startedAt: new Date().toISOString() } })
        .eq('user_id', userId).eq('kind', 'reaction_fire').eq('entity_id', claimKey)
        .eq('tasks->>deferred', 'true').select('entity_id');
      const [c1, c2] = await Promise.all([claim(), claim()]);
      ok('THE ATOMIC START CLAIM — two concurrent flips, exactly ONE winner (no run can double-start)',
        ((c1.data ?? []).length + (c2.data ?? []).length) === 1,
        `${(c1.data ?? []).length}/${(c2.data ?? []).length}`);
      ok('…and the loser leaves the record exactly as the winner wrote it',
        (await tFire(claimKey))?.deferred === false);
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // TB — THE PARTITION (the drain owns unstarted runs, the backstop owns lost starts)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nTB — THE DRAIN/BACKSTOP PARTITION (mode: LIVE):');
    {
      const parkWf = await mkT(`${TPFX} partition`);
      const mkStale = async (tasksExtra: Record<string, unknown>) => {
        const { data } = await admin.from('workflow_runs').insert({
          workflow_id: parkWf, user_id: userId, status: 'queued', triggered_by: 'event',
          created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        }).select('id').single();
        const runId = (data as { id: string } | null)?.id ?? '';
        const key = `${parkWf}:workflow:${randomUUID()}`;
        tPlanKeys.push({ kind: 'reaction_fire', entity_id: key });
        await admin.from('item_plans').insert({
          user_id: userId, kind: 'reaction_fire', entity_id: key,
          tasks: { runId, reason: 'partition probe', context: 'probe context', ...tasksExtra },
        });
        return { runId, key };
      };
      // THE RECORDING PROXY (the SP7 idiom): the backstop's re-fire rides `after()`, which cannot
      // run outside a request scope — so what a host-safe gate observes is WHICH RUNS IT CLAIMED.
      // A claim is the `workflow_runs.id=<run>` update; a refused run never reaches one.
      const seen: string[] = [];
      const wrapQ = (obj: Record<string, unknown>, table: string): Record<string, unknown> =>
        new Proxy(obj, {
          get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
              if (p === 'eq') seen.push(`${table}.${String(args[0])}=${String(args[1])}`);
              const out = (v as (...a: unknown[]) => unknown).apply(t, args);
              return (out && typeof out === 'object' && typeof (out as Record<string, unknown>).eq === 'function')
                ? wrapQ(out as Record<string, unknown>, table) : out;
            };
          },
        });
      const recorder = new Proxy(admin as unknown as Record<string, unknown>, {
        get(target, prop, recv) {
          if (prop === 'from') return (table: string) => wrapQ((admin.from as (t: string) => unknown)(table) as Record<string, unknown>, table);
          const v = Reflect.get(target, prop, recv);
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }) as unknown as SupabaseClient;

      const census = async () => {
        const { data } = await admin.from('workflow_runs').select('id')
          .eq('status', 'queued').eq('triggered_by', 'event')
          .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString()).limit(20);
        return (data ?? []).length;
      };

      // ── PASS 1: the ONLY stale row of ours is a DEFERRED one. Nothing may be claimed.
      const deferredRun = await mkStale({ deferred: true });
      console.log(`    · ${await census()} stale queued event run(s) exist on this host (the backstop reads 5 at a time)`);
      seen.length = 0;
      try { await refireStaleEventRuns(recorder); } catch { /* the re-fire is host-bound; the LOOKUPS are the gate */ }
      ok('THE BACKSTOP LOOKS AT the deferred run\'s fire record (the partition is read, not assumed)',
        seen.includes(`item_plans.tasks->>runId=${deferredRun.runId}`), JSON.stringify(seen.slice(0, 8)));
      ok('THE BACKSTOP REFUSES A DEFERRED RUN — it never reaches the claim (flushing it would undo the throttle)',
        !seen.includes(`workflow_runs.id=${deferredRun.runId}`), JSON.stringify(seen.slice(0, 8)));
      ok('…leaving it queued and still `deferred:true` for the drain to own',
        (await tFire(deferredRun.key))?.deferred === true
        && (await tRuns(parkWf!)).find(r => r.id === deferredRun.runId)?.status === 'queued',
        JSON.stringify(await tFire(deferredRun.key)));

      // ── PASS 2: a run whose START was lost — the other half of the partition.
      const lostRun = await mkStale({ startedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
      seen.length = 0;
      try { await refireStaleEventRuns(recorder); } catch { /* same host-bound tail */ }
      ok('…while it STILL CLAIMS a run whose START was lost (the throttle never became an outage)',
        seen.includes(`workflow_runs.id=${lostRun.runId}`), JSON.stringify(seen.slice(0, 10)));
      ok('…and the deferred run was passed over a SECOND time (the flag, not a one-off)',
        !seen.includes(`workflow_runs.id=${deferredRun.runId}`), JSON.stringify(seen.slice(0, 10)));

      // A subprocess link is a DIFFERENT kind — the drain's work-list is `reaction_fire` alone, so a
      // link row wearing the same flag is invisible to it (kinds are not a shared namespace).
      const linkKey = `probe-w3b-link-${stamp}`;
      tPlanKeys.push({ kind: 'subprocess_link', entity_id: linkKey });
      await admin.from('item_plans').insert({
        user_id: userId, kind: 'subprocess_link', entity_id: linkKey,
        tasks: { childRunId: deferredRun.runId, deferred: true, context: 'probe baton' },
      });
      await drainDeferredFires(admin);
      const { data: linkAfter } = await admin.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', 'subprocess_link').eq('entity_id', linkKey).maybeSingle();
      ok('A SUBPROCESS LINK wearing `deferred:true` is INVISIBLE to the drain (kind, not flag, selects)',
        (linkAfter?.tasks as { deferred?: boolean } | undefined)?.deferred === true,
        JSON.stringify(linkAfter?.tasks));
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // TS — SERVING + PARITY (law 1: one schema, four doors — comment-stripped)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    console.log('\nTS — THE THROTTLE REACHES EVERY DOOR (mode: source):');
    {
      const wfGet = stripComments(readFileSync('app/api/workflows/[id]/route.ts', 'utf8'));
      const ledger = stripComments(readFileSync('app/api/workflows/ledger/route.ts', 'utf8'));
      const studioNow = stripComments(readFileSync('components/work/studio-builder.tsx', 'utf8'));
      const genNow = stripComments(readFileSync('lib/workflows/generate-config.ts', 'utf8'));
      const wtNow = stripComments(readFileSync('lib/tools/worker-tasks.ts', 'utf8'));
      const cardNow = stripComments(readFileSync('components/workflows/workflow-draft-card.tsx', 'utf8'));
      const postNow = stripComments(readFileSync('app/api/workflows/route.ts', 'utf8'));
      const dispatchNow = stripComments(readFileSync('app/api/cron/workflows-dispatch/route.ts', 'utf8'));

      ok('SERVED: the workflow GET reads the throttle and serves it in BOTH places (one derivation)',
        /const fireLimit = await readFireLimit\(adminRead, data\.user_id, id\);/.test(wfGet)
        && /workflow: \{ \.\.\.data,[^}]*fireLimit,/.test(wfGet) && /\n\s*fireLimit,\n/.test(wfGet));
      ok('SERVED: the ledger batches it for every row and never serves null (absent = the default)',
        /readFireLimits\(supabase, user\.id, wfs\.map\(\(w\) => w\.id\)\)/.test(ledger)
        && /fireLimit: limitsOut\.get\(w\.id\) \?\? \{ \.\.\.DEFAULT_FIRE_LIMIT \}/.test(ledger));
      ok('WRITTEN: the PATCH takes `fire_limit` OUT OF BAND (never a workflows column) …',
        /const fireLimitBody = 'fire_limit' in body \? body\.fire_limit : undefined;/.test(wfGet)
        && /delete update\.fire_limit;/.test(wfGet));
      ok('…through the ENGINE\'S OWN WRITE, echoing the clamp so the surface can speak it',
        /await writeFireLimit\(supabase, user\.id, id, fireLimitBody\)/.test(wfGet)
        && /fire_limit_clamped: fireLimitClamped/.test(wfGet));
      ok('THE CREATE PATH RIDES IT TOO (a pace the draft stated survives the Confirm) …',
        /body\.fire_limit !== undefined/.test(postNow) && /await writeFireLimit\(supabase, user\.id, \(data as \{ id: string \}\)\.id, body\.fire_limit\)/.test(postNow));
      ok('…best-effort and isolated — a store failure costs the number, never the creation',
        /catch \(e\) \{[\s\S]{0,160}?fire limit not persisted/.test(postNow));

      ok('STUDIO: the control exists ONLY where there are doors to throttle (no dead chrome)',
        /\{doors\.length > 0 && \(\s*<ThrottleRow limit=\{workflow\.fireLimit\} onChange=\{onFireLimit\} \/>\s*\)\}/.test(studioNow));
      ok('STUDIO: the floors are IMPORTED from the engine, never re-typed (a second copy is a second law)',
        studioNow.includes("from '@/lib/workflows/fire-limit'")
        && /clampFireLimit/.test(studioNow));
      {
        const body = studioNow.slice(studioNow.indexOf('function ThrottleRow('));
        const row = body.slice(0, body.indexOf('\nfunction '));
        // Class names are not the law (border-neutral-100 is a colour, not a ceiling) — strings are
        // stripped before the literal hunt, so only real code numbers can offend.
        const rowCode = row.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
        ok('…and the row itself contains NO bare 20/100 literal — only the imported constants',
          !/\b(?:20|100)\b/.test(rowCode),
          rowCode.split('\n').filter((l) => /\b(?:20|100)\b/.test(l)).join(' | ').slice(0, 160));
        ok('…and it commits through THE ONE CLAMP, never a second range check',
          /onChange\(n\);/.test(row) && !/Math\.(?:min|max)\(/.test(row));
      }
      ok('STUDIO: the save carries `fire_limit` and honours the clamped echo out loud',
        /fire_limit: workflow\.fireLimit\.dailyFires/.test(studioNow) && /payload\.fire_limit_clamped/.test(studioNow));

      ok('DOOR 1 (describe-it): generate-config may author a stated pace, through the ONE clamp',
        /clampFireLimit\(generated\.fire_limit\)/.test(genNow) && /fire_limit: fireLimit,/.test(genNow));
      ok('…and a moved number rides the DOOR note (trigger-side config, one sentence about how work starts)',
        /needsDoorNote = doorNote\(\[[\s\S]{0,160}?fireLimitClampNote\(generated\.fire_limit, value\),/.test(genNow));
      ok('…its prompt states the floors from the constants and forbids the "stop after N" reading',
        /\$\{FIRE_LIMIT_MIN\}–\$\{FIRE_LIMIT_MAX\}/.test(genNow) && /extra events are not dropped/.test(genNow));
      ok('DOOR 2 (coworker chat): create_task AND update_task both take `daily_run_limit`',
        (wtNow.match(/daily_run_limit: \{/g) ?? []).length === 2);
      ok('…create clamps and SAYS the move; update clamps and lands after the row',
        /clampFireLimit\(dailyRunLimit\)/.test(wtNow) && /clampFireLimit\(fields\.daily_run_limit\)/.test(wtNow));
      ok('…ONE WRITE PATH — the chat door stores through writeFireLimit, never its own upsert',
        (wtNow.match(/await writeFireLimit\(/g) ?? []).length === 1
        && !new RegExp(`from\\('item_plans'\\)[\\s\\S]{0,120}${FIRE_LIMIT_KIND}`).test(wtNow));
      ok('…and get_task SPEAKS the number, marking the default as the default',
        /Daily event limit: \$\{fireLimit\.dailyFires\}\$\{fireLimit\.isDefault \? ' \(default\)' : ''\}/.test(wtNow)
        && /await readFireLimit\(/.test(wtNow));
      ok('THE DRAFT CARD speaks it ONLY when it is not the default (never restate the settled)',
        /typeof draft\.fire_limit === 'number' && draft\.fire_limit !== FIRE_LIMIT_DEFAULT/.test(cardNow)
        && /up to \{draft\.fire_limit\} event runs a day/.test(cardNow));
      ok('…and the Confirm body carries it to the create route (the draft\'s pace becomes the task\'s)',
        /\.\.\.\(typeof draft\.fire_limit === 'number' \? \{ fire_limit: draft\.fire_limit \} : \{\}\)/.test(cardNow));

      ok('THE DISPATCHER DRAINS BEFORE IT BACKSTOPS (a drained run gets its own honest start first)',
        dispatchNow.indexOf('drainDeferredFires') > 0
        && dispatchNow.indexOf('drainDeferredFires') < dispatchNow.indexOf('refireStaleEventRuns'),
        `${dispatchNow.indexOf('drainDeferredFires')} vs ${dispatchNow.indexOf('refireStaleEventRuns')}`);
      const reactionsNow = stripComments(readFileSync('lib/workflows/reactions.ts', 'utf8'));
      ok('THE COUNTING FACT is ONE predicate with three readers — never a second copy of the rule',
        /function fireStarted\(tasks: unknown\): boolean \{\s*return \(tasks as FireTasks \| null\)\?\.deferred !== true;/
          .test(reactionsNow)
        && (reactionsNow.match(/fireStarted\(/g) ?? []).length === 4,
        String((reactionsNow.match(/fireStarted\(/g) ?? []).length));
      ok('THE OLD SHREDDER IS GONE — no DAILY_CAP survives in the engine\'s code',
        !/DAILY_CAP/.test(reactionsNow));
      ok('…and the throttle is read through the ONE store module, batched (never a read per event)',
        /import \{ readFireLimits, FIRE_LIMIT_DEFAULT \} from '@\/lib\/workflows\/fire-limit'/.test(reactionsNow)
        && /const limits = await readFireLimits\(admin, userId, wfs\.map\(w => w\.id\)\);/.test(reactionsNow));
    }
  } finally {
    for (const id of tWfIds) {
      await admin.from('workflow_runs').delete().eq('workflow_id', id);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'reaction_fire').like('entity_id', `${id}:%`);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', FIRE_LIMIT_KIND).eq('entity_id', id);
      await admin.from('work_threads').delete().eq('workflow_id', id);
      await admin.from('workflows').delete().eq('id', id);
    }
    for (const k of tPlanKeys) {
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', k.kind).eq('entity_id', k.entity_id);
    }
    const { data: leftWf } = await admin.from('workflows').select('id').eq('user_id', userId).like('name', `${TPFX}%`);
    const { data: leftRuns } = await admin.from('workflow_runs').select('id')
      .in('workflow_id', tWfIds.length ? tWfIds : ['00000000-0000-0000-0000-000000000000']);
    const { data: leftFires } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', 'reaction_fire').gte('created_at', tStart);
    const { data: leftLimits } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', FIRE_LIMIT_KIND).gte('created_at', tStart);
    const { data: leftLinks } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', 'subprocess_link').gte('created_at', tStart);
    ok('W3b probe leftovers are ZERO (workflows · runs · fire records · limit rows · link rows)',
      (leftWf ?? []).length === 0 && (leftRuns ?? []).length === 0 && (leftFires ?? []).length === 0
      && (leftLimits ?? []).length === 0 && (leftLinks ?? []).length === 0,
      `${(leftWf ?? []).length}/${(leftRuns ?? []).length}/${(leftFires ?? []).length}/${(leftLimits ?? []).length}/${(leftLinks ?? []).length}`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
