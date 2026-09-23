// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE CONVERSATION, ONE LIVE ITEM — THE CONVERSATION DELTA (stabilization W8.2).
//
// THE FINDING (owner account, read-only census, Sep 23): one client conversation carried ~20 open
// commitments accumulated message by message over six weeks — one counterparty alone held seven
// ("Change label X", "Complete diagnostic calls", "Create interim report", "Confirm pricing"…).
// Every new message EXTRACTED new obligations; nothing reconsidered the older open ones on the same
// conversation, so the Home top-5 filled with four rows from one thread.
//
// THE LAW: when a new message (or meeting) lands on a conversation that already holds open work,
// extraction does not just APPEND. ONE reasoned pass reads the open items on that conversation +
// the new message's OWN words (topMessageOf — never the quoted chain) and returns, per open item,
// keep · update · superseded_by · delivered · moot, and per candidate new commitment, new ·
// duplicate_of. The model JUDGES; the CODE decides what a judgment may do:
//   • every non-keep disposition carries a QUOTE that must exist in the message text (code-checked,
//     accent/space/quote-folded) — no quote, no change: keep;
//   • `delivered` NEVER closes on the pass's say-so — it only NOMINATES the message to the one
//     fulfillment judge (lib/commitments/fulfillment.ts); only a judged delivery closes (EVIDENCE
//     SETTLES), and only when the message's author is the debtor (the judge is told who wrote it);
//   • `superseded` / `moot` settle through the one status flip (dismissed, resolved_reason
//     `superseded:<id>` · `moot`, resolved_at = the message's own time), logged under the REVERSIBLE
//     `commitment_dismissed` type (/api/restore reopens it — HUMAN IN THE LOOP: a settlement is a
//     state change, logged and undoable, never a deed);
//   • `update` rewrites only a description / a due date the message itself STATES (never before the
//     message's own date), previous values kept in the activity row;
//   • every write is a CONDITIONAL CLAIM (status still live, the row as we read it) — exactly once;
//   • FAILURE = KEEP EVERYTHING (showing costs less than hiding) — a thrown call, bad JSON, an
//     unknown label: every open item kept, every candidate new;
//   • BOUNDED: at most DELTA_MAX_OPEN open items per pass (oldest first — the hoard's head); the rest
//     are reported as left behind, never silently dropped (NO SILENT CAPS).
//
// ONE call site: `writeCommitments` in lib/commitments/extract.ts (both the mail and the meeting
// path land there). The repair (scripts/repair-conversation-hoard.ts) runs the SAME pure validator
// and the SAME applier over history. Zero keyword lists.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { dateStatedInText } from '@/lib/utils/user-time';
import { foldAccents } from '@/lib/projects/identity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = SupabaseClient<any, any, any> | any;

/** Bump on ANY change to the delta prompt / validation floors. */
export const CONVERSATION_DELTA_VERSION = 1;
/** Open items one pass may reconsider (oldest first). The rest are reported as left behind. */
export const DELTA_MAX_OPEN = 20;
/** Candidate new commitments one pass may fold (an extraction batch is small by prompt). */
export const DELTA_MAX_CANDIDATES = 8;
/** The message excerpt budget — clipped by THE ONE CLIPPER, the cut declared. */
export const DELTA_MESSAGE_CHARS = 3000;
const LIVE = ['open', 'suggested'] as const;
const DAY_MS = 86_400_000;

// ── Shapes ────────────────────────────────────────────────────────────────────────────────────────
export type DeltaOpenItem = {
  id: string;
  description: string;
  direction: string | null;
  counterparty: string | null;
  due_date: string | null;
  created_at: string | null;
  status: string;
};
export type DeltaCandidate = {
  description: string;
  direction?: string | null;
  counterparty?: string | null;
  due_date?: string | null;
  /** Repair mode: the candidate is an EXISTING row (born of this message) — a duplicate dismisses it. */
  id?: string | null;
};
export type DeltaMessage = {
  kind: 'email' | 'meeting';
  /** emails.id / meeting_transcripts.id — the evidence the fulfillment judge reads. */
  id: string;
  /** The message's OWN words (email: topMessageOf(body); meeting: its summary + action items). */
  text: string;
  /** The message's own time (received_at / meeting start). */
  at: string | null;
  /** True = the user wrote it; false = the counterparty; null = unknown (a meeting). */
  authoredByUser: boolean | null;
  subject?: string | null;
};
export type DeltaInput = {
  open: DeltaOpenItem[];
  candidates: DeltaCandidate[];
  message: DeltaMessage;
  /** Context only — the conversation's open inbox item titles (never settled here). */
  inboxContext?: string[];
  /** YYYY-MM-DD — injected by code, never guessed by the model. */
  todayIso: string;
};

