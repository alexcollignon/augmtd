// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE USER'S HAND WINS + DRAFTS CHANGE ONLY WHEN THE GROUND MOVES (stabilization W9.1 —
// docs/stabilization-plan.md PART VI; docs/laws-registry.md `the-users-hand-wins`, `ground-law`).
//
// Two findings, one module (Sep 23 read-only audit):
//   1 · THE CLOCK REGENERATED. Every prepare lane carried `FRESH_HOURS = 24`: a reply draft, a
//       nudge, an invite, a forward, a paste pack older than a day was re-generated — at the
//       conversation tier, plus the evaluator — EVEN WHEN NOTHING HAD CHANGED. A clock is not a
//       ground. Here the regeneration decision is a PURE function of the ground's signals and has
//       no clock parameter at all: an artifact is re-prepared only when its ground moved (a newer
//       inbound than `prepared_from`, thread activity past it, supply that landed after it), when
//       it was written under an older drafting law, or when THE ONE READER withdrew it as untrue.
//   2 · NOTHING PROTECTED THE USER'S WORDS. An artifact the user edited carried no mark, so the
//       next ground move (or the clock) replaced it with machine words. Now every edit door stamps
//       `edited_by_user_at` + `hand_hash` (a hash of the CANONICAL content the user saved). A
//       stamp only counts while the stored content still hashes to it — a writer that spreads the
//       old fields over NEW machine words (the steer lane does `{...sd.draft, body}`) leaves a stamp
//       that no longer matches, and the artifact is machine words again. Hand-held artifacts are
//       NEVER overwritten by the engine: when their ground moves the engine MARKS them
//       (`staleUnderEdit`, derived at read — "the thread moved since you edited this") and the user
//       picks a fresh version (the card's redraft tabs / the steer lane / `?fresh=1`), which files
//       their words into the version chain (`version_of`) first — nothing they wrote is lost.
//
// PURE and client-safe (no IO, no `crypto`, no clock) — the pass, the reader, the edit door, the
// gate and the unit tests all call these same functions.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The artifact kinds an edit door can stamp (THE ONE READER's PreparedKind vocabulary). */
export type HandKind = 'reply_draft' | 'nudge_draft' | 'invite' | 'forward' | 'paste_pack' | 'deliverable';

/** The two stamp fields, named once. On a source_data artifact they sit on the artifact object
 *  (`source_data.draft.edited_by_user_at`); on a pool row they sit on `metadata`. */
export const HAND_AT = 'edited_by_user_at' as const;
export const HAND_HASH = 'hand_hash' as const;

export type HandStamp = { edited_by_user_at: string; hand_hash: string };

const norm = (s: unknown): string => String(s ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const sortedList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean).sort();

/** THE CANONICAL CONTENT of an artifact — what "the words the user saved" means per kind. Text
 *  kinds hash their body; an invite hashes the fields a user can edit; a forward its recipients +
 *  note. Whitespace-folded so a re-serialisation is not an edit. */
export function canonicalOf(kind: HandKind, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === 'invite') {
    return JSON.stringify({
      title: norm(p.title), startISO: String(p.startISO ?? p.start ?? ''), endISO: String(p.endISO ?? ''),
      attendees: sortedList(p.attendees), description: norm(p.description),
    });
  }
  if (kind === 'forward') return JSON.stringify({ to: sortedList(p.to), note: norm(p.note) });
  // Text kinds: a source_data draft keeps its words in `body`, a pool row in `content`.
  if (typeof payload === 'string') return norm(payload);
  return norm(p.body ?? p.content ?? '');
}

/** FNV-1a (32-bit, twice with different offsets) over the canonical content — a content
 *  fingerprint, not a security primitive (collisions only ever cost a missed protection). */
export function handHash(canonical: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
    b ^= c; b = Math.imul(b, 0x5bd1e995) >>> 0; b ^= b >>> 15;
  }
  return `h1:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}:${canonical.length}`;
}

/** The stamp an edit door writes beside the content it saved. `at` is handed in (the caller owns
 *  the clock — this module has none). */
export function handStamp(kind: HandKind, payload: unknown, at: string): HandStamp {
  return { edited_by_user_at: at, hand_hash: handHash(canonicalOf(kind, payload)) };
}

