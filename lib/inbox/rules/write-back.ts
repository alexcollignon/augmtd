// Label write-back — THE LABEL FLIP (work-surface M + one-room era). An email carries up to TWO
// labels, two orthogonal dimensions:
//   KIND    — what the mail IS (Receipt · Newsletter · Notification · Calendar · Cold outreach ·
//             Customer · Team · Personal). Stable for the thread's life; the reasoned
//             `understanding.mailKind` is the source, a user/rule `kind_override` outranks it,
//             cheap structural signals are the fallback. The PRIMARY identity label.
//   POSTURE — what it needs from YOU (Needs reply · To do · Waiting on → Done). The lifecycle
//             label: applied only while alive, swapped by the reconciler as the thread resolves/
//             reactivates. FYI/bulk mail gets NO posture label — identity is the kind's job now
//             (the old FYI/Notifications/Marketing posture labels are RETIRED; the reconciler
//             still strips them from old threads).
// Precedence everywhere: user override → reasoned kind → structural fallback. Rules keep posture
// authority (set_type) and gain `set_kind` (types.ts) as the override channel.
// Purely ADDITIVE in the mailbox — never archives, moves, or touches the user's own labels —
// and reversible (delete the AUGMTD labels to undo). Gated on auto_label.

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

// ── THE KIND LABEL SET (the Scape-style identity vocabulary, mailbox form). ──
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

/** THE POSTURE LABEL — lifecycle only: a label exists while the thread needs the user (or is
 *  freshly Done); FYI/bulk postures get NO label (the kind carries identity now). */
export function postureFor(ruleType?: string | null, workState?: string | null): RuleLabel | null {
  if (ruleType === 'needs_reply' || ruleType === 'to_do' || ruleType === 'waiting_on' || ruleType === 'done') return ruleType;
  if (ruleType === 'fyi' || ruleType === 'notifications' || ruleType === 'marketing' || ruleType === 'meeting') return null;
  const ws = mapWorkStateToLabel(workState);
  return ws === 'fyi' ? null : ws;
}

/** The pair of display names an item should carry (either may be null — grounded-or-absent). */
export function labelNamesFor(
  sd: Record<string, unknown> | null | undefined,
  ruleType?: string | null, workState?: string | null,
  hints?: { bulk?: boolean; noise?: boolean },
): { kindName: string | null; postureName: string | null } {
  const kind = resolveKind(sd, ruleType, hints);
  const posture = postureFor(ruleType, workState);
  return { kindName: kind ? KIND_DISPLAY[kind] : null, postureName: posture ? LABEL_DISPLAY[posture] : null };
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
  const targetName = LABEL_DISPLAY[target];
  if (!targetName) return false;
  try {
    if (opts.provider === 'gmail' && opts.gmailThreadId) {
      const cache = opts.gmailCache ?? new GmailLabelCache(opts.encryptedTokens);
      const { addGmailThreadLabel, removeGmailThreadLabel } = await import('@/lib/google/gmail');
      // Remove every OTHER existing AUGMTD/* state label. We only resolve ids for labels that already
      // exist (ensure() would create them, but a removed label absent from the thread is a harmless
      // no-op), so we list once via the cache and skip names it can't resolve.
      for (const name of ALL_STATE_LABELS) {
        if (name === targetName) continue;
        const id = await cache.ensure(name).catch(() => null);
        if (!id) continue;
        await removeGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, id).catch(() => {});
      }
      // Add the target.
      const targetId = await cache.ensure(targetName);
      if (!targetId) return false;
      await addGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, targetId);
      return true;
    } else if (opts.provider === 'outlook' && opts.outlookMessageId) {
      const { addOutlookCategory, removeOutlookCategory } = await import('@/lib/microsoft/outlook');
      const targetCategory = targetName.replace('/', ': ');
      for (const name of ALL_STATE_LABELS) {
        const category = name.replace('/', ': ');
        if (category === targetCategory) continue;
        await removeOutlookCategory(opts.encryptedTokens, opts.outlookMessageId, category, opts.onTokenRefresh).catch(() => {});
      }
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
  const name = LABEL_DISPLAY[opts.label as RuleLabel];
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

/**
 * THE LABEL FLIP's applier — write the item's PAIR (kind + posture) in one call. Adds only (the
 * reconciler owns posture swaps; kind never needs one). Returns true when every label the pair
 * called for actually landed — a partial/failed apply stays unmarked so the sweep retries.
 * NEVER throws.
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
}): Promise<boolean> {
  const { kindName, postureName } = labelNamesFor(opts.sd, opts.ruleType, opts.workState, opts.hints);
  const names = [kindName, postureName].filter(Boolean) as string[];
  if (!names.length) return true; // honestly nothing to label (no kind signal, no live posture)
  let allOk = true;
  try {
    if (opts.provider === 'gmail' && opts.gmailThreadId) {
      const cache = opts.gmailCache ?? new GmailLabelCache(opts.encryptedTokens);
      const { addGmailThreadLabel } = await import('@/lib/google/gmail');
      for (const name of names) {
        const id = await cache.ensure(name);
        if (!id) { allOk = false; continue; }
        try { await addGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, id); } catch { allOk = false; }
      }
      return allOk;
    } else if (opts.provider === 'outlook' && opts.outlookMessageId) {
      const { addOutlookCategory } = await import('@/lib/microsoft/outlook');
      for (const name of names) {
        try { await addOutlookCategory(opts.encryptedTokens, opts.outlookMessageId, name.replace('/', ': '), opts.onTokenRefresh); }
        catch { allOk = false; }
      }
      return allOk;
    }
    return false;
  } catch {
    return false;
  }
}
