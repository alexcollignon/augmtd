// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BULK-DEED GATE (permanent — docs/attention-plan.md, law A7).
//
// "A law is only alive while a gate enforces it." This suite holds A7's seven promises:
//
//   BD1 · PREVIEW THEN COMMIT — a deed is born once, stored, and committed by id. No exported
//         executor acts on items without a deed row; an unknown deed refuses.
//   BD2 · TRASH, NEVER DELETE — no permanent-delete primitive exists anywhere in lib/deeds/, and
//         the trash lane uses the provider's own Trash.
//   BD3 · THE HONEST UNSUBSCRIBE SUBSET — one-click and mailto are classified and acted on;
//         link-only is `needs_click` and is NEVER fetched. Unit-level, against the parser.
//   BD4 · EXACTLY-ONCE — a second commit returns the FIRST result rather than acting twice.
//   BD5 · THE EXPIRY DOOR — bulk expire calls the expiry law's own judged, undoable close, and
//         contains no raw `commitments` status write of its own.
//   BD6 · PARITY — the chat tool calls the SAME preparer and cannot reach the commit.
//   BD7 · THE CARD CONTRACT — the bulk card renders the breakdown, the needs-a-click tail and the
//         undo note; its commit hits the ONE route; a committed deed wears no commit door.
//
// Asserted on SOURCE (the structures that make the laws unbreakable) and at UNIT level (the pure
// parser and composers). NOTHING IS EXECUTED: no unsubscribe is fired, no message is archived or
// trashed, no commitment is closed. Fixtures only — a gate that empties the owner's inbox to prove
// it can is not a gate.
//
// Zero AI, zero writes. Run: set -a; source .env.local; set +a; npx tsx scripts/smoke-deeds.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { bulkVerbLabel } from '../lib/deeds/held-words-bulk';
import { join } from 'path';
import {
  parseUnsubscribe, UNSUBSCRIBE_MAIL_SUBJECT, UNSUBSCRIBE_MAIL_BODY,
} from '../lib/deeds/unsubscribe';
import {
  BULK_VERBS, BULK_DEED_KIND, MAX_DEED_ITEMS, MAX_UNSUBSCRIBE_HEADER_READS, DEED_PAGE_SIZE, deedBoundFor,
  composeIntro, composeUndoNote, breakdownLines, tallyLine, doneReceipt,
  type BulkDeed, type DeedOutcome,
} from '../lib/deeds/words';
import { resolveHeldClass, classListSentence } from '../lib/tools/prepare-bulk-deed';
import { sanitizeAddressList, sanitizeFilename, sanitizeHeaderValue, sanitizeMimeType } from '../lib/utils/email-headers';
import { HELD_CLASSES, HELD_CLASS_ORDER } from '../lib/home/attention';
import { POSTURE_ELIGIBILITY, POSTURE_VERBS, postureFromDeed } from '../lib/postures/from-deed';
import { validatePrimitives, renderPostureSentence } from '../lib/postures/registry';

const ROOT = join(__dirname, '..');
const read = (rel: string): string | null => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; } };

let pass = 0, fail = 0;
const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Code only. A law stated in a comment must neither satisfy a gate nor trip one — the bans below
 *  are about what the module DOES, and this arc's own headers name the very things they forbid. */
