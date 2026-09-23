// smoke-typed-stores.ts — W2.6 TYPED STORES + DEMOLITION gate (R2 · R4 · docs/stabilization-plan.md).
//
// ZERO AI, ZERO DB. What it proves:
//   T1 THE ONE DOOR    — lib/store/item-plans.ts carries the kind registry (schema · role · key · home ·
//                        retention) and the typed helpers; every registered home file exists.
//   T2 THE RATCHET     — every raw `.from('item_plans')` outside the door sits in a file on the ALLOW
//                        list below, with EXACTLY the allowed count. More = a new raw site (use the door);
//                        fewer = a migration landed, so SHRINK THE LIST (it can only shrink).
//   T3 NO UNREGISTERED KIND — every kind literal a raw site filters/writes on is in the registry.
//   T4 THE HOT KINDS MIGRATED — judgment · room_brief · pending_change · prep_outcome · workflow_inputs ·
//                        fulfillment · sweep_claim · the sweep markers · prep_requeue · conversation_pair
//                        have ZERO raw sites left anywhere.
//   T5 RETENTION       — the retention cron reads ITEM_PLANS_RETENTION from the door (no local kind list);
//                        every retained kind is a staging/record kind whose evidence the route header names.
//   T6 SCHEMAS         — representative stored shapes (the Sep 23 live census) parse; a wrong shape fails.
//   D  DEMOLITION      — no `person_state` reader/writer in lib/app/components; the dead readers are gone.
//   S  NO SILENT CAPS  — the standing sync's full listings page (fetchAllRows); the owner read is chunked.
//   V  VERSIONED SIGS  — the Home brief synthesis + bundle-naming caches carry their prompt VERSION.
//   KEPT               — label-era modules still serving a live surface: printed with the evidence.
//
// Run: npx tsx scripts/smoke-typed-stores.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import {
  ITEM_PLAN_REGISTRY, ITEM_PLAN_KINDS, ITEM_PLANS_RETENTION, planTasksValid, isItemPlanKind,
  type ItemPlanStoreKind, type PlanKindSpec,
} from '../lib/store/item-plans';

const ROOT = join(__dirname, '..');
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
const rel = (f: string) => relative(ROOT, f);
function walk(dir: string, files: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
  return files;
}
const files = ['lib', 'app', 'components', 'hooks', 'context'].flatMap((d) => walk(join(ROOT, d)));
const DOOR = 'lib/store/item-plans.ts';