export type ItemDisposition =
  | { id: string; action: 'keep'; note?: string }
  | { id: string; action: 'update'; description?: string; due_date?: string; quote: string }
  | { id: string; action: 'superseded'; by: { kind: 'existing'; id: string } | { kind: 'candidate'; index: number }; quote: string }
  | { id: string; action: 'delivered'; quote: string }
  | { id: string; action: 'moot'; quote: string };
export type CandidateDisposition = { index: number; action: 'new' } | { index: number; action: 'duplicate'; of: string };
export type DeltaPlan = {
  items: ItemDisposition[];
  candidates: CandidateDisposition[];
  /** Model dispositions the code floors turned into keep/new — the receipts of the floors. */
  downgraded: Array<{ label: string; wanted: string; why: string }>;
  /** True when the pass failed and everything was kept. */
  failed: boolean;
};

/** The model's raw answer, labelled (C1… for open items, N1… for candidates — never raw ids). */
export type RawDelta = {
  open?: Array<{ id?: unknown; verdict?: unknown; quote?: unknown; description?: unknown; due_date?: unknown; by?: unknown }>;
  new?: Array<{ id?: unknown; verdict?: unknown; of?: unknown }>;
};

// ── THE QUOTE LAW (pure) ──────────────────────────────────────────────────────────────────────────
const foldQuote = (s: string): string => foldAccents(String(s ?? ''))
  .toLowerCase()
  .replace(/[‘’‚‛`´]/g, "'")
  .replace(/[“”„‟«»]/g, '"')
  .replace(/[‐-―]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Does the quote exist VERBATIM in the message text? Folded for accents, case, curly quotes, dashes
 * and whitespace; the model's own ellipsis may join fragments, each of which must appear IN ORDER.
 * A fragment shorter than 6 characters proves nothing. Pure.
 */
export function quoteInText(quote: unknown, text: string): boolean {
  if (typeof quote !== 'string') return false;
  const q = foldQuote(quote).replace(/^["']+|["']+$/g, '').trim();
  if (q.length < 6 || q.length > 400) return false;
  const t = foldQuote(text);
  const parts = q.split(/\s*(?:\.\.\.|…|\[…\]|\[\.\.\.\])\s*/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.some((p) => p.length < 6)) return false;
  let from = 0;
  for (const p of parts) {
    const at = t.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

// ── THE STATED-DUE FLOOR for an update (pure) ────────────────────────────────────────────────────
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/**
 * A due date an UPDATE may write: a real YYYY-MM-DD, never before the message's own day, and
 * STATED by the message — explicitly (dateStatedInText) or as its weekday within the coming week
 * ("by Friday" in a Tuesday mail). Anything else → null (the update keeps its description half).
 */
export function verifiedUpdateDue(due: unknown, messageText: string, messageAt: string | null): string | null {
  if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const d = Date.parse(`${due}T12:00:00Z`);
  if (Number.isNaN(d) || new Date(d).toISOString().slice(0, 10) !== due) return null;
  const at = messageAt && !Number.isNaN(Date.parse(messageAt)) ? Date.parse(`${messageAt.slice(0, 10)}T12:00:00Z`) : null;
  if (at !== null && d < at) return null;                                   // never due before its own source
  // A bare weekday ("by Friday") names only the COMING one — within a week of the message. Beyond
  // that the text must carry the date's own day number (dateStatedInText alone accepts a weekday).
  const gap = at !== null ? Math.round((d - at) / DAY_MS) : null;
  const dayDigits = new RegExp(`(?<!\\d)0?${Number(due.slice(8, 10))}(?!\\d)`).test(messageText);
  if (dateStatedInText(messageText, due) && (dayDigits || (gap !== null && gap >= 0 && gap <= 7))) return due;
  if (gap !== null && gap >= 1 && gap <= 7) {
    const wd = WEEKDAYS[new Date(d).getUTCDay()];
    if (new RegExp(`\\b${wd}\\b`, 'i').test(foldAccents(messageText))) return due;
  }
  return null;
}

// ── THE VALIDATOR (pure) — the code half of the pass ────────────────────────────────────────────
export function keepAll(input: Pick<DeltaInput, 'open' | 'candidates'>, failed = true): DeltaPlan {
  return {
    items: input.open.map((o) => ({ id: o.id, action: 'keep' as const })),
    candidates: input.candidates.map((_, index) => ({ index, action: 'new' as const })),
    downgraded: [],
    failed,
  };
}

const label = (s: unknown): string => String(s ?? '').trim().toUpperCase();

/**
 * Turn the model's labelled answer into a plan the code can stand behind. Every floor of the law
 * lives HERE (and the gates exercise it directly): unknown labels ignored, quotes verified in the
 * message, a delivered nomination only when the debtor wrote the message, supersession only onto a
 * live target (chains followed, cycles kept), a duplicate only of an open item of the SAME direction,
 * an update only with a changed description or a stated due. Pure.
 */
export function validateDelta(raw: RawDelta | null | undefined, input: DeltaInput): DeltaPlan {
  if (!raw || typeof raw !== 'object') return keepAll(input);
  const { open, candidates, message } = input;
  const byLabel = new Map(open.map((o, i) => [`C${i + 1}`, o]));
  const text = `${message.subject ? `${message.subject}\n` : ''}${message.text}`;
  const downgraded: DeltaPlan['downgraded'] = [];
  const down = (l: string, wanted: string, why: string) => { downgraded.push({ label: l, wanted, why }); };

  // ── candidates first (a supersession may point at one) ──
  const cand: CandidateDisposition[] = candidates.map((_, index) => ({ index, action: 'new' }));
  for (const r of Array.isArray(raw.new) ? raw.new : []) {
    const l = label(r?.id);
    const m = /^N(\d+)$/.exec(l);
    if (!m) continue;
    const index = Number(m[1]) - 1;
    if (index < 0 || index >= candidates.length || cand[index].action !== 'new') continue;
    if (String(r?.verdict ?? '').toLowerCase().replace(/_of$/, '') !== 'duplicate') continue;
    const target = byLabel.get(label(r?.of));
    if (!target) { down(l, 'duplicate', 'duplicate of an unknown item'); continue; }
    const cd = candidates[index].direction ?? null;
    if (cd && target.direction && cd !== target.direction) { down(l, 'duplicate', 'duplicate across directions'); continue; }
    cand[index] = { index, action: 'duplicate', of: target.id };
  }

  // ── open items ──
  const plan = new Map<string, ItemDisposition>(open.map((o) => [o.id, { id: o.id, action: 'keep' }]));
  const pendingSupersede: Array<{ id: string; l: string; byLabel: string; quote: string }> = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw.open) ? raw.open : []) {
    const l = label(r?.id);
    const item = byLabel.get(l);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    const verdict = String(r?.verdict ?? 'keep').toLowerCase().replace(/_by$/, '');
    if (verdict === 'keep' || !verdict) continue;
    if (!['update', 'superseded', 'delivered', 'moot'].includes(verdict)) { down(l, verdict, 'unknown verdict'); continue; }
    const quote = typeof r?.quote === 'string' ? r.quote : '';
    if (!quoteInText(quote, text)) { down(l, verdict, 'quote not found in the message'); continue; }
    if (verdict === 'update') {
      const desc = typeof r?.description === 'string' ? r.description.replace(/\s+/g, ' ').trim() : '';
      const newDesc = desc && desc.length <= 200 && foldQuote(desc) !== foldQuote(item.description) ? desc : undefined;
      const due = verifiedUpdateDue(r?.due_date, text, message.at);
      const newDue = due && due !== item.due_date ? due : undefined;
      if (!newDesc && !newDue) { down(l, 'update', 'nothing verified to change'); continue; }
      plan.set(item.id, { id: item.id, action: 'update', ...(newDesc ? { description: newDesc } : {}), ...(newDue ? { due_date: newDue } : {}), quote });
    } else if (verdict === 'delivered') {
      // The fulfillment judge is told WHO wrote the evidence — a message by the other side is not
      // the debtor's delivery (their acknowledgement is the nominator's business, not this pass's).
      const debtorIsUser = item.direction !== 'awaiting';
      if (message.authoredByUser !== null && message.authoredByUser !== debtorIsUser) { down(l, 'delivered', 'the message was not written by the debtor'); continue; }
      plan.set(item.id, { id: item.id, action: 'delivered', quote });
    } else if (verdict === 'moot') {
      plan.set(item.id, { id: item.id, action: 'moot', quote });
    } else {
      pendingSupersede.push({ id: item.id, l, byLabel: label(r?.by), quote });
    }
  }

  // ── supersession: onto a live target only; chains followed; cycles and self-targets kept ──
  const supTarget = new Map<string, ItemDisposition & { action: 'superseded' }>();
  for (const s of pendingSupersede) {
    let by: { kind: 'existing'; id: string } | { kind: 'candidate'; index: number } | null = null;
    const nm = /^N(\d+)$/.exec(s.byLabel);
    if (nm) {
      const index = Number(nm[1]) - 1;
      const c = cand[index];
      if (c?.action === 'new') by = { kind: 'candidate', index };
      else if (c?.action === 'duplicate' && c.of !== s.id) by = { kind: 'existing', id: c.of };
    } else {
      const t = byLabel.get(s.byLabel);
      if (t && t.id !== s.id) by = { kind: 'existing', id: t.id };
    }
    if (!by) { down(s.l, 'superseded', 'no live replacement named'); continue; }
    supTarget.set(s.id, { id: s.id, action: 'superseded', by, quote: s.quote });
  }
  // Follow existing-target chains to a target that stays live; a cycle or a dead end keeps the row.
  for (const [id, d] of supTarget) {
    let by = d.by;
    const visited = new Set([id]);
    let ok = true;
    while (by.kind === 'existing') {
      if (visited.has(by.id)) { ok = false; break; }
      visited.add(by.id);
      const next = supTarget.get(by.id);
      if (next) { by = next.by; continue; }
      const p = plan.get(by.id);
      if (p && p.action !== 'keep' && p.action !== 'update') ok = false; // its target is being settled
      break;
    }
    if (!ok) { down(`C${open.findIndex((o) => o.id === id) + 1}`, 'superseded', 'replacement is itself settled / a cycle'); continue; }
    plan.set(id, { ...d, by });
  }

  return {
    items: open.map((o) => plan.get(o.id)!),
    candidates: cand,
    downgraded,
    failed: false,
  };
}

// ── THE PROMPT (pure) ─────────────────────────────────────────────────────────────────────────────
export function buildDeltaPrompt(input: DeltaInput): string {
  const { open, candidates, message, todayIso } = input;
  const who = message.kind === 'meeting'
    ? 'a MEETING (its summary and action items below)'
    : message.authoredByUser === true ? 'an EMAIL written BY THE USER'
      : message.authoredByUser === false ? 'an EMAIL written BY THE OTHER PARTY' : 'an EMAIL';
  const fmt = (o: DeltaOpenItem, i: number) =>
    `[C${i + 1}] ${o.direction === 'awaiting' ? 'THEY OWE the user' : 'THE USER OWES'}${o.counterparty ? ` (${clipForPrompt(o.counterparty, 60)})` : ''}: "${clipForPrompt(o.description, 200)}"` +
    `${o.due_date ? ` — due ${o.due_date}` : ''}${o.created_at ? ` — open since ${o.created_at.slice(0, 10)}` : ''}`;
  const fmtN = (c: DeltaCandidate, i: number) =>
    `[N${i + 1}] ${c.direction === 'awaiting' ? 'THEY OWE the user' : 'THE USER OWES'}${c.counterparty ? ` (${clipForPrompt(String(c.counterparty), 60)})` : ''}: "${clipForPrompt(c.description, 200)}"${c.due_date ? ` — due ${c.due_date}` : ''}`;
  const msgText = clipForPrompt(message.text.replace(/\n{3,}/g, '\n\n'), DELTA_MESSAGE_CHARS);
  return (
    `One conversation holds several OPEN obligations. A new message just landed on it. Decide, for each open obligation, what THIS message did to it — and whether each newly extracted obligation is genuinely new.\n` +
    `Today is ${todayIso}. The new message is ${who}${message.at ? `, dated ${message.at.slice(0, 10)}` : ''}.\n` +
    `${EXCERPT_RULE}\n\n` +
    `OPEN OBLIGATIONS ON THIS CONVERSATION:\n${open.map(fmt).join('\n')}\n\n` +
    `${candidates.length ? `NEWLY EXTRACTED FROM THIS MESSAGE:\n${candidates.map(fmtN).join('\n')}\n\n` : ''}` +
    `${input.inboxContext?.length ? `CONTEXT ONLY (the conversation's open inbox item — do not judge it): ${input.inboxContext.map((t) => `"${clipForPrompt(t, 120)}"`).join('; ')}\n\n` : ''}` +
    `THE MESSAGE'S OWN WORDS (quoted reply-history removed):\n"""${message.subject ? `Subject: ${clipForPrompt(message.subject, 160)}\n` : ''}${msgText}"""\n\n` +
    `For EACH open obligation choose ONE verdict:\n` +
    `- "keep": the message does not change it (THE DEFAULT — when in doubt, keep; hiding live work costs more than showing it).\n` +
    `- "update": the message restates THE SAME obligation with a changed scope or a new stated deadline — give the new short imperative "description" and/or "due_date" (YYYY-MM-DD, only if the message states it).\n` +
    `- "superseded": the message REPLACES it with a different obligation — "by" names the replacement (an N label, or another C label).\n` +
    `- "delivered": the message itself hands the thing over or states it as ALREADY done (a promise to do it later is NOT delivered).\n` +
    `- "moot": the message says it is no longer needed (cancelled, dropped, decided otherwise, overtaken by events).\n` +
    `Every verdict other than "keep" MUST carry "quote": a short VERBATIM span copied from THE MESSAGE'S OWN WORDS above that shows it. No such span → "keep".\n` +
    `For EACH newly extracted obligation: "new", or "duplicate" with "of" = the C label of the open obligation it restates (same act, same side owing it).\n\n` +
    `JSON only: {"open":[{"id":"C1","verdict":"keep|update|superseded|delivered|moot","quote":"…","description":"…","due_date":"YYYY-MM-DD","by":"N1|C2"}],"new":[{"id":"N1","verdict":"new|duplicate","of":"C1"}]}`
  );
}