/** Is this stored artifact HELD BY THE USER'S HAND? True only while the stored content still
 *  hashes to the stamp — a stamp riding over machine words that replaced the user's is void.
 *  `stamp` is where the fields live (the artifact object for source_data, `metadata` for a pool
 *  row); `payload` is what the content is read from (the same object, or the pool row). */
export function isHandHeld(kind: HandKind, stamp: unknown, payload?: unknown): boolean {
  const s = (stamp ?? null) as Partial<HandStamp> | null;
  if (!s || typeof s.edited_by_user_at !== 'string' || !s.edited_by_user_at || typeof s.hand_hash !== 'string') return false;
  return s.hand_hash === handHash(canonicalOf(kind, payload === undefined ? stamp : payload));
}

/** The pool-row form: the stamp rides `metadata`, the content is the row's `content` (an invite's
 *  is `metadata.invite`). */
export function isPoolRowHandHeld(kind: HandKind, row: { content?: unknown; metadata?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const payload = kind === 'invite' ? (meta.invite ?? null) : { content: row.content };
  return isHandHeld(kind, meta, payload);
}

// ── THE REGENERATION DECISION — pure, and structurally clock-free. ──────────────────────────────

/** The ground's signals — every one a fact about the item or the artifact, none a clock. */
export type GroundSignals = {
  /** The newest inbound on the thread is newer than what the artifact was prepared from. */
  groundMoved?: boolean;
  /** The item's last activity postdates the artifact's ground (the batched approximation). */
  activityMoved?: boolean;
  /** Supply landed after the artifact (a staged file, a typed input — `reopenAfterSupply`). */
  supplyMoved?: boolean;
  /** The artifact was written under an older drafting law (DRAFT_LAW_VERSION). */
  lawStale?: boolean;
  /** THE ONE READER withdrew it (untrue: outside window · false claim · misaddressed · expired). */
  nonLive?: boolean;
};

export type RegenAction = 'keep' | 'regenerate' | 'mark_stale_under_edit';
export type RegenDecision = { action: RegenAction; reason: string };

/** Moved = one of the ground's own signals (the law's triggers that are about the THREAD). */
export const groundSignalMoved = (g: GroundSignals): boolean => !!(g.groundMoved || g.activityMoved || g.supplyMoved);

/**
 * decideRegeneration — THE ONE DECISION every prepare lane asks before it spends a model call.
 *
 *   sent                     → keep (done work is never re-prepared)
 *   nothing stored           → regenerate
 *   HELD BY THE USER'S HAND  → never regenerate: a moved ground MARKS it (stale under edit — the
 *                              reader derives the flag, the card says so, the user picks a fresh
 *                              version); a law/truth reason alone keeps it (their words, their call)
 *   machine words            → regenerate on a moved ground, an older law, or a reader withdrawal;
 *                              otherwise KEEP — however old it is. There is no clock input.
 */
export function decideRegeneration(i: GroundSignals & { exists: boolean; handHeld: boolean; sent?: boolean }): RegenDecision {
  if (i.sent) return { action: 'keep', reason: 'it already went out' };
  if (!i.exists) return { action: 'regenerate', reason: 'nothing prepared yet' };
  const moved = groundSignalMoved(i);
  if (i.handHeld) {
    return moved
      ? { action: 'mark_stale_under_edit', reason: 'your edit stands — the thread moved since you edited it, so it is marked, never replaced' }
      : { action: 'keep', reason: 'your edit stands — the engine never overwrites your words' };
  }
  if (i.groundMoved) return { action: 'regenerate', reason: 'a newer message moved the ground' };
  if (i.activityMoved) return { action: 'regenerate', reason: 'the thread moved past what this was prepared from' };
  if (i.supplyMoved) return { action: 'regenerate', reason: 'new input landed after this was prepared' };
  if (i.lawStale) return { action: 'regenerate', reason: 'written under an older drafting law' };
  if (i.nonLive) return { action: 'regenerate', reason: 'the reader withdrew it as untrue' };
  return { action: 'keep', reason: 'nothing moved under it — the prepared version stands' };
}

/** The batched/approximate activity signal (the reader's documented approximation, +5s slack):
 *  the item's last activity postdates the artifact's ground. Pure; unresolvable = not moved. */
export function activityMovedPast(lastActivityAt: string | null | undefined, preparedFrom: { receivedAt?: string | null } | null | undefined, fallbackAt?: string | null): boolean {
  const act = Date.parse(String(lastActivityAt ?? '')) || 0;
  if (!act) return false;
  const ground = Date.parse(String(preparedFrom?.receivedAt ?? '')) || Date.parse(String(fallbackAt ?? '')) || 0;
  if (!ground) return false;
  return act > ground + 5000;
}

/** The ONE line a card / narration speaks for a hand-held artifact whose ground moved. */
export const STALE_UNDER_EDIT_LINE = 'The thread moved since you edited this — your words are kept; pick a fresh version if you want one.';

/** A card's plan kind → the edit door's item kind (the same mapping THE ONE READER's serving edge
 *  uses: a followup is a commitment's chase door; a meeting carries no engine-prepared artifact). */
export function handItemKindOf(planKind: string | null | undefined): 'inbox' | 'commitment' | null {
  if (!planKind || planKind === 'meeting') return null;
  return planKind === 'commitment' || planKind === 'followup' ? 'commitment' : 'inbox';
}

/** An artifact object WITHOUT the hand stamp — what a writer spreads when it lands NEW words over a
 *  prior artifact it has already filed (the steer lane): a stamp must never ride machine words. */
export function withoutHandStamp<T extends Record<string, unknown>>(obj: T | null | undefined): Omit<T, 'edited_by_user_at' | 'hand_hash'> | Record<string, never> {
  if (!obj) return {};
  const { edited_by_user_at: _a, hand_hash: _h, ...rest } = obj as T & { edited_by_user_at?: unknown; hand_hash?: unknown };
  return rest;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CONSEQUENCE NEVER DELETES THE USER'S HAND (W9.1b — the law `the-users-hand-wins`, its note).
// Found after W9.1: the verdict's hygiene (lib/work/apply-verdict.ts) and every settle door stripped
// `source_data.draft` / `nudge_draft` / `prepared_invite` / `prepared_forward` with a bare `delete`
// — an artifact the user had edited vanished the moment the judgment changed kind (reply → none,
// reply → decide) or the item settled. A regenerated fresh version is the user's ask; a verdict
// consequence is not. THE RULING: an engine strip goes through ONE partition. Machine words strip as
// before (derived state, the judged pass regenerates the right kind). An artifact the user's hand
// holds (unsent, stamp still matching its content) no longer has a live surface once the plan moved
// off its kind — so it is FILED into the version chain (`version_of`, hand: true — the ledger keeps
// it) and narrated ONCE into the item's room WITH the user's words (deduped on the content hash,
// zero AI): the room turn is the surface where they can still find, copy and reuse what they wrote.
// A filing that fails keeps the artifact in place (fail closed — their words never vanish).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The source_data fields that hold a prepared artifact, and the hand kind each one is. */
export type HandField = 'draft' | 'nudge_draft' | 'prepared_invite' | 'prepared_forward';
export const HAND_FIELD_KIND: Record<HandField, HandKind> = {
  draft: 'reply_draft', nudge_draft: 'nudge_draft', prepared_invite: 'invite', prepared_forward: 'forward',
};

export type HeldArtifact = { field: HandField; kind: HandKind; artifact: Record<string, unknown> };

/** Is this source_data field's artifact held by the user's hand (and still unsent)? */
export function heldSourceArtifact(sd: Record<string, unknown> | null | undefined, field: HandField): HeldArtifact | null {
  const art = ((sd ?? {}) as Record<string, unknown>)[field];
  if (!art || typeof art !== 'object') return null;
  const a = art as Record<string, unknown>;
  if (a.sent_at) return null; // done work is a record — never "kept for later"
  const kind = HAND_FIELD_KIND[field];
  return isHandHeld(kind, a) ? { field, kind, artifact: a } : null;
}

/**
 * THE ONE ENGINE STRIP PARTITION (pure). Removes the named fields from a COPY of source_data and
 * reports which removed artifacts the user's hand held — those the caller must FILE before its
 * write lands (lib/prepare/hand-store.ts `stripSourceArtifacts` does both). Never mutates `sd`.
 */
export function partitionStrip(sd: Record<string, unknown> | null | undefined, fields: HandField[]): {
  sd: Record<string, unknown>; stripped: HandField[]; held: HeldArtifact[];
} {
  const next = { ...((sd ?? {}) as Record<string, unknown>) };
  const stripped: HandField[] = [];
  const held: HeldArtifact[] = [];
  for (const f of Array.from(new Set(fields))) {
    if (!(f in next) || next[f] == null) continue;
    const h = heldSourceArtifact(next, f);
    if (h) held.push(h);
    delete next[f];
    stripped.push(f);
  }
  return { sd: next, stripped, held };
}

/** A pool row held by the user's hand, whatever its kind (text kinds hash `content`; an invite its
 *  `metadata.invite`). A sent or already-filed row is not "held" — it is a record already. */
export function isPoolRowHeldAnyKind(row: { content?: unknown; metadata?: unknown } | null | undefined): HandKind | null {
  if (!row) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  if (meta.sent_at || meta.version_of) return null;
  if (meta.invite && isPoolRowHandHeld('invite', row)) return 'invite';
  return isPoolRowHandHeld('deliverable', row) ? 'deliverable' : null;
}

/** Why a held artifact left its card — the narration's cause, never the judge's prose. */
export type HandFileWhy = 'plan_changed' | 'resolved' | 'booked' | 'replaced';

const HAND_LABEL: Record<HandKind, string> = {
  reply_draft: 'reply', nudge_draft: 'follow-up', invite: 'invite', forward: 'forward', paste_pack: 'words', deliverable: 'draft',
};

/** The user's words, displayable — text kinds verbatim; an invite / forward as its edited fields. */
export function handWordsOf(kind: HandKind, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  if (kind === 'invite') {
    return [
      String(p.title ?? '').trim() || 'Meeting',
      p.startISO || p.start ? `When: ${String(p.startISO ?? p.start)}${p.endISO ? ` – ${String(p.endISO)}` : ''}` : '',
      list(p.attendees) ? `With: ${list(p.attendees)}` : '',
      String(p.description ?? '').trim(),
    ].filter(Boolean).join('\n');
  }
  if (kind === 'forward') return [list(p.to) ? `To: ${list(p.to)}` : '', String(p.note ?? '').trim()].filter(Boolean).join('\n');
  if (typeof payload === 'string') return payload.trim();
  return String(p.body ?? p.content ?? '').trim();
}

/** The display ceiling for the words carried in the room line — a longer edit is cut at a word
 *  boundary and says so. */
export const HAND_FILED_WORDS_MAX = 4000;

/** THE ONE LINE for a filed hand-held artifact — a composed consequence + the user's own words. */
export function composeHandFiledLine(kind: HandKind, why: HandFileWhy, words: string): string {
  const label = HAND_LABEL[kind] ?? 'draft';
  const lead = why === 'resolved' ? `This was settled — your edited ${label} was never sent, so it is kept here:`
    : why === 'booked' ? `The meeting is already on your calendar — your edited ${label} was not sent, so it is kept here:`
      : why === 'replaced' ? `A new version replaced your edited ${label} on the card — your words are kept here:`
        : `The plan changed since you edited this — your ${label} is no longer on the card, so it is kept here:`;
  let w = String(words ?? '').trim();
  if (w.length > HAND_FILED_WORDS_MAX) {
    const cut = w.slice(0, HAND_FILED_WORDS_MAX + 1);
    const at = cut.lastIndexOf(' ');
    w = `${(at > HAND_FILED_WORDS_MAX * 0.6 ? cut.slice(0, at) : cut.slice(0, HAND_FILED_WORDS_MAX)).trimEnd()} … [shortened]`;
  }
  return w ? `${lead}\n\n${w}` : lead;
}

/** The narration's dedupe key — ONCE per item, kind and the exact words (their hash). */
export function handFiledKey(itemId: string, kind: HandKind, hash: string): string {
  return `hand-filed:${itemId}:${kind}:${hash}`;
}
