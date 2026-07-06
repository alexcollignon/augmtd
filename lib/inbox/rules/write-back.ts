// Triage label write-back. Mirrors the item's type into Gmail (nested labels under "Augmtd/") or
// Outlook (categories prefixed "Augmtd: "). Purely ADDITIVE — never archives, moves, or touches
// the user's own labels — and reversible (delete the Augmtd labels to undo). Gated on auto_label.

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

export function mapWorkStateToLabel(ws?: string | null): RuleLabel {
  if (ws === 'work_prepared' || ws === 'decision_required') return 'needs_reply';
  if (ws === 'action_required') return 'to_do';
  if (ws === 'waiting') return 'waiting_on';
  return 'fyi';
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

// All AUGMTD state-label display names (Gmail form). The reconciler strips any of these that are
// present before adding the target, so a thread never carries two conflicting AUGMTD/* state labels.
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