function code(src: string | null): string {
  return (src ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every source file under lib/deeds — the floors below are asserted on the WHOLE module, never on
 *  one file a later hand could route around. */
function deedSources(): Array<{ path: string; src: string }> {
  const dir = join(ROOT, 'lib/deeds');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && statSync(join(dir, f)).isFile())
    .map((f) => ({ path: `lib/deeds/${f}`, src: readFileSync(join(dir, f), 'utf8') }));
}

const bulk = read('lib/deeds/bulk.ts');
const words = read('lib/deeds/words.ts');
const unsub = read('lib/deeds/unsubscribe.ts');
const cardKit = read('components/thread/thread-cards.tsx');
const cardTypes = read('components/thread/types.ts');
const host = read('components/home/bulk-deed-card.tsx');
const prepareRoute = read('app/api/deeds/prepare/route.ts');
const commitRoute = read('app/api/deeds/commit/route.ts');
const readRoute = read('app/api/deeds/[id]/route.ts');
const chatTool = read('lib/tools/prepare-bulk-deed.ts');
const converse = read('lib/converse/index.ts');
const featureMap = read('lib/workspace/tool-capabilities.ts');
const registry = read('lib/work/surface-registry.ts');

// ── BD1 · PREVIEW THEN COMMIT ───────────────────────────────────────────────────────────────────
console.log('\nBD1 · PREVIEW THEN COMMIT — a deed is a stored fact, and the commit acts on THAT row');
{
  gate('BD1.1 the engine exports exactly one preparer, one reader and one committer',
    !!bulk && /export async function prepareBulkDeed\(/.test(bulk)
    && /export async function readBulkDeed\(/.test(bulk)
    && /export async function commitBulkDeed\(/.test(bulk));

  // THE PREVIEW IS STORED: the member list and the breakdown are persisted at prepare time.
  gate('BD1.2 prepare PERSISTS the whole member list and the breakdown (never client state)',
    !!bulk && /from\('item_plans'\)\s*\.insert\(\{[\s\S]{0,160}kind: BULK_DEED_KIND, entity_id: deed\.id, tasks: deed/.test(bulk)
    && !!words && /items: DeedItemRef\[\];/.test(words) && /breakdown: BulkBreakdown;/.test(words));

  // THE COMMIT READS THE STORED DEED, and its per-item walk is over `existing.items`.
  // ⟲ RE-POINTED (W8.6 — THE WHOLE GROUP): the commit walks the stored list IN PAGES — each page is a
  // slice of `existing.items`, nothing else; the law (the stored list, never a caller's) is unchanged.
  gate('BD1.3 commit walks the STORED member list, never a list the caller handed it',
    !!bulk && /const existing = await readBulkDeed\(client, userId, deedId\);/.test(bulk)
    && /const page = existing\.items\.slice\(cursor, cursor \+ DEED_PAGE_SIZE\);/.test(bulk));

  gate('BD1.4 an unknown deed REFUSES (and the refusal is the same shape as a foreign one)',
    !!bulk && /if \(!existing\) return \{ ok: false, error: 'that deed is not on file' \};/.test(bulk)
    && /eq\('user_id', userId\)/.test(bulk));

  // NO BYPASS: the only exported async functions that can change the world are the committer and
  // the preparer. `runOne`, `runArchive`, `runTrash`, `runUnsubscribe`, `runExpire` are private.
  {
    const exportedAsync = [...(bulk ?? '').matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    // ⟲ RE-POINTED (W8.6): `undoBulkDeed` joins — it only REOPENS what the deed resolved (the batch
    // undo /api/restore calls); no executor that acts on the world is exported.
    gate('BD1.5 NO EXECUTOR IS EXPORTED — the per-item lanes are unreachable except through commitBulkDeed',
      exportedAsync.join(',') === 'commitBulkDeed,prepareBulkDeed,readBulkDeed,undoBulkDeed'
      && !!bulk && !/export async function run/.test(bulk),
      exportedAsync.join(','));
    gate('BD1.5b …and the lanes exist as private functions',
      !!bulk && /^async function runArchive\(/m.test(bulk) && /^async function runTrash\(/m.test(bulk)
      && /^async function runUnsubscribe\(/m.test(bulk) && /^async function runExpire\(/m.test(bulk));
  }

  // THE ROUTES ARE THIN AND ZERO-AI.
  gate('BD1.6 the commit route takes a deedId and NOTHING ELSE — nothing uncommitted can be committed',
    !!commitRoute && /body: \{ deedId\?: string \}/.test(commitRoute)
    && !/itemIds/.test(commitRoute) && !/classKey/.test(commitRoute)
    && /commitBulkDeed\(supabase, user\.id, deedId\)/.test(commitRoute));
  gate('BD1.7 both routes are auth\'d and zero-AI (no client is built, none is reachable)',
    !!prepareRoute && !!commitRoute && !!readRoute
    && [prepareRoute, commitRoute, readRoute].every((r) =>
      /auth\.getUser\(\)/.test(r) && /status: 401/.test(r)
      && !/getAIClient|aiCall|aiCreate|getSystemClient/.test(r)));
  gate('BD1.8 the read door rehydrates the STORED deed, user-scoped',
    !!readRoute && /readBulkDeed\(supabase, user\.id, id\)/.test(readRoute) && /status: 404/.test(readRoute));

  gate('BD1.9 the deed row is the house precedent (item_plans, owner-scoped, no migration)',
    !!words && /BULK_DEED_KIND = 'bulk_deed'/.test(words)
    && !!bulk && /from\('item_plans'\)/.test(bulk)
    && !readdirSync(join(ROOT, 'supabase/migrations')).some((f) => /bulk_deed/i.test(f)));

  // ⟲ RE-POINTED (W8.6 — THE WHOLE GROUP): the bound is now the verb's own stated safety bound
  // (archive/trash 5,000; unsubscribe/expire one page), and a deed is COMMITTED in pages ≤ 500.
  gate('BD1.10 a deed is BOUNDED — no unbounded set can be minted in one act',
    MAX_DEED_ITEMS > 0 && MAX_DEED_ITEMS <= 5000 && DEED_PAGE_SIZE > 0 && DEED_PAGE_SIZE <= 500
    && deedBoundFor('unsubscribe') <= 500 && deedBoundFor('expire') <= 500
    && !!bulk && /const bound = deedBoundFor\(verb\);/.test(bulk) && /\.slice\(0, bound\)/.test(bulk));
}

// ── BD2 · TRASH, NEVER DELETE ───────────────────────────────────────────────────────────────────
console.log('\nBD2 · THE TRASH FLOOR — provider-reversible is the ceiling');
{
  const sources = deedSources();
  // No permanent-delete primitive: not the providers' hard deletes, not a row delete on emails,
  // not a `.delete()` against any provider surface. The sweep is over the WHOLE module.
  const banned = /\bdeleteGmail\w*|messages\.delete|threads\.delete|permanentDelete|\bhardDelete\b|from\('emails'\)[\s\S]{0,40}\.delete\(|api\([^)]*\)\s*\.delete\(/;
  const offenders = sources.filter((f) => banned.test(f.src)).map((f) => f.path);
  gate('BD2.1 NO permanent-delete primitive anywhere in lib/deeds/', offenders.length === 0, offenders.join(', '));

  gate('BD2.2 the trash lane uses the PROVIDERS\' OWN TRASH (recoverable by the user)',
    !!bulk && /import \{[^}]*trashGmailThread[^}]*\} from '@\/lib\/google\/gmail'/.test(bulk)
    && /import \{[^}]*trashOutlookMessage[^}]*\} from '@\/lib\/microsoft\/outlook'/.test(bulk)
    && /await trashGmailThread\(/.test(bulk) && /await trashOutlookMessage\(/.test(bulk));

  gate('BD2.3 a refused mailbox move FAILS the item — it is never resolved here while it still sits in the inbox',
    !!bulk && /status: 'failed', note: e instanceof Error \? e\.message : 'your mailbox refused the move'/.test(bulk));

  gate('BD2.4 the undo note says TRASH, NEVER DELETE, in the user\'s own words',
    /Trash, never delete/.test(composeUndoNote('trash')));

  gate('BD2.5 the deed NEVER writes a raw status to inbox_items — it goes through the ONE resolution door',
    !!bulk && /import \{ executeResolveInboxItem \} from '@\/lib\/tools\/item-actions'/.test(bulk)
    && !/from\('inbox_items'\)[\s\S]{0,80}\.update\(/.test(bulk));
}

// ── BD3 · THE HONEST UNSUBSCRIBE SUBSET (unit-level, against the parser) ────────────────────────
console.log('\nBD3 · THE HONEST UNSUBSCRIBE SUBSET — link-only is REPORTED, never fired');
{
  // THE DECOY: a link-only List-Unsubscribe. Historically the tempting shortcut is to GET it.
  const linkOnly = parseUnsubscribe('<https://list.example.test/u/abc123>');
  gate('BD3.1 a link-only List-Unsubscribe lands in needs_click, with its URL kept for the user',
    linkOnly.lane === 'needs_click' && linkOnly.url === 'https://list.example.test/u/abc123');

  // …even when the sender writes a Post header that does NOT declare one-click.
  const fakePost = parseUnsubscribe('<https://list.example.test/u/abc>', 'List-Unsubscribe=Something-Else');
  gate('BD3.2 a Post header that does not DECLARE one-click never promotes a link into the automatic lane',
    fakePost.lane === 'needs_click');

  const oneClick = parseUnsubscribe('<https://list.example.test/u/abc>', 'List-Unsubscribe=One-Click');
  gate('BD3.3 RFC 8058 one-click is classified as one_click with its https target',
    oneClick.lane === 'one_click' && oneClick.url === 'https://list.example.test/u/abc');

  const caseAndSpace = parseUnsubscribe('<https://x.test/u>', '  list-unsubscribe = one-click  ');
  gate('BD3.4 …case- and whitespace-tolerantly (the header is written a dozen ways in the wild)',
    caseAndSpace.lane === 'one_click');

  const insecure = parseUnsubscribe('<http://x.test/u>', 'List-Unsubscribe=One-Click');
  gate('BD3.5 an INSECURE one-click claim is refused — a subscriber token is never posted in the clear',
    insecure.lane === 'needs_click');

  const mailto = parseUnsubscribe('<mailto:unsub@list.example.test?subject=unsubscribe%20me>');
  gate('BD3.6 a mailto is classified with its address and the subject the sender asked for',
    mailto.lane === 'mailto' && mailto.mailto === 'unsub@list.example.test' && mailto.mailtoSubject === 'unsubscribe me');

  // PREFERENCE ORDER: one-click wins over a mailto in the same header; without the declaration the
  // mailto wins over a bare link, because the mailto is a lane we can actually act on.
  const both = parseUnsubscribe('<mailto:u@x.test>, <https://x.test/u>', 'List-Unsubscribe=One-Click');
  gate('BD3.7 a declared one-click outranks a mailto in the same header', both.lane === 'one_click');
  const bothNoDecl = parseUnsubscribe('<https://x.test/u>, <mailto:u@x.test>');
  gate('BD3.8 …and without the declaration the MAILTO wins over the bare link (an actable lane beats a reported one)',
    bothNoDecl.lane === 'mailto' && bothNoDecl.mailto === 'u@x.test');

  gate('BD3.9 no header at all is `none`, never a guess',
    parseUnsubscribe(null).lane === 'none' && parseUnsubscribe('').lane === 'none'
    && parseUnsubscribe('<tel:+100000000>').lane === 'none');

  // THE FLOOR IN CODE: the module has exactly ONE outbound fetch and it is a POST.
  {
    const fetches = [...(unsub ?? '').matchAll(/fetch\(/g)].length;
    gate('BD3.10 the module makes exactly ONE outbound call, and it is a POST (a GET is the lane we refuse)',
      fetches === 1 && !!unsub && /method: 'POST'/.test(unsub) && /body: 'List-Unsubscribe=One-Click'/.test(unsub));
    gate('BD3.11 the one-click sender refuses a non-https URL before it can fire',
      !!unsub && /if \(!\/\^https:\\\/\\\/\/i\.test\(url\)\) return \{ ok: false/.test(unsub));
  }

  // THE ENGINE HONOURS THE PREVIEW'S OWN VERDICT — a needs_click member is skipped at commit, with
  // its URL, and the one-click fire is reachable ONLY from the one_click lane.
  gate('BD3.12 at commit a needs_click member is SKIPPED and handed back with its link',
    !!bulk && /if \(ref\.lane === 'needs_click'\) \{[\s\S]{0,180}status: 'skipped', note: `needs a click from you/.test(bulk));
  gate('BD3.13 …and fireOneClickUnsubscribe is called ONLY inside the one_click branch',
    !!bulk && (() => {
      const i = bulk.indexOf("if (ref.lane === 'one_click')");
      const j = bulk.indexOf('fireOneClickUnsubscribe(ref.url)');
      const k = bulk.indexOf("if (ref.lane === 'mailto')");
      return i > 0 && j > i && k > j;
    })());
  gate('BD3.14 the mailto lane sends AS THE USER, from their own connected mailbox',
    !!bulk && /sendGmailEmail\(\{ encryptedTokens: target\.encryptedTokens, to: ref\.mailto/.test(bulk)
    && /sendOutlookEmail\(\{ encryptedTokens: target\.encryptedTokens, to: ref\.mailto/.test(bulk)
    && UNSUBSCRIBE_MAIL_SUBJECT === 'unsubscribe' && UNSUBSCRIBE_MAIL_BODY === 'unsubscribe');

  // THE BREAKDOWN IS COMPUTED AT PREPARE TIME, so the card can state it before the commit.
  gate('BD3.15 the breakdown is computed in PREPARE, not at commit',
    !!bulk && (() => {
      const p = bulk.indexOf('export async function prepareBulkDeed');
      const c = bulk.indexOf('export async function commitBulkDeed');
      const parse = bulk.indexOf('parseUnsubscribe(headers.listUnsubscribe');
      return p >= 0 && c > p && parse > p && parse < c;
    })());
  gate('BD3.16 the header read is BOUNDED and the unread remainder is REPORTED, never dropped silently',
    MAX_UNSUBSCRIBE_HEADER_READS > 0 && !!bulk && /if \(i >= MAX_UNSUBSCRIBE_HEADER_READS\) \{ unread\+\+; continue; \}/.test(bulk));

  // AND THE WORDS: the honest split reaches the card, and an unsubscribe never claims an undo.
  {
    const deed: BulkDeed = {
      id: 'd', verb: 'unsubscribe', classKey: 'bulk_mail', className: HELD_CLASSES.bulk_mail.label,
      items: [], breakdown: { total: 12, oneClick: 7, mailto: 2, needsClick: 3, none: 0, unread: 0 },
      intro: '', undoNote: '', createdAt: '',
    };
    const lines = breakdownLines(deed);
    gate('BD3.17 the card states the honest split — automatic, by-mail, and needs-a-click',
      lines.length === 3 && /7 senders unsubscribe automatically/.test(lines[0])
      && /2 senders unsubscribe by an email sent as you/.test(lines[1])
      && /3 senders need a click from you/.test(lines[2]));
    gate('BD3.18 a ZERO lane gets NO line ("0 need a click from you" is chrome pretending to be information)',
      breakdownLines({ ...deed, breakdown: { total: 7, oneClick: 7 } }).length === 1);
    gate('BD3.19 THE UNSUBSCRIBE UNDO NOTE TELLS THE TRUTH — it says we cannot take it back',
      /cannot take it back/.test(composeUndoNote('unsubscribe'))
      && !/Reversible/.test(composeUndoNote('unsubscribe')));
    const ran: BulkDeed = { ...deed, committedAt: 'now',
      tally: { done: 9, partial: 0, skipped: 3, failed: 0, line: tallyLine('unsubscribe', []) } };
    gate('BD3.20 …and the done state never offers Undo on an unsubscribe',
      !/undo in Activity/.test(doneReceipt(ran) ?? ''));
  }
}

// ── BD4 · EXACTLY-ONCE ──────────────────────────────────────────────────────────────────────────
console.log('\nBD4 · EXACTLY-ONCE — a second commit returns the first result, it never acts twice');
{
  // ⟲ RE-POINTED (W8.6): a COMPLETE deed (every page done) or an undone one returns its prior result;
  // a committed deed with pages left resumes only through the lease + cursor compare-and-set.
  gate('BD4.1 an already-committed deed returns its PRIOR result before any work happens',
    !!bulk && /if \(deedComplete\(existing\) \|\| existing\.undoneAt\) return \{ ok: true, deed: existing, alreadyCommitted: true \};/.test(bulk)
    && /q\.filter\('tasks->>leaseUntil', 'lt', nowIso\)\.filter\('tasks->progress->>cursor', 'eq', String\(cursor\)\)/.test(bulk));

  gate('BD4.2 the claim is ATOMIC — the update is conditional on committedAt still being null',
    !!bulk && /\.filter\('tasks->>committedAt', 'is', null\)/.test(bulk)
    && /\.select\('entity_id'\)/.test(bulk));

  gate('BD4.3 a LOST claim re-reads and returns the winner\'s result rather than acting',
    !!bulk && /const prior = await readBulkDeed\(client, userId, deedId\);[\s\S]{0,160}alreadyCommitted: true/.test(bulk));

  gate('BD4.4 the claim is taken BEFORE the per-item work (the commit-door idiom: claim → fire → record)',
    !!bulk && (() => {
      const claim = bulk.indexOf("filter('tasks->>committedAt', 'is', null)");
      const work = bulk.indexOf('const page = existing.items.slice(cursor'); // ⟲ RE-POINTED (W8.6): the page walk
      return claim > 0 && work > claim;
    })());

  gate('BD4.5 the door reports WHICH it was, so a caller never re-presents a done deed as pending',
    !!commitRoute && /alreadyCommitted: res\.alreadyCommitted/.test(commitRoute));
}

// ── BD5 · THE EXPIRY DOOR ───────────────────────────────────────────────────────────────────────
console.log('\nBD5 · THE EXPIRY DOOR — bulk expire goes through the expiry law, never around it');
{
  gate('BD5.1 the engine imports the expiry law\'s own nomination and close',
    !!bulk && /import \{ isPastDue, judgeCommitmentExpiry, applyExpiryVerdict \} from '@\/lib\/commitments\/expiry'/.test(bulk));

  gate('BD5.2 the close IS applyExpiryVerdict — there is no raw commitments status write in the module',
    !!bulk && /await applyExpiryVerdict\(client, userId, c, verdict\)/.test(bulk)
    && !deedSources().some((f) => /from\('commitments'\)[\s\S]{0,120}\.update\(/.test(f.src)));

  gate('BD5.3 a verdict that is not `expired` SKIPS and is COUNTED, with the judge\'s own reason — never forced',
    !!bulk && /if \(verdict\.verdict !== 'expired'\) \{[\s\S]{0,140}status: 'skipped', note: verdict\.reason/.test(bulk));

  gate('BD5.4 a commitment that is not past due is never even judged (the deterministic nomination first)',
    !!bulk && /if \(!isPastDue\(c, today\)\) return \{ itemId: ref\.itemId, status: 'skipped', note: 'not past due' \};/.test(bulk));

  gate('BD5.5 a class can never carry `expire` — commitments are never held in the ledger',
    !!bulk && /if \(classKey\) return \{ ok: false, error: 'commitments are never held in the ledger/.test(bulk)
    && !HELD_CLASS_ORDER.some((id) => HELD_CLASSES[id].deed === 'expire'));

  gate('BD5.6 the expire preview says the judge decides — it never promises N closes',
    /each one is judged before it closes/.test(breakdownLines({
      id: 'd', verb: 'expire', classKey: null, className: null, items: [],
      breakdown: { total: 6, pastDue: 4 }, intro: '', undoNote: '', createdAt: '',
    }).join(' ')));
}

// ── BD6 · PARITY (the sayable door) ─────────────────────────────────────────────────────────────
console.log('\nBD6 · PARITY — the same deed is sayable, and the spoken door cannot commit');
{
  gate('BD6.1 the chat tool calls the SAME preparer the route calls',
    !!chatTool && /const \{ prepareBulkDeed \} = await import\('@\/lib\/deeds\/bulk'\);/.test(chatTool)
    && !!prepareRoute && /prepareBulkDeed\(supabase, user\.id/.test(prepareRoute));

  gate('BD6.2 THE MODEL CANNOT COMMIT — commitBulkDeed is not named anywhere on the chat path',
    !!chatTool && !/commitBulkDeed/.test(code(chatTool))
    && !!converse && !/commitBulkDeed/.test(code(converse)));

  gate('BD6.3 AMBIGUITY IS A REFUSAL — a description matching two classes refuses BY LISTING them',
    (() => {
      // A description reaching TWO classes at once ("notices and newsletters") must refuse and name
      // both — picking the first would silently archive a set the user never asked for.
      const r = resolveHeldClass('notices and newsletters');
      return !r.ok && r.candidates.length === 2
        && r.candidates.includes('bulk_mail') && r.candidates.includes('notices');
    })()
    && !!chatTool && /could mean \$\{classListSentence\(r\.candidates\)\} — which one\?/.test(chatTool));

  gate('BD6.4 the class resolution is DETERMINISTIC — exact key, exact label, then a distinctive word',
    (() => {
      const byKey = resolveHeldClass('bulk_mail');
      const byLabel = resolveHeldClass(HELD_CLASSES.notices.label);
      const byWord = resolveHeldClass('newsletters');
      const spoken = resolveHeldClass('the quieter threads');
      return byKey.ok && byKey.classKey === 'bulk_mail'
        && byLabel.ok && byLabel.classKey === 'notices'
        && byWord.ok && byWord.classKey === 'bulk_mail'
        && spoken.ok && spoken.classKey === 'quieter_threads';
    })());

  gate('BD6.5 an unknown group refuses by LISTING the real ones, never by guessing',
    (() => { const r = resolveHeldClass('sdfkjhsdf'); return !r.ok && r.candidates.length === 0; })()
    && HELD_CLASS_ORDER.every((id) => classListSentence().includes(HELD_CLASSES[id].label)));

  // THE REGISTRATION POINTS — a tool that is not registered everywhere is refused at run time.
  gate('BD6.6 registered in the FEATURE MAP (the sovereign law: a chip is a claim)',
    !!featureMap && /prepare_bulk_deed: 'email',/.test(featureMap));
  gate('BD6.7 registered in the CAPABILITY MAP, chief-exposed, reversible, conversational',
    !!registry && /prepare_bulk_deed: \{[\s\S]{0,400}tool: 'prepare_bulk_deed', built: true[\s\S]{0,80}irreversible: false[\s\S]{0,200}exposure: \['chief_of_staff'\], conversational: true,/.test(registry));
  gate('BD6.8 registered in the CHIEF TOOL DEFS, with a progress word and a dispatch branch',
    !!converse && /prepareBulkDeedDefinition/.test(converse)
    && /prepare_bulk_deed: 'Working out exactly what that would do…',/.test(converse)
    && /if \(tool === 'prepare_bulk_deed'\) \{/.test(converse));
  gate('BD6.9 the card channel rides the turn AND the loop\'s early return (a card that never returns is a card that never renders)',
    !!converse && /bulkDeed\?: \{ id: string; deed: Record<string, unknown> \} \| null;/.test(converse)
    // RE-POINTED (Sep 21): the email card joined the same early return. The law is the channel —
    // a card-bearing turn must survive the loop — and it now carries one more kind.
    // RE-POINTED (Sep 22): the binding was renamed (`out` → `turn`) when a dispatch result became
    // `ConverseTurn | ToolData`, and the early return keeps gaining card kinds. The law is
    // MEMBERSHIP — the bulk card is one of the fields that lets a turn leave the loop — not the
    // binding's name or its neighbours.
    && /if \([^\n]*\?\.bulkDeed[^\n]*\) return \{/.test(converse));
  gate('BD6.10 the router prompt and the system prompt both name it (an unmentioned tool is an unused tool)',
    !!converse && /prepare_bulk_deed \{"verb":"archive","group":"notices"\}/.test(converse)
    && /call \` \+\n      \`prepare_bulk_deed — it only previews/.test(converse));
  gate('BD6.11 a DISPLAY LABEL exists and says PREVIEW, not a deed',
    (() => { const l = read('lib/tools/tool-labels.ts'); return !!l && /prepare_bulk_deed: 'Preview a bulk deed',/.test(l); })());
  gate('BD6.12 exported from the tools barrel, and NO committing executor rides with it',
    (() => {
      const idx = read('lib/tools/index.ts');
      return !!idx && /prepareBulkDeedDefinition, executePrepareBulkDeed/.test(idx) && !/commitBulkDeed/.test(idx);
    })());
  gate('BD6.13 THE AGENTOS GAP IS STATED, not silent',
    !!chatTool && /AGENTOS, STATED/.test(chatTool) && /BOX REDEPLOY/.test(chatTool));

  // A CARD IS A TURN — the deed survives the reload, as a POINTER (its committed state lives on
  // the row, so a reloaded card can never offer a commit door on a deed that already ran).
  {
    const ask = read('app/api/home/ask/route.ts');
    const turns = read('app/api/room/turns/route.ts');
    const homeAsk = read('components/home/home-ask.tsx');
    gate('BD6.14 A CARD IS A TURN — the answer door writes the deed as a component POINTER (no payload)',
      !!ask && /component: \{ key: 'bulk_deed_card', refId: turn\.bulkDeed\.id \}/.test(ask)
      && !/key: 'bulk_deed_card'[\s\S]{0,40}state:/.test(ask));
    gate('BD6.15 …the client-written door validates it as a POINTER kind, never a payload',
      !!turns && /bulk_deed: \(r\) => \{[\s\S]{0,200}kind: 'bulk_deed', tid, deedId/.test(turns));
    gate('BD6.16 …and the room rehydrates it into the same host on the next open',
      !!homeAsk && /t\.component\?\.key === 'bulk_deed_card' && t\.component\.refId/.test(homeAsk)
      && /<BulkDeedCard deedId=\{bd\.deedId\}/.test(homeAsk));
  }
}

// ── BD7 · THE CARD CONTRACT ─────────────────────────────────────────────────────────────────────
console.log('\nBD7 · THE CARD — what will happen, to how many, the undo note, ONE commit door');
{
  gate('BD7.1 the kit owns a `bulk` card kind, in the grammar, the enumeration and the render',
    !!cardTypes && /kind: 'bulk';/.test(cardTypes)
    // RE-POINTED (Sep 21): the enumeration pinned an exact neighbour list and broke the day the
    // kit gained its `source` kind (THE ONE OBJECT CARD, Sep 19). The law is MEMBERSHIP — `bulk`
    // is one of the kit's enumerated kinds — not who happens to sit beside it.
    && /THREAD_CARD_KINDS[\s\S]{0,400}'bulk'/.test(cardTypes)
    && !!cardKit && /case 'bulk':/.test(cardKit) && /function BulkCardView\(/.test(cardKit));

  gate('BD7.2 the card renders the INTRO, the BREAKDOWN LINES and the UNDO NOTE',
    !!cardKit && /\{card\.intro\}/.test(cardKit)
    && /card\.lines!\.map/.test(cardKit)
    && /\{card\.undoNote\}/.test(cardKit));

  gate('BD7.3 THE HONEST SUBSET IS NAMED — the needs-a-click messages list their own subjects',
    !!cardKit && /card\.needsClick!\.map/.test(cardKit) && /\{n\.subject\}/.test(cardKit)
    && !!host && /deed\.items\.filter\(\(i\) => i\.lane === 'needs_click'\)/.test(host));

  gate('BD7.4 ONE primary commit door, and the way out stays QUIET',
    !!cardKit && (() => {
      // BOUNDED TO ITS OWN VIEW (Sep 17): the kit grew the `doc` card between this one and the
      // renders section, so the slice ends at the NEXT top-level function, not at the section.
      const from = cardKit.indexOf('function BulkCardView(');
      const nextFn = cardKit.indexOf('\nfunction ', from + 1);
      const row = cardKit.slice(from, nextFn > 0 ? nextFn : cardKit.indexOf('// ── the card renders'));
      const primaries = (row.match(/bg-indigo-600/g) ?? []).length;
      return primaries === 1 && /label=\{card\.cancelLabel \?\? 'Not now'\}[\s\S]{0,60}tone="quiet"/.test(row);
    })());

  gate('BD7.5 A DONE DEED WEARS NO COMMIT DOOR — only its receipt',
    !!cardKit && /\{!done && card\.onCommit && \(/.test(cardKit)
    && /\{\(!done \|\| card\.receipt\) && \(/.test(cardKit));

  gate('BD7.6 the WORKING state uses the kit\'s ONE helper (never a second motion idiom)',
    !!cardKit && (() => {
      // BOUNDED TO ITS OWN VIEW (Sep 17): the kit grew the `doc` card between this one and the
      // renders section, so the slice ends at the NEXT top-level function, not at the section.
      const from = cardKit.indexOf('function BulkCardView(');
      const nextFn = cardKit.indexOf('\nfunction ', from + 1);
      const row = cardKit.slice(from, nextFn > 0 ? nextFn : cardKit.indexOf('// ── the card renders'));
      return /workingClass\(busy\)/.test(row) && !/animate-spin/.test(row);
    })());

  gate('BD7.7 the commit fires THE ONE ROUTE, with the deed id alone',
    !!host && /fetch\('\/api\/deeds\/commit', \{/.test(host)
    && /JSON\.stringify\(\{ deedId \}\)/.test(host)
    && !/itemIds/.test(host));

  gate('BD7.8 the host is CLIENT-SAFE — it imports the pure words, never the engine (the server-graph law)',
    !!host && /from '@\/lib\/deeds\/words'/.test(host) && !/from '@\/lib\/deeds\/bulk'/.test(host)
    && !!words && !/googleapis|@\/lib\/google|@\/lib\/microsoft|from 'crypto'|@\/lib\/supabase|@\/lib\/deeds\/bulk/.test(code(words)));

  gate('BD7.9 the kit stays PRESENTATIONAL — the bulk card fetches nothing and routes nowhere',
    !!cardKit && !/fetch\(/.test(cardKit) && !/\/api\//.test(cardKit));

  gate('BD7.10 the done receipt is measured from REAL outcomes, never the preview\'s hopes',
    (() => {
      const outcomes: DeedOutcome[] = [
        { itemId: '1', status: 'done' }, { itemId: '2', status: 'done' },
        { itemId: '3', status: 'partial' }, { itemId: '4', status: 'skipped' }, { itemId: '5', status: 'failed' },
      ];
      const line = tallyLine('archive', outcomes);
      return /2 archived/.test(line) && /1 done here but not in your mailbox/.test(line)
        && /1 left for you/.test(line) && /1 failed/.test(line);
    })());

  gate('BD7.11 …and it offers Undo only where an undo actually exists',
    (() => {
      const base = { id: 'd', classKey: null, className: null, items: [], intro: '', undoNote: '', createdAt: '', committedAt: 'now' };
      const tally = { done: 3, partial: 0, skipped: 0, failed: 0, line: 'x' };
      const arch = doneReceipt({ ...base, verb: 'archive', breakdown: { total: 3 }, tally } as BulkDeed);
      const uns = doneReceipt({ ...base, verb: 'unsubscribe', breakdown: { total: 3 }, tally } as BulkDeed);
      return /undo in Activity/.test(arch ?? '') && !/undo in Activity/.test(uns ?? '');
    })());

  gate('BD7.12 every verb composes an INTRO and an UNDO NOTE (no verb can ship mute)',
    BULK_VERBS.every((v) => composeIntro(v, 3, 'Notices').trim().length > 10 && composeUndoNote(v).trim().length > 10));

  gate('BD7.13 the intro COUNTS and NAMES — and pluralises honestly',
    /^Archive 31 messages from Notices\.$/.test(composeIntro('archive', 31, 'Notices'))
    && /^Archive 1 message\.$/.test(composeIntro('archive', 1, null))
    && /^Move 4 messages to trash\.$/.test(composeIntro('trash', 4, null)));

  // ⟲ RE-POINTED (W8.6): ONE record per deed — `bulk_deed` (reversible AS ONE via /api/restore), or
  // `bulk_unsubscribe` (the sender's to reverse — no Undo) — updated in place as later pages land.
  gate('BD7.14 THE DEED IS LOGGED — one activity row carrying the verb, the class and the tally',
    !!bulk && /logActivity\(client, userId, \{[\s\S]{0,200}type: existing\.verb === 'unsubscribe' \? 'bulk_unsubscribe' : 'bulk_deed',/.test(bulk)
    && /metadata: \{ verb: existing\.verb, classKey: existing\.classKey, \.\.\.tally, total, deedId: existing\.id \}/.test(bulk));

  // RE-POINTED (Sep 17, never weakened): BD7.15 held the SEAM open while the posture door did not
  // exist — "a named seam, not a silent omission". The door exists now, so the gate holds the WIRING
  // instead: the kit renders the offer AND the answer in its place, and the card's seat is filled by
  // a host that only offers what the eligibility law says is keepable (asserted in WD2).
  gate('BD7.15 THE POSTURE TAIL (A8) IS WIRED — offered, answerable, and read back in place',
    !!cardTypes && /postureAsk\?: string;/.test(cardTypes) && /postureNote\?: string;/.test(cardTypes)
    && !!cardKit && /card\.onKeepDoingThis/.test(cardKit)
    && /\{done && card\.postureNote && \(/.test(cardKit)
    && /\{done && !card\.postureNote && card\.postureAsk && card\.onKeepDoingThis && \(/.test(cardKit)
    && !!host && /postureFromDeed\(deed\)/.test(host));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LEDGER'S HANDS (WD1–WD4) — the ledger integration of A7 + A8 + A3's one-scale clause.
//
//   WD1 · THE LEDGER'S VERBS — a class's natural verb PREVIEWS through /api/deeds/prepare and the
//         card mounts in place. There is exactly one commit path on the page, and it is the card's.
//   WD2 · THE POSTURE TAIL — "keep doing this?" routes through /api/postures/from-deed → the ONE
//         writer, with a DETERMINISTIC sentence (no AI on the path), and it is offered ONLY where a
//         standing posture is expressible AND the class's own account survives it.
//   WD3 · ONE HOME — the ledger route, the deed and the door read ONE derivation.
//   WD4 · ONE SCALE (live) — the number the door speaks IS the number the ledger accounts for.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const lens = read('components/home/held-quiet.tsx');
const homeView = read('components/home/home-view.tsx');
const heldRoute = read('app/api/home/held/route.ts');
const heldMembers = read('lib/deeds/held-members.ts');
const briefRoute = read('app/api/home/brief/route.ts');
const fromDeed = read('lib/postures/from-deed.ts');
const fromDeedRoute = read('app/api/postures/from-deed/route.ts');

console.log('\nWD1 · THE LEDGER\'S VERBS — the class row previews; the card is the only commit door');
{
  gate('WD1.1 the class row carries its OWN declared verb, and only a real bulk verb',
    !!lens && /const verb = verbOf\(c\.deed\);/.test(lens)
    && /\(BULK_VERBS as readonly string\[\]\)\.includes\(deed\)/.test(lens)
    // `surface` (brought_forward's deed) is a navigation, so it can never render as a deed verb.
    && !BULK_VERBS.includes(HELD_CLASSES.brought_forward.deed as never));

  gate('WD1.2 firing it POSTS THE PREVIEW DOOR — the whole class by key, a picked subset by ids',
    !!lens && /fetch\('\/api\/deeds\/prepare', \{/.test(lens)
    && /chosen\.length \? \{ verb, itemIds: chosen \} : \{ verb, classKey: c\.id \}/.test(lens));

  // ⟲ RE-POINTED (W8.3): the card now also carries the class's GROUP TRUTH (the scope line).
  gate('WD1.3 the prepared deed mounts AS THE CARD, in place, directly beneath its class row',
    !!lens && /<BulkDeedCard deedId=\{deed\.id\} deed=\{deed\} onDone=\{onDeedDone\}\s+scopeLine=/.test(lens));

  gate('WD1.4 NO SECOND COMMIT PATH — the lens never names the commit door or an executor',
    !!lens && !/\/api\/deeds\/commit/.test(code(lens)) && !/commitBulkDeed/.test(code(lens)));

  gate('WD1.5 the members become a PICKABLE set when the class is open, with one select-all',
    !!lens && /const pickable = !!verb && open;/.test(lens)
    && /type="checkbox" checked=\{picked\.has\(m\.itemId\)\}/.test(lens)
    && /onPickAll\(e\.target\.checked\)/.test(lens));

  // ⟲ RE-POINTED (W8.3 — THE GROUP TRUTH): the label law moved to one pure, gate-assertable home
  // (lib/deeds/held-words-bulk.ts `bulkVerbLabel`); the lens composes through it. The law is the same
  // — picked → exactly those, within the cap → "all N" — plus the W8.3 clause: past the cap it says
  // "the newest 200 OF 1,223", never a bare "200" beside a group of 1,223.
  {
    gate('WD1.6 the verb SAYS WHAT IT WILL ACT ON — the whole class, or exactly the ones picked',
      // ⟲ RE-POINTED (W8.6): the cap is the VERB'S own deed bound (the whole group for archive/trash).
      !!lens && /bulkVerbLabel\(VERB_WORD\[verb\], c\.count, picked\.size, deedBoundFor\(verb\)\)/.test(lens)
      && bulkVerbLabel('Archive', 12, 3, 200) === 'Archive 3' && bulkVerbLabel('Archive', 12, 0, 200) === 'Archive all 12');

    gate('WD1.6b …and it never promises more than a deed can hold — nor prints the cap as the group',
      bulkVerbLabel('Archive', 1223, 0, 200) === 'Archive the newest 200 of 1,223');
  }

  gate('WD1.7 a committed deed RE-READS the account — an archived member leaves the list honestly',
    !!lens && /export function useHeldLedger\(enabled: boolean\): \{ ledger: HeldLedger \| null; reload: \(\) => void \}/.test(lens)
    && /onRefresh\?\.\(\)/.test(lens)
    && !!homeView && /onRefresh=\{reloadHeld\}/.test(homeView));

  gate('WD1.8 the verb stays a WORD in the ledger\'s calm vocabulary (12px, neutral, no button block)',
    !!lens && /text-\[12px\] text-neutral-300 transition-colors hover:text-indigo-600 disabled:text-neutral-200/.test(lens)
    && !/bg-indigo-600/.test(lens));

  gate('WD1.9 the lens stays CLIENT-SAFE — the pure words, never the deed engine (the server-graph law)',
    !!lens && /from '@\/lib\/deeds\/words'/.test(lens) && !/from '@\/lib\/deeds\/bulk'/.test(lens));
}

console.log('\nWD2 · THE POSTURE TAIL — deterministic, and offered only where it is keepable');
{
  gate('WD2.1 the card\'s tail routes through the posture door, carrying the deed id alone',
    !!host && /fetch\('\/api\/postures\/from-deed', \{/.test(host)
    && /JSON\.stringify\(\{ deedId \}\)/.test(host)
    && /onKeepDoingThis: keepDoingThis/.test(host));

  gate('WD2.2 …and that door lands through THE ONE WRITER, with the floor re-validating the shape',
    !!fromDeedRoute && /createPosture\(supabase, user\.id, offer\.offer\.sentence, \{/.test(fromDeedRoute)
    && /primitives: offer\.offer\.primitives/.test(fromDeedRoute));

  gate('WD2.3 THE SENTENCE IS DETERMINISTIC — no AI client is built or reachable on this path',
    !!fromDeedRoute && !/getAIClient|getSystemClient|aiCreate|aiCall\(|parsePostureSentence|openai|anthropic/i.test(code(fromDeedRoute))
    && !!fromDeed && !/getAIClient|getSystemClient|aiCreate|aiCall\(|openai|anthropic/i.test(code(fromDeed))
    // types only from the registry — a runtime import would drag the server graph into the card.
    && /import type \{ PosturePrimitives \} from '@\/lib\/postures\/registry';/.test(fromDeed));

  gate('WD2.4 ONLY A COMMITTED DEED leaves a posture — "keep doing this" about nothing is refused',
    !!fromDeedRoute && /if \(!deed\.committedAt\)/.test(fromDeedRoute)
    && /there is nothing to keep doing/.test(fromDeedRoute));

  gate('WD2.4b THE POSTURE LANDS WHERE IT WILL ACTUALLY FIRE — the engine evaluates per inbox, so a posture with no inbox is refused, never saved as a rule that does nothing',
    !!fromDeedRoute && (() => {
      const c = code(fromDeedRoute);
      // the refusal is REAL code, and it stands BEFORE the writer — never a comment, never after.
      return /from\('connections'\)\.select\('id'\)\.eq\('user_id', user\.id\)/.test(c)
        && /set it up per inbox in Settings → Email/.test(c)
        && c.indexOf('if (!connectionId)') > 0
        && c.indexOf('if (!connectionId)') < c.indexOf('createPosture(supabase');
    })());

  gate('WD2.5 THE ELIGIBILITY TABLE EXISTS, and every class carries a stated reason',
    !!fromDeed && HELD_CLASS_ORDER.every((id) => POSTURE_ELIGIBILITY[id]
      && typeof POSTURE_ELIGIBILITY[id].offered === 'boolean'
      && POSTURE_ELIGIBILITY[id].why.trim().length > 30));

  gate('WD2.6 judged_quiet is NOT in it — a cached verdict about one thread is not a standing rule',
    POSTURE_ELIGIBILITY.judged_quiet.offered === false
    && !postureFromDeed({ verb: 'archive', classKey: 'judged_quiet' }).ok);

  gate('WD2.7 …nor quieter_threads (real correspondence) nor brought_forward (read-time calendar)',
    POSTURE_ELIGIBILITY.quieter_threads.offered === false
    && POSTURE_ELIGIBILITY.brought_forward.offered === false
    && !postureFromDeed({ verb: 'archive', classKey: 'quieter_threads' }).ok);

  gate('WD2.8 …nor cc_watch — expressible, but a standing archive would cancel the watch it promised',
    POSTURE_ELIGIBILITY.cc_watch.offered === false
    && /cancels the watch it just promised/.test(POSTURE_ELIGIBILITY.cc_watch.why));

  gate('WD2.9 the three inert classes DO offer it, as one plain sentence about arriving mail',
    (['bulk_mail', 'own_outreach', 'notices'] as const).every((id) => {
      const r = postureFromDeed({ verb: 'archive', classKey: id });
      return r.ok && /^Archive .+ as they arrive\.$/.test(r.offer.sentence)
        && r.offer.primitives.trigger === 'received'
        && r.offer.primitives.outcome.archive === true
        && !!r.offer.primitives.ai_match
        && r.offer.ask.startsWith('Keep doing this?');
    }));

  gate('WD2.10 a verb the RULES ENGINE CANNOT PERFORM is never offered (unsubscribe · expire)',
    !postureFromDeed({ verb: 'unsubscribe', classKey: 'bulk_mail' }).ok
    && !postureFromDeed({ verb: 'expire', classKey: null }).ok
    && POSTURE_VERBS.length === 2);

  gate('WD2.11 a HAND-PICKED deed has no honest subject, so it is offered nothing',
    !postureFromDeed({ verb: 'archive', classKey: null }).ok);

  gate('WD2.12 THE PRIMITIVES PASS THE ENGINE\'S OWN FLOOR — validated, never trusted',
    (['bulk_mail', 'own_outreach', 'notices'] as const).every((id) => {
      const r = postureFromDeed({ verb: 'trash', classKey: id });
      return r.ok && validatePrimitives(r.offer.primitives).ok;
    }));

  gate('WD2.13 the card SHOWS BACK what was understood (or the refusal), in place of the offer',
    !!host && /Kept — \$\{String\(json\.understood \?\? json\.sentence \?\? ''\)\.trim\(\)\}/.test(host)
    && /String\(json\?\.reason \?\? 'That could not be kept just now\.'\)/.test(host));

  gate('WD2.14 the accepted sentence is what is STORED VERBATIM (one sentence, both doors, one store)',
    (() => {
      const r = postureFromDeed({ verb: 'archive', classKey: 'bulk_mail' });
      return r.ok && renderPostureSentence({
        name: r.offer.sentence,
        outcome: { ...r.offer.primitives.outcome, posture: { sentence: r.offer.sentence } },
      } as never) === r.offer.sentence;
    })());
}

console.log('\nWD3 · ONE HOME — the ledger, the deed and the door read ONE derivation');
{
  gate('WD3.1 the held route derives THROUGH the shared module',
    !!heldRoute && /import \{ deriveHeld \} from '@\/lib\/deeds\/held-members';/.test(heldRoute)
    && /deriveHeld\(supabase, user\.id, user\.email \?\? null\)/.test(heldRoute));

  gate('WD3.2 …and carries NO second derivation of its own',
    !!heldRoute && (() => {
      const c = code(heldRoute);
      return !/classifyItem|deckEligible|rankAttention\(|getCampaignSignature|fetchAllRows/.test(c);
    })());

  gate('WD3.3 the deed engine reads the SAME function, so a class deed acts on what the ledger shows',
    !!bulk && /import \{ deriveHeldMembers \} from '\.\/held-members';/.test(bulk)
    && !!heldMembers && /export async function deriveHeldMembers\(/.test(heldMembers)
    && /const byClass = \(await deriveHeld\(client, userId, selfEmail\)\)\.membersByClass;/.test(heldMembers));

  gate('WD3.4 …and so does the door\'s count (countHeld delegates, it never re-derives)',
    !!heldMembers && /export async function countHeld\(/.test(heldMembers)
    && /const d = await deriveHeld\(client, userId, selfEmail\);/.test(heldMembers));

  gate('WD3.5 the derivation keeps the deck\'s OWN order — the reasoned weight, then the one budget',
    !!heldMembers && /work_entities'\)\.select\('id, priority'\)/.test(heldMembers)
    && /rankAttention\(candidates, ATTENTION_BUDGET\)/.test(heldMembers));
}

console.log('\nWD4 · ONE SCALE — the door speaks the number the ledger accounts for');
{
  // (Q2, Sep 17 — THE GRADIENT. The one-scale law is unchanged; WHICH number the door speaks is.
  //  The door now says the WAITING band — alive, real, held only by the budget — and rests the
  //  handled total beside it. Both still come from the ledger's own derivation, in one call.)
  gate('WD4.1 the brief serves the LEDGER\'S OWN numbers, through the ledger\'s own function',
    !!briefRoute && /const \{ countHeld \} = await import\('@\/lib\/deeds\/held-members'\);/.test(briefRoute)
    && /heldTotal: counts\?\.total \?\? null,/.test(briefRoute)
    && /heldWaiting: counts\?\.waiting \?\? null,/.test(briefRoute)
    // RE-POINTED (Sep 18): the payload grew THE FRESH SEAT's count and the catch-up detector beside
    // these. The one-scale law is untouched — the door's numbers are still the ledger's own, served.
    && /heldTotal: attention\.heldTotal, heldWaiting: attention\.heldWaiting, heldHandled: attention\.heldHandled,/.test(briefRoute));

  // RE-POINTED (Sep 21): the third clause pinned `handledQuietly={…heldHandled ?? 0}` on the door.
  // The owner removed that receipt from the line ("it looks clickable/meaningful but opens nothing")
  // — it wore a button's affordance for a door that only repeated the left one. The LAW is that the
  // handled account is still SPOKEN somewhere the reader can reach, and its new home is the held
  // page's own intro (lib/home/held-words.ts `heldIntro`), one click behind this door. So the clause
  // now asserts THAT — the account survives the receipt's removal — instead of the retired prop.
  gate('WD4.2 the door READS those numbers (and the handled account is still spoken, one click on)',
    !!homeView && /b\?\.attention\?\.heldWaiting === 'number'/.test(homeView)
    && /b\.attention\.heldWaiting \+ deckHeldRows\.length/.test(homeView)
    && /Everything else is handled: \$\{handled\.toLocaleString\(\)\} filed quietly/.test(read('lib/home/held-words.ts') || ''));

  gate('WD4.3 …and the ledger\'s own intro sums the SAME two numbers',
    /const waiting = \(b\?\.waiting\.count \?\? 0\) \+ deckHeld;/.test(read('lib/home/held-words.ts') || ''));

  // (RE-POINTED, STRICTLY STRONGER: the fallback gained its own honest third leg — with no brief at
  //  all the door is handed `null` and says so in words, rather than a zero. The gate now asserts
  //  BOTH halves of the law instead of only the fallback's leading token.)
  gate('WD4.4 a brief served WITHOUT the field falls back — never a number nobody computed',
    !!homeView && /restRows\.length : null/.test(homeView));
}

// ── BD8 · THE HEADER FLOOR ──────────────────────────────────────────────────────────────────────
// A header value can never carry a line break. Found by review: `/api/emails/send` capped its
// subject at 300 chars with interior CR/LF intact, and lib/google/gmail.ts wrote `Subject: ${s}`
// straight into the RFC822 block — a silent Bcc away from a message the user never authorised.
console.log('\nBD8 · THE HEADER FLOOR — no user string reaches a mail header carrying a newline');
{
  gate('BD8.1 a subject with CR/LF collapses to ONE line (the injected header becomes text)',
    !/[\r\n]/.test(sanitizeHeaderValue('Invoice\r\nBcc: someone@example.com'))
    && sanitizeHeaderValue('Invoice\r\nBcc: someone@example.com') === 'Invoice Bcc: someone@example.com');
  gate('BD8.2 …and every other control character goes too (a tab or a NUL is not a header value)',
    sanitizeHeaderValue('a\u0000b\tc') === 'a b c');
  gate('BD8.3 an address list keeps real addresses, drops anything that is not one',
    sanitizeAddressList('sam@example.com, not-an-address, Sam Doe <sam2@example.com>')
      === 'sam@example.com, Sam Doe <sam2@example.com>');
  gate('BD8.4 an address carrying a newline can never smuggle a header through the To line',
    !/[\r\n]/.test(sanitizeAddressList('sam@example.com\r\nBcc: other@example.com'))
    && sanitizeAddressList('sam@example.com\r\nBcc: other@example.com') === '');
  gate('BD8.5 an attachment filename cannot close its own quoted parameter',
    sanitizeFilename('re"port\r\nX.pdf') === 'report X.pdf'
    && sanitizeMimeType('text/plain; x=1') === 'application/octet-stream');
  const gmailSrc = read('lib/google/gmail.ts') || '';
  const outlookSrc = read('lib/microsoft/outlook.ts') || '';
  gate('BD8.6 BOTH Gmail RFC822 builders take their header values through the floor, never from params directly',
    (gmailSrc.match(/const subject = sanitizeHeaderValue\(params\.subject\);/g) ?? []).length === 2
    && (gmailSrc.match(/const to = sanitizeAddressList\(params\.to\);/g) ?? []).length === 2
    && !/const \{ encryptedTokens, to, cc, bcc, subject/.test(gmailSrc));
  gate('BD8.7 …and attachment headers are built from the sanitized name and type',
    !/name="\$\{att\.filename\}"/.test(gmailSrc) && !/\$\{att\.mimeType\}/.test(gmailSrc));
  gate('BD8.8 the Outlook transport holds the same address discipline (one law, two transports)',
    /const to = sanitizeAddressList\(params\.to\);/.test(outlookSrc)
    && /const subject = sanitizeHeaderValue\(params\.subject\);/.test(outlookSrc));
  gate('BD8.9 both user-facing send doors sanitize the subject on the way IN as well',
    /sanitizeHeaderValue\(typeof e\.subject === 'string'/.test(read('app/api/emails/send/route.ts') || '')
    && /const subject = sanitizeHeaderValue\(raw\.subject, 300\);/.test(read('app/api/compose/send/route.ts') || ''));
}

async function live() {
  const { createClient: createSb } = await import('@supabase/supabase-js');
  const { resolveProbeUser } = await import('./probe-user');
  const { deriveHeld, countHeld } = await import('../lib/deeds/held-members');
  const { buildHeldLedger } = await import('../lib/home/attention');
  const sb = createSb(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const today = new Date().toISOString().slice(0, 10);

  const accounts: Array<{ label: string; id: string }> = [];
  try { accounts.push({ label: 'the probe host', id: await resolveProbeUser(sb) }); } catch { /* probe absent */ }
  const { data: profs } = await sb.from('profiles').select('id').limit(500);
  const ref = (profs ?? []).map((p) => p.id as string).find((id) => id.startsWith('08fe4449'));
  if (ref) accounts.push({ label: 'the reference account (read-only)', id: ref });

  for (const a of accounts) {
    console.log(`\nWD4 · ONE SCALE ON THE WORLD — ${a.label}`);
    // THE ROUTE'S NUMBER (the ledger) and THE BRIEF'S NUMBER (the door), for the same account, in
    // the same breath. Two doors, one computation — if they could ever differ, this is where.
    const d = await deriveHeld(sb, a.id);
    const c = await countHeld(sb, a.id);
    const ledger = buildHeldLedger(d.facts, today);
    console.log(`     (${d.poolRead} pending · ${d.servedCount} served · ${d.total} held)`);
    gate(`WD4.5 the door's total EQUALS the ledger's total (${c.total} = ${ledger.total}) — ${a.label}`,
      c.total === ledger.total && c.total === d.total);
    // Q2: the classes are the HANDLED band's surface, so the sum that accounts for EVERYTHING held
    // is the three bands'. (The class↔handled identity is asserted one line down.)
    gate(`WD4.6 …and the three bands sum to it (nothing held is unaccounted for) — ${a.label}`,
      ledger.bands.waiting.count + ledger.bands.watched.count + ledger.bands.handled.count === ledger.total
      && ledger.classes.reduce((n, x) => n + x.count, 0) === ledger.bands.handled.count);
    gate(`WD4.7 …and nothing is lost: served + held = the pool read — ${a.label}`,
      d.servedCount + d.total === d.poolRead, `${d.servedCount}+${d.total} ≠ ${d.poolRead}`);
  }
  if (!accounts.length) console.log('  (no account available in this database — live scale gates skipped)');
}

// ── the id-uniqueness guard (the smoke-threads precedent: two agents, one day, colliding ids) ───
function idGuard() {
  const own = read('scripts/smoke-deeds.ts') || '';
  const ids = [...own.matchAll(/gate\(\s*[`']((?:BD|WD)\d+\.\d+[a-z0-9-]*)[\s'`]/g)].map((m) => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) { console.log(`\n✗ GATE-ID COLLISION — duplicated ids: ${dupes.join(', ')}`); process.exit(1); }
}

live().then(() => {
  idGuard();
  console.log(`\n${pass}/${pass + fail} gates green${fail ? ` — ${fail} FAILING` : ''}`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
}).catch((e) => { console.error(e); process.exit(1); });
