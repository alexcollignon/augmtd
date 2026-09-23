// ════════════════════════════════════════════════════════════════════════════════════════════════
// W10 THE MAILBOX IS THE USER'S — the rule outcome vocabulary + the user-label name floor.
//
// CLIENT-SAFE BY CONSTRUCTION (pure, zero imports): the Settings rule editor validates a label name
// with the SAME function the server re-runs (lib/postures/registry.ts validatePrimitives and the
// /api/inbox/rules routes via sanitizeRuleOutcome), so the editor can never accept a name the
// server refuses.
//
// ── THE ONE SWITCH SEMANTICS (owner call, Sep 23) ────────────────────────────────────────────────
//   `profiles.email_settings.auto_label` governs ONE thing: AUGMTD's OWN posture labels
//   (AUGMTD/Needs reply · To do · Waiting on → Done). It is OFF unless the account explicitly set
//   it to true — an account that never chose is never labelled.
//   A USER RULE's mailbox outcomes (apply_label · mark_read · archive · trash) are the user's own
//   standing instruction, like a Gmail filter: they apply whatever auto_label says. Their switch is
//   the rule itself — its `enabled` toggle, or deleting it. There is no second hidden kill-switch.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** THE ONE READER of the AUGMTD-labels switch: ON only when the account explicitly chose it. */
export function augmtdLabelsOn(settings: { auto_label?: unknown } | null | undefined): boolean {
  return settings?.auto_label === true;
}

/** Outcome keys something EXECUTES (lib/inbox/rules/execute.ts + the in-app classifiers). */
export const EXECUTED_OUTCOME_KEYS = ['set_type', 'set_kind', 'apply_label', 'mark_read', 'archive', 'trash'] as const;
/** Outcome keys the user may author — exactly the executed set (no lying doors). */
export const AUTHORABLE_RULE_OUTCOME_KEYS = EXECUTED_OUTCOME_KEYS;
/** Keys that exist on legacy rows but that NOTHING executes. Never authorable; stripped on save.
 *  `forward_to` is an external send — it stays unexecuted and unauthorable by design (the egress
 *  floor + human-in-the-loop). `auto_draft` / `escalate` were per-rule promises no code kept:
 *  drafting is the account-level Drafting setting, and there is no per-rule escalation. */
export const UNEXECUTED_OUTCOME_KEYS = ['forward_to', 'auto_draft', 'escalate'] as const;

/** The outcome keys that touch the user's MAILBOX (provider writes) — they run only on mail as it
 *  arrives (trigger 'received'); a rule on sent mail cannot carry them. */
export const MAILBOX_OUTCOME_KEYS = ['apply_label', 'mark_read', 'archive', 'trash'] as const;

/** The namespace AUGMTD writes under. A user label may never claim it — so the cleanup that removes
 *  AUGMTD's own labels can never touch a label the user named. */
export const AUGMTD_NAMESPACE = 'AUGMTD';

const GMAIL_SYSTEM = new Set(['INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT', 'DRAFTS', 'UNREAD', 'STARRED', 'IMPORTANT', 'CHAT']);
export const USER_LABEL_MAX = 100;

export type LabelNameCheck = { ok: true; name: string } | { ok: false; reason: string };

/**
 * THE USER-LABEL NAME FLOOR. The user's own words, trimmed; '/' nests (Gmail nested labels —
 * Outlook keeps the name as one category). Refuses with a reason: empty, too long, control
 * characters, an empty path segment, a system label, or the AUGMTD namespace.
 */
export function validateUserLabelName(raw: unknown): LabelNameCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'A label needs a name.' };
  const name = raw.trim().replace(/\s*\/\s*/g, '/');
  if (!name) return { ok: false, reason: 'A label needs a name.' };
  if (name.length > USER_LABEL_MAX) return { ok: false, reason: `A label name can be at most ${USER_LABEL_MAX} characters.` };
  if (/[\u0000-\u001F\u007F-\u009F]/.test(name)) return { ok: false, reason: 'A label name cannot contain control characters.' };
  if (name.split('/').some((seg) => !seg.trim())) return { ok: false, reason: 'A label name cannot start or end with “/”, or contain “//”.' };
  const head = name.split('/')[0].trim().toUpperCase();
  if (head === AUGMTD_NAMESPACE) return { ok: false, reason: '“AUGMTD” is reserved for the labels AUGMTD writes — pick your own name.' };
  if (GMAIL_SYSTEM.has(name.toUpperCase()) || /^CATEGORY_/i.test(name)) return { ok: false, reason: `“${name}” is a built-in mailbox label — pick your own name.` };
  return { ok: true, name };
}

const SET_TYPES = new Set(['needs_reply', 'to_do', 'waiting_on', 'meeting', 'fyi', 'notifications', 'marketing', 'done']);
const SET_KINDS = new Set(['receipt', 'newsletter', 'notification', 'calendar', 'cold_outreach', 'customer', 'team', 'personal']);

export type OutcomeCheck = { ok: true; outcome: Record<string, unknown> } | { ok: false; reason: string };

/**
 * THE ADVANCED EDITOR'S FLOOR (W10) — what /api/inbox/rules stores. Keeps only EXECUTED keys (plus
 * the posture's own verbatim sentence, which rides the same jsonb); drops the unexecuted legacy keys
 * (forward_to · auto_draft · escalate) so a saved rule never carries a promise nothing keeps;
 * validates the user's label name; refuses mailbox deeds on a sent-mail rule. Pure, client-safe.
 */
export function sanitizeRuleOutcome(raw: unknown, trigger: unknown): OutcomeCheck {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.set_type === 'string' && o.set_type) {
    if (!SET_TYPES.has(o.set_type)) return { ok: false, reason: `“${o.set_type}” isn’t one of the sort labels.` };
    out.set_type = o.set_type;
  }
  if (typeof o.set_kind === 'string' && o.set_kind) {
    if (!SET_KINDS.has(o.set_kind)) return { ok: false, reason: `“${o.set_kind}” isn’t one of the mail kinds.` };
    out.set_kind = o.set_kind;
  }
  if (typeof o.apply_label === 'string' && o.apply_label.trim()) {
    const v = validateUserLabelName(o.apply_label);
    if (!v.ok) return { ok: false, reason: v.reason };
    out.apply_label = v.name;
  }
  if (o.mark_read === true) out.mark_read = true;
  if (o.trash === true) out.trash = true;
  else if (o.archive === true) out.archive = true;
  const posture = o.posture as { sentence?: unknown } | undefined;
  if (posture && typeof posture === 'object' && typeof posture.sentence === 'string') out.posture = { sentence: posture.sentence };
  if (trigger === 'sent' && MAILBOX_OUTCOME_KEYS.some((k) => out[k])) {
    return { ok: false, reason: 'Mailbox actions run on mail as it arrives — a rule on mail you send can only sort it.' };
  }
  return { ok: true, outcome: out };
}
