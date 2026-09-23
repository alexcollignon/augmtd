/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE AUTHORSHIP LAW (stabilization W7.6 · AUTHORED, NOT FILED — docs/laws-registry.md
 * `authorship-law`).
 *
 * Found live (W7.5): the Sent-folder sync stamped `emails.is_from_user = true` on everything in Sent
 * Items, and a forwarded meeting request keeps its CLIENT organizer in `from`. Every reader treats the
 * flag as "the user wrote this" (reply resolution, the evidence settle, the self derivation, voice
 * learning, the addressee ladder, the echo floor…).
 *
 * ZERO-AI, deterministic, no data: A · source floors (every sync path stamps through the ONE helper,
 * no folder-based stamp left, no reader tests the folder, both providers carry the sender fact, the
 * repair is guarded dry-run) · B · pure rules on real provider shapes · C · the repair plan. Exit 1 on
 * any failure.   npx tsx scripts/smoke-authorship.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { authorshipOf, authorshipStamp, ownAddressesOf, isAuthoredByUser } from '../lib/email-sync/authorship';
import { smtpFromProxyAddresses, ownedFromGmailSendAs } from '../lib/email-sync/send-as';
import { planAuthorshipRepair, closeCausedByMisattribution } from '../lib/email-sync/authorship-repair';
import { parseGmailMessage } from '../lib/google/gmail';
import { parseOutlookMessage, OUTLOOK_MESSAGE_SELECT } from '../lib/microsoft/outlook';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');
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
const rel = (p: string) => p.replace(ROOT + '/', '');

