// Label write-back — AUGMTD's OWN mailbox labels.
//
// ── W10 THE MAILBOX IS THE USER'S (owner call, Sep 23) ───────────────────────────────────────────
//   1 · OFF BY DEFAULT. AUGMTD writes its own labels only for an account that EXPLICITLY set
//       `email_settings.auto_label = true` (the one reader: label-name.ts `augmtdLabelsOn`). An
//       account that never chose is never labelled.
//   2 · POSTURE ONLY. When on, AUGMTD writes the lifecycle labels alone — Needs reply · To do ·
//       Waiting on → Done. KIND labels (Receipt / Newsletter / Notification / Calendar / Cold
//       outreach / Customer / Team / Personal) are RETIRED from the mailbox: nothing here writes
//       them any more. The kind itself lives on in-app — `resolveKind` (override → reasoned
//       `understanding.mailKind` → structural fallback) still feeds the kind floor and routing —
//       it simply never becomes a mailbox label. The names stay listed below ONLY so the guarded
//       cleanup (scripts/remove-augmtd-labels.ts · lib/inbox/rules/mailbox-labels.ts) can find and
//       remove what earlier eras wrote.
//   3 · A USER RULE'S OWN LABEL (`outcome.apply_label`) is not AUGMTD's label — it is the user's
//       instruction, applied by lib/inbox/rules/execute.ts regardless of auto_label.
// Purely ADDITIVE in the mailbox — never archives, moves, or touches the user's own labels — and
// reversible (the cleanup removes every AUGMTD label). Gated on auto_label === true by every caller.

import type { RuleLabel } from './types';

const LABEL_DISPLAY: Record<RuleLabel, string> = {
  needs_reply: 'AUGMTD/Needs reply',
  to_do: 'AUGMTD/To do',
  waiting_on: 'AUGMTD/Waiting on',
  meeting: 'AUGMTD/Meeting',
  fyi: 'AUGMTD/FYI',
  notifications: 'AUGMTD/Notifications',
  marketing: 'AUGMTD/Marketing',
  done: 'AUGMTD/Done',
};

// ── THE KIND LABEL SET — RETIRED FROM THE MAILBOX (W10). Kept for the in-app resolver's key set and
// so the cleanup can recognise the labels earlier eras wrote. Nothing writes these names any more. ──
export type MailKindKey = 'receipt' | 'newsletter' | 'notification' | 'calendar' | 'cold_outreach' | 'customer' | 'team' | 'personal';
const KIND_DISPLAY: Record<MailKindKey, string> = {
  receipt: 'AUGMTD/Receipt',
  newsletter: 'AUGMTD/Newsletter',
  notification: 'AUGMTD/Notification',
  calendar: 'AUGMTD/Calendar',
  cold_outreach: 'AUGMTD/Cold outreach',
  customer: 'AUGMTD/Customer',
  team: 'AUGMTD/Team',
  personal: 'AUGMTD/Personal',
};
const KIND_KEYS: ReadonlySet<string> = new Set(Object.keys(KIND_DISPLAY));

/** The Gmail parent AUGMTD nests its labels under (Outlook categories use `AUGMTD: <name>`). */
export const AUGMTD_PARENT_LABEL = 'AUGMTD';
/** The posture labels AUGMTD still writes (when the account chose labels). */
export const AUGMTD_LIVE_POSTURE_LABELS: readonly string[] = ['needs_reply', 'to_do', 'waiting_on', 'done'].map((k) => LABEL_DISPLAY[k as RuleLabel]);
/** Every AUGMTD label nothing writes any more: the retired FYI/Meeting/Notifications/Marketing
 *  postures + every KIND label. The cleanup removes these from EVERY account. */
export const AUGMTD_RETIRED_LABELS: readonly string[] = [
  ...['meeting', 'fyi', 'notifications', 'marketing'].map((k) => LABEL_DISPLAY[k as RuleLabel]),
  ...Object.values(KIND_DISPLAY),
];
/** Every label name AUGMTD has ever created (Gmail form). Nothing outside this list is AUGMTD's. */
export const AUGMTD_ALL_LABELS: readonly string[] = [...AUGMTD_LIVE_POSTURE_LABELS, ...AUGMTD_RETIRED_LABELS];
/** The Outlook category form of an AUGMTD label name ('AUGMTD/Done' → 'AUGMTD: Done'). */
export const outlookCategoryOf = (gmailName: string): string => gmailName.replace('/', ': ');

export function mapWorkStateToLabel(ws?: string | null): RuleLabel {
  if (ws === 'work_prepared' || ws === 'decision_required') return 'needs_reply';
  if (ws === 'action_required') return 'to_do';
  if (ws === 'waiting') return 'waiting_on';
  return 'fyi';
}

