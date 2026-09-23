// THE POSTURE REGISTRY (docs/attention-plan.md · A8) — the sentence-form layer OVER `inbox_rules`.
//
// TWO DOORS, ONE STORE. A posture IS a rule row wearing a sentence: no new table, no second store,
// no parallel evaluation. The deterministic rules engine (lib/inbox/rules/*) stays the substrate —
// its matching semantics are read here and NEVER changed. Everything in this module is either a
// pure render over an existing row, a validated authoring door onto the same row shape, or an
// honest count over data that already exists.
//
// The forcing fact: 22 rules platform-wide, all default-seeded, zero user-created ever. Nobody
// configures a condition builder. People correct, in sentences. So the sentence is the object.
//
// THREE FLOORS this module enforces:
//  1. RENDER IS DETERMINISTIC AND TOTAL — every row (defaults included) renders as a sentence with
//     zero AI. An unrenderable row gets an honest generic sentence naming its rule name, never ''.
//  2. THE PARSE IS CODE-VALIDATED — the reasoned pass PROPOSES; `validatePrimitives` disposes
//     against the engine's real vocabulary. Anything outside it refuses WITH A REASON; a silently
//     wrong rule is never written.
//  3. THE EGRESS FLOOR — `forward_to` is deliberately NOT in the authoring vocabulary. A rule must
//     never open a path that mails a user's correspondence to a third party. W10: it is not in the
//     advanced editor either, and nothing executes it — no surface claims it.
//  4. W10 NO LYING DOORS — the authorable vocabulary IS the executed set (lib/inbox/rules/label-name.ts
//     EXECUTED_OUTCOME_KEYS; the executor is lib/inbox/rules/execute.ts). `auto_draft` and
//     `escalate` were authorable and executed by nothing — they are refused now, and the renderer
//     never speaks a verb nothing performs.

import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { matchesFilters } from '@/lib/inbox/rules/evaluate';
import { AUTHORABLE_RULE_OUTCOME_KEYS, MAILBOX_OUTCOME_KEYS, UNEXECUTED_OUTCOME_KEYS, validateUserLabelName } from '@/lib/inbox/rules/label-name';
import type { Condition, ConditionField, InboxRule, MatchMode, RuleEmail, RuleLabel, RuleOutcome, RuleTrigger } from '@/lib/inbox/rules/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

/** The stored row, as the rules table serves it. */
export type PostureRow = InboxRule & { id: string; connection_id?: string | null };

/** The outcome shape PLUS the posture's own verbatim sentence.
 *  WHERE THE SENTENCE LIVES: `outcome.posture.sentence`, inside the existing `outcome` jsonb —
 *  no migration, and the engine is untouched (write-back/execute read named outcome keys only, so
 *  an extra key is inert). `name` alone would not do: a rule authored in the ADVANCED editor also
 *  has a name, and rendering "My rule" verbatim as a posture sentence would be a lie. The presence
 *  of `outcome.posture.sentence` is exactly the fact "a human authored this as a sentence". */
export type PostureOutcome = RuleOutcome & { posture?: { sentence?: string } };

export type PosturePrimitives = {
  trigger: RuleTrigger;
  match_mode: MatchMode;
  conditions: Condition[];
  ai_match: string | null;
  outcome: RuleOutcome;
};

export type Posture = {
  id: string;
  /** The sentence shown to the user — verbatim when authored, derived otherwise. */
  sentence: string;
  /** True when the sentence is the user's own words, stored and served back byte-identical. */
  verbatim: boolean;
  /** Default-seeded rows render as postures too, quietly labelled "built-in". */
  builtin: boolean;
  enabled: boolean;
  priority: number;
  connection_id: string | null;
  primitives: PosturePrimitives;
};

// ── THE VOCABULARY (the engine's, mirrored — validation reads THESE, never the model's word) ─────

export const CONDITION_FIELDS: ConditionField[] = [
  'from', 'not_from', 'to', 'not_to', 'cc', 'not_cc',
  'subject_contains', 'subject_excludes', 'body_contains', 'body_excludes',
  'has_label', 'has_no_label',
];

export const RULE_LABELS: RuleLabel[] = ['needs_reply', 'to_do', 'waiting_on', 'meeting', 'fyi', 'notifications', 'marketing', 'done'];
export const RULE_KINDS = ['receipt', 'newsletter', 'notification', 'calendar', 'cold_outreach', 'customer', 'team', 'personal'] as const;

/** Outcome keys a SENTENCE may author — exactly the EXECUTED set (W10). `forward_to` is absent by
 *  design (the egress floor); `auto_draft` / `escalate` are absent because nothing executes them. */
