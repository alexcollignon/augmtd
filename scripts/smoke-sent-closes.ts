// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W9.2 WHAT YOU SEND ANYWHERE CLOSES WITHIN SECONDS (docs/laws-registry.md `sent-closes`;
// serves invariant 7 EVIDENCE SETTLES + 9 EXACTLY-ONCE DEEDS). ZERO AI, ZERO network, no data.
//
//   P · THE PUSH SHAPE — the Gmail watch covers INBOX + SENT (INCLUDE), the Outlook side adds a Sent
//       Items subscription, both stamp the versioned shape; the renew cron re-registers stale shapes
//       (paged, budgeted, left-behind reported); the Outlook door finds a Sent-subscription connection;
//       the Gmail door drops drafts/spam/trash; the rollout script is dry-run by default.
//   H · THE ONE HANDLER (outcome, in-memory Supabase double applying the real filters) — due gating;
//       two concurrent storing paths → each step runs EXACTLY ONCE; a re-run is a no-op; a failed
//       step leaves a lease that blocks a concurrent claim and is retried once stale; a replacing
//       metadata write carries the marker.
//   R · EVERY STORING PATH ROUTES — every emails write in the sync hands its user-authored rows to the
//       handler (Phase-1 insert · recovery · raced · backfill · Sent pass); one handler call, after
//       Phase 4; the sync holds no second resolve/extract/settle for the user's mail; both push doors
//       run the same sync.
//   V · NO BARE VOID ON A SYNC PATH — no `void <expr>` in the sync, the handler, the push doors or the
//       watch files; the tail drains in a finally (outcome: waits; a spent budget is REPORTED).
//   C · THE CALENDAR PUSH INCLUDES TODAY — both doors use PUSH_CALENDAR_WINDOW (daysBehind ≥ 1).
//   X · THE INBOUND EXTRACTION ENTRY (W9.4 upstream) — every triage class reaches the entry (its gate
//       decides delta vs extraction), launched after Phase 2 in the drained tail; no keyword wording.
// Fixtures: fake identities only.   Run: npx tsx scripts/smoke-sent-closes.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GMAIL_WATCH_LABEL_IDS, GMAIL_WATCH_FILTER_BEHAVIOR, OUTLOOK_INBOX_RESOURCE, OUTLOOK_SENT_RESOURCE,
  PUSH_WATCH_SHAPE, PUSH_CALENDAR_WINDOW, gmailPushKeeps, pushShapeStale,
} from '../lib/email-sync/push-shape';
import {
  authoredDeedDue, landUserAuthoredMessages, carryDeedMarkers, createSyncTail, DEED_LEASE_MS,
  type AuthoredDeedSteps, type LandedRow,
} from '../lib/email-sync/authored-landed';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
/** Code only — block + line comments stripped (a comment never satisfies or trips a gate). */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\s\/\/[^\n'"`]*$/gm, '');

// ── an in-memory Supabase double for `emails` (select · update · eq · is · maybeSingle · select-after-
// update). Every awaited query yields first, so two claimants interleave exactly like two requests. ──
type Row = Record<string, any>;
function fakeClient(rows: Row[]): SupabaseClient {
  const val = (r: Row, col: string) => {
    const m = col.match(/^(\w+)->>(\w+)$/);
    if (m) { const v = r[m[1]]?.[m[2]]; return v == null ? null : String(v); }
    return r[col] ?? null;
  };
  const from = (_table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null; let returning = false; let single = false;
    const b: any = {
      select() { if (patch) returning = true; return b; },
      update(p: Row) { patch = p; return b; },
      eq(c: string, v: unknown) { filters.push((r) => val(r, c) === (v == null ? null : String(v))); return b; },
      is(c: string, v: null) { filters.push((r) => val(r, c) === v); return b; },
      maybeSingle() { single = true; return b; },
      then(res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return new Promise((r) => setImmediate(r)).then(() => {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (patch) {
            for (const r of hit) Object.assign(r, JSON.parse(JSON.stringify(patch)));
            return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
          }
          const out = hit.map((r) => JSON.parse(JSON.stringify(r)));
          return { data: single ? (out[0] ?? null) : out, error: null };
        }).then(res, rej);
      },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}
const counting = (fails?: { resolve?: number }) => {
  const n = { resolve: 0, door: 0, extract: 0 };
  let failLeft = fails?.resolve ?? 0;
  const steps: AuthoredDeedSteps = {
    resolve: async () => { n.resolve++; if (failLeft > 0) { failLeft--; throw new Error('simulated'); } },
    door: async () => { n.door++; },
    extract: async () => { n.extract++; },
  };
  return { n, steps };
};
const recent = new Date(Date.now() - 5 * 60_000).toISOString();
const sentRow = (over: Row = {}): Row => ({ id: 'e-sent', user_id: 'u1', is_from_user: true, received_at: recent, thread_id: 't1', subject: 'Re: the proposal', body: 'Attached, as promised.', to_addresses: ['jo@acme.test'], metadata: { filed_in_sent: true }, ...over });

async function main() {
  // ═══ P · THE PUSH SHAPE ═══
  console.log('P · THE PUSH SHAPE');
  const watch = code('lib/google/gmail-watch.ts');
  const outSub = code('lib/microsoft/outlook-subscriptions.ts');
  const renew = code('app/api/cron/renew-push-subscriptions/route.ts');
  const gPush = code('app/api/webhooks/gmail/push/route.ts');
  const oPush = code('app/api/webhooks/outlook/push/route.ts');
  ok('P1 the Gmail watch shape lists INBOX AND SENT with INCLUDE (notify on a change to ANY listed label)',
    GMAIL_WATCH_LABEL_IDS.includes('INBOX') && GMAIL_WATCH_LABEL_IDS.includes('SENT') && GMAIL_WATCH_FILTER_BEHAVIOR === 'INCLUDE');
  ok('P2 register AND renew watch with the shape (no INBOX-only literal left) and stamp it',
    (watch.match(/labelIds: \[\.\.\.GMAIL_WATCH_LABEL_IDS\],\s*labelFilterBehavior: GMAIL_WATCH_FILTER_BEHAVIOR/g) ?? []).length === 2
    && !/labelIds:\s*\['INBOX'\]/.test(watch) && (watch.match(/push_watch_shape: PUSH_WATCH_SHAPE/g) ?? []).length === 2);
  ok('P3 Outlook: an inbox AND a Sent Items subscription; register + renew both ensure the Sent one and stamp the shape',
    OUTLOOK_INBOX_RESOURCE === 'me/mailFolders/inbox/messages' && /SentItems/.test(OUTLOOK_SENT_RESOURCE)
    && /createSubscription\(client, OUTLOOK_INBOX_RESOURCE/.test(outSub) && /createSubscription\(client, OUTLOOK_SENT_RESOURCE/.test(outSub)
    && (outSub.match(/await ensureSentSubscription\(connection, client, adminSupabase, expirationDateTime\)/g) ?? []).length === 2
    && (outSub.match(/push_watch_shape: PUSH_WATCH_SHAPE/g) ?? []).length === 2 && /push_sent_subscription_id: sub\.id/.test(outSub)
    && /\.patch\(\{ expirationDateTime \}\)/.test(outSub));
  ok('P4 outcome: pushShapeStale — an unstamped / old-stamped connection is stale, the current stamp is not',
    pushShapeStale({ metadata: {} }) && pushShapeStale({ metadata: { push_watch_shape: 'inbox@old' } }) && pushShapeStale({ metadata: null })
    && !pushShapeStale({ metadata: { push_watch_shape: PUSH_WATCH_SHAPE } }));
  ok('P5 the renew cron re-registers stale shapes: full listing through fetchAllRows (ordered), a per-run budget, left-behind REPORTED',
    /fetchAllRows<any>\(/.test(renew) && /\.order\('id', \{ ascending: true \}\)/.test(renew) && /pushShapeStale\(c\)/.test(renew)
    && /shapeQueued >= SHAPE_MIGRATION_PER_RUN/.test(renew) && /shapeMigration: \{ queued: shapeQueued, leftBehind: shapeLeftBehind \}/.test(renew));
  ok('P6 the Outlook door finds the connection by EITHER subscription (inbox column · metadata Sent id)',
    /\.eq\('push_subscription_id', subscriptionId\)/.test(oPush) && /\.eq\('metadata->>push_sent_subscription_id', subscriptionId\)/.test(oPush));
  ok('P7 outcome: the Gmail door keeps arrivals + sends, drops drafts / spam / trash (and the door applies it)',
    gmailPushKeeps(['INBOX', 'UNREAD']) && gmailPushKeeps(['SENT']) && gmailPushKeeps(['CATEGORY_UPDATES']) && gmailPushKeeps(null)
    && !gmailPushKeeps(['DRAFT']) && !gmailPushKeeps(['SPAM']) && !gmailPushKeeps(['TRASH']) && /\.filter\(\(m\) => gmailPushKeeps\(m\?\.labelIds\)\)/.test(gPush));
  const rw = code('scripts/rewatch-sent.ts');
  ok('P8 scripts/rewatch-sent.ts is dry-run by default: --apply needs --yes; provider writes only after the DRY RUN return',
    /if \(APPLY && !YES\)/.test(rw) && rw.indexOf("if (!APPLY) {") > 0 && rw.indexOf('renewGmailWatch(c, sb)') > rw.indexOf('if (!APPLY) {')
    && rw.indexOf('renewOutlookSubscription(c, sb)') > rw.indexOf('if (!APPLY) {') && /fetchAllRows<any>\(/.test(rw));

  // ═══ H · THE ONE HANDLER (outcome) ═══
  console.log('\nH · THE ONE HANDLER — exactly once, whichever path stored it');
  const ctx = { todoAuto: true, instructions: '' };
  ok('H1 due gating reads the ONE authorship stamp + recency + the marker (never a folder)',
    authoredDeedDue(sentRow() as LandedRow) === 'due'
    && authoredDeedDue(sentRow({ is_from_user: false, metadata: { filed_in_sent: true } }) as LandedRow) === 'not_authored'
    && authoredDeedDue(sentRow({ received_at: new Date(Date.now() - 30 * 86_400_000).toISOString() }) as LandedRow) === 'stale'
    && authoredDeedDue(sentRow({ metadata: { deed_processed_at: recent } }) as LandedRow) === 'done');
  {
    const rows = [sentRow()];
    const client = fakeClient(rows);
    const { n, steps } = counting();
    // Two storing paths hand the SAME message concurrently (e.g. the Sent pass and a push delivery).
    const [a, b] = await Promise.all([
      landUserAuthoredMessages(client, 'u1', [sentRow() as LandedRow], ctx, steps),
      landUserAuthoredMessages(client, 'u1', [sentRow() as LandedRow], ctx, steps),
    ]);
    ok('H2 two concurrent paths → resolve · door · extract each ran EXACTLY ONCE (one claim won, one lost)',
      n.resolve === 1 && n.door === 1 && n.extract === 1 && a.processed + b.processed === 1 && a.claimedElsewhere + b.claimedElsewhere === 1,
      JSON.stringify({ n, a, b }));
    ok('H3 the marker is stamped (deed_processed_at) and records the steps', !!rows[0].metadata.deed_processed_at && rows[0].metadata.deed_steps?.extract === 'ok' && rows[0].metadata.filed_in_sent === true);
    // A later pass (a push that finds the row already stored) hands the STORED row — a no-op.
    const again = await landUserAuthoredMessages(client, 'u1', [JSON.parse(JSON.stringify(rows[0]))], ctx, steps);
    const againStale = await landUserAuthoredMessages(client, 'u1', [sentRow() as LandedRow], ctx, steps); // a caller holding a pre-marker copy
    ok('H4 a re-run is a no-op — by the carried marker (pre-check) AND by the claim (a stale in-memory copy)',
      again.skipped === 1 && againStale.claimedElsewhere === 1 && n.resolve === 1 && n.extract === 1);
  }
  {
    const rows = [sentRow({ id: 'e-fail' })];
    const client = fakeClient(rows);
    const { n, steps } = counting({ resolve: 1 });
    const first = await landUserAuthoredMessages(client, 'u1', [sentRow({ id: 'e-fail' }) as LandedRow], ctx, steps);
    const held = await landUserAuthoredMessages(client, 'u1', [sentRow({ id: 'e-fail' }) as LandedRow], ctx, steps);
    ok('H5 a step that THREW → not processed; its live lease blocks a concurrent claim (no double run)',
      first.failed === 1 && !rows[0].metadata.deed_processed_at && !!rows[0].metadata.deed_claimed_at && held.claimedElsewhere === 1 && n.resolve === 1);
    rows[0].metadata.deed_claimed_at = new Date(Date.now() - DEED_LEASE_MS - 60_000).toISOString(); // the lease expires
    const retry = await landUserAuthoredMessages(client, 'u1', [sentRow({ id: 'e-fail' }) as LandedRow], ctx, steps);
    ok('H6 once the lease is stale the next storing pass retries and completes (the marker is the durable schedule)',
      retry.processed === 1 && !!rows[0].metadata.deed_processed_at && n.resolve === 2 && n.extract === 2);
  }
  ok('H7 a replacing metadata write carries the marker (carryDeedMarkers) — and nothing else',
    JSON.stringify(carryDeedMarkers({ deed_processed_at: 'x', deed_claimed_at: 'y', attachments: [1] })) === JSON.stringify({ deed_claimed_at: 'y', deed_processed_at: 'x' })
    && JSON.stringify(carryDeedMarkers(null)) === '{}');

  // ═══ R · EVERY STORING PATH ROUTES ═══
  console.log('\nR · EVERY STORING PATH ROUTES USER-AUTHORED ROWS THROUGH THE HANDLER');
  const sync = code('lib/email-sync/sync-emails.ts');
  const writes = [...sync.matchAll(/\.from\('emails'\)\s*\.(insert|upsert)\(/g)];
  const routed = writes.map((m) => {
    const tail = sync.slice(m.index!, m.index! + 1400);
    return /noteAuthored\(/.test(tail) || /inserted = \(insertedRows/.test(tail) || /racedEmail/.test(tail);
  });
  ok('R1 every emails insert/upsert in the sync (main insert · backfill · Sent pass) routes its rows to noteAuthored',
    writes.length === 3 && routed.every(Boolean), `${writes.length} write(s), routed ${routed.join(',')}`);
  ok('R2 the backfill RETURNS what it inserted and the caller routes it; the Sent pass selects its rows back and routes them',
    /noteAuthored\(await backfillThreadHistory\(\{/.test(sync) && /\}\): Promise<LandedRow\[\]> \{/.test(sync)
    && /\.upsert\(sentRows, \{ onConflict: 'user_id,message_id', ignoreDuplicates: false \}\)\s*\.select\(LANDED_ROW_COLUMNS\)/.test(sync)
    && /noteAuthored\(\(sentStored \?\? \[\]\)/.test(sync));
  ok('R3 rows stored FIRST elsewhere still route: the existing-email branch, the raced branch, the Phase-1 insert',
    /if \(existingEmail\) \{\s*noteAuthored\(\[existingEmail\]\);/.test(sync) && /noteAuthored\(\[racedEmail\]\)/.test(sync) && /noteAuthored\(\[storedEmail\]\)/.test(sync));
  ok('R4 noteAuthored keeps ONLY the stamp\'s user-authored rows (is_from_user === true — never a folder)',
    /if \(r\?\.id && r\.is_from_user === true\) _authored\.set\(r\.id, r\)/.test(sync));
  const iHandler = sync.indexOf('landUserAuthoredMessages(adminSupabase');
  ok('R5 ONE handler call, AWAITED, after the Sent pass (Phase 4) and before the sync marks itself completed',
    (sync.match(/landUserAuthoredMessages\(/g) ?? []).length === 1 && /await landUserAuthoredMessages\(adminSupabase/.test(sync)
    && sync.indexOf('fetchGmailSentEmails(') > 0 && iHandler > sync.indexOf('[SentSync] Upsert error:') && iHandler < sync.indexOf("sync_status: 'completed'"));
  ok('R6 the sync holds no second path for the user\'s deed (no resolveThreadOnReply, no settleForEvent, no isFromUser:true extraction)',
    !/resolveThreadOnReply\(/.test(sync) && !/settleForEvent\(/.test(sync) && !/isFromUser: true/.test(sync));
  ok('R7 Phase 4 carries the marker into its replacing upsert (a processed deed is never re-run by a re-sync)',
    /metadata: \{ \.\.\.authorship\.metadata, \.\.\.carryDeedMarkers\(_existingMeta\.get\(m\.message_id\)\) \}/.test(sync));
  ok('R8 both push doors store through the same sync (so they reach the same handler)',
    /await syncEmailsForConnection\(connection, adminSupabase, \{\s*preloadedMessages: fetchedMessages/.test(gPush)
    && /await syncEmailsForConnection\(connection, adminSupabase, \{\s*preloadedMessages: \[message\]/.test(oPush));
  const landed = code('lib/email-sync/authored-landed.ts');
  ok('R9 the handler runs resolve → door → extract in that order, each awaited; the claim is a conditional UPDATE (CAS on the observed claim)',
    /for \(const name of \['resolve', 'door', 'extract'\] as const\)/.test(landed) && /await steps\[name\]\(client, userId, row\)/.test(landed)
    && /\.is\('metadata->>deed_processed_at', null\)/.test(landed) && /q\.eq\('metadata->>deed_claimed_at', observed\) : q\.is\('metadata->>deed_claimed_at', null\)/.test(landed)
    && /if \(claimErr \|\| !won\?\.length\) return null;/.test(landed));

  // ═══ V · NO BARE VOID ON A SYNC PATH ═══
  console.log('\nV · NO BARE `void` SIDE EFFECT ON A SYNC / PUSH PATH');
  const FILES = ['lib/email-sync/sync-emails.ts', 'lib/email-sync/authored-landed.ts', 'lib/email-sync/push-shape.ts',
    'app/api/webhooks/gmail/push/route.ts', 'app/api/webhooks/outlook/push/route.ts', 'lib/google/gmail-watch.ts',
    'lib/microsoft/outlook-subscriptions.ts', 'app/api/cron/renew-push-subscriptions/route.ts', 'lib/inbox/resolve-on-reply.ts'];
  const bare = FILES.filter((f) => /\bvoid [A-Za-z_(]/.test(code(f)));
  ok('V1 no `void <expr>` in the sync, the handler, the push doors, the watch files or resolve-on-reply', bare.length === 0, bare.join(', '));
  ok('V2 the converted sites ride the drained tail (learning · inbound door · inbound extraction · both label write-backs · first-look fallback)',
    ["_tail.add('learning', analyzeSentEmail(", "_tail.add('evidence-door', openMailEvidenceDoor(", "_tail.add('extract-inbound', import('@/lib/commitments/extract')",
      "_tail.add('label-fast', import('@/lib/inbox/rules/write-back')", "_tail.add('label-process', import('@/lib/inbox/rules/write-back')",
      "_tail.add('first-look', fire())"].every((s) => sync.includes(s)));
  ok('V3 no floating analyzeSentEmail(...).catch — every call sits inside the tail',
    !/^\s*analyzeSentEmail\(/m.test(sync));
  ok('V4 the tail is drained in the sync\'s finally, and a spent budget is REPORTED in the result (no silent cap)',
    /\} finally \{[\s\S]{0,400}await _tail\.drain\(\)/.test(sync) && /result\.errors\.push\(`tail: \$\{_drain\.leftRunning\}/.test(sync));
  {
    const tail = createSyncTail('smoke');
    let done = 0;
    tail.add('slow', new Promise((r) => setTimeout(() => { done++; r(null); }, 30)));
    tail.add('boom', Promise.reject(new Error('non-fatal')));
    const d = await tail.drain(2_000);
    const tail2 = createSyncTail('smoke');
    tail2.add('stuck', new Promise(() => {}));
    const d2 = await tail2.drain(20);
    ok('V5 outcome: the drain WAITS for its effects (a rejection is non-fatal); a spent budget returns leftRunning > 0',
      done === 1 && d.drained && d.leftRunning === 0 && !d2.drained && d2.leftRunning === 1);
  }

  // ═══ C · THE CALENDAR PUSH INCLUDES TODAY ═══
  console.log('\nC · THE CALENDAR PUSH INCLUDES TODAY');
  ok('C1 both push doors refresh the calendar through PUSH_CALENDAR_WINDOW; no daysBehind: 0 left (0 is falsy → an accidental week)',
    PUSH_CALENDAR_WINDOW.daysBehind >= 1 && /syncCalendarForConnection\(connection, adminSupabase, \{ \.\.\.PUSH_CALENDAR_WINDOW \}\)/.test(gPush)
    && /syncCalendarForConnection\(connection, adminSupabase, \{ \.\.\.PUSH_CALENDAR_WINDOW \}\)/.test(oPush)
    && !/daysBehind:\s*0\b/.test(gPush + oPush));

  // ═══ X · THE EXTRACTION ENTRY (W9.2 × W9.4 upstream) ═══
  console.log('\nX · THE INBOUND EXTRACTION ENTRY — every class, after Phase 2, the gate decides');
  ok('X1 every triage class is queued for the entry — no `emailClass === \'process\'` guard at the call site (extractionGate decides delta vs new extraction)',
    /_inboundExtract\.push\(\{ storedEmail, recipientRole: _recipientRole, emailClass \}\)/.test(sync) /* W9.4 follow-up: the class rides to the gate as `triage` */ && !/emailClass === 'process' && emailSettings\.todo_auto/.test(sync)
    && (sync.match(/extractEmailCommitments\(/g) ?? []).length === 1);
  const iLoopEnd = sync.indexOf("'[Sync] Batch email processing error:'"); // the last statement of the Phase 2 loop
  ok('X2 the entry launches AFTER Phase 2 (the understanding Phase 2 stamps is what the gate reads), inside the drained tail',
    iLoopEnd > 0 && sync.indexOf("_tail.add('extract-inbound'") > iLoopEnd && sync.indexOf("_tail.add('extract-inbound'") < sync.indexOf("import('@/lib/contacts/extract-contacts')"));
  ok('X3 no stale "keyword-gated" wording left in the sync (W9.4: extraction is reasoned, not keyword-gated)', !/keyword-gated/i.test(src('lib/email-sync/sync-emails.ts')));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
