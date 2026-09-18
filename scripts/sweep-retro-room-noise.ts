// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RETRO ROOM-NOISE SWEEP — the backlog half of three laws that only bind NEW writes.
//
// "A law that only binds new writes is half a law" (lib/room/legacy-ask-speech.ts, Sep 8). The three
// laws below each installed a refusal or an archive at a WRITE seam. Every row written before that
// seam existed still stands, in real rooms, saying what the law now forbids. This script applies the
// SAME laws to the standing backlog — by importing their own predicates, never by re-implementing
// them, and never by re-judging anything (zero AI; every verdict read here was already stored).
//
// ── CLASS 1 · RESTATED DEED LINES ───────────────────────────────────────────────────────────────
// When an item RESOLVES, `archiveItemNarrations` (lib/work/apply-verdict.ts) archives the narrations
// keyed to it — `prep:<kind>:<id>`, `revisit:<kind>:<id>`, `verdict-resolve:<kind>:<id>`. A deed
// settled before that seam shipped (or settled through a door that never reached it) left its line
// standing: "Clara drafted the reply on X — it's ready to review", over work that is closed. That is
// the standing lie the narration-follows-its-artifact law exists to stop. This sweep archives the
// SAME key set, for items that are no longer open.
//
// ── CLASS 2 · STALE PREP NARRATIONS ─────────────────────────────────────────────────────────────
//   (a) THE DEAD HORIZON — `anticipate:meeting:<eventId>` / `meeting-prep:<eventId>` turns whose
//       calendar event is more than 24h past (or gone). An anticipation's subject is IMMINENT by
//       construction (lib/home/anticipation.ts); once its meeting is over the line is record, not
//       news. The render layer already folds these (components/home/item-rail.tsx `isAgedAnticipation`)
//       — the ROWS still stand, and every reasoner reading the room still sees them.
//   (b) THE ORPHAN PREP — `prep:*` turns whose artifact is gone: none of the item's prepared lanes
//       (draft · nudge_draft · prepared_invite · prepared_forward) still holds work, and no pool
//       deliverable backs it either. This is `applyVerdictConsequences`'s own `narrationBacked` test,
//       asked WITHOUT a verdict (verdict-independent, so strictly the safer half: if ANY lane still
//       holds an artifact, the line is left alone).
//   (c) THE NOISE-FLOOR PREP — `prep:inbox:*` turns anchored on a row THE NOISE FLOOR
//       (lib/prepare/noise-floor.ts) now refuses to work on. Its own header documents this exact
//       backlog: live `prep:*` narrations anchored on the user's own outbound campaign coming back.
//
// ── CLASS 3 · ECHO DRAFTS ───────────────────────────────────────────────────────────────────────
// Reply drafts stored on `inbox_items.source_data.draft` for rows the echo floor (LAW 5,
// lib/inbox/campaign-echo.ts) now postures as the user's own campaign reflected back. The floor
// means we should never have drafted for them; the draft is stripped, everything else in
// source_data is preserved.
//
// ── WHY IT IS SAFE TO RE-RUN (IDEMPOTENT) ───────────────────────────────────────────────────────
//   • Turns are ARCHIVED, never deleted (`archived_at`), and the candidate query only ever reads
//     `archived_at IS NULL` — a second run finds nothing left to do. Undo for a whole run is one
//     statement against the run's single shared stamp, printed in the output.
//   • Drafts are stripped by a merge-safe update of `source_data`; a row with no draft is not a
//     candidate, so re-running is a no-op.
//   • Nothing is resolved, dismissed, re-postured or re-judged. No AI call is made anywhere.
//
// GUARDED: dry-run by default. --apply writes. --user <email|uuid-prefix> scopes; unscoped needs --all.
//   npx tsx scripts/sweep-retro-room-noise.ts --all
//   npx tsx scripts/sweep-retro-room-noise.ts --user sam@acme.example --apply
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { noiseOf } from '../lib/prepare/noise-floor';
import { getCampaignSignature, type CampaignSignature } from '../lib/inbox/campaign-echo';
import type { DeckItem } from '../lib/home/deck-floors';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const arg = (f: string) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
const USER = arg('--user');