export const AUTHORABLE_OUTCOME_KEYS = AUTHORABLE_RULE_OUTCOME_KEYS;

const LABEL_WORD: Record<RuleLabel, string> = {
  needs_reply: 'Needs reply', to_do: 'To do', waiting_on: 'Waiting on', meeting: 'Meeting',
  fyi: 'FYI', notifications: 'Notifications', marketing: 'Marketing', done: 'Done',
};
// ── W11.3 · RULES SORT MAIL IN AUGMTD (WHAT THE SCREEN SAYS IS TRUE — owner walk Sep 23) ────────
// After W10 a rule's `set_type` is an IN-APP SORT: it decides which lane the mail lands in inside
// AUGMTD (lib/inbox/rules/types.ts LABEL_TO_TYPE). It writes a mailbox label ONLY when the account
// chose the mirror (augmtdLabelsOn) AND the posture is one the mirror still writes (Needs reply ·
// To do · Waiting on · Done). Meeting / Notifications / Marketing / FYI are no mailbox labels at all
// any more — in-app they are awareness mail of a given kind. The built-in rows used to read "Label
// mail … as Notifications" to an account with labels OFF: three lies in one line. So the sentence
// speaks SORTING, and names the mailbox only when the mailbox is actually touched.
/** How a sentence names the in-app sort a set_type performs. */
export const SORT_PHRASE: Record<RuleLabel, string> = {
  needs_reply: 'Needs reply', to_do: 'To do', waiting_on: 'Waiting on', done: 'Done',
  fyi: 'for your awareness',
  notifications: 'a notification (for your awareness)',
  meeting: 'a calendar update (for your awareness)',
  marketing: 'marketing (for your awareness)',
};
/** How a receipt names the same sort ("N messages sorted as …"). */
const SORT_COUNT_WORD: Record<RuleLabel, string> = {
  needs_reply: 'Needs reply', to_do: 'To do', waiting_on: 'Waiting on', done: 'Done',
  fyi: 'for your awareness', notifications: 'notifications', meeting: 'calendar updates', marketing: 'marketing',
};
/** The postures the mailbox mirror still writes (mirrors lib/inbox/rules/write-back.ts
 *  AUGMTD_LIVE_POSTURE_LABELS — smoke-screen-truth asserts the two never drift). */
export const MIRRORED_POSTURES: readonly RuleLabel[] = ['needs_reply', 'to_do', 'waiting_on', 'done'];
/** Render context: whether the account chose the mailbox mirror (email_settings.auto_label). */
export type RenderOpts = { mirrorOn?: boolean };

const KIND_WORD: Record<string, string> = {
  receipt: 'a receipt', newsletter: 'a newsletter', notification: 'a notification', calendar: 'a calendar update',
  cold_outreach: 'cold outreach', customer: 'customer mail', team: 'team mail', personal: 'personal mail',
};
const FIELD_PHRASE: Record<ConditionField, (vals: string) => string> = {
  from: (v) => `from ${v}`,
  not_from: (v) => `not from ${v}`,
  to: (v) => `addressed to ${v}`,
  not_to: (v) => `not addressed to ${v}`,
  cc: (v) => `copied to ${v}`,
  not_cc: (v) => `not copied to ${v}`,
  subject_contains: (v) => `with ${v} in the subject`,
  subject_excludes: (v) => `without ${v} in the subject`,
  body_contains: (v) => `mentioning ${v}`,
  body_excludes: (v) => `not mentioning ${v}`,
  has_label: (v) => `carrying the mailbox label ${v}`,
  has_no_label: (v) => `not carrying the mailbox label ${v}`,
};

// ── 1 · THE RENDERER — deterministic, total, zero AI ─────────────────────────────────────────────

