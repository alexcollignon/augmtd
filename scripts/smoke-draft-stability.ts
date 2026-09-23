/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — W9.1 DRAFTS CHANGE ONLY WHEN THE GROUND MOVES + THE USER'S HAND WINS
 * (docs/stabilization-plan.md PART VI; docs/laws-registry.md `the-users-hand-wins` · `ground-law`).
 *
 * ZERO-AI, ZERO-NETWORK, deterministic (an in-memory table fake stands in for Supabase where the
 * gate runs the real edit door and THE ONE READER end to end). Four classes:
 *   A · NO CLOCK-ONLY REGENERATION — the decision has no clock input; no lane, pack or serving
 *       route re-buys an artifact because it is old.
 *   B · AN EDITED ARTIFACT IS NEVER OVERWRITTEN — on every lane (reply · nudge ×2 · invite ×2 ·
 *       forward · decision brief · deliverable · paste pack · docsend ×2), at the draft route, and
 *       through any writer that spreads an old stamp over new words (the hash voids it).
 *   C · STALE-UNDER-EDIT MARKS, NEVER REPLACES — a moved ground under the user's words derives
 *       `staleUnderEdit` (still live, never `stale`), the lane writes nothing to the artifact.
 *   D · EVERY EDIT PATH STAMPS — the edit door, the three cards, the fresh-version door files the
 *       edit first, the steer lane strips the stamp from new machine words.
 *   E · A CONSEQUENCE NEVER DELETES THE USER'S HAND (W9.1b) — a verdict that changes kind, a
 *       resolution, a settle, a cascade, the mirror archive, the booked floor and the pool's re-run
 *       dedupe FILE a hand-held artifact (version chain + one narration with the words) on every lane;
 *       every engine strip path consults the hand (no bare `delete sd.<artifact>` left in lib/**).
 *
 *   npx tsx scripts/smoke-draft-stability.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  decideRegeneration, isHandHeld, isPoolRowHandHeld, handStamp, canonicalOf, activityMovedPast, withoutHandStamp,
  partitionStrip, composeHandFiledLine, isPoolRowHeldAnyKind, handWordsOf, HAND_FIELD_KIND,
  type GroundSignals, type HandField,
} from '../lib/prepare/hand';
import { preparedFromSourceData, poolRowsToArtifacts, isLiveArtifact, nonLiveKindsOf, markGroundMoved, stampTruth, commitmentTruthFacts, preparedState } from '../lib/prepare/read';
import { saveUserEdit, stripSourceArtifacts } from '../lib/prepare/hand-store';
import { clockRegenerationsInLane, probableClockRegen, voidHandStamp } from '../lib/prepare/churn';
import { applyVerdictConsequences } from '../lib/work/apply-verdict';
import { writeDeliverable } from '../lib/home/deliverable-pool';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** One lane's body out of pass.ts (from its declaration to the next top-level function). */
const passSrc = src('lib/prepare/pass.ts');
function laneBody(name: string): string {
  const i = passSrc.indexOf(`async function ${name}(`);
  if (i < 0) return '';
  const rest = passSrc.slice(i + 10);
  const j = rest.search(/\n(?:async function |export async function |export function |function |\/\/ ═)/);
  return passSrc.slice(i, i + 10 + (j < 0 ? rest.length : j));
}

// ── an in-memory Supabase stand-in (select/eq/filter/order/limit/maybeSingle/update/insert) ──
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, opts: { failInsert?: string } = {}) {
  let seq = 0;
  const pathOf = (r: Row, c: string): unknown => {
    const [col, key] = c.split('->>');
    const v = r[col];
    return key ? ((v ?? {}) as Row)[key] : v;
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let order: { c: string; asc: boolean } | null = null;
    let lim: number | null = null;
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Row | null = null;
    const rows = () => {
      let out = (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (order) { const o = order; out = [...out].sort((a, b) => String(pathOf(a, o.c) ?? '').localeCompare(String(pathOf(b, o.c) ?? '')) * (o.asc ? 1 : -1)); }
      if (lim !== null) out = out.slice(0, lim);
      return out;
    };
    const api: Record<string, unknown> = {};
    Object.assign(api, {
      select: () => api,
      eq: (c: string, v: unknown) => { filters.push((r) => pathOf(r, c) === v); return api; },
      neq: (c: string, v: unknown) => { filters.push((r) => pathOf(r, c) !== v); return api; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(pathOf(r, c))); return api; },
      is: (c: string, v: unknown) => { filters.push((r) => (v === null ? pathOf(r, c) == null : pathOf(r, c) === v)); return api; },
      filter: (c: string, o: string, v: unknown) => { if (o === 'is' && (v === null || v === 'null')) filters.push((r) => pathOf(r, c) == null); else if (o === 'eq') filters.push((r) => pathOf(r, c) === v); return api; },
      like: () => api, gte: () => api, lte: () => api, gt: () => api, not: () => api, or: () => api,
      order: (c: string, o?: { ascending?: boolean }) => { order ??= { c, asc: o?.ascending !== false }; return api; },
      limit: (n: number) => { lim = n; return api; },
      range: () => api,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'none' } }),
      update: (p: Row) => { op = 'update'; patch = p; return api; },
      delete: () => { op = 'delete'; return api; },
      upsert: async (row: Row) => { (tables[table] ??= []).push({ id: `row-${++seq}`, ...row }); return { error: null }; },
      insert: (row: Row) => {
        if (opts.failInsert === table) return { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ error: { message: 'insert refused' } }).then(res, rej) };
        (tables[table] ??= []).push({ id: `row-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...row });
        const made = tables[table][tables[table].length - 1];
        return { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(res, rej), select: () => ({ single: async () => ({ data: made, error: null }) }) };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (op === 'update') { for (const r of rows()) Object.assign(r, patch); return Promise.resolve({ error: null }).then(res, rej); }
        if (op === 'delete') { const gone = new Set(rows()); tables[table] = (tables[table] ?? []).filter((r) => !gone.has(r)); return Promise.resolve({ error: null }).then(res, rej); }
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      },
    });
    return api;
  };
  return { from } as never;
}

async function main(): Promise<void> {
  // ═══ A · NO CLOCK-ONLY REGENERATION ═══
  console.log('\nA · a clock is not a ground');
  {
    const hand = src('lib/prepare/hand.ts');
    gate('A1 the ONE decision is structurally clock-free (no Date.now in lib/prepare/hand.ts; no time field in its inputs)',
      !/Date\.now\(/.test(hand) && !/age|hours|clock|now/i.test(Object.keys({ groundMoved: 1, activityMoved: 1, supplyMoved: 1, lawStale: 1, nonLive: 1 } satisfies Record<keyof GroundSignals, 1>).join(' ')));
    gate('A2 an unchanged ground KEEPS machine words, whatever their age (there is no age to pass)',
      decideRegeneration({ exists: true, handHeld: false }).action === 'keep');
    gate('A3 the ground\'s own signals regenerate machine words (ground · activity · supply · law · reader withdrawal)',
      (['groundMoved', 'activityMoved', 'supplyMoved', 'lawStale', 'nonLive'] as const).every((k) => decideRegeneration({ exists: true, handHeld: false, [k]: true }).action === 'regenerate')
      && decideRegeneration({ exists: false, handHeld: false }).action === 'regenerate'
      && decideRegeneration({ exists: true, handHeld: false, sent: true, groundMoved: true }).action === 'keep');
    gate('A4 pass.ts carries no freshness clock (FRESH_HOURS gone; no lane compares an artifact\'s age)',
      !/FRESH_HOURS/.test(passSrc) && !/Date\.now\(\) - Date\.parse\((existing|prior)/.test(passSrc) && !/created_at as string\)\) </.test(passSrc));
    const lanes = ['prepareReplyDraft', 'prepareNudge', 'prepareInviteDraft', 'prepareForwardDraft', 'prepareDecisionBrief', 'delegatePrepare'];
    const missing = lanes.filter((l) => !/decideRegeneration\(/.test(laneBody(l)));
    gate('A5 every regenerating lane asks THE ONE DECISION (reply · nudge · invite · forward · decision brief · deliverable)', !missing.length, missing.join(', '));
    gate('A6 prepareNudge asks it on BOTH halves (inbox + commitment) and prepareInviteDraft on BOTH (commitment pool + inbox)',
      (laneBody('prepareNudge').match(/decideRegeneration\(/g) ?? []).length === 2 && (laneBody('prepareInviteDraft').match(/decideRegeneration\(/g) ?? []).length === 2);
    const pp = src('lib/prepare/paste-pack.ts');
    gate('A7 the paste pack lost its freshHours clock and asks the decision', !/freshHours|3_600_000/.test(pp) && /decideRegeneration\(/.test(pp));
    const nudgeRoute = src('app/api/commitments/[id]/nudge/route.ts');
    gate('A8 the commitment nudge door serves the LIVE draft — no <24h clock re-buys it on the next day',
      !/24 \* 3_600_000/.test(nudgeRoute) && /st\.live\.find\(\(a\) => \(a\.kind === 'nudge_draft' \|\| a\.kind === 'reply_draft'\)/.test(nudgeRoute));
    gate('A9 the activity signal compares against the artifact\'s GROUND, not its write time (+5s slack; unresolvable = not moved)',
      activityMovedPast('2026-09-20T10:00:10Z', { receivedAt: '2026-09-20T10:00:00Z' }) === true
      && activityMovedPast('2026-09-20T10:00:03Z', { receivedAt: '2026-09-20T10:00:00Z' }) === false
      && activityMovedPast(null, { receivedAt: '2026-09-20T10:00:00Z' }) === false
      && activityMovedPast('2026-09-20T10:00:10Z', null) === false);
    gate('A10 the supply seam is a SIGNAL (generated_at dropped) read as supplyMoved on the reply lane',
      /supplyMoved: !!existing\?\.body && !existing\.generated_at/.test(laneBody('prepareReplyDraft')));
  }

  // ═══ B · AN EDITED ARTIFACT IS NEVER OVERWRITTEN ═══
  console.log('\nB · the user\'s hand wins on every lane');
  {
    // Exhaustive: every combination of the five signals, hand-held → never 'regenerate'.
    const keys = ['groundMoved', 'activityMoved', 'supplyMoved', 'lawStale', 'nonLive'] as const;
    let never = true;
    for (let m = 0; m < 32; m++) {
      const sig: GroundSignals = {};
      keys.forEach((k, i) => { if (m & (1 << i)) sig[k] = true; });
      const d = decideRegeneration({ exists: true, handHeld: true, ...sig });
      if (d.action === 'regenerate') never = false;
      const moved = !!(sig.groundMoved || sig.activityMoved || sig.supplyMoved);
      if (moved && d.action !== 'mark_stale_under_edit') never = false;
      if (!moved && d.action !== 'keep') never = false;
    }
    gate('B1 a hand-held artifact is NEVER regenerated — all 32 signal combinations (moved → mark; law/truth alone → keep)', never);
    const laneHand: Array<[string, RegExp, number]> = [
      ['prepareReplyDraft', /handHeld: isHandHeld\('reply_draft', existing\)/, 1],
      ['prepareNudge', /handHeld: isHandHeld\('nudge_draft', existing\)|handHeld: isPoolRowHandHeld\('nudge_draft', existing\)/g, 2],
      ['prepareInviteDraft', /handHeld: isPoolRowHandHeld\('invite', prior\)|handHeld: isHandHeld\('invite', existing\)/g, 2],
      ['prepareForwardDraft', /handHeld: isHandHeld\('forward', existing\)/, 1],
      ['prepareDecisionBrief', /handHeld: isPoolRowHandHeld\('deliverable', prior\)/, 1],
      ['delegatePrepare', /handHeld: isPoolRowHandHeld\('deliverable', prior\)/, 1],
    ];
    const bad = laneHand.filter(([l, re, n]) => (laneBody(l).match(new RegExp(re.source, 'g')) ?? []).length !== n).map(([l]) => l);
    gate('B2 every lane hands its STORED artifact\'s hand to the decision (reply · nudge ×2 · invite ×2 · forward · brief · deliverable)', !bad.length, bad.join(', '));
    const ds = laneBody('prepareDocSend');
    gate('B3 the docsend lane never writes over the user\'s words (commitment: never shadows a hand-held message; inbox: never replaces a hand-held draft)',
      /if \(isPoolRowHandHeld\('reply_draft', prior\)\) return/.test(ds) && /if \(isHandHeld\('reply_draft', existingDraft\)\) return/.test(ds));
    gate('B4 the pool lanes never read a ledger row as "the" artifact (version_of filtered: nudge · brief · deliverable · docsend · pack)',
      /filter\('metadata->>version_of', 'is', null\)/.test(laneBody('prepareNudge'))
      && /filter\('metadata->>version_of', 'is', null\)/.test(laneBody('prepareDecisionBrief'))
      && /filter\('metadata->>version_of', 'is', null\)/.test(laneBody('delegatePrepare'))
      && /filter\('metadata->>version_of', 'is', null\)/.test(ds)
      && /filter\('metadata->>version_of', 'is', null\)/.test(src('lib/prepare/paste-pack.ts')));
    const pp = src('lib/prepare/paste-pack.ts');
    gate('B5 the paste pack reads the hand of its stored pack', /handHeld: isPoolRowHandHeld\('paste_pack', prior\)/.test(pp));
    const route = src('app/api/inbox/[id]/draft/route.ts');
    gate('B6 the draft door never supersedes a hand-held draft (ground or law) and serves it WITH its marks',
      /const draftSuperseded = !!sd\.draft\?\.body && !handHeld/.test(route) && /\.\.\.handFlags/.test(route));
    // The hash, not the field, decides: a writer that spreads the old stamp over NEW words voids it.
    const saved = { body: 'Thanks Sam — Thursday works for us.', ...handStamp('reply_draft', { body: 'Thanks Sam — Thursday works for us.' }, '2026-09-23T10:00:00Z') };
    const spreadOver = { ...saved, body: 'Hello, following up on the proposal.' };
    gate('B7 the stamp counts only while the content hashes to it (whitespace-folded; a spread over new words is VOID)',
      isHandHeld('reply_draft', saved) && isHandHeld('reply_draft', { ...saved, body: '  Thanks Sam —   Thursday works for us.\n' })
      && !isHandHeld('reply_draft', spreadOver) && voidHandStamp('reply_draft', spreadOver) && !voidHandStamp('reply_draft', saved));
    gate('B8 an invite / forward hash only their editable fields (a re-stored proposal flag is not an edit)',
      canonicalOf('invite', { title: 'Call', startISO: 'x', endISO: 'y', attendees: ['B@x.com', 'a@x.com'], description: 'd', proposed: true })
        === canonicalOf('invite', { title: 'Call', startISO: 'x', endISO: 'y', attendees: ['a@x.com', 'b@x.com'], description: 'd', proposedFrom: 'calendar' })
      && canonicalOf('forward', { to: ['a@x.com'], note: 'fyi' }) !== canonicalOf('forward', { to: ['a@x.com'], note: 'fyi please' }));
  }

  // ═══ C · STALE-UNDER-EDIT MARKS, NEVER REPLACES ═══
  console.log('\nC · a moved ground marks the user\'s words — never hides, never replaces them');
  {
    const words = 'Sam — Thursday at 10 works. I will bring the draft agreement.';
    const sd = { draft: { body: words, generated_at: '2026-09-20T09:00:00Z', prepared: 'pass', prepared_from: { emailId: 'e1', receivedAt: '2026-09-20T08:00:00Z' }, ...handStamp('reply_draft', { body: words }, '2026-09-21T09:00:00Z') } };
    const arts = preparedFromSourceData(sd as never);
    markGroundMoved(arts[0]);
    gate('C1 THE ONE READER: a hand-held draft whose ground moved is staleUnderEdit, NOT stale — still live, never a re-prepare kind',
      arts[0].hand !== null && !!arts[0].hand && arts[0].staleUnderEdit === true && !arts[0].stale && isLiveArtifact(arts[0]) && nonLiveKindsOf({ all: arts }).size === 0);
    const machine = preparedFromSourceData({ draft: { body: 'Hello', generated_at: 'x', prepared_from: { receivedAt: '2026-09-20T08:00:00Z' } } } as never);
    markGroundMoved(machine[0]);
    gate('C2 …while machine words on a moved ground stay SUPERSEDED (the ground law is untouched)', machine[0].stale === true && !isLiveArtifact(machine[0]) && nonLiveKindsOf({ all: machine }).has('reply_draft'));
    const claim = 'I have sent the signed contract this morning.';
    const handClaim = poolRowsToArtifacts([{ id: 'r1', type: 'draft', title: 'Your message', content: claim, created_at: '2026-09-21T00:00:00Z', metadata: { ...handStamp('reply_draft', { body: claim }, '2026-09-21T00:00:00Z') } }], 'commitment');
    stampTruth(handClaim, commitmentTruthFacts({ description: 'Send the signed contract', status: 'open', direction: 'you_owe', created_at: '2026-09-18T00:00:00Z' }));
    gate('C3 the truth floors never withdraw the USER\'S OWN words (a hand-held completion claim is theirs to make)', !!handClaim[0].hand && !handClaim[0].falseClaim && isLiveArtifact(handClaim[0]));
    const mark = laneBody('markStaleUnderEdit');
    gate('C4 the lane\'s mark WRITES NOTHING to the artifact (only a deduped room line; the flag is derived at read)',
      !!mark && !/from\('inbox_items'\)|from\('item_deliverables'\)|\.update\(|\.insert\(/.test(mark) && /dedupeKey: `hand-stale:/.test(mark));
    const lanes = ['prepareReplyDraft', 'prepareNudge', 'prepareInviteDraft', 'prepareForwardDraft', 'prepareDecisionBrief', 'delegatePrepare'];
    const noMark = lanes.filter((l) => !/decision\.action === 'mark_stale_under_edit'|Decision\.action === 'mark_stale_under_edit'/.test(laneBody(l)));
    gate('C5 every lane turns mark_stale_under_edit into the mark (and returns) — never falls through to a write', !noMark.length, noMark.join(', '));

    // END TO END through the real edit door + THE ONE READER over the table fake.
    const tables: Record<string, Row[]> = {
      inbox_items: [{ id: 'i1', user_id: 'u1', status: 'pending', work_state: 'action_required', source_data: {
        thread_id: 't1', received_at: '2026-09-20T08:00:00Z', subject: 'Contract', body: 'Can you confirm Thursday?', from_address: 'sam@acme.example', from_name: 'Sam',
        draft: { body: 'Hi Sam, Thursday works.', generated_at: '2026-09-20T09:00:00Z', prepared: 'pass', prepared_from: { emailId: 'e1', receivedAt: '2026-09-20T08:00:00Z' } },
      } }],
      emails: [{ id: 'e1', user_id: 'u1', thread_id: 't1', is_from_user: false, received_at: '2026-09-20T08:00:00Z' }],
      item_deliverables: [],
      commitments: [{ id: 'c1', user_id: 'u1', description: 'Send Sam the revised scope', status: 'open', direction: 'you_owe', counterparty: 'Sam <sam@acme.example>', created_at: '2026-09-18T00:00:00Z', thread_id: null }],
    };
    const db = fakeDb(tables);
    const r = await saveUserEdit(db, 'u1', { itemKind: 'inbox', itemId: 'i1', kind: 'reply_draft', body: 'Hi Sam, Thursday at 10 works — see you then.' });
    const stored = ((tables.inbox_items[0].source_data as Row).draft ?? {}) as Row;
    gate('C6 E2E the edit door saves IN PLACE with the stamp + the ground it was edited on',
      r.saved === true && isHandHeld('reply_draft', stored) && ((stored.prepared_from as Row)?.emailId === 'e1') && stored.generated_at === '2026-09-20T09:00:00Z');
    const again = await saveUserEdit(db, 'u1', { itemKind: 'inbox', itemId: 'i1', kind: 'reply_draft', body: 'Hi Sam, Thursday at 10 works — see you then.' });
    gate('C7 E2E a re-save of the same words over the user\'s own edit keeps the stamp (idempotent)', again.saved === true && isHandHeld('reply_draft', ((tables.inbox_items[0].source_data as Row).draft) as Row));
    tables.emails.push({ id: 'e2', user_id: 'u1', thread_id: 't1', is_from_user: false, received_at: '2026-09-22T08:00:00Z' });
    const st = await preparedState(db, 'u1', { kind: 'inbox_item', id: 'i1' });
    const art = st.all.find((a) => a.kind === 'reply_draft');
    gate('C8 E2E a NEWER inbound after the edit: the reader serves the user\'s words, live, marked staleUnderEdit — no re-prepare kind',
      !!art && art.content.includes('Thursday at 10') && art.staleUnderEdit === true && !art.stale && st.live.includes(art) && nonLiveKindsOf(st).size === 0);
    const r2 = await saveUserEdit(db, 'u1', { itemKind: 'commitment', itemId: 'c1', kind: 'nudge_draft', body: 'Sam — the revised scope is coming Friday.' });
    const pooled = tables.item_deliverables.find((x) => x.entity_id === 'c1');
    const st2 = await preparedState(db, 'u1', { kind: 'commitment', id: 'c1' });
    gate('C9 E2E a commitment message the card drafted on demand becomes ONE stamped pool row the reader serves as the user\'s',
      r2.saved === true && !!pooled && isPoolRowHandHeld('nudge_draft', pooled as never) && pooled.title === 'Your message'
      && !!st2.live.find((a) => a.hand && a.content.includes('Friday')));
    (((tables.inbox_items[0].source_data as Row).draft) as Row).sent_at = '2026-09-23T00:00:00Z';
    const r3 = await saveUserEdit(db, 'u1', { itemKind: 'inbox', itemId: 'i1', kind: 'reply_draft', body: 'changed after send' });
    gate('C10 E2E a SENT artifact refuses an edit (done work is a record)', r3.saved === false && r3.reason === 'sent');
  }

  // ═══ D · EVERY EDIT PATH STAMPS ═══
  console.log('\nD · every edit path stamps');
  {
    const store = src('lib/prepare/hand-store.ts');
    gate('D1 the edit door stamps at every write site (source_data field · pool row · new commitment message)', (store.match(/handStamp\(e\.kind, payload, at\)/g) ?? []).length >= 3 || ((store.match(/handStamp\(/g) ?? []).length >= 3 && /const stamp = handStamp\(e\.kind, payload, at\)/.test(store)));
    const route = src('app/api/items/prepared/route.ts');
    gate('D2 PATCH /api/items/prepared is the RLS door to saveUserEdit (server client, the authed user)', /export async function PATCH/.test(route) && /saveUserEdit\(supabase, user\.id,/.test(route) && /@\/lib\/supabase\/server/.test(route));
    const email = src('components/home/email-card.tsx');
    gate('D3 the email card saves a real edit on BOTH prepared lanes (item → reply_draft · compose → the commitment message) and speaks the mark',
      /fetch\('\/api\/items\/prepared', \{\s*method: 'PATCH'/.test(email) && /kind: 'reply_draft', body: words/.test(email) && /kind: 'nudge_draft', body: words/.test(email)
      && /handNote === 'stale'/.test(email));
    const invite = src('components/home/invite-card.tsx');
    gate('D4 the invite card saves the user\'s edits (only once touched — the pre-fill never stamps)', /fetch\('\/api\/items\/prepared'/.test(invite) && /kind: 'invite'/.test(invite) && /if \(!touchedRef\.current/.test(invite));
    const fwd = src('components/home/forward-card.tsx');
    gate('D5 the forward card saves the user\'s edits (only once touched)', /fetch\('\/api\/items\/prepared'/.test(fwd) && /kind: 'forward'/.test(fwd) && /if \(!touchedRef\.current/.test(fwd));
    const route2 = src('app/api/inbox/[id]/draft/route.ts');
    gate('D6 the user\'s own fresh version FILES their edit into the version chain before replacing it', /if \(handHeld && sd\.draft\?\.body\) \{[\s\S]{0,200}fileHandVersion\(/.test(route2));
    const conv = src('lib/converse/index.ts');
    const stripped = withoutHandStamp({ body: 'x', edited_by_user_at: 'a', hand_hash: 'h', prepared_from: { receivedAt: 'r' } });
    gate('D7 the steer lane files the prior (J3) and strips the stamp from its new machine words', /withoutHandStamp\(sd\.draft \?\? \{\}\)/.test(conv) && !('edited_by_user_at' in stripped) && !('hand_hash' in stripped) && 'prepared_from' in stripped);
    // The census's pure classifiers (the definite / probable split).
    const lane = [
      { created_at: '2026-09-10T00:00:00Z', metadata: { prepared_from: { emailId: 'e1', receivedAt: '2026-09-09T00:00:00Z' } } },
      { created_at: '2026-09-11T00:00:00Z', metadata: { prepared_from: { emailId: 'e1', receivedAt: '2026-09-09T00:00:00Z' } } },
      { created_at: '2026-09-12T00:00:00Z', metadata: { prepared_from: { emailId: 'e1', receivedAt: '2026-09-09T00:00:00Z' }, version_of: 'superseded:ground-move' } },
      { created_at: '2026-09-13T00:00:00Z', metadata: { prepared_from: { emailId: 'e2', receivedAt: '2026-09-12T00:00:00Z' } } },
    ];
    // rows 1→2 and 2→3 stand on the same ground with the prior unfiled (2 clock re-buys); 3 was filed
    // (ground move) and 4 stands on a new ground — neither counts.
    gate('D8 the census counts a same-ground unfiled replacement as a DEFINITE clock regeneration (filed rows and ground moves never count)', clockRegenerationsInLane(lane) === 2);
    gate('D9 the census\'s probable class: engine-written >24h past its inbound, no activity since, inside the window',
      probableClockRegen({ prepared: 'pass', generated_at: '2026-09-20T00:00:00Z', prepared_from: { receivedAt: '2026-09-15T00:00:00Z' } }, { windowStartMs: Date.parse('2026-09-09T00:00:00Z') }) === true
      && probableClockRegen({ prepared: 'pass', generated_at: '2026-09-20T00:00:00Z', prepared_from: { receivedAt: '2026-09-15T00:00:00Z' } }, { windowStartMs: Date.parse('2026-09-09T00:00:00Z'), lastActivityAt: '2026-09-19T00:00:00Z' }) === false
      && probableClockRegen({ prepared: 'user', generated_at: '2026-09-20T00:00:00Z', prepared_from: { receivedAt: '2026-09-15T00:00:00Z' } }, { windowStartMs: 0 }) === false);
  }


  // ═══ E · A CONSEQUENCE NEVER DELETES THE USER'S HAND (W9.1b) ═══
  console.log('\nE · a verdict consequence files the user\'s hand — never deletes it');
  {
    const reply = 'Sam — Thursday at 10 works; I will bring the signed copy.';
    const nudge = 'Sam, a quick nudge on the scope — Friday still good?';
    const invite = { title: 'Scope call', startISO: '2026-09-30T09:00:00Z', endISO: '2026-09-30T09:30:00Z', attendees: ['sam@acme.example'], description: 'Walk the scope' };
    const forward = { to: ['finance@acme.example'], note: 'Please book this one against the pilot.' };
    const heldSd = (): Row => ({
      thread_id: 't9', subject: 'Scope',
      draft: { body: reply, generated_at: '2026-09-20T09:00:00Z', prepared: 'pass', ...handStamp('reply_draft', { body: reply }, '2026-09-21T09:00:00Z') },
      nudge_draft: { body: nudge, generated_at: '2026-09-20T09:00:00Z', ...handStamp('nudge_draft', { body: nudge }, '2026-09-21T09:00:00Z') },
      prepared_invite: { ...invite, ...handStamp('invite', invite, '2026-09-21T09:00:00Z') },
      prepared_forward: { ...forward, ...handStamp('forward', forward, '2026-09-21T09:00:00Z') },
      prepared_by: 'Clara',
    });
    const fields: HandField[] = ['draft', 'nudge_draft', 'prepared_invite', 'prepared_forward'];

    // E1 · the pure partition — every lane field, hand vs machine vs sent.
    const sd0 = heldSd();
    const part = partitionStrip(sd0, fields);
    const machineSd = { draft: { body: 'Hello there.' }, nudge_draft: { body: 'Just checking in.' }, prepared_invite: { ...invite }, prepared_forward: { ...forward } };
    const mPart = partitionStrip(machineSd, fields);
    const sentPart = partitionStrip({ draft: { ...(sd0.draft as Row), sent_at: '2026-09-22T00:00:00Z' } }, ['draft']);
    gate('E1 the ONE partition: a hand-held artifact on every lane (reply · nudge · invite · forward) is reported HELD; machine words and sent records are not; the input is never mutated',
      part.held.map((h) => h.field).join(',') === fields.join(',') && part.held.every((h) => h.kind === HAND_FIELD_KIND[h.field])
      && mPart.held.length === 0 && mPart.stripped.length === 4 && sentPart.held.length === 0
      && 'draft' in sd0 && !('draft' in part.sd));

    // E2 · END TO END — the verdict changes kind (reply → decide): every lane's hand is FILED.
    const tables: Record<string, Row[]> = {
      inbox_items: [{ id: 'i9', user_id: 'u1', status: 'pending', work_title: 'Scope', source_data: heldSd() }],
      item_deliverables: [], room_turns: [], emails: [], commitments: [], item_plans: [], activity_log: [],
    };
    const db = fakeDb(tables);
    const cons = await applyVerdictConsequences(db, 'u1', { kind: 'inbox', id: 'i9' } as never, { work: 'decide', reason: 'the user must choose', failed: false } as never);
    const sdAfter = tables.inbox_items[0].source_data as Row;
    const versions = tables.item_deliverables.filter((r) => (r.metadata as Row)?.hand === true && (r.metadata as Row)?.version_of);
    gate('E2 E2E a verdict that changes kind never DELETES a hand-held artifact — all four lanes filed into the version chain (hand: true, the words intact)',
      cons.filed.length === 4 && versions.length === 4
      && versions.some((v) => v.content === reply) && versions.some((v) => v.content === nudge)
      && versions.some((v) => String(v.content).includes('Scope call') && ((v.metadata as Row).artifact as Row)?.title === 'Scope call')
      && versions.some((v) => String(v.content).includes('finance@acme.example'))
      && !sdAfter.draft && !sdAfter.nudge_draft && !sdAfter.prepared_invite && !sdAfter.prepared_forward,
      `filed=${cons.filed.join(',')} versions=${versions.length}`);
    const turns = tables.room_turns.filter((t) => String(t.dedupe_key ?? '').startsWith('hand-filed:i9:'));
    gate('E3 E2E the room hears it ONCE per artifact, WITH the user\'s words (the surface where they still find it)',
      turns.length === 4 && turns.some((t) => String(t.text).includes(reply) && String(t.text).startsWith('The plan changed since you edited this')));
    const c4 = await applyVerdictConsequences(db, 'u1', { kind: 'inbox', id: 'i9' } as never, { work: 'decide', reason: 'again', failed: false } as never);
    const hf = () => tables.room_turns.filter((t) => String(t.dedupe_key ?? '').startsWith('hand-filed:i9:')).length;
    const filedOnce = c4.filed.length === 0 && tables.item_deliverables.filter((r) => (r.metadata as Row)?.hand === true).length === 4 && hf() === 4;
    await stripSourceArtifacts(db, 'u1', { itemId: 'i9', sd: heldSd(), fields, why: 'plan_changed' }); // the same words, re-met
    gate('E4 a repeat consequence files nothing twice, and the SAME words re-met never narrate twice (keyed on the words\' hash)', filedOnce && hf() === 4);

    // E5 · machine words on the same verdict still strip (the hygiene law is untouched).
    const t2: Record<string, Row[]> = { inbox_items: [{ id: 'i8', user_id: 'u1', status: 'pending', source_data: { draft: { body: 'Hello there.' }, prepared_by: 'Clara' } }], item_deliverables: [], room_turns: [] };
    const c2 = await applyVerdictConsequences(fakeDb(t2), 'u1', { kind: 'inbox', id: 'i8' } as never, { work: 'decide', reason: 'x', failed: false } as never);
    gate('E5 machine words on a contradicting verdict still strip (no version row, no narration)',
      c2.stripped.includes('reply_draft') && c2.filed.length === 0 && !(t2.inbox_items[0].source_data as Row).draft
      && t2.item_deliverables.length === 0 && t2.room_turns.length === 0);

    // E6 · a resolution (none/answered) files the hand too.
    const t3: Record<string, Row[]> = { inbox_items: [{ id: 'i7', user_id: 'u1', status: 'pending', work_title: 'Scope', source_data: heldSd() }], item_deliverables: [], room_turns: [], item_plans: [], activity_log: [], emails: [], commitments: [] };
    const c3 = await applyVerdictConsequences(fakeDb(t3), 'u1', { kind: 'inbox', id: 'i7' } as never, { work: 'none', resolution: 'answered', reason: 'handled', failed: false } as never);
    gate('E6 E2E a RESOLUTION files a hand-held reply + nudge (the item settles; the words are kept, narrated as settled)',
      c3.resolved && t3.inbox_items[0].status === 'completed' && c3.filed.includes('draft') && c3.filed.includes('nudge_draft')
      && t3.item_deliverables.filter((r) => (r.metadata as Row)?.hand === true).length === 2
      && t3.room_turns.some((t) => String(t.text).startsWith('This was settled') && String(t.text).includes(reply)),
      `resolved=${c3.resolved} filed=${c3.filed.join(',')}`);

    // E7 · FAIL CLOSED — a filing that cannot land keeps the artifact where it is.
    const t4: Record<string, Row[]> = { inbox_items: [{ id: 'i6', user_id: 'u1', status: 'pending', source_data: heldSd() }], item_deliverables: [], room_turns: [] };
    const s4 = await stripSourceArtifacts(fakeDb(t4, { failInsert: 'item_deliverables' }), 'u1', { itemId: 'i6', sd: t4.inbox_items[0].source_data as Row, fields: ['draft'], why: 'plan_changed' });
    gate('E7 a filing that fails KEEPS the user\'s artifact in place (fail closed — never a silent loss) and narrates nothing',
      s4.kept.includes('draft') && !s4.stripped.includes('draft') && (s4.sd.draft as Row)?.body === reply && t4.room_turns.length === 0);

    // E8 · the pool's re-run dedupe never deletes a hand-held row.
    const t5: Record<string, Row[]> = { item_deliverables: [
      { id: 'p1', user_id: 'u1', kind: 'commitment', entity_id: 'c9', task_id: 'prepare-pass-docsend', type: 'draft', content: nudge, metadata: handStamp('nudge_draft', { body: nudge }, '2026-09-21T00:00:00Z') },
      { id: 'p2', user_id: 'u1', kind: 'commitment', entity_id: 'c9', task_id: 'prepare-pass-docsend', type: 'draft', content: 'machine words', metadata: {} },
    ], room_turns: [] };
    await writeDeliverable(fakeDb(t5), 'u1', { kind: 'commitment', entityId: 'c9', taskId: 'prepare-pass-docsend', type: 'draft', content: 'new machine words' });
    const p1 = t5.item_deliverables.find((r) => r.id === 'p1');
    gate('E8 E2E writeDeliverable\'s re-run dedupe FILES a hand-held row (version_of, still there) and deletes only machine rows',
      !!p1 && !!(p1.metadata as Row).version_of && (p1.metadata as Row).hand === true && !t5.item_deliverables.some((r) => r.id === 'p2')
      && t5.item_deliverables.some((r) => r.content === 'new machine words') && t5.room_turns.some((t) => String(t.text).includes(nudge)));
    gate('E9 isPoolRowHeldAnyKind: text + invite rows held; a filed / sent / machine row never is',
      isPoolRowHeldAnyKind({ content: nudge, metadata: handStamp('deliverable', { content: nudge }, 't') }) === 'deliverable'
      && isPoolRowHeldAnyKind({ content: 'x', metadata: { invite, ...handStamp('invite', invite, 't') } }) === 'invite'
      && isPoolRowHeldAnyKind({ content: nudge, metadata: { ...handStamp('deliverable', { content: nudge }, 't'), version_of: 'nudge_draft' } }) === null
      && isPoolRowHeldAnyKind({ content: nudge, metadata: { ...handStamp('deliverable', { content: nudge }, 't'), sent_at: 'x' } }) === null
      && isPoolRowHeldAnyKind({ content: nudge, metadata: {} }) === null);
    gate('E10 the narration line: composed cause + the words; an over-long edit declares its cut',
      composeHandFiledLine('forward', 'booked', handWordsOf('forward', forward)).includes('To: finance@acme.example')
      && /… \[shortened\]$/.test(composeHandFiledLine('reply_draft', 'plan_changed', 'word '.repeat(2000))));

    // E11 · SOURCE — every engine strip path consults the hand (no bare delete left in lib/**).
    const walk = (d: string): string[] => readdirSync(join(ROOT, d)).flatMap((f) => {
      const rel = `${d}/${f}`;
      return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(f) ? [rel] : [];
    });
    const bare = walk('lib').filter((f) => !f.startsWith('lib/prepare/hand')).filter((f) => {
      const t = src(f);
      return /delete\s+[A-Za-z_$][\w$]*\.(draft|nudge_draft|prepared_invite|prepared_forward)\b/.test(t)
        || /\{\s*(draft|nudge_draft|prepared_invite|prepared_forward)\s*:\s*_\w*\s*,\s*\.\.\.\w+\s*\}\s*=/.test(t);
    });
    gate('E11 no engine path in lib/** strips a prepared artifact with a bare delete / destructure-drop (all go through the ONE strip)', !bare.length, bare.join(', '));
    const sites: Array<[string, RegExp]> = [
      ['lib/work/apply-verdict.ts', /stripSourceArtifacts\([\s\S]{0,200}why: 'resolved'[\s\S]*stripSourceArtifacts\([\s\S]{0,200}why: 'plan_changed'/],
      ['lib/work/evidence-settle.ts', /stripSourceArtifacts\(/],
      ['lib/inbox/conversation-identity.ts', /stripSourceArtifacts\(/],
      ['lib/inbox/commitment-mirrors.ts', /stripSourceArtifacts\(/],
      ['lib/prepare/pass.ts', /stripSourceArtifacts\(admin, userId, \{[^}]*fields: \['prepared_invite'\], why: 'booked'/],
      ['lib/home/deliverable-pool.ts', /isPoolRowHeldAnyKind\(r\)[\s\S]{0,400}fileHeldPoolRow\([\s\S]{0,600}\.delete\(\)[\s\S]{0,80}\.in\('id', machine\)/],
    ];
    const unrouted = sites.filter(([f, re]) => !re.test(src(f))).map(([f]) => f);
    gate('E12 every engine strip site routes through the hand check (verdict hygiene + resolution · evidence settle · cascade · mirror archive · booked floor · pool dedupe)', !unrouted.length, unrouted.join(', '));
  }

  console.log(`\n${failures.length ? '✗' : '✓'} smoke-draft-stability: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