/** ONE stamp for the whole run — so the entire repair reverses with a single statement. */
const RUN_STAMP = new Date().toISOString();

const clip = (s: unknown, n = 60) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ── THE KEY GRAMMAR ─────────────────────────────────────────────────────────────────────────────
// Every narration key this sweep understands, parsed structurally. Two spellings of the prep key
// exist in the tree and BOTH are honoured here:
//   • the WRITER (lib/prepare/pass.ts) keys on the work-spine id — `prep:inbox:<id>` / `prep:commit:<id>`
//   • the ARCHIVER (lib/work/apply-verdict.ts) keys on the judge-input kind — `prep:inbox:<id>` /
//     `prep:commitment:<id>`
// They agree on inbox rows and disagree on commitments, so a commitment's prep narration has never
// been archivable by the live seam. That mismatch is exactly the kind of row this sweep is for.
type ItemKind = 'inbox' | 'commitment';
type ParsedKey =
  | { cls: 'item'; prefix: 'prep' | 'revisit' | 'verdict-resolve'; kind: ItemKind; id: string }
  | { cls: 'event'; prefix: 'anticipate:meeting' | 'meeting-prep'; id: string };

function parseKey(dk: string | null | undefined): ParsedKey | null {
  const k = String(dk ?? '');
  if (!k) return null;
  let m = k.match(/^(prep|revisit|verdict-resolve):(inbox|commit|commitment):([0-9a-f-]{8,})$/i);
  if (m) {
    return {
      cls: 'item',
      prefix: m[1] as 'prep' | 'revisit' | 'verdict-resolve',
      kind: m[2].toLowerCase() === 'inbox' ? 'inbox' : 'commitment',
      id: m[3],
    };
  }
  m = k.match(/^anticipate:meeting:([0-9a-zA-Z_-]{6,})$/);
  if (m) return { cls: 'event', prefix: 'anticipate:meeting', id: m[1] };
  m = k.match(/^meeting-prep:([0-9a-zA-Z_-]{6,})$/);
  if (m) return { cls: 'event', prefix: 'meeting-prep', id: m[1] };
  return null;
}

/** THE NARRATION TEST — the one-narrator law, read structurally off the row. Narration is the chief
 *  of staff's voice: role='system', author ABSENT (a coworker's own speech is their record), and no
 *  component (a card is a deed, not talk). A user turn is never touched, at any door. */
const isNarration = (t: Row): boolean => t.role === 'system' && !t.author && !t.component;

/** THE DEAD HORIZON — a meeting more than this far in the past can no longer be prepared for. */
const EVENT_GRACE_MS = 24 * 60 * 60 * 1000;

type Candidate = { id: string; roomKey: string; dkey: string; subject: string; reason: string };