/** THE KIND RESOLVER — one precedence chain, never per-surface:
 *  user/rule override (`source_data.kind_override`) → the reasoned `understanding.mailKind` →
 *  structural fallback (legacy rule taxonomy + bulk/noise header signals) → null (no kind label). */
export function resolveKind(
  sd: Record<string, unknown> | null | undefined,
  ruleType?: string | null,
  hints?: { bulk?: boolean; noise?: boolean },
): MailKindKey | null {
  const o = String((sd as Record<string, unknown> | null)?.kind_override ?? '').toLowerCase();
  if (KIND_KEYS.has(o)) return o as MailKindKey;
  const u = (sd?.understanding ?? null) as { mailKind?: string } | null;
  const mk = String(u?.mailKind ?? '').toLowerCase();
  if (KIND_KEYS.has(mk)) return mk as MailKindKey;
  // Structural fallback — the legacy taxonomy + header signals, so old/unstamped mail still gets
  // an honest identity where the signal is unambiguous. Conservative: no signal → no kind label.
  if (ruleType === 'marketing') return 'newsletter';
  if (ruleType === 'notifications') return 'notification';
  if (ruleType === 'meeting') return 'calendar';
  if (sd?.has_unsubscribe === true || hints?.bulk) return 'newsletter';
  if (hints?.noise) return 'notification';
  return null;
}

/** Which TIER produced the kind resolveKind would return — the stamp's honesty bookkeeping
 *  (July 31): a 'fallback' kind is a PLACEHOLDER, never a final verdict — the sweep's reasoned
 *  completer must get its turn and upgrade it (a structural guess is never final). */
export function kindTier(
  sd: Record<string, unknown> | null | undefined,
  ruleType?: string | null,
  hints?: { bulk?: boolean; noise?: boolean },
): 'override' | 'reasoned' | 'fallback' | null {
  const o = String((sd as Record<string, unknown> | null)?.kind_override ?? '').toLowerCase();
  if (KIND_KEYS.has(o)) return 'override';
  const u = (sd?.understanding ?? null) as { mailKind?: string } | null;
  if (KIND_KEYS.has(String(u?.mailKind ?? '').toLowerCase())) return 'reasoned';
  return resolveKind(sd, ruleType, hints) ? 'fallback' : null;
}

/** THE POSTURE LABEL — lifecycle only: a label exists while the thread needs the user (or is
 *  freshly Done); FYI/bulk postures get NO label (the kind carries identity now). */
export function postureFor(ruleType?: string | null, workState?: string | null): RuleLabel | null {
  if (ruleType === 'needs_reply' || ruleType === 'to_do' || ruleType === 'waiting_on' || ruleType === 'done') return ruleType;
  if (ruleType === 'fyi' || ruleType === 'notifications' || ruleType === 'marketing' || ruleType === 'meeting') return null;
  const ws = mapWorkStateToLabel(workState);
  return ws === 'fyi' ? null : ws;
}

/** The resolved pair (either may be null — grounded-or-absent). The KIND half is IN-APP ONLY since
 *  W10 — `mailboxLabelNamesFor` is what the mailbox receives. */
export function labelNamesFor(
  sd: Record<string, unknown> | null | undefined,
  ruleType?: string | null, workState?: string | null,
  hints?: { bulk?: boolean; noise?: boolean },
): { kindName: string | null; postureName: string | null } {
  const kind = resolveKind(sd, ruleType, hints);
  const posture = postureFor(ruleType, workState);
  return { kindName: kind ? KIND_DISPLAY[kind] : null, postureName: posture ? LABEL_DISPLAY[posture] : null };
}

/** W10 — the ONLY names AUGMTD writes into a mailbox: the live posture, never a kind. */
export function mailboxLabelNamesFor(
  sd: Record<string, unknown> | null | undefined,
  ruleType?: string | null, workState?: string | null,
  hints?: { bulk?: boolean; noise?: boolean },
): string[] {
  const { postureName } = labelNamesFor(sd, ruleType, workState, hints);
  return postureName ? [postureName] : [];
}

// Per-connection Gmail label cache: list once, create namespaced labels on demand, cache ids.
export class GmailLabelCache {
  private map = new Map<string, string>();
  private loaded = false;
  constructor(private encryptedTokens: string) {}

