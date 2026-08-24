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
  // THE AI FENCE: the `workflow` source is STRUCTURAL. With the provider keys removed from the
  // process, ANY judged path can only return zero matches — so a fire here PROVES no judge ran.
  const savedKeys: Record<string, string | undefined> = {};
  const fenceAI = () => {
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_BEDROCK_ACCESS_KEY_ID', 'AWS_BEDROCK_SECRET_ACCESS_KEY']) {
      savedKeys[k] = process.env[k]; delete process.env[k];
    }
  };
  const unfenceAI = () => { for (const [k, v] of Object.entries(savedKeys)) if (v !== undefined) process.env[k] = v; };

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

    /** Seed the honest DAILY CAP so a candidate is COUNTED but never judged — the token gates below
     *  are then fully deterministic and spend nothing. */
    const seedCap = async (wfId: string) => {
      for (let i = 0; i < 5; i++) {
        const key = `${wfId}:cap:${stamp}-${i}`;
        capKeys.push(key);
        await admin.from('item_plans').insert({ user_id: userId, kind: 'reaction_fire', entity_id: key, tasks: { runId: null, reason: 'cap seed' } });
      }
    };
    const seedFire = async (key: string) => {
      capKeys.push(key);
      await admin.from('item_plans').insert({ user_id: userId, kind: 'reaction_fire', entity_id: key, tasks: { runId: null, reason: 'exactly-once seed' } });
    };
    const runsOf = async (wfId: string) => {
      const { data } = await admin.from('workflow_runs').select('id, triggered_by').eq('workflow_id', wfId);
      return (data ?? []) as Array<{ id: string; triggered_by: string }>;
    };

    fenceAI();

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
      ok('…with the AI provider keys REMOVED — a judged path could not have matched (structural, proven)',
        r1?.fired === 1);
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

    // ── THE SOURCE TOKENS (deterministic through the honest daily cap — zero AI) ────────────────
    const tokenMode = HAS_COLUMN ? 'live (stored triggers)' : 'fixture-proxy (migration-absent pattern)';
    console.log(`\nF — THE SOURCE TOKENS (exactly-once keys) [mode: ${tokenMode} · mail: live legacy]:`);
    const tokenClient = HAS_COLUMN ? admin : doorProxy(admin, (cols) => ({
      data: WIDE(cols)
        ? [fixtureRow(fileId, [{ type: 'reaction', source: 'file', when: 'the file is a probe fixture' }]),
           fixtureRow(meetId, [{ type: 'reaction', source: 'meeting', when: 'it was a probe call' }])]
        : [],
      error: null,
    }));
    for (const id of [fileId, meetId, mailId]) if (id) await seedCap(id);

    for (const [source, wfId, token, client] of [
      ['file', fileId, 'file', tokenClient],
      ['meeting', meetId, 'meeting', tokenClient],
      ['mail', mailId, 'inbox', admin],
    ] as Array<['file' | 'meeting' | 'mail', string, string, SupabaseClient]>) {
      const fresh = randomUUID(), seeded = randomUUID(), wrong = randomUUID();
      const rFresh = await checkSourceReactions(client, userId, source, [{ id: fresh, title: 'probe', gist: 'probe event' }]);
      ok(`${source}: the door is DISCOVERED and the event considered (capped, never judged)`,
        rFresh?.considered === 1 && rFresh?.capped === 1 && rFresh?.fired === 0, JSON.stringify(rFresh));

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

      const runsBefore = (await admin.from('workflow_runs').select('id').in('workflow_id', fireIds)).data?.length ?? 0;
      for (const source of ['file', 'meeting', 'workflow'] as const) {
        const r = await checkSourceReactions(degraded, userId, source,
          [{ id: randomUUID(), sourceId: upId!, title: 'probe', gist: 'probe event' }]);
        ok(`${source}: a NEW door is a SILENT no-op before the migration (no throw, no fire)`, r === null, JSON.stringify(r));
      }
      const rMail = await checkSourceReactions(degraded, userId, 'mail', [{ id: randomUUID(), title: 'probe', gist: 'probe event' }]);
      ok('mail: the LEGACY reaction is still discovered through the fallback (behaviour preserved)',
        rMail?.considered === 1 && rMail?.capped === 1, JSON.stringify(rMail));
      const runsAfter = (await admin.from('workflow_runs').select('id').in('workflow_id', fireIds)).data?.length ?? 0;
      ok('…and the degraded pass created ZERO runs', runsAfter === runsBefore, `${runsBefore} → ${runsAfter}`);
    }
  } finally {
    unfenceAI();
    for (const id of fireIds) {
      await admin.from('workflow_runs').delete().eq('workflow_id', id);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'reaction_fire').like('entity_id', `${id}:%`);
      await admin.from('workflows').delete().eq('id', id);
    }
    for (const k of capKeys) await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', k);
    const { data: leftWf } = await admin.from('workflows').select('id').eq('user_id', userId).like('name', `${FPFX}%`);
    const { data: leftRuns } = await admin.from('workflow_runs').select('id')
      .in('workflow_id', fireIds.length ? fireIds : ['00000000-0000-0000-0000-000000000000']);
    const { data: leftFires } = await admin.from('item_plans').select('id')
      .eq('user_id', userId).eq('kind', 'reaction_fire').gte('created_at', new Date(stamp - 60_000).toISOString());
    ok('F probe leftovers are ZERO (workflows · runs · fire records)',
      (leftWf ?? []).length === 0 && (leftRuns ?? []).length === 0 && (leftFires ?? []).length === 0,
      `${(leftWf ?? []).length}/${(leftRuns ?? []).length}/${(leftFires ?? []).length}`);
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

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