const quote = (s: string) => `“${s}”`;
const joinList = (parts: string[], conj: string): string => {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} ${conj} ${parts[parts.length - 1]}`;
};
// Lower-case the first letter so a description reads inside a "… when <x>" clause — but never
// destroy a word that is capitalised for its own sake ("I sent a message", "Gmail marks it").
const lowerFirst = (s: string) => {
  if (!s) return s;
  const firstWord = s.split(/\s/)[0];
  if (/^I\b/.test(s) || (firstWord.length > 1 && firstWord === firstWord.toUpperCase())) return s;
  return s[0].toLowerCase() + s.slice(1);
};
const stripTrailingPeriod = (s: string) => s.replace(/\s*[.;]+\s*$/, '');

/** "from “no-reply”, “noreply” or “mailer-daemon”" — same-field conditions collapse into one clause. */
function conditionPhrase(conditions: Condition[], mode: MatchMode): string {
  const groups: Array<{ field: ConditionField; values: string[] }> = [];
  for (const c of conditions) {
    if (!c || typeof c.value !== 'string' || !c.value.trim()) continue;
    const field = c.field as ConditionField;
    if (!FIELD_PHRASE[field]) continue;
    const last = groups[groups.length - 1];
    if (last && last.field === field) last.values.push(c.value);
    else groups.push({ field, values: [c.value] });
  }
  if (!groups.length) return '';
  const conj = mode === 'any' ? 'or' : 'and';
  const clauses = groups.map((g) => {
    const isLabel = g.field === 'has_label' || g.field === 'has_no_label';
    // W11.3 · Gmail's own categories read as Gmail's words, not as raw ids ("CATEGORY_PROMOTIONS").
    if (isLabel && g.values.every((v) => /^CATEGORY_[A-Z]+$/.test(v))) {
      const cats = joinList(g.values.map((v) => v.slice(9).charAt(0) + v.slice(10).toLowerCase()), conj);
      return g.field === 'has_label' ? `that Gmail files under ${cats}` : `that Gmail does not file under ${cats}`;
    }
    return FIELD_PHRASE[g.field](joinList(g.values.map((v) => (isLabel ? v : quote(v))), conj));
  });
  return joinList(clauses, conj);
}

/** The verb phrases a rule's outcome actually performs — derived from the data, never a fixed subset. */
function outcomeVerbs(outcome: RuleOutcome, subject: string, opts: RenderOpts = {}): string[] {
  const verbs: string[] = [];
  const push = (first: string, rest: string) => verbs.push(verbs.length ? rest : first);
  const o = outcome ?? {};
  if (o.set_type && SORT_PHRASE[o.set_type]) {
    push(`Treat ${subject} as ${SORT_PHRASE[o.set_type]}`, `treat it as ${SORT_PHRASE[o.set_type]}`);
    // The mailbox is named only when it is actually touched: the mirror is ON and this posture is
    // one the mirror writes (W11.3).
    if (opts.mirrorOn && (MIRRORED_POSTURES as readonly string[]).includes(o.set_type)) {
      verbs.push(`label it AUGMTD/${LABEL_WORD[o.set_type]} in my mailbox`);
    }
  }
  if (o.set_kind && KIND_WORD[o.set_kind]) push(`Treat ${subject} as ${KIND_WORD[o.set_kind]}`, `treat it as ${KIND_WORD[o.set_kind]}`);
  if (o.apply_label && typeof o.apply_label === 'string') push(`File ${subject} under my mailbox label ${quote(o.apply_label)}`, `file it under my mailbox label ${quote(o.apply_label)}`);
  if (o.mark_read) push(`Mark ${subject} as read`, 'mark it read');
  if (o.trash) push(`Move ${subject} to trash`, 'move it to trash');
  else if (o.archive) push(`Archive ${subject}`, 'archive it');
  // W10 — NO LYING VERB: auto_draft / escalate / forward_to may sit on legacy rows, but nothing
  // executes them, so the sentence never says them (the executed set is label-name.ts's).
  return verbs;
}

/**
 * THE SENTENCE. Total function: every rule row renders as one non-empty plain sentence.
 * - A posture authored as a sentence returns THAT sentence, byte-identical (PS4).
 * - Anything else (every default-seeded rule included) is derived from conditions + outcome.
 * - A row whose primitives say nothing renderable falls back to an honest generic sentence that
 *   names the rule — never a fabricated description of what it does.
 * ZERO AI. This function must never import or construct an AI client (gate PS1 asserts it).
 */
export function renderPostureSentence(rule: Partial<PostureRow> | null | undefined, opts: RenderOpts = {}): string {
  if (!rule) return 'Apply this rule.';
  const outcome = (rule.outcome ?? {}) as PostureOutcome;
  const authored = outcome.posture?.sentence;
  if (typeof authored === 'string' && authored.trim()) return authored;

  const trigger = rule.trigger === 'sent' ? 'sent' : 'received';
  const object = trigger === 'sent' ? 'mail I send' : 'mail';
  const ai = typeof rule.ai_match === 'string' && rule.ai_match.trim() ? rule.ai_match.trim() : null;
  const conds = Array.isArray(rule.conditions) ? (rule.conditions as Condition[]) : [];
  const phrase = ai ? '' : conditionPhrase(conds, (rule.match_mode as MatchMode) ?? 'all');
  const subject = phrase ? `${object} ${phrase}` : object;
  const when = ai ? ` when ${lowerFirst(stripTrailingPeriod(ai))}` : '';

  const verbs = outcomeVerbs((rule.outcome ?? {}) as RuleOutcome, subject, opts);
  if (!verbs.length) {
    const named = (rule.name ?? '').trim();
    const head = named ? `Apply the ${quote(named)} rule` : 'Apply this rule';
    return `${head}${phrase ? ` to ${subject}` : ''}${when}.`;
  }
  return `${joinList(verbs, 'and')}${when}.`;
}

// ── 2 · THE CODE-VALIDATION FLOOR ────────────────────────────────────────────────────────────────

export type ValidationResult = { ok: true; value: PosturePrimitives } | { ok: false; reason: string };

const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * The disposer. A parse result is only a CANDIDATE until every field survives the engine's real
 * vocabulary. Unknown condition field, unknown outcome key, unknown label/kind, empty value,
 * no effect at all → refuse WITH THE REASON. Pure, synchronous, independently testable (PS3).
 */
export function validatePrimitives(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'The parse returned nothing usable.' };
  const r = raw as Record<string, unknown>;

  const trigger: RuleTrigger = r.trigger === 'sent' ? 'sent' : 'received';
  if (r.trigger != null && r.trigger !== 'sent' && r.trigger !== 'received') {
    return { ok: false, reason: `“${String(r.trigger)}” is not a trigger I can act on — mail is either received or sent.` };
  }
  const match_mode: MatchMode = r.match_mode === 'any' ? 'any' : 'all';
  if (r.match_mode != null && r.match_mode !== 'any' && r.match_mode !== 'all') {
    return { ok: false, reason: `“${String(r.match_mode)}” is not a match mode — it is either all or any.` };
  }

  // Conditions.
  const rawConds = Array.isArray(r.conditions) ? r.conditions : [];
  const conditions: Condition[] = [];
  for (const c of rawConds) {
    if (!c || typeof c !== 'object') return { ok: false, reason: 'One of the conditions was not readable.' };
    const { field, value } = c as { field?: unknown; value?: unknown };
    if (!isStr(field) || !CONDITION_FIELDS.includes(field as ConditionField)) {
      return { ok: false, reason: `I can't match on “${String(field)}” — I can only look at ${CONDITION_FIELDS.join(', ')}.` };
    }
    if (!isStr(value) || !value.trim()) return { ok: false, reason: `The “${field}” condition needs something to look for.` };
    if (value.length > 200) return { ok: false, reason: 'That condition value is too long to be a reliable match.' };
    conditions.push({ field: field as ConditionField, value: value.trim() });
  }

  // AI match. An AI rule carries NO deterministic conditions (the engine's own split:
  // evaluateDeterministic only ever considers rules with ai_match === null).
  let ai_match: string | null = null;
  if (r.ai_match != null && r.ai_match !== '') {
    if (!isStr(r.ai_match) || r.ai_match.trim().length < 5) return { ok: false, reason: 'The description of what to match is too short to judge mail by.' };
    ai_match = r.ai_match.trim();
  }
  if (!ai_match && !conditions.length) return { ok: false, reason: "I couldn't tell which mail this is about." };
  const finalConditions = ai_match ? [] : conditions;

  // Outcome.
  const rawOut = (r.outcome && typeof r.outcome === 'object' ? r.outcome : {}) as Record<string, unknown>;
  const outcome: RuleOutcome = {};
  for (const key of Object.keys(rawOut)) {
    if (rawOut[key] == null || rawOut[key] === false) continue;
    if (key === 'forward_to') {
      return { ok: false, reason: 'I won’t forward your mail to someone else from a rule — sending anything anywhere stays your own click, on purpose.' };
    }
    if ((UNEXECUTED_OUTCOME_KEYS as readonly string[]).includes(key)) {
      const o = rawOut[key];
      if (typeof o === 'object' && (o as Record<string, unknown>).enabled !== true) continue; // switched off — says nothing
      return key === 'auto_draft'
        ? { ok: false, reason: 'I don’t draft per rule — whether I draft replies is set once, in Settings → Drafting.' }
        : { ok: false, reason: 'I can’t flag or notify you from a rule yet — I won’t promise something I don’t do.' };
    }
    if (!(AUTHORABLE_OUTCOME_KEYS as readonly string[]).includes(key)) {
      return { ok: false, reason: `I can’t do “${key}”. I can sort mail, treat it as a kind, file it under your own mailbox label, mark it read, archive it, or trash it.` };
    }
    const v = rawOut[key];
    switch (key) {
      case 'set_type':
        if (!isStr(v) || !RULE_LABELS.includes(v as RuleLabel)) return { ok: false, reason: `“${String(v)}” isn’t one of my labels (${RULE_LABELS.join(', ')}).` };
        outcome.set_type = v as RuleLabel;
        break;
      case 'set_kind':
        if (!isStr(v) || !(RULE_KINDS as readonly string[]).includes(v)) return { ok: false, reason: `“${String(v)}” isn’t one of my mail kinds (${RULE_KINDS.join(', ')}).` };
        outcome.set_kind = v as RuleOutcome['set_kind'];
        break;
      case 'apply_label': {
        const v2 = validateUserLabelName(v);
        if (!v2.ok) return { ok: false, reason: v2.reason };
        outcome.apply_label = v2.name;
        break;
      }
      case 'mark_read': outcome.mark_read = true; break;
      case 'archive': outcome.archive = true; break;
      case 'trash': outcome.trash = true; break;
    }
  }
  if (!Object.keys(outcome).length) return { ok: false, reason: "I understood which mail you mean, but not what you want done with it." };
  // W10 — mailbox deeds act on mail as it ARRIVES; a sent-mail rule carrying one would be a promise
  // the executor never keeps (lib/inbox/rules/execute.ts plans mailbox deeds for 'received' only).
  if (trigger === 'sent' && (MAILBOX_OUTCOME_KEYS as readonly string[]).some((k) => (outcome as Record<string, unknown>)[k])) {
    return { ok: false, reason: 'I act on your mailbox as mail arrives — I can’t label, archive, mark read or trash mail you send.' };
  }

  return { ok: true, value: { trigger, match_mode, conditions: finalConditions, ai_match, outcome } };
}