  async ensure(name: string): Promise<string | null> {
    try {
      const { listGmailLabels, createGmailLabel } = await import('@/lib/google/gmail');
      if (!this.loaded) {
        for (const l of await listGmailLabels(this.encryptedTokens)) this.map.set(l.name, l.id);
        this.loaded = true;
      }
      // Create the parent first so Gmail NESTS the children under a single collapsible "Augmtd"
      // group, instead of flat top-level "Augmtd/FYI" labels. Done before the cache hit below so a
      // pre-existing flat child still gets its parent created (which makes it re-nest).
      if (name.includes('/') && !this.map.has(name.slice(0, name.lastIndexOf('/')))) {
        await this.ensure(name.slice(0, name.lastIndexOf('/')));
      }
      if (this.map.has(name)) return this.map.get(name)!;
      try {
        const created = await createGmailLabel(this.encryptedTokens, name);
        this.map.set(created.name, created.id);
        return created.id;
      } catch {
        // Likely a concurrent create (name already taken) — re-list and pick it up.
        for (const l of await listGmailLabels(this.encryptedTokens)) this.map.set(l.name, l.id);
        return this.map.get(name) ?? null;
      }
    } catch {
      return null;
    }
  }

  /** Lookup WITHOUT creating — for reconcile removals (a label the mailbox never had must not be
   *  created just to be removed). */
  async peek(name: string): Promise<string | null> {
    try {
      const { listGmailLabels } = await import('@/lib/google/gmail');
      if (!this.loaded) {
        for (const l of await listGmailLabels(this.encryptedTokens)) this.map.set(l.name, l.id);
        this.loaded = true;
      }
      return this.map.get(name) ?? null;
    } catch { return null; }
  }
}

// All AUGMTD POSTURE-label display names (Gmail form; includes the retired FYI/Notifications/
// Marketing so old threads clean up). The reconciler strips any of these before adding the target —
// and by construction NEVER touches a KIND label (kinds live in KIND_DISPLAY, not this list):
// posture is the lifecycle dimension, kind is stable identity.
const ALL_STATE_LABELS = Object.values(LABEL_DISPLAY);

/**
 * Reconcile the AUGMTD state label on a thread: remove ANY existing AUGMTD/* state label, then add
 * the target. The single entry point used by every state-change caller (send/complete/dismiss/
 * external-reply resolution + reactivation on a new inbound to a resolved thread). Idempotent,
 * non-fatal (NEVER throws — a label failure must not break send/complete/dismiss/sync), returns
 * whether the target label was applied. Honors the caller's auto_label check (skip when off).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reconcileAugmtdLabel(opts: {
  provider: string;
  encryptedTokens: string;
  /** either a work_state (mapped via mapWorkStateToLabel) or an explicit RuleLabel via targetLabel */
  targetWorkState?: string | null;
  targetLabel?: RuleLabel;
  gmailThreadId?: string | null;
  gmailCache?: GmailLabelCache;
  outlookMessageId?: string | null;
  onTokenRefresh?: any;
}): Promise<boolean> {
  const target: RuleLabel = opts.targetLabel ?? mapWorkStateToLabel(opts.targetWorkState);
  // W10 POSTURE ONLY — a target that is not a LIVE posture (the retired FYI/Meeting/Notifications/
  // Marketing) is never written: the stale postures are stripped and nothing is added.
  const liveTarget = postureFor(target) !== null;
  const targetName: string | null = liveTarget ? LABEL_DISPLAY[target] : null;
  try {
    if (opts.provider === 'gmail' && opts.gmailThreadId) {
      const cache = opts.gmailCache ?? new GmailLabelCache(opts.encryptedTokens);
      const { addGmailThreadLabel, removeGmailThreadLabel } = await import('@/lib/google/gmail');
      // Remove every OTHER existing AUGMTD/* state label. PEEK, never ensure (W10): ensure() CREATES
      // a missing label, so a removal pass re-created every retired label (FYI, Marketing, …) in the
      // mailbox on each reconcile — undoing the cleanup. Only labels that already exist are resolved.
      for (const name of ALL_STATE_LABELS) {
        if (name === targetName) continue;
        const id = await cache.peek(name).catch(() => null);
        if (!id) continue;
        await removeGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, id).catch(() => {});
      }
      // Add the target (a live posture only).
      if (!targetName) return false;
      const targetId = await cache.ensure(targetName);
      if (!targetId) return false;
      await addGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, targetId);
      return true;
    } else if (opts.provider === 'outlook' && opts.outlookMessageId) {
      const { addOutlookCategory, removeOutlookCategory } = await import('@/lib/microsoft/outlook');
      const targetCategory = targetName ? outlookCategoryOf(targetName) : null;
      for (const name of ALL_STATE_LABELS) {
        const category = outlookCategoryOf(name);
        if (category === targetCategory) continue;
        await removeOutlookCategory(opts.encryptedTokens, opts.outlookMessageId, category, opts.onTokenRefresh).catch(() => {});
      }
      if (!targetCategory) return false;
      await addOutlookCategory(opts.encryptedTokens, opts.outlookMessageId, targetCategory, opts.onTokenRefresh);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeBackLabel(opts: {
  provider: string;
  encryptedTokens: string;
  label: string;
  gmailThreadId?: string | null;
  gmailCache?: GmailLabelCache;
  outlookMessageId?: string | null;
  onTokenRefresh?: any;
}): Promise<boolean> {
  // Returns whether the label was actually applied. NEVER throws (write-back must not break sync) —
  // but the boolean lets callers (e.g. the label-sweep) know NOT to mark an item "labeled" on a
  // transient failure, so it retries instead of silently recording a label that never landed.
  // W10 POSTURE ONLY — a retired posture (FYI/Meeting/Notifications/Marketing) is never written.
  const name = postureFor(opts.label) ? LABEL_DISPLAY[opts.label as RuleLabel] : null;
  if (!name) return false;
  try {
    if (opts.provider === 'gmail' && opts.gmailThreadId && opts.gmailCache) {
      const id = await opts.gmailCache.ensure(name);
      if (!id) return false;
      const { addGmailThreadLabel } = await import('@/lib/google/gmail');
      await addGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, id);
      return true;
    } else if (opts.provider === 'outlook' && opts.outlookMessageId) {
      const { addOutlookCategory } = await import('@/lib/microsoft/outlook');
      await addOutlookCategory(opts.encryptedTokens, opts.outlookMessageId, name.replace('/', ': '), opts.onTokenRefresh);
      return true;
    }
    return false;
  } catch {
    return false; // transient/permanent failure — caller decides whether to retry
  }
}

