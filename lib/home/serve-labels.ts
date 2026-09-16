// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SERVE-LABEL CHOKE — LAW 3 (THE SERVED-WORDS LAW) as a STRUCTURE, not a site list.
//
// The guard was wired at four seams inside the brief route. Four is a site list, and a site list
// misses the N+1th seam — the fifth time this class has been found in this codebase (the excerpt
// law, the deixis write seams, the tier leak, the embeddings space, now this). The seams are not
// wrong; they are simply not a GUARANTEE.
//
// This module is the guarantee: ONE pass over the deck payload, at the ONE point where every
// user-facing deck label leaves the server. A lane that forgets to strip still cannot serve a
// decaying word, because nothing reaches the client except through here.
//
// TWO RULES, both deliberate:
//   • THE FIELD TABLE IS EXPLICIT — a lane lists the fields that are LABELS. Identity fields (a
//     person's name, a project's name, a deal's title, a bundle's name) are NEVER stripped: a
//     surname or a product can legitimately BE a day-word, and mangling a name is a worse lie than
//     a stale adverb. Adding a lane is one row here, not a new call site.
//   • PROSE IS OUT OF SCOPE, stated — the composed briefing/tldr are day-keyed compositions with
//     their own version-gated invalidation; they are written today, about today. This choke owns
//     the ROW LABELS, which are frozen ingest snapshots and decay.
//
// PURE + client-safe: imports only the day-word table's guard.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { stripDeixis, carriesDayWord } from '@/lib/inbox/deixis';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** THE FIELD TABLE — lane → the fields that are LABELS (never identity). Stated once. */
export const DECK_LABEL_FIELDS: Record<string, string[]> = {
  'mustRespond.items': ['ask', 'angle', 'subject'],
  actionNotices: ['summary'],
  commitments: ['description'],
  priorities: ['title', 'context'],
  'keepAnEyeOn.items': ['why'],
  slippingDeals: ['summary'],
  'followups.items': ['status', 'nextMove'],
  'fyiDigest.groups': ['summary'],
  forYourAwareness: ['why', 'summary'],
  waitingOn: ['nextMove', 'status'],
};

const guardRow = (row: any, fields: string[]): any => {
  if (!row || typeof row !== 'object') return row;
  let out = row;
  for (const f of fields) {
    const v = out[f];
    if (typeof v !== 'string' || !v) continue;
    const g = stripDeixis(v);
    if (g !== v) out = out === row ? { ...row, [f]: g } : { ...out, [f]: g };
  }
  return out;
};

const guardList = (list: any, fields: string[]): any =>
  Array.isArray(list) ? list.map((r) => guardRow(r, fields)) : list;

/**
 * THE ONE GUARD, at the ONE boundary. Every deck label in the payload passes through it on its way
 * out. Pure and total: an unknown shape is returned untouched (the guard never breaks a response),
 * and a strip that would empty a label keeps the original (stripDeixis's own never-destructive law).
 */
export function guardDeckLabels<T extends Record<string, any>>(payload: T): T {
  const out: Record<string, any> = { ...payload };
  for (const [lane, fields] of Object.entries(DECK_LABEL_FIELDS)) {
    const [head, tail] = lane.split('.');
    if (!tail) { out[head] = guardList(out[head], fields); continue; }
    const container = out[head];
    if (!container || typeof container !== 'object') continue;
    out[head] = { ...container, [tail]: guardList((container as any)[tail], fields) };
  }
  return out as T;
}

/** THE GATE'S PREDICATE — every label a guarded payload serves, flattened, so LAW 6 can assert the
 *  standing sentence over the real thing instead of a re-derivation of it. */
export function servedLabelsOf(payload: Record<string, any>): Array<{ lane: string; field: string; text: string }> {
  const out: Array<{ lane: string; field: string; text: string }> = [];
  for (const [lane, fields] of Object.entries(DECK_LABEL_FIELDS)) {
    const [head, tail] = lane.split('.');
    const list = tail ? (payload?.[head] as any)?.[tail] : payload?.[head];
    if (!Array.isArray(list)) continue;
    for (const row of list) for (const f of fields) {
      const v = row?.[f];
      if (typeof v === 'string' && v) out.push({ lane, field: f, text: v });
    }
  }
  return out;
}

/** True when a payload still speaks a decaying word anywhere in the table. */
export function payloadCarriesDayWord(payload: Record<string, any>): boolean {
  return servedLabelsOf(payload).some((l) => carriesDayWord(l.text));
}