// ── THE ALLOWLIST (not yet migrated — each with its kind(s)). IT CAN ONLY SHRINK. ────────────────
// '$plan' = the Identified-tasks plan kinds (email|meeting|commitment|awareness|followup), passed as a
// variable; '*' = a delete keyed by a project id across every kind (the project-delete door).
const ALLOW: Record<string, { n: number; kinds: string[] }> = {
  'app/api/cron/status-alerts/route.ts': { n: 2, kinds: ['status_alert'] },
  'app/api/entities/[id]/route.ts': { n: 1, kinds: ['*'] },
  'app/api/home/held/route.ts': { n: 1, kinds: ['held_cache'] },
  'app/api/home/timeline/route.ts': { n: 2, kinds: ['timeline_cache'] },
  'app/api/inbox/[id]/send-reply/route.ts': { n: 2, kinds: ['email'] },
  'app/api/items/execute/route.ts': { n: 4, kinds: ['$plan'] },
  'app/api/items/ingest/route.ts': { n: 2, kinds: ['$plan'] },
  'app/api/items/plan/route.ts': { n: 4, kinds: ['$plan'] },
  'app/api/items/prepare/route.ts': { n: 1, kinds: ['$plan'] },
  'app/api/items/reply-directions/route.ts': { n: 2, kinds: ['reply_directions'] },
  'app/api/items/view/route.ts': { n: 1, kinds: ['$plan'] },
  'app/api/rooms/adopt/route.ts': { n: 4, kinds: ['room_scope'] },
  'app/api/rooms/recent/route.ts': { n: 2, kinds: ['room_title', 'room_scope'] },
  'app/api/rooms/title/route.ts': { n: 1, kinds: ['room_title'] },
  'app/api/workflows/[id]/runs/route.ts': { n: 1, kinds: ['frame_share'] },
  'app/api/workflows/ledger/route.ts': { n: 1, kinds: ['workflow_scope'] },
  'lib/autonomy/ledger.ts': { n: 2, kinds: ['autonomy'] },
  'lib/commitments/expiry.ts': { n: 2, kinds: ['expiry'] },
  'lib/commitments/extract.ts': { n: 1, kinds: ['commitment'] },
  'lib/deeds/bulk.ts': { n: 4, kinds: ['bulk_deed'] },
  'lib/deeds/held-cache.ts': { n: 1, kinds: ['held_cache'] },
  'lib/documents/theme.ts': { n: 3, kinds: ['doc_theme'] },
  'lib/frames/share.ts': { n: 4, kinds: ['frame_share'] },
  'lib/home/anticipation.ts': { n: 11, kinds: ['anticipation'] },
  'lib/home/day-anchors.ts': { n: 2, kinds: ['day_anchors'] },
  'lib/home/day-state.ts': { n: 2, kinds: ['day_state'] },
  'lib/home/day.ts': { n: 1, kinds: ['anticipation'] },
  'lib/home/item-plan.ts': { n: 1, kinds: ['$plan'] },
  'lib/inbox/campaign-echo.ts': { n: 2, kinds: ['campaign_signature'] },
  'lib/inbox/conversation-identity.ts': { n: 5, kinds: ['judgment_nomination', 'conversation_cascade'] },
  'lib/knowledge/rename-folder.ts': { n: 4, kinds: ['profile_manifest'] },
  'lib/matching/manifest.ts': { n: 2, kinds: ['profile_manifest'] },
  'lib/matching/match-profiles.ts': { n: 2, kinds: ['match_seen'] },
  'lib/prepare/chat-email-store.ts': { n: 4, kinds: ['chat_email'] },
  'lib/prepare/chat-invite-store.ts': { n: 4, kinds: ['chat_invite'] },
  'lib/prepare/outcome-facts.ts': { n: 2, kinds: ['outcome_facts'] },
  'lib/present/dm-channel.ts': { n: 3, kinds: ['dm_present'] },
  'lib/room/read-marker.ts': { n: 4, kinds: ['room_read'] },
  'lib/tenders/enrich-members.ts': { n: 2, kinds: ['tender_member_enrichment'] },
  'lib/tenders/member-directory.ts': { n: 2, kinds: ['tender_member_manifest'] },
  'lib/utils/user-time.ts': { n: 2, kinds: ['date_stated'] },
  'lib/work/apply-verdict.ts': { n: 2, kinds: ['verdict_resolve_roll'] },
  'lib/work/catch-up.ts': { n: 2, kinds: ['catch_up'] },
  'lib/work/proof-of-life.ts': { n: 4, kinds: ['proof_of_life'] },
  'lib/workers/cos-seat.ts': { n: 1, kinds: ['cos_seat'] },
  'lib/workflows/case-step.ts': { n: 10, kinds: ['workflow_case', 'run_case', 'reaction_fire'] },
  'lib/workflows/entity-edge.ts': { n: 3, kinds: ['workflow_scope'] },
  'lib/workflows/fire-limit.ts': { n: 4, kinds: ['workflow_limit'] },
  'lib/workflows/handoffs.ts': { n: 4, kinds: ['handoff_override', 'handoff_nudge'] },
  'lib/workflows/owner.ts': { n: 2, kinds: ['workflow_owner'] },
  'lib/workflows/process-state.ts': { n: 2, kinds: ['reaction_fire', 'run_case'] },
  'lib/workflows/reactions.ts': { n: 9, kinds: ['workflow_scope', 'reaction_fire', 'subprocess_link'] },
  'lib/workflows/subprocess.ts': { n: 5, kinds: ['subprocess_link'] },
};
const PLAN_KINDS = ['email', 'meeting', 'commitment', 'awareness', 'followup'];
const HOT: ItemPlanStoreKind[] = [
  'judgment', 'room_brief', 'pending_change', 'prep_outcome', 'workflow_inputs', 'fulfillment',
  'sweep_claim', 'judgment_sweep', 'draft_sweep', 'label_sweep', 'prep_requeue', 'conversation_pair',
];