/** The applier's HONEST outcome — the caller's bookkeeping depends on the distinction:
 *  'applied' = the label landed (stamp `labeled`) · 'noop' = nothing to apply (no live posture — do
 *  NOT stamp; a posture that goes live later is labelled by the next sweep) · 'failed' = transient
 *  apply failure (do not stamp; retried next sweep). 'noop' is never recorded as success. */
export type WriteBackOutcome = 'applied' | 'noop' | 'failed';

/**
 * THE POSTURE APPLIER (W10 — was the kind+posture pair). Adds the item's live posture label and
 * strips every OTHER AUGMTD posture label from the thread. Never writes a kind. NEVER throws.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeBackLabels(opts: {
  provider: string;
  encryptedTokens: string;
  sd?: Record<string, unknown> | null;
  ruleType?: string | null;
  workState?: string | null;
  hints?: { bulk?: boolean; noise?: boolean };
  gmailThreadId?: string | null;
  gmailCache?: GmailLabelCache;
  outlookMessageId?: string | null;
  onTokenRefresh?: any;
}): Promise<WriteBackOutcome> {
  // W10 POSTURE ONLY: the mailbox receives the live posture and nothing else (no kind label).
  const names = mailboxLabelNamesFor(opts.sd, opts.ruleType, opts.workState, opts.hints);
  const postureName = names[0] ?? null;
  if (!names.length) return 'noop'; // no live posture — nothing of AUGMTD's belongs in the mailbox
  let allOk = true;
  try {
    if (opts.provider === 'gmail' && opts.gmailThreadId) {
      const cache = opts.gmailCache ?? new GmailLabelCache(opts.encryptedTokens);
      const { addGmailThreadLabel, removeGmailThreadLabel } = await import('@/lib/google/gmail');
      for (const name of names) {
        const id = await cache.ensure(name);
        if (!id) { allOk = false; continue; }
        try { await addGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, id); } catch { allOk = false; }
      }
      // THREAD-SCOPED RECONCILE (the stacked-labels fix): Gmail's thread row shows the UNION of
      // every message's labels, so stale postures from earlier eras (incl. the retired FYI/
      // Notifications/Marketing) sit next to the current one forever. Strip every OTHER state
      // label from the thread — only ones that already EXIST in the mailbox (peek, never create).
      try {
        for (const stale of ALL_STATE_LABELS) {
          if (stale === postureName) continue;
          const staleId = await cache.peek(stale);
          if (staleId) await removeGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, staleId).catch(() => {});
        }
      } catch { /* reconcile is best-effort — the applied posture stands */ }
      return allOk ? 'applied' : 'failed';
    } else if (opts.provider === 'outlook' && opts.outlookMessageId) {
      const { addOutlookCategory } = await import('@/lib/microsoft/outlook');
      for (const name of names) {
        try { await addOutlookCategory(opts.encryptedTokens, opts.outlookMessageId, outlookCategoryOf(name), opts.onTokenRefresh); }
        catch { allOk = false; }
      }
      return allOk ? 'applied' : 'failed';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}
