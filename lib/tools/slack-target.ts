// ─── Slack targets (PURE, leaf) ───────────────────────────────────────────────
// What a `channel` value MEANS, with zero IO — so the confirm card (lib/work/confirm-policy.ts,
// which must stay leaf) and the executor (lib/tools/slack.ts, which pulls Nango) read ONE answer.

// "DM the user" sentinels — a channel value the worker/UI uses to mean a direct message.
const DM_SENTINELS = new Set(['@me', 'dm', 'dm:me', 'me', '__dm__']);
export function isDmTarget(ch: string): boolean { return DM_SENTINELS.has(ch.trim().toLowerCase()); }

// Accept a pasted Slack channel URL (e.g. .../archives/C0123ABCD or
// .../client/T.../C0123ABCD) and reduce it to the channel ID, so users can point at a
// private channel by copying its link. Non-URL values (#name, @me, raw ID) pass through.
export function normalizeChannel(ch: string): string {
  const v = ch.trim();
  const m = v.match(/\/(?:archives|client\/[A-Z0-9]+)\/([A-Z0-9]+)/i);
  return m ? m[1] : v;
}

/** A raw Slack conversation id (C…, G…, D…) rather than a #name. */
export function isChannelId(ch: string): boolean { return /^[CGD][A-Z0-9]{6,}$/.test(ch.trim()); }