function parseJsonLoose(text: string): unknown {
  let raw = String(text ?? '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
  throw new Error('no json');
}

/** The reasoned half, injectable (the gates stub it; production rides the factory). */
export type DeltaJudge = (prompt: string) => Promise<string>;

export function factoryJudge(client: DBClient, userId: string): DeltaJudge {
  return async (prompt: string) => {
    const { getAIClient, aiCreate } = await import('@/lib/ai/factory');
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, { model, max_tokens: 900, temperature: 0, messages: [{ role: 'user', content: prompt }] });
    return res.choices?.[0]?.message?.content ?? '';
  };
}

/**
 * ONE reasoned pass → a validated plan. No open items → no call (every candidate new). Any failure
 * → keep everything.
 */
export async function judgeConversationDelta(input: DeltaInput, judge: DeltaJudge): Promise<DeltaPlan> {
  if (!input.open.length) return keepAll(input, false);
  try {
    const text = await judge(buildDeltaPrompt(input));
    return validateDelta(parseJsonLoose(text) as RawDelta, input);
  } catch (e) {
    console.error('[conversation-delta] pass failed — keeping everything:', e instanceof Error ? e.message : e);
    return keepAll(input);
  }
}

// ── THE CONVERSATION (IO, bounded) ───────────────────────────────────────────────────────────────
export type ConversationKey =
  | { kind: 'thread'; threadId: string; excludeSourceId?: string | null }
  | { kind: 'meeting'; transcriptId: string };