async function sweepUser(uid: string, label: string): Promise<{ deeds: number; preps: number; drafts: number }> {
  // ── THE ROWS. The oldest lesson in this repo: a full listing pages, or PostgREST silently caps
  // it at 1000 and the tail is invisible. Ordered, so page boundaries hold.
  const turns = await fetchAllRows<Row>((from, to) => sb.from('room_turns')
    .select('id, room_key, role, text, refs, component, author, dedupe_key, created_at')
    .eq('user_id', uid).is('archived_at', null).not('dedupe_key', 'is', null)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to));

  const narrations = turns.filter(isNarration)
    .map((t) => ({ t, k: parseKey(t.dedupe_key) }))
    .filter((x): x is { t: Row; k: ParsedKey } => x.k !== null);

  // ── THE SUBJECTS, batched. One read per table; `.in()` is chunked so no single request can be
  // capped, and nothing is fetched that no turn actually references.
  const inboxIds = [...new Set(narrations.filter((x) => x.k.cls === 'item' && x.k.kind === 'inbox').map((x) => (x.k as any).id))];
  const commitIds = [...new Set(narrations.filter((x) => x.k.cls === 'item' && x.k.kind === 'commitment').map((x) => (x.k as any).id))];
  const eventIds = [...new Set(narrations.filter((x) => x.k.cls === 'event').map((x) => x.k.id))];

  const inbox = new Map<string, Row>();
  for (const part of chunk(inboxIds, 150)) {
    const { data } = await sb.from('inbox_items')
      .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data')
      .eq('user_id', uid).in('id', part);
    for (const r of (data ?? []) as Row[]) inbox.set(String(r.id), r);
  }
  const commits = new Map<string, Row>();
  for (const part of chunk(commitIds, 150)) {
    const { data } = await sb.from('commitments').select('id, description, status').eq('user_id', uid).in('id', part);
    for (const r of (data ?? []) as Row[]) commits.set(String(r.id), r);
  }
  const events = new Map<string, Row>();
  for (const part of chunk(eventIds, 150)) {
    const { data } = await sb.from('calendar_events').select('id, title, start_time, status').eq('user_id', uid).in('id', part);
    for (const r of (data ?? []) as Row[]) events.set(String(r.id), r);
  }
  // The pool half of the artifact test — a prep narration may also be backed by a deliverable row.
  const pooled = new Set<string>();
  for (const part of chunk([...inboxIds, ...commitIds], 150)) {
    const { data } = await sb.from('item_deliverables').select('entity_id').eq('user_id', uid).in('entity_id', part);
    for (const r of (data ?? []) as Row[]) pooled.add(String(r.entity_id));
  }

  // THE SIGNATURE — day-cached, deterministic, zero-AI (lib/inbox/campaign-echo). Read, never forced:
  // a stored signature is the verdict this account already carries.
  let sig: CampaignSignature | null = null;
  try { sig = await getCampaignSignature(sb, uid); } catch { /* inert, never fabricated */ }

  // Is this inbox row one the noise floor now refuses to work on (echo / no-move notice)?
  const noiseFor = (it: Row | undefined) => (it ? noiseOf(it as DeckItem, sig) : null);

  // ── CLASS 1 · RESTATED DEED LINES ─────────────────────────────────────────────────────────────
  const deeds: Candidate[] = [];
  const claimed = new Set<string>(); // a turn belongs to exactly one class — class 1 wins
  for (const { t, k } of narrations) {
    if (k.cls !== 'item') continue;
    const subj = k.kind === 'inbox'
      ? clip(inbox.get(k.id)?.work_title ?? (inbox.get(k.id)?.source_data ?? {}).subject)
      : clip(commits.get(k.id)?.description);
    let settled: string | null = null;
    if (k.kind === 'inbox') {
      const it = inbox.get(k.id);
      if (!it) settled = 'its inbox item no longer exists';
      else if (String(it.status ?? '') !== 'pending') settled = `its item is ${it.status} — the deed is settled`;
    } else {
      const c = commits.get(k.id);
      if (!c) settled = 'its commitment no longer exists';
      else if (String(c.status ?? '') !== 'open') settled = `its commitment is ${c.status} — the deed is settled`;
    }
    if (!settled) continue;
    claimed.add(String(t.id));
    deeds.push({ id: String(t.id), roomKey: String(t.room_key), dkey: String(t.dedupe_key), subject: subj || clip(t.text), reason: settled });
  }

  // ── CLASS 2 · STALE PREP NARRATIONS ───────────────────────────────────────────────────────────
  const preps: Candidate[] = [];
  const now = Date.now();
  for (const { t, k } of narrations) {
    if (claimed.has(String(t.id))) continue;

    // (a) THE DEAD HORIZON — the meeting this line prepared for is over.
    if (k.cls === 'event') {
      const ev = events.get(k.id);
      let why: string | null = null;
      if (!ev) why = 'its calendar event no longer exists';
      else {
        const start = Date.parse(String(ev.start_time ?? ''));
        if (!Number.isFinite(start)) why = 'its calendar event carries no readable start time';
        else if (now - start > EVENT_GRACE_MS) why = `its meeting ended ${Math.floor((now - start) / 86_400_000)}d ago`;
      }
      if (!why) continue;
      claimed.add(String(t.id));
      preps.push({ id: String(t.id), roomKey: String(t.room_key), dkey: String(t.dedupe_key), subject: clip(ev?.title ?? t.text), reason: why });
      continue;
    }

    // (b)+(c) apply to prep lines only — a revisit/verdict-resolve line on a still-open item is
    // current by construction and is left exactly where it is.
    if (k.prefix !== 'prep') continue;

    if (k.kind === 'inbox') {
      const it = inbox.get(k.id);
      if (!it) continue; // a missing row was already class 1
      const sd = (it.source_data ?? {}) as Row;
      // (c) THE NOISE-FLOOR PREP — asked first, because it is the stronger statement: this row
      // should never have been worked on at all.
      const n = noiseFor(it);
      if (n?.noise) {
        claimed.add(String(t.id));
        preps.push({
          id: String(t.id), roomKey: String(t.room_key), dkey: String(t.dedupe_key),
          subject: clip(it.work_title ?? sd.subject),
          reason: `the noise floor now refuses this row (${n.via}) — ${n.reason}`,
        });
        continue;
      }
      // (b) THE ORPHAN PREP — `narrationBacked`, asked across ALL lanes at once (verdict-free).
      const backed = !!(sd.draft?.body) || !!(sd.nudge_draft?.body) || !!sd.prepared_invite
        || !!sd.prepared_forward || pooled.has(k.id);
      if (backed) continue;
      claimed.add(String(t.id));
      preps.push({
        id: String(t.id), roomKey: String(t.room_key), dkey: String(t.dedupe_key),
        subject: clip(it.work_title ?? sd.subject),
        reason: 'its artifact is gone — no draft, nudge, invite, forward or pool row backs it',
      });
      continue;
    }

    // A commitment's prep narration lives on a pool row; no pool row is the whole test.
    const c = commits.get(k.id);
    if (!c || pooled.has(k.id)) continue;
    claimed.add(String(t.id));
    preps.push({
      id: String(t.id), roomKey: String(t.room_key), dkey: String(t.dedupe_key),
      subject: clip(c.description), reason: 'its artifact is gone — no pool deliverable backs it',
    });
  }

  // ── CLASS 3 · ECHO DRAFTS ─────────────────────────────────────────────────────────────────────
  // Only rows the echo floor itself calls an echo. The notice half of the noise floor is deliberately
  // NOT spent here: it is a "nothing is owed" refusal, not "this was never ours to answer", and the
  // task this sweep serves is the echo class.
  const items = await fetchAllRows<Row>((from, to) => sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data')
    .eq('user_id', uid).eq('status', 'pending')
    .order('created_at', { ascending: true }).range(from, to));
  const echoDrafts: Array<{ id: string; subject: string; head: string; marker: string }> = [];
  for (const it of items) {
    const sd = (it.source_data ?? {}) as Row;
    if (!sd.draft?.body) continue;
    const n = noiseOf(it as DeckItem, sig);
    if (!n.noise || n.via !== 'echo') continue;
    echoDrafts.push({
      id: String(it.id),
      subject: clip(it.work_title ?? sd.subject),
      head: clip(sd.draft.body, 40),
      marker: String(n.reason ?? 'campaign echo'),
    });
  }

  // ── REPORT ────────────────────────────────────────────────────────────────────────────────────
  console.log(`\n══ ${label}`);
  console.log(`   ${turns.length} live keyed turn(s) · ${narrations.length} engine narration(s) with a known key · ${items.length} pending item(s)`);
  console.log(`   campaign signature: ${sig && (sig.tokens.length || sig.templates.length)
    ? `${sig.tokens.length} token(s) · ${sig.templates.length} template(s) (from ${sig.sentRead} sent rows)`
    : '(none — the echo floor is inert for this account)'}`);

  console.log(`\n   1 · RESTATED DEED LINES — ${deeds.length}`);
  for (const c of deeds) console.log(`     · ${c.id.slice(0, 8)} [${c.dkey}] "${c.subject}" — ${c.reason}`);

  console.log(`\n   2 · STALE PREP NARRATIONS — ${preps.length}`);
  for (const c of preps) console.log(`     · ${c.id.slice(0, 8)} [${c.dkey}] "${c.subject}" — ${c.reason}`);

  console.log(`\n   3 · ECHO DRAFTS — ${echoDrafts.length}`);
  for (const d of echoDrafts) console.log(`     · ${d.id.slice(0, 8)} "${d.subject}" — draft began "${d.head}" · ${d.marker}`);

  // ── APPLY ─────────────────────────────────────────────────────────────────────────────────────
  if (APPLY) {
    const turnIds = [...deeds, ...preps].map((c) => c.id);
    for (const part of chunk(turnIds, 100)) {
      // ARCHIVE, NEVER DELETE. One shared stamp for the whole run = one statement to undo it.
      const { error } = await sb.from('room_turns').update({ archived_at: RUN_STAMP })
        .eq('user_id', uid).in('id', part).is('archived_at', null);
      if (error) console.error(`     ! archive failed for ${part.length} turn(s): ${error.message}`);
    }
    for (const d of echoDrafts) {
      // MERGE-SAFE: read the row's current source_data, drop the one key, write the rest back.
      const { data: live } = await sb.from('inbox_items').select('source_data')
        .eq('id', d.id).eq('user_id', uid).maybeSingle();
      const sd = { ...((live?.source_data ?? {}) as Row) };
      if (!sd.draft) continue;
      delete sd.draft;
      // The attribution stamp belongs to the artifacts; with none left it is a claim about nothing
      // (apply-verdict's own rule, mirrored).
      if (!sd.nudge_draft?.body && !sd.prepared_invite && !sd.prepared_forward) delete sd.prepared_by;
      const { error } = await sb.from('inbox_items').update({ source_data: sd }).eq('id', d.id).eq('user_id', uid);
      if (error) console.error(`     ! draft strip failed for ${d.id.slice(0, 8)}: ${error.message}`);
    }
  }

  console.log(`\n   ${APPLY ? 'APPLIED' : 'DRY RUN'} — deeds ${deeds.length} · preps ${preps.length} · drafts ${echoDrafts.length}`);
  return { deeds: deeds.length, preps: preps.length, drafts: echoDrafts.length };
}