// ── 3 · THE AUTHORING DOOR — one reasoned pass, then the floor ───────────────────────────────────

export type ParseOutcome =
  | { ok: true; primitives: PosturePrimitives; sentence: string; understood: string }
  | { ok: false; reason: string };

const PARSE_SYSTEM = `You turn ONE sentence a person wrote about their own email into a mail-triage rule.

The person may write in ANY language. Read their intent; do not translate the rule vocabulary.

You may ONLY use this vocabulary. Anything outside it must be refused.

conditions[] — deterministic, each {"field","value"}; field is one of:
  from, not_from, to, not_to, cc, not_cc,
  subject_contains, subject_excludes, body_contains, body_excludes,
  has_label, has_no_label            (has_label = a MAILBOX label, e.g. CATEGORY_PROMOTIONS)
match_mode — "all" or "any" (how the conditions combine)
trigger — "received" (mail arriving) or "sent" (mail the person sends)
ai_match — a short natural-language description, used INSTEAD of conditions when the intent is a
  judgement rather than a literal string match ("anything from a customer chasing an invoice").
  When you set ai_match, leave conditions empty.
outcome — one or more of:
  set_type: needs_reply | to_do | waiting_on | meeting | fyi | notifications | marketing | done
  set_kind: receipt | newsletter | notification | calendar | cold_outreach | customer | team | personal
  apply_label: "<the person's OWN label name, exactly as they said it, e.g. Clients/Acme>"
               (a Gmail label / Outlook category; "/" nests; never invent a name they did not say)
  archive: true      mark_read: true      trash: true
  (apply_label / archive / mark_read / trash act on mail as it ARRIVES — trigger "received" only)

NOT SUPPORTED — refuse if asked: forwarding mail to another address, sending messages anywhere
(SMS, WhatsApp, Slack), drafting or replying per rule, flagging/notifying/escalating, deleting
permanently, snoozing, anything outside email triage.

Quote-then-verify: only assert a condition value the person's own sentence contains or plainly
implies. Never invent a sender, a domain, or a keyword they did not state.

Respond with ONLY JSON.
  Understood:  {"ok":true,"trigger":"...","match_mode":"...","conditions":[...],"ai_match":null,"outcome":{...}}
  Refused:     {"ok":false,"reason":"<one plain sentence saying what you can't do>"}`;

