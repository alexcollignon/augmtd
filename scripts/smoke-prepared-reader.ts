/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE ONE PREPARED READER (stabilization W2.1 — docs/stabilization-plan.md PART III;
 * invariants 5 ONE READER PER OBJECT · 8 A CLAIM RENDERS · 14 TIME TRUTH; root cause R1).
 *
 * ZERO-AI, ZERO-DB, deterministic: source floors (every prepared-state consumer reads THE ONE
 * READER; the writer's and the readers' prep anchor keys agree) + pure tests of the kind mapping,
 * the past-invite exclusion, the badge/lead-kind/receipt derivations. Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-prepared-reader.ts
 *
 * The live read-only census (how many pooled commitment artifacts map to a renderable kind) is a
 * scratchpad script, not this gate — this gate must never depend on data.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  poolRowsToArtifacts, preparedFromSourceData, inviteExpired, isLiveArtifact, badgeOf, leadKindOf,
  stampTruth, commitmentTruthFacts,
} from '../lib/prepare/read';
import { receiptWordOf } from '../lib/home/calm';
import { prepAnchorKey } from '../lib/room/presentation';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ═══ A · SOURCE FLOORS — ONE READER PER OBJECT ═══
console.log('\nA · source floors');
{
  const read = src('lib/prepare/read.ts');
  gate('A1 THE ONE READER exists (preparedState + preparedStatesFor) and getPrepared is its thin wrapper',
    /export async function preparedState\(/.test(read) && /export async function preparedStatesFor\(/.test(read)
    && /export async function getPrepared\([\s\S]*?return \(await preparedState\(client, userId, item\)\)\.all;/.test(read));
  gate('A2 the reader owns the ONE live predicate + the time law (isLiveArtifact · inviteExpired) and the pool mapper is kind-true (metadata.invite → invite)',
    /export function isLiveArtifact\(/.test(read) && /export function inviteExpired\(/.test(read)
    && /if \(meta\.invite && typeof meta\.invite === 'object'\)/.test(read) && /kind: 'invite'/.test(read)
    && /if \(meta\.sent_at\) continue;/.test(read));

  const g = src('lib/room/grounding.ts');
  gate('A3 the room grounding board reads THE ONE READER (preparedStatesFor) — the source_data-only preparedOf is gone; commitments no longer read []',
    !/function preparedOf\(/.test(g) && /preparedStatesFor\(client, userId/.test(g)
    && /prepStates\.get\(`commitment:\$\{String\(c\.id\)\}`\)/.test(g) && /expired: cprep\.expired/.test(g)
    && /EXPIRED \(not ready\)/.test(g));

  const brief = src('app/api/home/brief/route.ts');
  gate('A4 the deck chip (commitPrepared + the inbox tokens) comes from THE ONE READER and carries WHAT is prepared (preparedKind)',
    /const commitPrepared = new Map<string, \{ by: string; kind: string \| null \}>\(\);/.test(brief)
    && /preparedStatesFor\(supabase, user\.id, openCommitIds/.test(brief)
    && !/from\('item_deliverables'\)\.select\('entity_id, type, metadata'\)/.test(brief)
    && !/preparedBadge\(/.test(brief)
    && /preparedKind: commitPrepared\.get\(c\.id\)\?\.kind/.test(brief)
    && /preparedKindByItem/.test(brief));

  const calm = src('lib/home/calm.ts');
  const attention = src('lib/home/attention.ts');
  gate('A5 ONE receipt mapping (calm.receiptWordOf) words the chip by KIND; attention delegates to it and authors no vocabulary of its own',
    /export function receiptWordOf\(/.test(calm) && /case 'invite': return 'invite prepared';/.test(calm)
    // ⟲ RE-POINTED (W14.1): both printers hand the machine's served word too — the receipt KIND follows
    // the ladder's rung (calm.ladderReceiptKind), never the reader's own ranking.
    && /return receiptWordOf\(item\.prepared \?\? null, item\.preparedKind \?\? null, item\.source, item\.stateWord \?\? null\);/.test(calm)
    && /import \{ urgencyOf, receiptWordOf \} from '@\/lib\/home\/calm';/.test(attention)
    && /return receiptWordOf\(f\.prepared \?\? null, f\.preparedKind \?\? null, f\.source, f\.stateWord \?\? null\);/.test(attention)
    && /const kind = ladderReceiptKind\(preparedKind, stateWord\);\s*if \(kind === false\) return null;/.test(calm)
    && !/return f\.prepared === 'draft' \? 'drafted' : 'ready to send';/.test(attention));
  gate('A6 preparedKind rides the whole deck seam (agenda DoItem · AttentionRow · WhyNowFacts · home-view rows)',
    /preparedKind\?: string \| null;/.test(src('lib/home/agenda.ts'))
    && (attention.match(/preparedKind\?: string \| null;/g) ?? []).length >= 2
    && (src('components/home/home-view.tsx').match(/preparedKind:/g) ?? []).length >= 3);

  const machine = src('lib/work/machine.ts');
  gate('A7 the machine consumes THE ONE READER (batch via preparedStatesFor, single via preparedState) and treats expired like stale (isLiveArtifact)',
    /preparedStatesFor\(client, userId, items\.map/.test(machine)
    // ⟲ RE-POINTED (W3.7 ROOM SPEED): the single reader takes a HELD state from its caller (the view
    // door already holds THE ONE READER's state) and reads it itself otherwise — still one reader.
    && /const st = held\?\.prepared\s*\?\? await preparedState\(/.test(machine)
    && /input\.prepared\.filter\(isLiveArtifact\)/.test(machine)
    && !/poolRowsToArtifacts\(/.test(machine) && !/preparedFromSourceData\(/.test(machine)
    && /if \(st\?\.sentStamp\) sentStamp = true;/.test(machine));

  const pa = src('lib/home/prepare-action.ts');
  gate('A8 readAmbientArtifact reads THE ONE READER and covers commitments (the pooled invite serves its STORED time; no second 24h freshness clock)',
    /const \{ preparedState \} = await import\('@\/lib\/prepare\/read'\);/.test(pa)
    && /kind === 'commitment' \|\| kind === 'followup' \? 'commitment' as const : 'inbox_item' as const/.test(pa)
    && /art\.payload\?\.store === 'pool'/.test(pa)
    && !/AMBIENT_FRESH_MS/.test(pa)
    && !/if \(kind !== 'email' && kind !== 'awareness' && kind !== 'followup'\) return null;/.test(pa));

  const view = src('app/api/items/view/route.ts');
  gate('A9 A CLAIM RENDERS at the door: /api/items/view serves LIVE artifacts only, with the stored invite time; inviteHasTime reads the reader',
    /prepared: preparedArts\.filter\(isLiveArtifact\)\.map/.test(view)
    && /invite: \{ title: a\.invite\.title \?\? null, startISO: a\.invite\.startISO \?\? null/.test(view)
    && /const inv = preparedArts\.filter\(isLiveArtifact\)\.find\(\(a\) => a\.kind === 'invite'\);/.test(view)
    && !/\?\.prepared_invite as \{ startISO\?: string \} \| undefined;/.test(view));

  const exec = src('app/api/items/execute/route.ts');
  gate('A10 the execute door stamps a commitment\'s pooled invite SPENT (metadata.sent_at) — the reader excludes it, so no surface serves a sent invite',
    /if \(kind === 'commitment' \|\| kind === 'followup'\) \{/.test(exec)
    && /\.not\('metadata->invite', 'is', null\)/.test(exec)
    && /metadata: \{ \.\.\.\(row\.metadata \?\? \{\}\), sent_at: new Date\(\)\.toISOString\(\) \}/.test(exec));

  gate('A12 W5a: the reader stamps TRUTH (outsideWindow · falseClaim) in BOTH readers and the live predicate honors both',
    /export function stampTruth</.test(read) && (read.match(/stampTruth\(/g) ?? []).length >= 2
    // ⟲ RE-POINTED (W7.3): the live predicate gained its truth-floor twin — `misaddressed`.
    // ⟲ RE-POINTED (W15.2): + the settled and empty-words floors (every earlier floor still required).
    && /return !a\.stale && !a\.expired && !a\.outsideWindow && !a\.falseClaim && !a\.misaddressed\s*\n\s*&& !a\.settled && !emptyTextArtifact\(a\);/.test(read));

  const compose = src('app/api/compose/draft/route.ts');
  gate('A11 the commitment composer serves the POOLED nudge first (preparedState live) — a fresh AI draft only when nothing is pooled',
    /const st = await preparedState\(supabase, user\.id, \{ kind: 'commitment', id: entityId \}\);/.test(compose)
    && /a\.kind === 'nudge_draft' \|\| a\.kind === 'reply_draft'/.test(compose)
    && /let body = pooledBody;/.test(compose));
}

// ═══ B · THE COMMITMENT ROOM RENDERS ITS ARTIFACTS ═══
console.log('\nB · the commitment room renders');
{
  const detail = src('components/home/item-detail.tsx');
  const commitSeg = detail.slice(detail.indexOf('function CommitmentDetail('), detail.indexOf('function CommitmentDetail(') + 40_000);
  // W5c re-point: the card mounts from the LIVE pool invite or a plan step ONLY — the bare schedule
  // verdict mounted a hollow shell whenever the stored invite was hidden (smoke-prepared-truth F8).
  gate('B1 CommitmentDetail passes artifacts to its ItemRail (like EmailDetail) — invite card from the LIVE pool row only (never the bare verdict, never a plan step), nudge → composer, lead → PreparedLead',
    /<ItemRail kind="commitment"[^>]*artifacts=\{commitArtifacts\}/.test(commitSeg)
    && /const inviteArt = prepArts\.find\(\(p\) => p\.kind === 'invite'\)/.test(commitSeg)
    && /\.\.\.\(inviteArt \? \[\{/.test(commitSeg)
    && !/\(inviteArt \|\| view\?\.inviteTaskId \|\| verdict\?\.work === 'schedule'\)/.test(commitSeg)
    && /node: <InviteCard kind="commitment" entityId=\{id\} taskId=\{view\?\.inviteTaskId \?\? undefined\}\s*verdictLevel=\{!view\?\.inviteTaskId\}/.test(commitSeg)
    && /key: 'nudge'/.test(commitSeg) && /node: <PreparedLead prepared=\{leadArts\} \/>/.test(commitSeg));
  gate('B2 the in-stage invite affordances survive ONLY embedded (the loose door mounts the card on the rail — one seat)',
    /\{embedded && inviteArt && !inviteOpen && \(/.test(commitSeg)
    && /\{embedded && inviteOpen && \(inviteArt \|\| view\?\.inviteTaskId\) && \(/.test(commitSeg));
  gate('B3 the served view type carries the invite payload + sendReady (what the card mounts from)',
    /invite\?: \{ title: string \| null; startISO: string \| null; proposed: boolean \} \| null;/.test(detail)
    && /sendReady\?: boolean;/.test(detail));
}

// ═══ C · THE PREP ANCHOR KEY — writer ↔ readers agree ═══
console.log('\nC · the prep anchor key');
{
  const pass_ = src('lib/prepare/pass.ts');
  const model = src('lib/work-items/model.ts');
  const detail = src('components/home/item-detail.tsx');
  const room = src('components/entities/entity-room.tsx');
  gate('C1 the WRITER narrates on `prep:${w.id}` where w.id is the spine id (`inbox:<id>` / `commit:<id>`)',
    /dedupeKey: `prep:\$\{w\.id\}`/.test(pass_)
    && /id: `commit:\$\{c\.id\}`, entityId: String\(c\.id\)/.test(model)
    && /id: `inbox:\$\{it\.id\}`, entityId: String\(it\.id\)/.test(model));
  gate('C2 ONE reader-side producer (prepAnchorKey) yields the writer\'s exact shape, for raw AND spine ids',
    prepAnchorKey('inbox', 'abc') === 'prep:inbox:abc'
    && prepAnchorKey('email', 'abc') === 'prep:inbox:abc'
    && prepAnchorKey('awareness', 'abc') === 'prep:inbox:abc'
    && prepAnchorKey('commitment', 'abc') === 'prep:commit:abc'
    && prepAnchorKey('followup', 'abc') === 'prep:commit:abc'
    && prepAnchorKey('inbox', 'commit:abc') === 'prep:commit:abc'
    && prepAnchorKey('commitment', 'inbox:abc') === 'prep:inbox:abc');
  gate('C3 every card reader anchors through prepAnchorKey — no `prep:${id}` / `prep:${boardRowItemId(r)}` raw-id anchors remain',
    !/anchorKey: `prep:\$\{id\}`/.test(detail) && !/anchorKey: `prep:\$\{boardRowItemId\(r\)\}`/.test(room)
    && (detail.match(/anchorKey: prepAnchorKey\(/g) ?? []).length >= 5
    && (detail.match(/prepAnchorKey\('commitment', id\)/g) ?? []).length >= 3
    && /anchorKey: prepAnchorKey\(r\.id\.startsWith\('commit:'\) \? 'commitment' : 'inbox', boardRowItemId\(r\)\)/.test(room));
  gate('C4 the consequence modules already key on the writer\'s shape (apply-verdict · membership) — the readers now agree with them',
    /`prep:\$\{input\.kind\}:\$\{input\.id\}`/.test(src('lib/work/apply-verdict.ts'))
    && /`prep:commit:\$\{args\.id\}`/.test(src('lib/entities/membership.ts')));
}

// ═══ D · PURE TESTS — the kind mapping, the time law, the derivations ═══
console.log('\nD · pure tests');
{
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const row = (over: Record<string, unknown>) => ({ id: 'r', task_id: null, type: 'draft', title: 'x', content: 'body', created_at: '2026-09-20T10:00:00Z', metadata: {}, ...over });

  const inv = poolRowsToArtifacts([row({ task_id: 'prepare-pass-invite', title: 'Invite — Kickoff', metadata: { invite: { title: 'Kickoff', startISO: future, endISO: future, attendees: ['a@example.com'] }, agentName: 'Clara' } })], 'commitment');
  gate('D1 a pooled commitment INVITE maps to kind invite (not reply_draft), send-ready, with its stored payload and the pool payload ref',
    inv.length === 1 && inv[0].kind === 'invite' && inv[0].sendReady === true && inv[0].invite?.startISO === future
    && inv[0].payload?.store === 'pool' && inv[0].by === 'Clara' && !inv[0].expired && isLiveArtifact(inv[0]));

  const expired = poolRowsToArtifacts([row({ metadata: { invite: { title: 'Old', startISO: past } } })], 'commitment');
  gate('D2 TIME TRUTH: an invite whose proposed start passed is EXPIRED — not live, no badge, no lead kind',
    expired.length === 1 && expired[0].kind === 'invite' && expired[0].expired === true && !isLiveArtifact(expired[0])
    && inviteExpired(expired[0]) && badgeOf(expired) === null && leadKindOf(expired) === null);

  const timeless = poolRowsToArtifacts([row({ metadata: { invite: { title: 'No time' } } })], 'commitment');
  gate('D3 a TIMELESS invite is sendReady:false (awaiting input) and NOT expired (a different honest word)',
    timeless[0]?.kind === 'invite' && timeless[0].sendReady === false && !timeless[0].expired && isLiveArtifact(timeless[0]));

  const sent = poolRowsToArtifacts([row({ metadata: { invite: { title: 'Sent', startISO: future }, sent_at: past } })], 'commitment');
  gate('D4 a pool artifact stamped sent_at is DONE work — it never enters the list', sent.length === 0);

  const mixed = poolRowsToArtifacts([
    row({ id: 'n', title: 'Nudge — follow up', content: 'ping', created_at: '2026-09-21T10:00:00Z', metadata: { agentName: 'Max' } }),
    row({ id: 'p', type: 'document', title: 'Words', metadata: { pastePack: true, note: 'paste into the portal' } }),
    row({ id: 'd', type: 'document', title: 'Options', metadata: { decisionBrief: true, options: ['A', { label: 'B', tradeoff: 'slower' }], recommendation: 'A' } }),
    row({ id: 'doc', type: 'document', title: 'Report', metadata: {} }),
    row({ id: 'v', title: 'Nudge — old', content: 'older', created_at: '2026-09-19T10:00:00Z', metadata: { version_of: 'x' } }),
  ], 'commitment');
  const kinds = mixed.map((a) => a.kind);
  gate('D5 kind-true mapping: "Nudge — " draft → nudge_draft · pastePack → paste_pack · decisionBrief → deliverable+decision · document → deliverable · version rows skipped',
    kinds.length === 4 && kinds[0] === 'nudge_draft' && kinds[1] === 'paste_pack' && kinds[2] === 'deliverable' && !!mixed[2].decision
    && mixed[2].decision!.options.length === 2 && kinds[3] === 'deliverable' && mixed[1].note === 'paste into the portal',
    kinds.join(','));
  gate('D6 badgeOf names the preparer from LIVE artifacts; leadKindOf ranks send-shaped > decision > document',
    badgeOf(mixed) === 'Max' && leadKindOf(mixed) === 'nudge_draft'
    && leadKindOf(mixed.filter((a) => a.kind !== 'nudge_draft')) === 'decision'
    && leadKindOf(mixed.filter((a) => a.kind === 'deliverable' && !a.decision)) === 'deliverable'
    && leadKindOf([...mixed, ...inv]) === 'invite');

  const sdArts = preparedFromSourceData({
    draft: { body: 'reply', sent_at: past },
    prepared_invite: { title: 'Past', startISO: past },
    prepared_forward: { to: ['b@example.com'], note: 'fyi' },
  } as never);
  gate('D7 source_data: a SENT reply draft never enters; a past prepared_invite is expired; the forward is live with its payload ref',
    !sdArts.some((a) => a.kind === 'reply_draft')
    && sdArts.find((a) => a.kind === 'invite')?.expired === true
    && sdArts.find((a) => a.kind === 'forward')?.payload?.store === 'source_data' && isLiveArtifact(sdArts.find((a) => a.kind === 'forward')!));

  gate('D8 receiptWordOf words the chip by KIND — an invite says invite, a document never says "ready to send", a reply lane keeps "reply ready"',
    receiptWordOf('Clara', 'invite', 'commitment') === 'invite prepared'
    && receiptWordOf('Clara', 'deliverable', 'commitment') === 'ready to review'
    && receiptWordOf('draft', 'deliverable', 'commitment') === 'drafted'
    && receiptWordOf('Max', 'nudge_draft', 'commitment') === 'ready to send'
    && receiptWordOf('draft', 'reply_draft', 'reply') === 'reply ready'
    && receiptWordOf('Clara', 'paste_pack', 'notice') === 'words ready'
    && receiptWordOf(null, 'invite', 'commitment') === null);

  // ── W5a · stale-by-window / stale-by-false-claim ──
  const winFacts = commitmentTruthFacts({ description: 'Schedule meeting with Sam — September 30 or October 1', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' });
  const outside = stampTruth(poolRowsToArtifacts([row({ task_id: 'prepare-pass-invite', metadata: { invite: { title: 'Sync', startISO: '2026-09-23T09:00:00Z', timezone: 'Europe/Lisbon', proposed: true } } })], 'commitment'), winFacts);
  gate('D9 TIME TRUTH (W5a): an invite proposing OUTSIDE the item\'s stated window is outsideWindow — not live, no badge, no lead kind',
    outside[0]?.kind === 'invite' && outside[0].outsideWindow === true && !isLiveArtifact(outside[0]) && badgeOf(outside) === null && leadKindOf(outside) === null);
  const claimFacts = commitmentTruthFacts({ description: 'Redistribute the group allocation', created_at: '2026-09-18T10:00:00Z', status: 'open', direction: 'you_owe' });
  const falsePack = stampTruth(poolRowsToArtifacts([row({ type: 'document', content: "I've finished the redistribution. Here's the updated breakdown.", metadata: { pastePack: true, note: 'Words ready', agentName: 'Clara' } })], 'commitment'), claimFacts);
  const honestPack = stampTruth(poolRowsToArtifacts([row({ type: 'document', content: 'Before I redistribute, could you confirm which groups are in scope?', metadata: { pastePack: true, note: 'Words ready', agentName: 'Clara' } })], 'commitment'), claimFacts);
  gate('D10 A CLAIM RENDERS (W5a): a pack claiming an UNDONE deed on an open you_owe commitment is falseClaim — not live; honest words stay live',
    falsePack[0]?.falseClaim === true && !isLiveArtifact(falsePack[0]) && badgeOf(falsePack) === null
    && honestPack[0]?.falseClaim === undefined && isLiveArtifact(honestPack[0]) && badgeOf(honestPack) === 'Clara');
}

console.log(`\n${failures.length ? '✗' : '✓'} smoke-prepared-reader: ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
