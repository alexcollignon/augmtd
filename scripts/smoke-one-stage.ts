/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ONE STAGE, NO INTERNAL TEXT, TRUE ADDRESSEES (stabilization W7.3, Sep 23 —
 * docs/laws-registry.md `one-stage` · `no-internal-text` · `true-addressees`).
 *
 * Found live on the owner's production account (a meeting-born commitment, counterparty null):
 *   1 · the header "Source" (and a nudge row) summoned a SPLIT STAGE holding the OLD ComposePanel,
 *       while the email door wore the kit EmailCard in the conversation;
 *   2 · the judge's private reason rendered raw ("Direction 'you_owe' with the item asking…"), and
 *       the identified-tasks plan rendered as "THIS MESSAGE SHOULD COVER";
 *   3 · a pooled "Nudge — <the user>" greeted the user by name with an empty To — and compose
 *       never consulted the meeting's attendees;
 *   4 · the meeting-born commitment had no source object at all;
 *   5 · recognition read an email commitment's `source_id` (an EMAILS row) as an inbox_item id.
 *
 * ZERO-AI, deterministic: source floors for every clause + pure tests of the addressee ladder, the
 * withdrawal predicate, the reader's stamp, the clause filter, the provenance mapper and the meeting
 * source producer. Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-one-stage.ts              (+ the read-only census when env exists)
 *   npx tsx scripts/smoke-one-stage.ts --no-census  (the board's form — never depends on data)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv'; config({ path: '.env.local' });
import {
  resolveAddressee, addresseeWithdrawn, addresseeFromNudgeTitle, recipientsLabel, type AddresseeFacts,
} from '../lib/prepare/addressee';
import { stampAddressees, isLiveArtifact, nonLiveKindsOf, withdrawnReasonOf, poolRowsToArtifacts, preparedFromSourceData } from '../lib/prepare/read';
import { motionClausesOf } from '../lib/home/item-gaps';
import { itemFromCommitment } from '../lib/entities/sources';
import { EXCERPT_MARK } from '../lib/utils/clip-for-prompt';
import type { UserForms } from '../lib/commitments/extraction-truth';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const detail = src('components/home/item-detail.tsx');
const commitSeg = detail.slice(detail.indexOf('function CommitmentDetail('), detail.indexOf('function CommitmentSourceSection('));
const host = src('components/home/email-card.tsx');
const view = src('app/api/items/view/route.ts');
const rail = src('components/home/item-rail.tsx');

// ═══ A · ONE STAGE ═══
console.log('\nA · ONE STAGE — a commitment\'s message is the ONE EmailCard in the conversation');
{
  gate('A1 the retired split-stage composer is gone from the commitment door (no <ComposePanel kind="commitment">, no composing/composeRaised state)',
    !/<ComposePanel kind="commitment"/.test(detail)
    && !/setComposing|composeRaised|composingTouchedRef/.test(commitSeg));
  gate('A2 the message mounts as THE ONE EmailCard (compose lane) as the nudge artifact\'s own node — anchored on the writer\'s key',
    /<EmailCard compose=\{\{ kind: 'commitment', id \}\}/.test(commitSeg)
    && /\.\.\.\(emailCardNode \? \[\{\s*\n\s*key: 'nudge',/.test(commitSeg)
    && /node: emailCardNode,/.test(commitSeg)
    // ⟲ RE-POINTED (W15.2): + a SETTLED commitment mounts no card (the machine's word).
    && /\(!isHandoff && !done && !roomSettled\(view\) && \(nudgeArt \|\| draftSummoned\)\)/.test(commitSeg));
  gate('A3 the stage exists ONLY for a parked gate; the "Source" handle is gone for every other commitment',
    /const stageOpen = sourceOpen \|\| \(isHandoff && inviteOpen\) \|\| gateStanding;/.test(commitSeg)
    && /\.\.\.\(isHandoff \? \{ onSummonStage: \(\) => setSourceOpen\(true\), sourceLabel: 'The ask' \} : \{\}\)/.test(commitSeg)
    && !/sourceLabel: isHandoff \? 'The ask' : 'Source'/.test(commitSeg));
  gate('A4 the verb "Draft an email" SUMMONS the card into the conversation (never a stage)',
    /label: data\?\.counterparty \? `Draft email → [^`]+` : 'Draft an email', onClick: \(\) => \{ setDraftSummoned\(true\); setInviteOpen\(false\); \}/.test(commitSeg));
  gate('A5 the commitment\'s SOURCE reads in the drawer (the email door\'s Thread idiom), read-only',
    /threadLabel: 'Source',/.test(commitSeg) && /<CommitmentSourceSection src=\{src \?\? null\} meeting=\{view\?\.sourceMeeting \?\? null\}(?: laterItemId=\{view\?\.sourceItemId \?\? null\})? \/>/.test(commitSeg) /* ⟲ RE-POINTED (W11.1): the drawer carries the source message THEN the rest of the conversation (laterItemId) */
    && /drawerSignal: drawerReq,/.test(commitSeg));
  gate('A6 the EmailCard\'s COMPOSE lane: one fill read (/api/compose/draft) + one approve-before-commit send (/api/compose/send) carrying what we prepared',
    /const composeLane = !!compose && !item && !coworker && !standalone;/.test(host)
    && (code('components/home/email-card.tsx').match(/fetch\('\/api\/compose\/draft'/g) ?? []).length === 1
    && (code('components/home/email-card.tsx').match(/fetch\('\/api\/compose\/send'/g) ?? []).length === 1
    && /prepared: servedRef\.current\.trim\(\)\s*\n?\s*\? \{ itemKind: compose!\.kind, itemId: compose!\.id/.test(host));
  gate('A7 the old ComposePanel survives ONLY on the meeting door (one mount)',
    (detail.match(/<ComposePanel /g) ?? []).length === 1 && /<ComposePanel kind="meeting"/.test(detail));
  gate('A8 the send offers the next deed in words (Mark this done) instead of a stage-bound button',
    /toast\('Sent\.', \{ action: \{ label: 'Mark this done'/.test(commitSeg));
}

// ═══ B · NO INTERNAL TEXT ON SCREEN ═══
console.log('\nB · NO INTERNAL TEXT — the judge\'s reason and the internal plan never render');
{
  const offenders = [...walk('components'), ...walk('app')].filter((f) => /\.tsx$/.test(f))
    .filter((f) => /\bverdict\??\.reason\b/.test(code(f.replace(ROOT + '/', ''))));
  gate('B1 NO component renders the judge\'s private reason (`verdict.reason` appears in no .tsx code)', offenders.length === 0, offenders.join(', '));
  gate('B2 decision questions come from the DECISION BRIEF\'s own title, else the item\'s own words — both doors',
    /title: decisionBriefC\?\.title \|\| data\?\.description \|\| null,/.test(commitSeg)
    && /title: decisionBrief\?\.title \|\| subject \|\| null,/.test(detail));
  gate('B3 the commitment door keeps no reason in its verdict state (the options only)',
    /useState<\{ work: string; options\?: Array<\{ label: string \}> \} \| null>\(null\)/.test(commitSeg));
  gate('B4 the motion checklist reads ONLY the extractor\'s clauses (motionClausesOf) — never the identified-tasks plan',
    /const steps = kind === 'commitment' \? motionClausesOf\(tasks\) : null;/.test(view)
    && !/kind === 'commitment' && tasks\.length >= 2/.test(view)
    && /done: false, clause: true \}\)\)/.test(src('lib/commitments/extract.ts')));
  const plan = [{ id: 't1', text: 'Review requirements', actor: 'system', capability: 'analyze' }, { id: 't2', text: 'Draft the proposal', actor: 'system', capability: 'draft' }];
  gate('B5 pure: an identified plan (t1…) is not a motion; extractor clauses (flagged / legacy g1-) are; a mixed plan is not',
    motionClausesOf(plan as never) === null
    && motionClausesOf([{ id: 'g1-0', text: 'attach the deck' }, { id: 'g1-1', text: 'include pricing' }] as never)?.length === 2
    && motionClausesOf([{ id: 'a', text: 'x', clause: true }, { id: 'b', text: 'y', clause: true }] as never)?.length === 2
    && motionClausesOf([{ id: 'g1-0', text: 'x' }, { id: 't2', text: 'y' }] as never) === null
    && motionClausesOf([{ id: 'g1-0', text: 'x' }] as never) === null);
}

// ═══ C · TRUE ADDRESSEES ═══
console.log('\nC · TRUE ADDRESSEES — one ladder, stamped at production, withdrawn at the one reader');
{
  const ad = src('lib/prepare/addressee.ts');
  gate('C1 lib/prepare/addressee.ts is the law\'s home: the pure ladder + the withdrawal predicate + ONE loader',
    /export function resolveAddressee\(f: AddresseeFacts\): AddresseeResolution/.test(ad)
    && /export function addresseeWithdrawn\(/.test(ad)
    && /export async function resolveCommitmentAddressee\(/.test(ad)
    && /export async function loadUserForms\(/.test(ad)
    && !/from '@\/lib\/ai/.test(ad));
  const rd = src('lib/prepare/read.ts');
  gate('C2 THE ONE READER stamps `misaddressed` in BOTH readers, reads legacy nudge titles, and the live predicate honors it',
    /export function stampAddressees<T extends PreparedArtifact>/.test(rd) && (rd.match(/stampAddressees\(/g) ?? []).length >= 2
    && /addresseeOfStamp\(meta\.addressee\) \?\? addresseeFromNudgeTitle\(d\.title as string\)/.test(rd)
    && /return !a\.stale && !a\.expired && !a\.outsideWindow && !a\.falseClaim && !a\.misaddressed\s*&& !a\.settled && !emptyTextArtifact\(a\);/.test(rd) // ⟲ W15.2: + settled · empty words
    && /if \(a\.misaddressed\) return 'it was addressed to the wrong person';/.test(rd)
    && /a\.falseClaim \|\| a\.misaddressed\)/.test(src('lib/room/grounding.ts')));
  const pass_ = src('lib/prepare/pass.ts');
  gate('C3 EVERY commitment drafter asks THE ONE LADDER and stamps it — the pass nudge · doc-send · paste pack, the steer redraft, compose',
    /const addr = await resolveCommitmentAddressee\(admin, userId, w\.entityId\);/.test(pass_)
    && /\.\.\.addresseeStamp\(addr\),/.test(pass_)
    && /\.\.\.stampC\(cAddr\),/.test(pass_)
    && /\.\.\.\(packAddr \? \{ addressee: packAddr\.addressee \} : \{\}\)/.test(pass_)
    && /\.\.\.\(args\.addressee !== undefined \? \{ addressee: args\.addressee \} : \{\}\)/.test(src('lib/prepare/paste-pack.ts'))
    && /metadata: \{ steered: true, \.\.\.addresseeStamp\(addr\),/.test(src('lib/converse/index.ts'))
    && /const addr = await resolveCommitmentAddressee\(supabase, user\.id, c as never\);/.test(src('app/api/compose/draft/route.ts')));
  gate('C4 the commit nudge lane never greets the spine\'s `blockedOn` (the field that named the user) — its title is the resolved greeting or "recipient to confirm"',
    !/Nudge — \$\{\(w\.blockedOn \|\| ''\)/.test(pass_)
    && /title: `Nudge — \$\{greet \? greet\.split\('<'\)\[0\]\.trim\(\) : 'recipient to confirm'\}`/.test(pass_)
    && /const direction: 'you' \| 'them' = dirRow\?\.direction === 'you_owe' \? 'you' : 'them';/.test(pass_));
  gate('C5 inbox drafts are stamped too (a reply → the sender; a nudge → the party chased)',
    /via: 'sender' \} \} : \{\}\),/.test(pass_) && /\.\.\.\(inboxAddressee \? \{ addressee: inboxAddressee \} : \{\}\),/.test(pass_));
  gate('C6 nothing ships a placeholder address as if addressed — the compose card ASKS and offers the ladder\'s candidates',
    !/recipient@email\.com/.test(detail)
    && /placeholder: recipientName \? `Add \$\{recipientName\}'s email` : 'Who should this go to\?',/.test(host)
    && /suggestions: suggestions\.map\(/.test(host)
    && /suggestions\?: Array<\{ email: string; label: string \}>;/.test(src('components/home/people-chips.tsx'))
    && /\.\.\.\(suggestions\.length \? \{ suggestions \} : \{\}\),/.test(src('app/api/compose/draft/route.ts')));

  // ── pure: the ladder (generic fakes only) ──
  const USER: UserForms = { name: 'Sam Rivera', aliases: ['sam@acme.test'] };
  const base: AddresseeFacts = { counterparty: null, emailSource: null, meetingAttendees: [], entityPeople: [], user: USER, userAddresses: ['sam@acme.test'] };
  gate('C7 pure rung 1: a non-user counterparty addresses (and finds its address among the source\'s people)',
    resolveAddressee({ ...base, counterparty: 'Jordan Blake', meetingAttendees: [{ name: 'Jordan Blake', email: 'jordan@globex.test' }] }).addressee?.email === 'jordan@globex.test');
  gate('C8 pure: a counterparty that IS the user is skipped (the live class) — the ladder moves on',
    resolveAddressee({ ...base, counterparty: 'Sam', meetingAttendees: ['Kim Lee <kim@initech.test>'] }).addressee?.via === 'meeting');
  gate('C9 pure rung 2: the email source\'s other party (the recipient when the user wrote it)',
    resolveAddressee({ ...base, emailSource: { fromAddress: 'sam@acme.test', fromName: 'Sam', to: ['kim@initech.test'], isFromUser: true } }).addressee?.email === 'kim@initech.test');
  const mt = resolveAddressee({ ...base, meetingAttendees: ['Sam Rivera <sam@acme.test>', 'Kim Lee <kim@initech.test>', { name: 'Lee Park', email: 'lee@initech.test' }] });
  gate('C10 pure rung 3: the meeting\'s attendees minus the user are the recipients',
    mt.recipients.length === 2 && mt.recipients.every((a) => a.email !== 'sam@acme.test') && recipientsLabel(mt.recipients) === 'Kim Lee and Lee Park');
  const many = resolveAddressee({ ...base, title: 'Walkthrough with the Initech team', entityPeople: ['kim.lee@initech.test', 'kim lee', 'lee.park@initech.test', 'jo@globex.test', 'pat@acme.test'] });
  gate('C11 pure rung 4: several project people are SUGGESTIONS (ranked by the org the title names), never an addressee; colleagues excluded',
    many.addressee === null && many.recipients.length === 0
    && many.suggestions.map((a) => a.email).join(',') === 'kim.lee@initech.test,lee.park@initech.test');
  gate('C12 pure: nothing resolves ⇒ no addressee, no recipients, no suggestions (the card asks)',
    JSON.stringify(resolveAddressee(base)) === JSON.stringify({ addressee: null, recipients: [], suggestions: [] }));
  gate('C13 pure withdrawal: to the user → withdrawn; to someone other than the counterparty → withdrawn; to the counterparty / unaddressed → kept',
    addresseeWithdrawn({ name: 'Sam', email: null }, { counterparty: null, user: USER })
    && addresseeWithdrawn({ name: 'Kim Lee', email: null }, { counterparty: 'Jordan Blake', user: USER })
    && !addresseeWithdrawn({ name: 'Jordan', email: null }, { counterparty: 'Jordan Blake', user: USER })
    && !addresseeWithdrawn(null, { counterparty: 'Jordan Blake', user: USER }));
  const legacy = stampAddressees(poolRowsToArtifacts([{ id: 'r', type: 'draft', title: 'Nudge — Sam', content: 'Dear Sam, following up.', metadata: {}, created_at: '2026-09-23T07:21:00Z' }], 'commitment'), { counterparty: null, user: USER });
  gate('C14 pure: the live row\'s shape ("Nudge — <user>", unstamped) is misaddressed → not live → its kind re-prepares',
    legacy[0].misaddressed === true && !isLiveArtifact(legacy[0]) && [...nonLiveKindsOf({ all: legacy })].join() === 'nudge_draft'
    && /wrong person/.test(withdrawnReasonOf(legacy[0]) ?? '')
    && addresseeFromNudgeTitle('Nudge — recipient to confirm') === null);
  const inboxSelf = stampAddressees(preparedFromSourceData({ draft: { body: 'Hi', addressee: { name: 'Sam Rivera', email: 'sam@acme.test' } } } as never), { user: USER });
  gate('C15 pure: an inbox reply stamped to the user\'s own address is withdrawn too',
    inboxSelf[0].misaddressed === true && !isLiveArtifact(inboxSelf[0]));
}

// ═══ D · A MEETING-BORN COMMITMENT'S SOURCE ═══
console.log('\nD · the meeting is the source object (the kit\'s existing `source` kind — no new visual language)');
{
  const cs = src('lib/commitments/source.ts');
  // ⟲ RE-POINTED (W11.3 — THE MARKER NEVER RENDERS): the surface excerpt is a DISPLAY clip.
  gate('D1 ONE read of the meeting source (title · date · attendees minus the user · the summary clipped for display · the ONE note address)',
    /export async function meetingSourceOf\(/.test(cs)
    && /excerpt: summary \? clipForDisplay\(summary, MEETING_SOURCE_EXCERPT_CHARS\) : null,/.test(cs)
    && /addressId: String\(mt\.calendar_event_id \?\? mt\.id\),/.test(cs));
  gate('D2 the door serves it in the SAME flight as the rest (no new round trip) and only for a meeting-born commitment',
    /const \[room, machine, sourceItemId, sourceMeeting\] = await Promise\.all\(\[/.test(view)
    && /String\(itemRow\.source \?\? ''\) !== 'meeting'/.test(view) && /sourceMeeting,\s*\n/.test(view));
  gate('D3 the rail seats it in the object card\'s ONE seat when the door has no mail object; its door is the meeting page',
    /\) : \(!objectItemId && door\.kind === 'item' && sourceMeeting\) \? \(/.test(rail)
    && /<MeetingSourceMount meeting=\{sourceMeeting\} onOpen=\{\(\) => go\(`\/meetings\/\$\{sourceMeeting\.addressId\}`\)\} \/>/.test(rail)
    && /sourceMeeting=\{view\?\.sourceMeeting \?\? null\}/.test(commitSeg));
  gate('D4 the kit already carries the meeting source (catalogue fixture) — the producer adds no kind',
    /kind: 'source', id: 'cat-so-2', source: 'meeting'/.test(src('app/(main)/dev/thread-preview/preview-catalogue.tsx'))
    && /source: 'email' \| 'meeting' \| 'document';/.test(src('components/thread/types.ts')));
  // Pure producer (a .tsx module with React imports — read its shape, then exercise the mapping rules).
  const so = src('components/room/source-object.tsx');
  gate('D5 the producer maps served facts only: byline "with …" (+N), the date label composed at the host, "Open meeting →" only with a handler',
    /export function meetingSourceCard\(m: MeetingSourceFacts, onOpen\?: \(\) => void\): ThreadCard/.test(so)
    && /kind: 'source', id: `source-meeting-\$\{m\.id\}`, source: 'meeting',/.test(so)
    && /who = shown\.length \? `with \$\{shown\.join\(', '\)\}\$\{more > 0 \? ` \+\$\{more\}` : ''\}` : null;/.test(so)
    && /\.\.\.\(onOpen \? \{ onOpen, openLabel: 'Open meeting →' \} : \{\}\),/.test(so)
    && EXCERPT_MARK.length > 0);
}

// ═══ E · PROVENANCE ═══
console.log('\nE · an email commitment\'s source_id is an EMAILS row — every reader maps it');
{
  gate('E1 pure: itemFromCommitment gives an email commitment an `email` parent (never an inbox_item id); meeting unchanged',
    JSON.stringify(itemFromCommitment({ id: 'c', description: 'x', source: 'email', source_id: 'e1' }).parent) === JSON.stringify({ kind: 'email', id: 'e1' })
    && JSON.stringify(itemFromCommitment({ id: 'c', description: 'x', source: 'meeting', source_id: 'm1' }).parent) === JSON.stringify({ kind: 'meeting', id: 'm1' }));
  const rec = src('lib/entities/recognize.ts');
  gate('E2 recognition maps an `email` parent to its inbox item through THE ONE READ before the structural lookup',
    /if \(item\.parent\?\.kind === 'email'\) \{[\s\S]{0,300}inboxItemForEmail\(supabase, userId, \{ emailId: item\.parent\.id, threadId: item\.threadId \?\? null \}\)/.test(rec)
    && /let parentEntity = await lookupLink\(supabase, userId, parent\.kind, parent\.id\);/.test(rec));
  gate('E3 the door and the deck read the same mapping (emails.id → inbox_items.source_id, else the thread)',
    /inboxItemForEmail\(supabase, user\.id, \{/.test(view)
    && /\.eq\('source', 'email'\)\.eq\('source_id', src\.emailId\)/.test(src('lib/commitments/source.ts'))
    && /client\.from\('inbox_items'\)\.select\('id, source_id'\)\.eq\('user_id', userId\)\.in\('source_id', sourceEmailIds\)/.test(src('lib/triage/deck-context-read.ts')));
  gate('E4 the addressee ladder reads the source EMAIL by its own id (emails.id)',
    /* ⟲ RE-POINTED (W11.1): the same by-id read also carries cc_addresses + thread_id (the reply-all Cc ladder) */
    /client\.from\('emails'\)\.select\('from_address, from_name, to_addresses, (?:cc_addresses, )?is_from_user(?:, thread_id)?'\)\.eq\('id', row\.source_id\)/.test(src('lib/prepare/addressee.ts')));
}

// ═══ F · THE CENSUS (read-only; never a gate) ═══
(async () => {
  const noCensus = process.argv.includes('--no-census');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!noCensus && url && key) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const { fetchAllRows } = await import('../lib/utils/fetch-all');
      const { preparedStatesFor } = await import('../lib/prepare/read');
      const { resolveCommitmentAddressee } = await import('../lib/prepare/addressee');
      const sb = createClient(url, key);
      const open = await fetchAllRows<{ id: string; user_id: string; source: string | null; source_id: string | null; counterparty: string | null }>((f, t) =>
        sb.from('commitments').select('id, user_id, source, source_id, counterparty').eq('status', 'open').order('id').range(f, t), { maxRows: 20000 });
      const byUser = new Map<string, string[]>();
      for (const c of open) byUser.set(c.user_id, [...(byUser.get(c.user_id) ?? []), c.id]);
      let drafts = 0, mis = 0, unaddressed = 0;
      for (const [uid, ids] of byUser) {
        const st = await preparedStatesFor(sb as never, uid, ids.map((id) => ({ kind: 'commitment' as const, id })));
        for (const s of st.values()) for (const a of s.all) {
          if (a.kind !== 'nudge_draft' && a.kind !== 'reply_draft') continue;
          drafts++;
          if (a.misaddressed) mis++;
          else if (!a.addressee) unaddressed++;
        }
      }
      const meeting = open.filter((c) => c.source === 'meeting');
      const dist = { counterparty: 0, email_source: 0, meeting: 0, entity: 0, nameOnly: 0, suggestionsOnly: 0, nothing: 0 };
      for (const c of meeting) {
        const r = await resolveCommitmentAddressee(sb as never, c.user_id, c.id);
        if (r.addressee?.email) dist[r.addressee.via as 'counterparty' | 'email_source' | 'meeting' | 'entity']++;
        else if (r.addressee) dist.nameOnly++;
        else if (r.suggestions.length) dist.suggestionsOnly++;
        else dist.nothing++;
      }
      let oldRule = 0, newRule = 0;
      const openIds = open.map((c) => c.id);
      for (let i = 0; i < openIds.length; i += 150) {
        const { data } = await sb.from('item_plans').select('entity_id, tasks').eq('kind', 'commitment').in('entity_id', openIds.slice(i, i + 150));
        for (const p of (data ?? []) as Array<{ tasks: unknown }>) {
          const t = Array.isArray(p.tasks) ? p.tasks as never[] : [];
          if (t.length >= 2) oldRule++;
          if (motionClausesOf(t)) newRule++;
        }
      }
      const email = open.filter((c) => c.source === 'email' && c.source_id).slice(0, 40);
      let inEmails = 0, asInbox = 0;
      for (const c of email) {
        const [{ count: e }, { count: i }] = await Promise.all([
          sb.from('emails').select('id', { count: 'exact', head: true }).eq('id', c.source_id!),
          sb.from('inbox_items').select('id', { count: 'exact', head: true }).eq('id', c.source_id!),
        ]);
        if (e) inEmails++; if (i) asInbox++;
      }
      console.log(`\nF · census (read-only): open commitments ${open.length} · pooled commitment drafts ${drafts} (misaddressed → now withdrawn ${mis} · unaddressed legacy ${unaddressed})`);
      console.log(`    meeting-born open ${meeting.length} → addressed via counterparty ${dist.counterparty} · email ${dist.email_source} · meeting attendees ${dist.meeting} · the project's one person ${dist.entity} · a name without an address ${dist.nameOnly} · suggestions only ${dist.suggestionsOnly} · nothing ${dist.nothing}`);
      console.log(`    "this message should cover": ${oldRule} open commitments under the old ≥2-tasks rule → ${newRule} under the clause rule`);
      console.log(`    email commitments sampled ${email.length}: source_id in emails ${inEmails} · as an inbox_items id ${asInbox}`);
    } catch (e) { console.log(`\nF · census skipped: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    console.log('\nF · census skipped (--no-census or no env)');
  }
  console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${pass} passed · ${failures.length} failed${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