/**
 * THE AUTHORING DOOR. One classification-tier reasoned pass PROPOSES; `validatePrimitives`
 * DISPOSES. The caller gets back both the stored primitive form and a re-rendered sentence, so the
 * surface can show "understood as: …" before anything is written.
 */
export async function parsePostureSentence(client: DBClient, userId: string, sentence: string): Promise<ParseOutcome> {
  const said = (sentence ?? '').trim();
  if (!said) return { ok: false, reason: 'Say what you want me to do with which mail.' };
  if (said.length > 600) return { ok: false, reason: 'That is longer than one posture — say it as a single sentence.' };

  let raw: Record<string, unknown>;
  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(ai, {
      model,
      messages: [{ role: 'system', content: PARSE_SYSTEM }, { role: 'user', content: said }],
      max_tokens: 700,
      temperature: 0,
    });
    raw = parseModelJSON<Record<string, unknown>>(res.choices[0]?.message?.content || '', {});
  } catch {
    return { ok: false, reason: "I couldn't read that just now — try saying it again." };
  }

  if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) return { ok: false, reason: "I couldn't turn that into something I can act on." };
  if (raw.ok === false) {
    const reason = isStr(raw.reason) && raw.reason.trim() ? raw.reason.trim() : "That isn't something I can do to your mail.";
    return { ok: false, reason };
  }

  const validated = validatePrimitives(raw);
  if (!validated.ok) return validated;

  // The show-back is rendered from the VALIDATED primitives — never from the model's prose. What
  // the user reads back is what the engine will actually do.
  const understood = renderPostureSentence({ name: said, ...validated.value } as Partial<PostureRow>);
  return { ok: true, primitives: validated.value, sentence: said, understood };
}