// ═══ A · SOURCE FLOORS ═══
console.log('A · every sync path stamps authorship through the ONE helper:');
const sync = code('lib/email-sync/sync-emails.ts');
gate('A1 no folder-based stamp is left (no literal `is_from_user: true` in the sync)', !/is_from_user:\s*true\b/.test(sync));
gate('A2 no single-address compare decides authorship (the old `from_address … === userEmail` stamp is gone)',
  !/is_from_user:\s*\(m\.from_address/.test(sync) && !/isFromUser\s*=\s*parsed\.from_address/.test(sync));
// Each emails WRITE object (a `stripNulls({` / `.insert({` literal) → the value its is_from_user takes.
const writes = [...sync.matchAll(/stripNulls\(\{|\.insert\(\{/g)]
  .map((m) => sync.slice(m.index!, m.index! + 1200).match(/is_from_user:\s*([^,\n}]+)/)?.[1]?.trim()).filter((w): w is string => !!w);
gate('A3 every is_from_user WRITE in the sync reads an authorshipStamp result (initial · recovery · push · fast path · backfill · Sent pass)',
  writes.length >= 3 && writes.every((w) => /^(authorship\.is_from_user|isFromUser)$/.test(w)) && /const isFromUser = _authorship\.is_from_user;/.test(sync),
  writes.join(' | '));
gate('A4 the three writer sites stamp through authorshipStamp (backfill · main insert · Sent pass with filedInSent: true)',
  (sync.match(/authorshipStamp\(/g) ?? []).length >= 3 && /authorshipStamp\(m as any, _userAddresses, \{\s*filedInSent: true,/.test(sync));
gate('A5 the owned set carries the provider send-as (full sync asks; a push reads the memo only)',
  /options\.preloadedMessages \? cachedSendAsAddresses\(connection\.id\) : await providerSendAsAddresses\(connection\)/.test(sync)
  && /loadOwnAddresses\(adminSupabase, connection\)/.test(sync));
// A6 — no writer outside the sync sets is_from_user on an emails row.
const writers = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
  .filter((p) => !p.endsWith('lib/email-sync/sync-emails.ts'))
  .filter((p) => { const s = readFileSync(p, 'utf8'); return /from\('emails'\)[\s\S]{0,200}\.(insert|upsert|update)\(/.test(s) && /is_from_user\s*:/.test(s); });
gate('A6 no other file writes emails.is_from_user', writers.length === 0, writers.map(rel).join(', '));
// A7 — no reader tests the folder: the SENT label / sentitems appear only where they are the fetch
// query, a folder listing, or the helper's filed_in_sent fact.
// ⟲ RE-POINTED (W9.2): lib/email-sync/push-shape.ts names the SENT label / Sent Items folder as a
// SUBSCRIPTION shape (what the provider pushes) — admitted ONLY while it never reads authorship
// (no is_from_user / filed_in_sent / authorship reference in its code), checked just below.
const FOLDER_OK = new Set(['lib/email-sync/authorship.ts', 'lib/google/gmail.ts', 'lib/microsoft/outlook.ts', 'lib/email-sync/push-shape.ts']);
const pushShapeCode = code('lib/email-sync/push-shape.ts');
gate('A7a the push-shape file (watch labels/resources) never reads authorship — a subscription shape, not a reader',
  !/is_from_user|filed_in_sent|authorship(Of|Stamp)|isAuthoredByUser/.test(pushShapeCode) && /GMAIL_WATCH_LABEL_IDS/.test(pushShapeCode));
const folderReaders = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]
  .filter((p) => !FOLDER_OK.has(rel(p)))
  .filter((p) => /(labelIds|labels)[^\n]{0,40}['"]SENT['"]|['"]SENT['"][^\n]{0,40}(labelIds|labels)|sentitems|filed_in_sent\s*[=!]==?|\.filed_in_sent\b/i.test(code(rel(p))));
gate('A7 no reader decides authorship from the folder (SENT label · sentitems · filed_in_sent)', folderReaders.length === 0, folderReaders.map(rel).join(', '));
gate('A8 Outlook: every message read uses THE ONE select, and it carries `sender`',
  /\bsender\b/.test(OUTLOOK_MESSAGE_SELECT.split(',').join(' '))
  && !/body,from,toRecipients,ccRecipients/.test(src('lib/microsoft/outlook.ts').replace(/export const OUTLOOK_MESSAGE_SELECT[^\n]*/, ''))
  && /\.select\(OUTLOOK_MESSAGE_SELECT\)/.test(src('app/api/webhooks/outlook/push/route.ts'))
  && !/body,from,toRecipients/.test(src('app/api/webhooks/outlook/push/route.ts')));
gate('A9 Gmail: the parser reads the RFC 5322 Sender header into metadata.sender_address',
  /getHeader\('Sender'\)/.test(code('lib/google/gmail.ts')) && /sender_address: senderAddress/.test(code('lib/google/gmail.ts')));
const repair = src('scripts/repair-authorship.ts');
gate('A10 the repair is dry-run by default: --apply needs --yes; writes live after the APPLY guard; reopen only via THE ONE restore flip',
  /if \(APPLY && !YES\)/.test(repair) && repair.indexOf('if (!APPLY) continue;') > 0
  && repair.indexOf(".from('emails').update(") > repair.indexOf('if (!APPLY) continue;')
  && repair.indexOf('reopenInboxItem(') > repair.indexOf('if (!REOPEN) continue;')
  && /import\('\.\.\/lib\/activity\/reopen'\)/.test(repair) && !/from\('inbox_items'\)\.update|from\('commitments'\)\.update/.test(repair));
gate('A11 /api/restore and the repair share THE ONE restore flip (lib/activity/reopen.ts)',
  /reopenInboxItem\(supabase, user\.id, entityId\)/.test(src('app/api/restore/route.ts')) && /reopenCommitment\(supabase, user\.id, entityId\)/.test(src('app/api/restore/route.ts')));

// ═══ B · THE RULES (pure, real provider shapes) ═══
console.log('B · the four rules:');
const OWN = ownAddressesOf({ profileEmail: 'sam.rivera@gmail.com', connections: [{ metadata: { email: 'sam@acme.test' } }] });
const outlook = (from: string, sender?: string, ev = false) => parseOutlookMessage({
  id: 'o', conversationId: 'c', subject: 's', bodyPreview: '', body: { content: 'x', contentType: 'text' },
  from: { emailAddress: { name: 'X', address: from } }, ...(sender ? { sender: { emailAddress: { address: sender } } } : {}),
  toRecipients: [], ccRecipients: [], receivedDateTime: '2026-09-01T10:00:00Z', internetMessageId: '<o@x>',
  ...(ev ? { '@odata.type': '#microsoft.graph.eventMessageRequest' } : {}),
} as never);
const gmail = (headers: Record<string, string>, calendar = false) => parseGmailMessage({
  id: 'g', threadId: 't', internalDate: '1756720800000', labelIds: ['SENT'], snippet: '',
  payload: { headers: Object.entries({ 'Message-ID': '<g@x>', ...headers }).map(([name, value]) => ({ name, value })), mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('x').toString('base64') } },
      ...(calendar ? [{ mimeType: 'text/calendar', filename: '', body: { data: Buffer.from('BEGIN:VCALENDAR').toString('base64') } }] : [])] },
} as never);
gate('B1 own send (Gmail) → authored', authorshipOf(gmail({ From: 'Sam <sam@acme.test>' }), OWN).basis === 'own_from');
const poison = authorshipStamp(outlook('jordan@globex.test', 'sam@acme.test', true), OWN, { filedInSent: true });
gate('B2 a forwarded meeting request filed in Sent (Outlook, organizer in from) → NOT authored + filed_in_sent',
  poison.is_from_user === false && poison.metadata.filed_in_sent === true && poison.metadata.authorship === 'relayed_calendar');
gate('B3 another person\'s mail filed in Sent → NOT authored', isAuthoredByUser(outlook('jordan@globex.test'), OWN) === false);
const behalf = authorshipStamp(outlook('pat@acme.test', 'sam@acme.test'), OWN);
gate('B4 on-behalf-of (from = principal, sender = the user) → authored, principal recorded',
  behalf.is_from_user && behalf.metadata.sent_on_behalf_of === 'pat@acme.test');
gate('B5 a delegate sending AS the user → authored, delegate recorded',
  authorshipStamp(outlook('sam@acme.test', 'ari@acme.test'), OWN).metadata.sent_by_delegate === 'ari@acme.test');
gate('B6 Gmail Sender header: on-behalf authored · a relayed invite with an owned Sender is not',
  authorshipOf(gmail({ From: 'pat@acme.test', Sender: 'sam@acme.test' }), OWN).basis === 'on_behalf'
  && authorshipOf(gmail({ From: 'jordan@globex.test', Sender: 'sam@acme.test' }, true), OWN).basis === 'relayed_calendar');
gate('B7 a send-as alias is owned only when the PROVIDER reports it',
  !isAuthoredByUser(gmail({ From: 'sales@acme.test' }), OWN)
  && isAuthoredByUser(gmail({ From: 'sales@acme.test' }), ownAddressesOf({ profileEmail: 'sam@acme.test', sendAs: ownedFromGmailSendAs([{ sendAsEmail: 'sales@acme.test', verificationStatus: 'accepted' }]) }))
  && !ownedFromGmailSendAs([{ sendAsEmail: 'x@acme.test', verificationStatus: 'pending' }]).length
  && smtpFromProxyAddresses(['SMTP:a@acme.test', 'smtp:b@acme.test', 'X500:/o']).join() === 'a@acme.test,b@acme.test');
gate('B8 no from / no owned set → nothing authored',
  !isAuthoredByUser({ from_address: '' }, OWN) && !isAuthoredByUser({ from_address: 'sam@acme.test' }, []));

// ═══ C · THE REPAIR PLAN ═══
console.log('C · the repair plan:');
const rows = [
  { id: 'own', from_address: 'sam@acme.test', connection_id: 'c1', received_at: '2026-09-01T10:00:00Z' },
  { id: 'fwd', from_address: 'jordan@globex.test', from_name: 'Jordan', connection_id: 'c1', thread_id: 't1', received_at: '2026-09-02T10:00:00Z' },
  { id: 'old', from_address: 'sam@oldco.test', connection_id: 'gone', received_at: '2026-09-03T10:00:00Z' },
  { id: 'alias', from_address: 'sales@acme.test', from_name: 'Samuel Rivera', connection_id: 'c1', received_at: '2026-09-04T10:00:00Z' },
];
const plan = planAuthorshipRepair(rows, { ownAddresses: OWN, ownNames: ['samuel rivera'], liveConnectionIds: ['c1'] });
gate('C1 only non-authored rows; disconnected mailboxes + likely aliases are held back',
  JSON.stringify(plan.map((m) => [m.id, m.hold])) === JSON.stringify([['fwd', null], ['old', 'orphan_connection'], ['alias', 'possible_alias']]));
gate('C2 an unknown identity flips nothing', planAuthorshipRepair(rows, { ownAddresses: [], ownNames: [], liveConnectionIds: [] }).length === 0);
const flagged = rows.map((r) => ({ id: r.id, thread_id: (r as { thread_id?: string }).thread_id ?? null, received_at: r.received_at }));
const close = { id: 'i', thread_id: 't1', created_at: '2026-09-01T12:00:00Z', resolved_at: '2026-09-02T10:00:30Z', resolved_reason: 'replied' };
gate('C3 a "replied" close is attributed only when every closing candidate is misattributed',
  closeCausedByMisattribution(close, flagged, new Set(['fwd'])).caused
  && !closeCausedByMisattribution(close, [...flagged, { id: 'real', thread_id: 't1', received_at: '2026-09-02T09:00:00Z' }], new Set(['fwd'])).caused);
gate('C4 an "evidence:email" close is attributed by the evidence\'s own time',
  closeCausedByMisattribution({ ...close, thread_id: null, resolved_at: '2026-09-02T10:00:00.000Z', resolved_reason: 'evidence:email' }, flagged, new Set(['fwd'])).caused
  && !closeCausedByMisattribution({ ...close, resolved_reason: 'user_marked' }, flagged, new Set(['fwd'])).caused);

console.log(`\n${failures.length === 0 ? '✅' : '❌'} ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('FAILED:', failures.join(' · ')); process.exit(1); }