// Raw-site scan: each `.from('item_plans')` chain, up to its statement end.
type Site = { file: string; line: number; body: string };
const sites: Site[] = [];
for (const f of files) {
  const r = rel(f);
  if (r === DOOR) continue;
  const t = readFileSync(f, 'utf8');
  const re = /\.from\((['"])item_plans\1\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    let i = m.index + m[0].length, depth = 0;
    while (i < t.length) {
      const c = t[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') { if (depth === 0) break; depth--; }
      else if (c === ';' && depth === 0) break;
      i++;
    }
    sites.push({ file: r, line: t.slice(0, m.index).split('\n').length, body: t.slice(m.index, i) });
  }
}

// ── T1 THE ONE DOOR ─────────────────────────────────────────────────────────────────────────────
{
  const door = src(DOOR);
  check('T1.1 the door exports the typed helpers',
    ['readPlan', 'readPlans', 'readPlansForUsers', 'readPlansByKeysAnyUser', 'upsertPlan', 'insertPlan', 'updatePlan', 'deletePlans']
      .every((fn) => new RegExp(`export async function ${fn}<`).test(door)));
  check('T1.2 the full listing pages through fetchAllRows (NO SILENT CAPS)', /fetchAllRows<RawRow>\(\(from, to\) => build\(keys\)\.range\(from, to\)\)/.test(door));
  check('T1.3 the door names the entity_id collision (the column holds an item KEY)', /NAMING COLLISION/.test(door));
  check(`T1.4 the registry holds ${ITEM_PLAN_KINDS.length} kinds (>= 50)`, ITEM_PLAN_KINDS.length >= 50);
  const specs = Object.entries(ITEM_PLAN_REGISTRY) as Array<[string, PlanKindSpec]>;
  const badSpec = specs.filter(([, s]) => !s.schema || !s.role || !s.key || !s.home).map(([k]) => k);
  check('T1.5 every kind carries schema · role · key · home', badSpec.length === 0, badSpec.join(', '));
  const missingHome = specs.filter(([, s]) => s.role !== 'orphan')
    .map(([k, s]) => [k, s.home.split(/\s/)[0]] as const).filter(([, h]) => !existsSync(join(ROOT, h))).map(([k, h]) => `${k} → ${h}`);
  check('T1.6 every kind\'s home file exists', missingHome.length === 0, missingHome.join(', '));
  const homeless = specs.filter(([k, s]) => s.role !== 'orphan' && !src(s.home.split(/\s/)[0]).includes(`'${k}'`)).map(([k]) => k);
  check('T1.7 every live kind\'s home module spells the kind (the registry points at its real owner)', homeless.length === 0, homeless.join(', '));
}

// ── T2 THE RATCHET ──────────────────────────────────────────────────────────────────────────────
{
  const counts = new Map<string, number>();
  for (const s of sites) counts.set(s.file, (counts.get(s.file) ?? 0) + 1);
  const unlisted = [...counts.keys()].filter((f) => !ALLOW[f]).map((f) => `${f} (${counts.get(f)})`);
  check('T2.1 no raw item_plans access outside the door + the allowlist (use lib/store/item-plans.ts)', unlisted.length === 0, unlisted.join(', '));
  const grew = Object.entries(ALLOW).filter(([f, a]) => (counts.get(f) ?? 0) > a.n).map(([f, a]) => `${f}: ${counts.get(f)} > ${a.n}`);
  check('T2.2 no allowlisted file GREW a raw site', grew.length === 0, grew.join(', '));
  const shrank = Object.entries(ALLOW).filter(([f, a]) => (counts.get(f) ?? 0) < a.n).map(([f, a]) => `${f}: ${counts.get(f) ?? 0} < ${a.n}`);
  check('T2.3 the allowlist is tight (a migrated site SHRINKS its entry — the list only shrinks)', shrank.length === 0, shrank.join(', '));
  const badAllowKinds = Object.entries(ALLOW).flatMap(([f, a]) => a.kinds.filter((k) => k !== '$plan' && k !== '*' && !isItemPlanKind(k)).map((k) => `${f}:${k}`));
  check('T2.4 every allowlisted kind is registered', badAllowKinds.length === 0, badAllowKinds.join(', '));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`      (raw sites remaining: ${total} across ${counts.size} files; allowlist entries: ${Object.keys(ALLOW).length})`);
}

// ── T3 NO UNREGISTERED KIND ─────────────────────────────────────────────────────────────────────
{
  const unregistered: string[] = [];
  for (const s of sites) {
    const lits = [
      ...[...s.body.matchAll(/eq\('kind',\s*'([a-z_]+)'\)/g)].map((m) => m[1]),
      ...[...s.body.matchAll(/in\('kind',\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])),
      ...[...s.body.matchAll(/kind:\s*'([a-z_]+)',\s*entity_id/g)].map((m) => m[1]),
    ];
    for (const k of lits) if (!isItemPlanKind(k)) unregistered.push(`${s.file}:${s.line} '${k}'`);
    const allowKinds = ALLOW[s.file]?.kinds ?? [];
    for (const k of lits) {
      if (allowKinds.includes(k) || allowKinds.includes('*') || (allowKinds.includes('$plan') && PLAN_KINDS.includes(k))) continue;
      unregistered.push(`${s.file}:${s.line} '${k}' (not on its allowlist entry)`);
    }
  }
  check('T3 every kind a raw site names is registered AND on its file\'s allowlist entry', unregistered.length === 0, unregistered.join(', '));
}

// ── T4 THE HOT KINDS MIGRATED ───────────────────────────────────────────────────────────────────
{
  const leaks = sites.filter((s) => HOT.some((k) => new RegExp(`'${k}'`).test(s.body))).map((s) => `${s.file}:${s.line}`);
  check(`T4.1 the hot kinds (${HOT.length}) have ZERO raw sites left`, leaks.length === 0, leaks.join(', '));
  const constLeaks: string[] = [];
  for (const [file, konst] of [
    ['lib/work/pending-change.ts', 'PENDING_CHANGE_KIND'], ['lib/workflows/inputs.ts', 'INPUTS_KIND'],
    ['lib/prepare/requeue.ts', 'PREP_REQUEUE_KIND'], ['lib/work/sweep-fanout.ts', 'SWEEP_CLAIM_KIND'],
  ] as const) if (sites.some((s) => s.file === file) || sites.some((s) => s.body.includes(konst))) constLeaks.push(`${file} (${konst})`);
  check('T4.2 the hot kinds\' constants no longer drive a raw query', constLeaks.length === 0, constLeaks.join(', '));
  const doorUsers = ['lib/work/judge.ts', 'lib/room/brief.ts', 'lib/work/pending-change.ts', 'lib/prepare/pass.ts',
    'lib/workflows/inputs.ts', 'lib/commitments/fulfillment.ts', 'lib/work/sweep-fanout.ts', 'lib/work/sweep-users.ts',
    'lib/prepare/requeue.ts', 'lib/inbox/conversation-identity.ts'].filter((f) => !src(f).includes("from '@/lib/store/item-plans'"));
  check('T4.3 every hot kind\'s home module imports the door', doorUsers.length === 0, doorUsers.join(', '));
  const sweepMarkers = src('lib/work/sweep-users.ts');
  check('T4.4 the sweep markers are a typed union (a typo\'d marker kind is a type error)',
    /export type SweepMarkerKind = 'judgment_sweep' \| 'draft_sweep' \| 'label_sweep'/.test(sweepMarkers)
      && /markerKind: SweepMarkerKind/.test(sweepMarkers));
}

// ── T5 RETENTION ────────────────────────────────────────────────────────────────────────────────
{
  const route = src('app/api/cron/retention/route.ts');
  check('T5.1 the retention cron reads the door\'s table', /import \{ ITEM_PLANS_RETENTION \} from '@\/lib\/store\/item-plans'/.test(route)
    && /Object\.entries\(ITEM_PLANS_RETENTION\)/.test(route));
  check('T5.2 no local kind list survives in the cron', !/ITEM_PLANS_DISPOSABLE_KINDS|ITEM_PLANS_RETENTION_DAYS/.test(route));
  const retained = Object.keys(ITEM_PLANS_RETENTION) as ItemPlanStoreKind[];
  const unsafe = retained.filter((k) => !['staging', 'record'].includes(ITEM_PLAN_REGISTRY[k].role));
  check('T5.3 only staging/record kinds carry a retention (never a cache sig, token or marker)', unsafe.length === 0, unsafe.join(', '));
  const unevidenced = retained.filter((k) => !route.includes(`'${k}'`));
  check('T5.4 every retained kind\'s evidence is written in the route header', unevidenced.length === 0, unevidenced.join(', '));
  check('T5.5 the three evidenced kinds keep their 180 days',
    ITEM_PLANS_RETENTION.chat_email === 180 && ITEM_PLANS_RETENTION.chat_invite === 180 && ITEM_PLANS_RETENTION.prep_outcome === 180 && retained.length === 3,
    JSON.stringify(ITEM_PLANS_RETENTION));
}

// ── T6 SCHEMAS (the Sep 23 live census shapes) ──────────────────────────────────────────────────
{
  const fixtures: Array<[ItemPlanStoreKind, unknown, boolean]> = [
    ['judgment', { sig: '17:2026-09-23:x', verdict: { work: 'reply' } }, true],
    ['fulfillment', { sig: '3:e1', verdict: { verdict: 'unclear' } }, true],
    ['room_brief', { v: 6, at: '2026-09-23T00:00:00Z', sig: 'a', move: null, text: 'Where it stands.', offers: [] }, true],
    ['conversation_pair', { v: 3, same: false, reason: 'x', evidence: '' }, true],
    ['prep_outcome', { at: '2026-09-23T00:00:00Z', did: 'none', reason: null, worker: null, lane: 'reply' }, true],
    ['workflow_inputs', { docs: [{ kbFileId: 'a', name: 'b' }], acceptMaterial: true }, true],
    ['pending_change', { id: 'x', tool: 'update_task', status: 'pending', expiresAt: 'z', createdAt: 'y', args: {} }, true],
    ['sweep_claim', { at: '2026-09-23T00:00:00Z' }, true],
    ['judgment_sweep', { at: 'x', fresh: 1, visited: 2, leftBehind: 0 }, true],
    ['commitment', [{ id: 'g1-0', text: 'Send the deck', actor: 'you', done: false }], true],
    ['email', [{ id: 's1', text: 'Reply', actor: 'system', done: false, detail: 'd', status: 'awaiting_input', capability: 'reply' }], true],
    ['handoff_nudge', [{ at: 'x', runId: 'y' }], true],
    ['anticipation', {}, true],
    ['tender_seen', { ids: [], version: 1 }, true],
    // A wrong shape must fail — the schemas are permissive, not decorative.
    ['judgment', { sig: 17 }, false],
    ['room_brief', { text: 42 }, false],
    ['commitment', { not: 'an array' }, false],
    ['day_state', 'a string', false],
    ['workflow_inputs', { acceptMaterial: 'yes' }, false],
  ];
  const bad = fixtures.filter(([k, v, want]) => planTasksValid(k, v) !== want).map(([k, v, want]) => `${k} ${JSON.stringify(v).slice(0, 40)} expected ${want ? 'valid' : 'invalid'}`);
  check(`T6 the schemas accept the live shapes and refuse wrong ones (${fixtures.length} fixtures)`, bad.length === 0, bad.join(' · '));
}

// ── D DEMOLITION ────────────────────────────────────────────────────────────────────────────────
{
  const psSites = files.filter((f) => /from\((['"])person_state\1\)/.test(readFileSync(f, 'utf8'))).map(rel);
  check('D1 no person_state read or write left in lib/app/components (the registry is the one person home)', psSites.length === 0, psSites.join(', '));
  const store = src('lib/people/state-store.ts');
  check('D2 the dead person_state readers are gone (getPersonStates / getPersonState / StoredPersonState)',
    !/export async function getPersonStates?\(|StoredPersonState/.test(store));
  const bc = src('lib/context/brain-context.ts');
  check('D3 the drafter\'s WHO block reads the person ENTITY only', !/getPersonState|people\/state-store/.test(bc) && /findPersonEntity/.test(bc));
  const brief = src('app/api/home/brief/route.ts');
  check('D4 the Home relationship cue reads the person ENTITY only', !/person_state'/.test(brief) && /findPersonEntity\(registry, k, null\)/.test(brief));
  check('D5 the person-ENTITY live refresh still runs at every ingestion door (sync · meeting · reply)',
    /refreshPersonStates/.test(src('lib/email-sync/sync-emails.ts'))
      && /refreshPersonStates/.test(src('lib/integrations/meeting-bot/bot-manager.ts'))
      && /refreshPersonStates/.test(src('app/api/inbox/[id]/send-reply/route.ts'))
      && /from\('work_entities'\)\.(update|insert)/.test(store));
  const stale: string[] = [];
  if (/slack-sofia/.test(src('lib/tools/slack.ts'))) stale.push('lib/tools/slack.ts names a deleted Slack app');
  if (/clicks "Send assistant"/.test(src('lib/integrations/meeting-bot/bot-manager.ts'))) stale.push('bot-manager.ts names the retired Send-assistant button as live');
  check('D6 retired surfaces are not described as live in code comments', stale.length === 0, stale.join(' · '));
  const together = files.filter((f) => /private_shared|together\.ai|AUGMTD_AI_KEY|fireworks/i.test(readFileSync(f, 'utf8'))).map(rel)
    .filter((f) => !['lib/ai/factory.ts', 'lib/ai/defaults.ts'].includes(f));
  check('D7 no Together/private_shared remnant beyond the retired-tier guard (factory) + its note (defaults)', together.length === 0, together.join(', '));
}

// ── S NO SILENT CAPS ────────────────────────────────────────────────────────────────────────────
{
  const st = src('lib/workflows/standing.ts');
  const at = st.indexOf('export async function syncAllStandingCommitments');
  const next = st.indexOf('\nexport ', at + 10);
  const body = at < 0 ? '' : st.slice(at, next < 0 ? undefined : next);
  check('S1 syncAllStandingCommitments pages BOTH full listings (workflows + open standing rows)',
    (body.match(/fetchAllRows</g) ?? []).length >= 2 && !/\.limit\(500\)/.test(body));
  check('S2 the owner read is chunked + paged through the door', /readPlansByKeysAnyUser\(admin, 'workflow_owner', ids\)/.test(src('lib/workflows/owner.ts')));
}

// ── V VERSIONED SIGS ────────────────────────────────────────────────────────────────────────────
{
  const brief = src('app/api/home/brief/route.ts');
  check('V1 the synthesizeBrief sig is sigOf-built and carries SYNTH_BRIEF_VERSION', /const sig = sigOf\(\{ version: SYNTH_BRIEF_VERSION, deps: \{/.test(brief) && !/const sig = `\$\{todayStr\}\|/.test(brief));
  check('V2 the bundle-names sig carries BUNDLE_NAMES_VERSION', /const bundleSig = sigOf\(\{ version: BUNDLE_NAMES_VERSION, deps: \{ keys: bundleKeys \} \}\)/.test(brief));
  const reg = src('lib/core/versions.ts');
  check('V3 both versions are registered in lib/core/versions.ts',
    /export \{ SYNTH_BRIEF_VERSION \} from '@\/lib\/home\/synthesize-brief'/.test(reg) && /export \{ BUNDLE_NAMES_VERSION \} from '@\/lib\/home\/name-bundles'/.test(reg));
}

// ── KEPT (label-era, still serving a live surface — printed, never silently accepted) ───────────
const KEPT: Array<[string, boolean]> = [
  ['lib/projects/initiative-clusters.ts — buildInitiativeClusters feeds clusterTag in app/api/home/brief/route.ts: the served `initiative`/`initiativeTotal` on the waitingOn lane (no entity-link override there) and the priorities/agenda inputs. Retire by serving waitingOn tags from entity_links (tagByAtom) first — a surface change needing a browser walk.',
    /buildInitiativeClusters/.test(src('app/api/home/brief/route.ts'))],
  ['lib/projects/initiative-resolver.ts — buildInitiativeMap is live in lib/work-items/model.ts (the spine) and resolveInitiative in lib/calendar/event-understanding.ts.',
    /initiative-resolver/.test(src('lib/work-items/model.ts')) || /initiative-resolver/.test(src('lib/calendar/event-understanding.ts'))],
  ['app/api/meetings/bot/** — zero UI callers (the auto-join UI is retired) but DORMANT BY OWNER DECISION (CLAUDE.md: bot routes + Hetzner infra dormant).',
    existsSync(join(ROOT, 'app/api/meetings/bot/adhoc/route.ts'))],
  ['content_manager / sofia render maps (lib/workers/roles.ts, components/work/worker-face.tsx, components/workers/skills-library-view.tsx, lib/inbox/self-echo.ts, lib/work/tool-vocabulary.ts) — INTENTIONAL: deactivated rows + persisted turns still render the retired role.',
    /content_manager/.test(src('lib/workers/roles.ts'))],
];

let fail = 0;
for (const [n, ok, d] of out) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? `\n      ${d}` : ''}`); if (!ok) fail++; }
for (const [n, live] of KEPT) if (live) console.log(`KEPT  ${n}`);
console.log(`\nsmoke-typed-stores: ${out.length - fail}/${out.length} PASS`);
process.exit(fail ? 1 : 0);