// ── 4 · RECEIPTS — honest by construction ────────────────────────────────────────────────────────

/**
 * WHAT THE DATA ALLOWS. `inbox_items` stores the LABEL a matched rule applied (`rule_type`); it has
 * never stored WHICH rule applied it. So "this posture archived 12 this month" is not a claim the
 * data can back, and this module does not make it. Two honest forms instead:
 *
 *  - `conditions_match` (deterministic postures): the posture's own conditions are re-evaluated IN
 *    CODE against the mail actually stored for this account in the window → "currently matching N
 *    of the last 30 days' mail". A real, reproducible number.
 *  - `label_count` (AI postures): the count of items carrying this posture's label in the window.
 *    When more than one live posture writes that label, the sentence SAYS SO ("shared with 1
 *    other") rather than claiming the whole count as this posture's work.
 *
 * A posture with no effect reports a zero. Never an absent line.
 */
export type ReceiptForm = 'conditions_match' | 'label_count' | 'no_effect';
export type PostureReceipt = {
  ruleId: string;
  form: ReceiptForm;
  count: number;
  /** How many other LIVE postures write the same label (label_count form only). */
  sharedWith: number;
  /** How much mail the count was computed over (conditions_match form only). */
  scanned: number;
  /** The line the surface shows. Never claims more than the computation supports. */
  line: string;
};

