// Triage label write-back. Mirrors the item's type into Gmail (nested labels under "Augmtd/") or
// Outlook (categories prefixed "Augmtd: "). Purely ADDITIVE — never archives, moves, or touches
// the user's own labels — and reversible (delete the Augmtd labels to undo). Gated on auto_label.

import type { RuleLabel } from './types';

const LABEL_DISPLAY: Record<RuleLabel, string> = {
  needs_reply: 'Augmtd/Needs reply',
  to_do: 'Augmtd/To do',
  waiting_on: 'Augmtd/Waiting on',
  meeting: 'Augmtd/Meeting',
  fyi: 'Augmtd/FYI',
  notifications: 'Augmtd/Notifications',
  marketing: 'Augmtd/Marketing',
  done: 'Augmtd/Done',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeBackLabel(opts: {
  provider: string;
  encryptedTokens: string;
  label: string;
  gmailThreadId?: string | null;
  gmailCache?: GmailLabelCache;
  outlookMessageId?: string | null;
  onTokenRefresh?: any;
}): Promise<void> {
  const name = LABEL_DISPLAY[opts.label as RuleLabel];
  if (!name) return;
  try {
    if (opts.provider === 'gmail' && opts.gmailThreadId && opts.gmailCache) {
      const id = await opts.gmailCache.ensure(name);
      if (id) {
        const { addGmailThreadLabel } = await import('@/lib/google/gmail');
        await addGmailThreadLabel(opts.encryptedTokens, opts.gmailThreadId, id);
      }
    } else if (opts.provider === 'outlook' && opts.outlookMessageId) {
      const { addOutlookCategory } = await import('@/lib/microsoft/outlook');
      await addOutlookCategory(opts.encryptedTokens, opts.outlookMessageId, name.replace('/', ': '), opts.onTokenRefresh);
    }
  } catch {
    /* non-fatal — write-back must never break sync */
  }
}