export type LoadedConversation = { open: DeltaOpenItem[]; leftBehind: string[]; inboxContext: string[] };

const OPEN_SELECT = 'id, description, direction, counterparty, due_date, created_at, status';

/** Split an open list at the cap, oldest first; the remainder is REPORTED, never silently dropped. Pure. */
export function capOpen<T extends { created_at: string | null }>(rows: T[], max = DELTA_MAX_OPEN): { kept: T[]; leftBehind: T[] } {
  const sorted = [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return { kept: sorted.slice(0, max), leftBehind: sorted.slice(max) };
}

/**
 * The open work on a conversation: an email thread's live commitments (minus the ones born of the
 * message itself), or — for a meeting — the live commitments born of EARLIER meetings of the same
 * calendar series. Bounded selects; explicit columns; every error answers "no conversation".
 */
export async function loadConversation(client: DBClient, userId: string, key: ConversationKey): Promise<LoadedConversation> {
  const empty: LoadedConversation = { open: [], leftBehind: [], inboxContext: [] };
  try {
    let rows: DeltaOpenItem[] = [];
    let inboxContext: string[] = [];
    if (key.kind === 'thread') {
      let q = client.from('commitments').select(OPEN_SELECT).eq('user_id', userId)
        .eq('thread_id', key.threadId).in('status', [...LIVE]);
      if (key.excludeSourceId) q = q.neq('source_id', key.excludeSourceId);
      const { data, error } = await q.order('created_at', { ascending: true }).limit(200);
      if (error) return empty;
      rows = (data ?? []) as DeltaOpenItem[];
      if (rows.length) {
        const { data: items, error: iErr } = await client.from('inbox_items').select('work_title')
          .eq('user_id', userId).eq('source', 'email').eq('status', 'pending')
          .eq('source_data->>thread_id', key.threadId).limit(3);
        if (!iErr) inboxContext = ((items ?? []) as Array<{ work_title: string | null }>).map((i) => String(i.work_title ?? '').trim()).filter(Boolean);
      }
    } else {
      const series = await meetingSeriesTranscripts(client, userId, key.transcriptId);
      if (!series.length) return empty;
      const { data, error } = await client.from('commitments').select(OPEN_SELECT).eq('user_id', userId)
        .eq('source', 'meeting').in('source_id', series).in('status', [...LIVE])
        .order('created_at', { ascending: true }).limit(200);
      if (error) return empty;
      rows = (data ?? []) as DeltaOpenItem[];
    }
    const { kept, leftBehind } = capOpen(rows);
    return { open: kept, leftBehind: leftBehind.map((r) => r.id), inboxContext };
  } catch { return empty; }
}

/** The OTHER transcripts of this meeting's calendar series (recurring_event_id) — never itself. */
export async function meetingSeriesTranscripts(client: DBClient, userId: string, transcriptId: string): Promise<string[]> {
  const { data: mt, error } = await client.from('meeting_transcripts').select('id, calendar_event_id')
    .eq('id', transcriptId).eq('user_id', userId).maybeSingle();
  if (error || !mt?.calendar_event_id) return [];
  const { data: ev, error: e2 } = await client.from('calendar_events').select('id, recurring_event_id')
    .eq('id', mt.calendar_event_id).eq('user_id', userId).maybeSingle();
  if (e2 || !ev?.recurring_event_id) return [];
  const { data: evs, error: e3 } = await client.from('calendar_events').select('id')
    .eq('user_id', userId).eq('recurring_event_id', ev.recurring_event_id).limit(200);
  if (e3) return [];
  const ids = ((evs ?? []) as Array<{ id: string }>).map((e) => e.id);
  if (!ids.length) return [];
  const { data: mts, error: e4 } = await client.from('meeting_transcripts').select('id')
    .eq('user_id', userId).in('calendar_event_id', ids).neq('id', transcriptId).limit(200);
  if (e4) return [];
  return ((mts ?? []) as Array<{ id: string }>).map((m) => m.id);
}

/** A meeting's OWN words for the pass: its summary + the action items this extraction produced. */
export async function meetingMessageText(client: DBClient, userId: string, transcriptId: string, actions: string[]): Promise<{ text: string; at: string | null; subject: string | null }> {
  let summary = '', at: string | null = null, subject: string | null = null;
  try {
    const { data, error } = await client.from('meeting_transcripts').select('title, summary, start_time, created_at')
      .eq('id', transcriptId).eq('user_id', userId).maybeSingle();
    if (!error && data) {
      summary = String(data.summary ?? '').trim();
      at = (data.start_time as string | null) ?? (data.created_at as string | null) ?? null;
      subject = (data.title as string | null) ?? null;
    }
  } catch { /* a meeting with no readable summary still has its action items */ }
  const acts = actions.filter(Boolean).map((a) => `- ${a}`).join('\n');
  return { text: [summary, acts ? `Action items:\n${acts}` : ''].filter(Boolean).join('\n\n'), at, subject };
}

// ── THE APPLIER (IO) — the code half's consequences, each a conditional claim ─────────────────────
export type DeltaReport = {
  kept: number; updated: number; superseded: number; moot: number;
  deliveredNominated: number; deliveredClosed: number; duplicates: number;
  leftBehind: number; failed: boolean; downgraded: number;
};
export const emptyReport = (): DeltaReport => ({ kept: 0, updated: 0, superseded: 0, moot: 0, deliveredNominated: 0, deliveredClosed: 0, duplicates: 0, leftBehind: 0, failed: false, downgraded: 0 });

export type ApplyDeps = {
  /** The fulfillment judge — the ONE door a `delivered` nomination may close through. */
  judgeFulfillment?: typeof import('@/lib/commitments/fulfillment').judgeFulfillmentFromEvidence;
  applyFulfillment?: typeof import('@/lib/commitments/fulfillment').applyFulfillmentVerdict;
  /** The receipts (asks settled, brief busted, mirrors archived) — the gates pass a no-op. */
  afterSettle?: (client: DBClient, userId: string, id: string, reason: string, stampAt: string) => Promise<void>;
  logActivity?: typeof import('@/lib/activity/log').logActivity;
};

async function defaultAfterSettle(client: DBClient, userId: string, id: string, reason: string, stampAt: string): Promise<void> {
  try {
    const { settleMirrorRows } = await import('@/lib/inbox/commitment-mirrors');
    await settleMirrorRows(client, userId, id, { reason, stampAt });
  } catch { /* archive-only, best-effort */ }
  import('@/lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(client, userId, 'commitment', id)).catch(() => {});
  import('@/lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(client, userId)).catch(() => {});
}

/** The one dismissal flip (superseded / moot / duplicate): conditional on the row still being live. */
async function dismissRow(client: DBClient, userId: string, id: string, reason: string, stampAt: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client.from('commitments')
    .update({ status: 'dismissed', resolved_reason: reason, resolved_at: stampAt, updated_at: nowIso })
    .eq('id', id).eq('user_id', userId).in('status', [...LIVE]).select('id');
  if (error) return false;
  return Array.isArray(data) ? data.length > 0 : !!data;
}

/**
 * Apply a validated plan. `insertedIds[index]` = the id a NEW candidate got at the write (a
 * supersession onto a candidate needs it; a missing one keeps the row). A candidate that carries its
 * own `id` (repair mode) and is a duplicate is dismissed as `duplicate`.
 */
export async function applyDeltaPlan(
  client: DBClient, userId: string,
  ctx: { plan: DeltaPlan; open: DeltaOpenItem[]; candidates: DeltaCandidate[]; message: DeltaMessage; insertedIds?: Array<string | null>; leftBehind?: number },
  deps: ApplyDeps = {},
): Promise<DeltaReport> {
  const report = emptyReport();
  report.failed = ctx.plan.failed;
  report.downgraded = ctx.plan.downgraded.length;
  report.leftBehind = ctx.leftBehind ?? 0;
  const log = deps.logActivity ?? (await import('@/lib/activity/log')).logActivity;
  const after = deps.afterSettle ?? defaultAfterSettle;
  const byId = new Map(ctx.open.map((o) => [o.id, o]));
  const stampAt = ctx.message.at && !Number.isNaN(Date.parse(ctx.message.at)) ? new Date(ctx.message.at).toISOString() : new Date().toISOString();
  const via = { auto: true, via: 'conversation-delta', version: CONVERSATION_DELTA_VERSION, message: `${ctx.message.kind}:${ctx.message.id}` };

  // Candidates that duplicate an open item and already exist as rows (repair mode) settle as duplicates.
  for (const c of ctx.plan.candidates) {
    if (c.action !== 'duplicate') continue;
    report.duplicates++;
    const row = ctx.candidates[c.index];
    if (!row?.id) continue; // write mode: the duplicate simply is not inserted
    if (await dismissRow(client, userId, row.id, 'duplicate', stampAt)) {
      await log(client, userId, {
        type: 'commitment_dismissed', title: `Folded (same as an open item on this conversation): ${row.description}`,
        entityType: 'commitment', entityId: row.id, metadata: { reason: 'duplicate', of: c.of, ...via },
      });
      await after(client, userId, row.id, 'duplicate', stampAt);
    }
  }

  for (const d of ctx.plan.items) {
    const item = byId.get(d.id);
    if (!item) continue;
    if (d.action === 'keep') { report.kept++; continue; }

    if (d.action === 'update') {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (d.description) patch.description = d.description.slice(0, 500);
      if (d.due_date) patch.due_date = d.due_date;
      const { data, error } = await client.from('commitments').update(patch)
        .eq('id', item.id).eq('user_id', userId).in('status', [...LIVE]).eq('description', item.description).select('id');
      if (error || !(Array.isArray(data) ? data.length : data)) { report.kept++; continue; }
      report.updated++;
      await log(client, userId, {
        type: 'commitment_updated', title: `Updated from the conversation: ${d.description ?? item.description}`,
        entityType: 'commitment', entityId: item.id,
        metadata: { previous: { description: item.description, due_date: item.due_date }, quote: d.quote.slice(0, 200), ...via },
      });
      continue;
    }

    if (d.action === 'superseded' || d.action === 'moot') {
      let reason = 'moot';
      if (d.action === 'superseded') {
        const target = d.by.kind === 'existing' ? d.by.id : (ctx.insertedIds?.[d.by.index] ?? ctx.candidates[d.by.index]?.id ?? null);
        if (!target) { report.kept++; continue; } // the replacement never landed — keep
        reason = `superseded:${target}`;
      }
      if (!(await dismissRow(client, userId, item.id, reason, stampAt))) { report.kept++; continue; }
      if (d.action === 'superseded') report.superseded++; else report.moot++;
      // UNDOABLE: commitment_dismissed is a REVERSIBLE type — /api/restore reopens the row.
      await log(client, userId, {
        type: 'commitment_dismissed',
        title: `${d.action === 'moot' ? 'No longer needed' : 'Replaced by a newer ask'} (the conversation moved on): ${item.description}`,
        entityType: 'commitment', entityId: item.id,
        metadata: { reason, quote: d.quote.slice(0, 200), ...via },
      });
      await after(client, userId, item.id, reason, stampAt);
      continue;
    }

    // delivered — a NOMINATION. Only the one fulfillment judge decides; only `delivered` closes.
    report.deliveredNominated++;
    try {
      const f = await import('@/lib/commitments/fulfillment');
      const judge = deps.judgeFulfillment ?? f.judgeFulfillmentFromEvidence;
      const applyV = deps.applyFulfillment ?? f.applyFulfillmentVerdict;
      const candidate = ctx.message.kind === 'email'
        ? { type: 'email' as const, id: ctx.message.id, at: stampAt, title: ctx.message.subject ?? '', body: ctx.message.text }
        : { type: 'transcript' as const, id: ctx.message.id, at: stampAt, title: ctx.message.subject ?? 'meeting' };
      const verdict = await judge(client, userId,
        { kind: 'commitment', id: item.id, description: item.description, due_date: item.due_date, created_at: item.created_at },
        [candidate], item.direction !== 'awaiting');
      const reason = `evidence:${candidate.type}`;
      const closed = await applyV(client, userId, { id: item.id, description: item.description, due_date: item.due_date }, verdict, async () => {
        const nowIso = new Date().toISOString();
        const { data, error } = await client.from('commitments')
          .update({ status: 'done', resolved_reason: reason, resolved_at: stampAt, updated_at: nowIso })
          .eq('id', item.id).eq('user_id', userId).in('status', [...LIVE]).select('id');
        if (error || !(Array.isArray(data) ? data.length : data)) return false;
        await log(client, userId, {
          type: 'commitment_done', title: `Resolved (delivered in the conversation): ${item.description}`,
          entityType: 'commitment', entityId: item.id,
          metadata: { reason, resolvedAt: stampAt, judged: String(verdict.reason ?? '').slice(0, 200), quote: d.quote.slice(0, 200), ...via },
        });
        await after(client, userId, item.id, reason, stampAt);
        return true;
      });
      if (closed) report.deliveredClosed++; else report.kept++;
    } catch { report.kept++; } // never close on an error path
  }
  return report;
}

/**
 * THE ONE ENTRY the write path calls: load the conversation, run the pass, and hand back which
 * candidates to write plus a `settle` to run once the new rows have ids. No open work → no call.
 */
export async function conversationDelta(
  client: DBClient, userId: string,
  args: {
    key: ConversationKey | null;
    candidates: DeltaCandidate[];
    message: Omit<DeltaMessage, 'text'> & { text: string | null };
    judge?: DeltaJudge;
    deps?: ApplyDeps;
  },
): Promise<{ plan: DeltaPlan; writeIndices: number[]; settle: (insertedIds: Array<string | null>) => Promise<DeltaReport> }> {
  const candidates = args.candidates.slice(0, DELTA_MAX_CANDIDATES);
  const passthrough = {
    plan: keepAll({ open: [], candidates: args.candidates }, false),
    writeIndices: args.candidates.map((_, i) => i),
    settle: async () => emptyReport(),
  };
  if (!args.key) return passthrough;
  const conv = await loadConversation(client, userId, args.key);
  if (!conv.open.length) return passthrough;
  let text = String(args.message.text ?? '');
  let at = args.message.at, subject = args.message.subject ?? null;
  if (args.message.kind === 'meeting' && !text.trim()) {
    const m = await meetingMessageText(client, userId, args.message.id, candidates.map((c) => c.description));
    text = m.text; at = at ?? m.at; subject = subject ?? m.subject;
  }
  if (!text.trim()) return passthrough;
  const message: DeltaMessage = { ...args.message, text, at, subject };
  const input: DeltaInput = { open: conv.open, candidates, message, inboxContext: conv.inboxContext, todayIso: new Date().toISOString().slice(0, 10) };
  const plan = await judgeConversationDelta(input, args.judge ?? factoryJudge(client, userId));
  if (conv.leftBehind.length) console.log(`[conversation-delta] ${conv.leftBehind.length} open item(s) left behind by the cap (${DELTA_MAX_OPEN})`);
  // Candidates beyond the fold cap are written as new (never silently dropped).
  const dup = new Set(plan.candidates.filter((c) => c.action === 'duplicate').map((c) => c.index));
  const writeIndices = args.candidates.map((_, i) => i).filter((i) => !dup.has(i));
  return {
    plan, writeIndices,
    settle: async (insertedIds) => {
      try {
        // insertedIds are aligned to writeIndices; re-key them by candidate index for the applier.
        const byIndex: Array<string | null> = candidates.map(() => null);
        writeIndices.forEach((ci, k) => { if (ci < byIndex.length) byIndex[ci] = insertedIds[k] ?? null; });
        return await applyDeltaPlan(client, userId, { plan, open: conv.open, candidates, message, insertedIds: byIndex, leftBehind: conv.leftBehind.length }, args.deps);
      } catch (e) {
        console.error('[conversation-delta] settle non-fatal:', e instanceof Error ? e.message : e);
        return { ...emptyReport(), failed: true };
      }
    },
  };
}