export const RECEIPT_WINDOW_DAYS = 30;
const RECEIPT_SCAN_CAP = 3000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function postureReceipts(
  client: DBClient,
  userId: string,
  rules: PostureRow[] | string,
  opts: { connectionId?: string | null } = {},
): Promise<Map<string, PostureReceipt>> {
  const out = new Map<string, PostureReceipt>();
  let rows: PostureRow[];
  if (typeof rules === 'string') {
    const { data } = await client.from('inbox_rules').select('*').eq('user_id', userId).eq('id', rules);
    rows = (data ?? []) as PostureRow[];
  } else {
    rows = rules ?? [];
  }
  if (!rows.length) return out;

  const since = new Date(Date.now() - RECEIPT_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const connectionId = opts.connectionId ?? rows.find((r) => r.connection_id)?.connection_id ?? null;

  const deterministic = rows.filter((r) => !r.ai_match && Array.isArray(r.conditions) && r.conditions.length);
  const aiRules = rows.filter((r) => !!r.ai_match);

  // ── the deterministic half: re-evaluate the posture's own conditions over real stored mail ──
  let scanned = 0;
  if (deterministic.length) {
    const mails: RuleEmail[] = [];
    for (let from = 0; from < RECEIPT_SCAN_CAP; from += 1000) {
      let q = client.from('emails')
        .select('id, from_address, to_addresses, cc_addresses, subject, body, labels, is_from_user')
        .eq('user_id', userId).gte('received_at', since)
        .order('received_at', { ascending: false }).range(from, from + 999);
      if (connectionId) q = q.eq('connection_id', connectionId);
      const { data } = await q;
      const page = (data ?? []) as Array<Record<string, unknown>>;
      for (const e of page) {
        mails.push({
          direction: e.is_from_user ? 'sent' : 'received',
          from: String(e.from_address ?? ''),
          to: (e.to_addresses as string[]) ?? [],
          cc: (e.cc_addresses as string[]) ?? [],
          subject: String(e.subject ?? ''),
          body: String(e.body ?? ''),
          labels: (e.labels as string[]) ?? [],
        });
      }
      if (page.length < 1000) break;
    }
    scanned = mails.length;
    for (const r of deterministic) {
      // matchesFilters is the ENGINE's own matcher, imported read-only — receipts and triage can
      // never disagree about what a condition means.
      const count = mails.filter((m) => m.direction === r.trigger && matchesFilters(m, r as InboxRule)).length;
      out.set(r.id, {
        ruleId: r.id, form: 'conditions_match', count, sharedWith: 0, scanned,
        line: `Currently matching ${plural(count, 'message', 'messages')} of the last ${RECEIPT_WINDOW_DAYS} days’ mail${scanned ? ` (${scanned} scanned)` : ''}.`,
      });
    }
  }

  // ── the AI half: the label is all the data records, so the label is all we claim ──
  if (aiRules.length) {
    const liveByLabel = new Map<string, number>();
    for (const r of rows) {
      const l = (r.outcome as RuleOutcome | null)?.set_type;
      if (r.enabled && l) liveByLabel.set(l, (liveByLabel.get(l) ?? 0) + 1);
    }
    for (const r of aiRules) {
      const label = (r.outcome as RuleOutcome | null)?.set_type;
      if (!label) {
        out.set(r.id, { ruleId: r.id, form: 'no_effect', count: 0, sharedWith: 0, scanned: 0, line: 'This rule sorts nothing, so there is nothing to count yet.' });
        continue;
      }
      const { count } = await client.from('inbox_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('rule_type', label).gte('created_at', since);
      const n = count ?? 0;
      const sharedWith = Math.max(0, (liveByLabel.get(label) ?? 1) - 1);
      // W11.3 · THE COUNT SAYS WHAT IT MEASURES: `inbox_items.rule_type` is the IN-APP sort, not a
      // mailbox label — the line says "sorted as … in AUGMTD", never "carry the … label".
      const word = SORT_COUNT_WORD[label as RuleLabel] ?? label;
      out.set(r.id, {
        ruleId: r.id, form: 'label_count', count: n, sharedWith, scanned: 0,
        line: sharedWith > 0
          ? `${plural(n, 'message', 'messages')} sorted as ${word} in AUGMTD in the last ${RECEIPT_WINDOW_DAYS} days — shared with ${plural(sharedWith, 'other rule', 'other rules')}, so not all of it is this rule’s doing.`
          : `${plural(n, 'message', 'messages')} sorted as ${word} in AUGMTD in the last ${RECEIPT_WINDOW_DAYS} days.`,
      });
    }
  }

  // Every row gets a line — a posture with no computable effect says zero, never nothing.
  for (const r of rows) {
    if (out.has(r.id)) continue;
    out.set(r.id, { ruleId: r.id, form: 'no_effect', count: 0, sharedWith: 0, scanned: 0, line: 'Nothing matched yet — this posture has had no effect I can count.' });
  }
  return out;
}

// ── 5 · CRUD — thin over the SAME store the rules routes write ───────────────────────────────────

export function toPosture(row: PostureRow, opts: RenderOpts = {}): Posture {
  const outcome = (row.outcome ?? {}) as PostureOutcome;
  return {
    id: row.id,
    sentence: renderPostureSentence(row, opts),
    verbatim: !!(outcome.posture?.sentence && outcome.posture.sentence.trim()),
    builtin: row.source === 'default' || row.source === 'workspace',
    enabled: !!row.enabled,
    priority: row.priority ?? 100,
    connection_id: row.connection_id ?? null,
    primitives: {
      trigger: (row.trigger as RuleTrigger) ?? 'received',
      match_mode: (row.match_mode as MatchMode) ?? 'all',
      conditions: (row.conditions as Condition[]) ?? [],
      ai_match: row.ai_match ?? null,
      outcome: (row.outcome ?? {}) as RuleOutcome,
    },
  };
}

export async function listPostures(client: DBClient, userId: string, connectionId?: string | null): Promise<Posture[]> {
  let q = client.from('inbox_rules').select('*').eq('user_id', userId);
  if (connectionId) q = q.eq('connection_id', connectionId);
  const { data } = await q.order('priority', { ascending: true });
  return ((data ?? []) as PostureRow[]).map((r) => toPosture(r));
}

export type CreatePostureResult = { ok: true; posture: Posture; understood: string } | { ok: false; reason: string };

/**
 * THE ONE WRITER. Both doors land here: the Settings surface (via /api/postures) and the spoken
 * door (a correction in conversation, a bulk deed's "keep doing this?" tail). One store, one
 * validation floor, one place the verbatim sentence is stamped.
 *
 * The deeds side calls exactly this:
 *   createPosture(client, userId, sentence, { connectionId })
 * and gets back either the created posture (with `understood` for the show-back) or a refusal
 * reason to speak. It never needs to know a condition field exists.
 */
export async function createPosture(
  client: DBClient,
  userId: string,
  sentence: string,
  opts: { connectionId?: string | null; primitives?: PosturePrimitives } = {},
): Promise<CreatePostureResult> {
  const said = (sentence ?? '').trim();
  let primitives: PosturePrimitives;
  let understood: string;

  if (opts.primitives) {
    // A pre-parsed candidate still passes the floor — the client is never trusted with primitives.
    const v = validatePrimitives(opts.primitives);
    if (!v.ok) return v;
    primitives = v.value;
    understood = renderPostureSentence({ name: said, ...primitives } as Partial<PostureRow>);
  } else {
    const parsed = await parsePostureSentence(client, userId, said);
    if (!parsed.ok) return parsed;
    primitives = parsed.primitives;
    understood = parsed.understood;
  }

  const connectionId = opts.connectionId ?? null;
  let q = client.from('inbox_rules').select('priority').eq('user_id', userId);
  q = connectionId ? q.eq('connection_id', connectionId) : q.is('connection_id', null);
  const { data: minRow } = await q.order('priority', { ascending: true }).limit(1).maybeSingle();
  // A user's own posture LEADS: a correction must outrank the defaults it corrects, so it seats one
  // step above the current first rule (floored at 1 — ties are resolved by the engine's stable sort).
  const priority = Math.max(1, (minRow?.priority ?? 10) - 1);

  const outcome: PostureOutcome = { ...primitives.outcome, posture: { sentence: said } };
  const { data, error } = await client.from('inbox_rules').insert({
    user_id: userId,
    connection_id: connectionId,
    name: said.slice(0, 200),
    enabled: true,
    priority,
    trigger: primitives.trigger,
    match_mode: primitives.match_mode,
    conditions: primitives.conditions,
    ai_match: primitives.ai_match,
    outcome,
    source: 'user',
  }).select('*').single();
  if (error || !data) return { ok: false, reason: error?.message || 'Could not save that.' };
  return { ok: true, posture: toPosture(data as PostureRow), understood };
}

export type UpdatePostureResult = { ok: true; posture: Posture; understood?: string } | { ok: false; reason: string };

/** Re-say (re-parses through the same door) and/or toggle. Nothing else is editable by sentence. */
export async function updatePosture(
  client: DBClient,
  userId: string,
  ruleId: string,
  patch: { sentence?: string; enabled?: boolean; primitives?: PosturePrimitives },
): Promise<UpdatePostureResult> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let understood: string | undefined;

  if (typeof patch.enabled === 'boolean') update.enabled = patch.enabled;

  const said = (patch.sentence ?? '').trim();
  if (said) {
    let primitives: PosturePrimitives;
    if (patch.primitives) {
      const v = validatePrimitives(patch.primitives);
      if (!v.ok) return v;
      primitives = v.value;
      understood = renderPostureSentence({ name: said, ...primitives } as Partial<PostureRow>);
    } else {
      const parsed = await parsePostureSentence(client, userId, said);
      if (!parsed.ok) return parsed;
      primitives = parsed.primitives;
      understood = parsed.understood;
    }
    update.name = said.slice(0, 200);
    update.trigger = primitives.trigger;
    update.match_mode = primitives.match_mode;
    update.conditions = primitives.conditions;
    update.ai_match = primitives.ai_match;
    update.outcome = { ...primitives.outcome, posture: { sentence: said } } as PostureOutcome;
    update.source = 'user'; // re-saying a built-in makes it yours
  }

  const { data, error } = await client.from('inbox_rules')
    .update(update).eq('id', ruleId).eq('user_id', userId).select('*').single();
  if (error || !data) return { ok: false, reason: error?.message || 'Could not update that.' };
  return { ok: true, posture: toPosture(data as PostureRow), understood };
}

export async function deletePosture(client: DBClient, userId: string, ruleId: string): Promise<{ ok: boolean; reason?: string }> {
  const { error } = await client.from('inbox_rules').delete().eq('id', ruleId).eq('user_id', userId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}