(async () => {
  const { data: listed, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error || !listed) { console.error('could not list users:', error?.message); process.exit(1); }
  let targets = listed.users;
  if (!ALL) {
    if (!USER) { console.error('Refusing to run unscoped. Pass --user <email|uuid-prefix> or --all.'); process.exit(1); }
    targets = targets.filter((u) => u.email === USER || u.id.startsWith(USER));
    if (!targets.length) { console.error(`No user matched "${USER}".`); process.exit(1); }
  }

  console.log(`\nTHE RETRO ROOM-NOISE SWEEP — ${APPLY ? 'APPLY' : 'DRY RUN'} · ${targets.length} account(s)`);
  if (APPLY) console.log(`Undo this run:  update room_turns set archived_at = null where archived_at = '${RUN_STAMP}';`);

  const total = { deeds: 0, preps: 0, drafts: 0 };
  for (const u of targets) {
    try {
      const r = await sweepUser(u.id, `${u.email ?? u.id} (${u.id.slice(0, 8)})`);
      total.deeds += r.deeds; total.preps += r.preps; total.drafts += r.drafts;
    } catch (e) {
      console.error(`  ! ${u.id.slice(0, 8)}: ${(e as Error)?.message ?? e}`);
    }
  }

  console.log(`\n────────────────────────────────────────────────────────────────`);
  console.log(`TOTAL — restated deed lines ${total.deeds} · stale prep narrations ${total.preps} · echo drafts ${total.drafts}`);
  console.log(APPLY
    ? `✅ applied · undo: update room_turns set archived_at = null where archived_at = '${RUN_STAMP}';`
    : 'ℹ️  dry run — nothing written. Re-run with --apply.');
})();
