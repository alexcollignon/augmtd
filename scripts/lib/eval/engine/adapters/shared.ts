// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — shared adapter plumbing: THE PIPELINE STEPS AUGMTD runs over a seeded world (understanding →
// judge), the matchers the labelled fields share, and the plain-prompt scaffold. Every step calls the
// REAL product function in-process; nothing here re-implements product logic.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { dbErr } from '../world';
import { renderWorld, answerSchema, type RenderScope } from '../neutral';
import { parseAnswerJSON } from '../judge';
import { localDate, localClock, resolveWhen, type SeededWorld, type ResolvedMessage } from '../world';
import type { EvalCase, LabelField, RunCtx, SetMatch } from '../types';

/** The thread's messages + its inbox item row (resolved world side). */
export function threadOf(s: SeededWorld, threadKey: string) {
  const t = s.resolved.threads.find((x) => x.key === threadKey);
  if (!t) throw new Error(`case names unknown thread "${threadKey}"`);
  return t;
}

/** The newest INBOUND message of a thread (what a "latest message" question is about). */
export function newestInbound(s: SeededWorld, threadKey: string): ResolvedMessage {
  const t = threadOf(s, threadKey);
  const m = [...t.messages].reverse().find((x) => !x.from.me);
  if (!m) throw new Error(`thread "${threadKey}" has no inbound message`);
  return m;
}

/** STEP 1 — THE ONE UNDERSTANDING PASS (lib/ai/email-processor computeUnderstanding, the relay floor
 *  inside it) over a message's OWN words (topMessageOf, clipped under the excerpt law — the refresh
 *  seam's exact shaping), then stamped on the item the way the sync stores it. Returns the understanding. */
export async function understand(ctx: RunCtx, s: SeededWorld, threadKey: string, messageKey?: string): Promise<Record<string, unknown> | null> {
  const { computeUnderstanding } = await import('../../../../../lib/ai/email-processor');
  const { topMessageOf } = await import('../../../../../lib/inbox/top-message');
  const t = threadOf(s, threadKey);
  const m = messageKey ? t.messages.find((x) => x.key === messageKey)! : newestInbound(s, threadKey);
  const own = topMessageOf(m.body).trim();
  const u = await computeUnderstanding({
    id: t.itemKey ? s.ids[t.itemKey] : s.ids[m.key], user_id: ctx.userId, message_id: `<eval-${s.tag}-${m.key}@fixture.test>`,
    // W28 · THE SEAM'S EXACT SHAPING (lib/inbox/refresh-understanding.ts, W27 · NO HEAD-CUT HERE): the
    // product hands the OWN words whole and the one assembler clips them two-ended; this adapter still
    // head-cut them at 2,000 chars, so a buried ask in long mail was never measured as the product sees it.
    subject: m.subject, body: own || m.body, from_address: m.from.email, from_name: m.from.name,
    to_addresses: m.to.map((p) => p.email), cc_addresses: m.cc.map((p) => p.email), received_at: m.at.toISOString(),
    user_addresses: [s.resolved.me.email], recipient_email: s.resolved.me.email, user_name: s.resolved.me.name,
  } as never, ctx.admin, { signals: t.signals ?? null }).catch((e: Error) => { throw new Error(`computeUnderstanding: ${e.message}`); });
  if (u && t.itemKey) {
    const id = s.ids[t.itemKey];
    const { data, error } = await ctx.admin.from('inbox_items').select('source_data').eq('id', id).eq('user_id', ctx.userId).maybeSingle();
    if (error) throw new Error(`read item for understanding stamp: ${dbErr(error)}`);
    const sd = ((data as { source_data?: Record<string, unknown> } | null)?.source_data ?? {}) as Record<string, unknown>;
    const { error: upErr } = await ctx.admin.from('inbox_items').update({
      source_data: { ...sd, understanding: u, understanding_from: `<eval-${s.tag}-${m.key}@fixture.test>`, understanding_at: m.at.toISOString() },
    }).eq('id', id).eq('user_id', ctx.userId);
    if (upErr) throw new Error(`stamp understanding: ${dbErr(upErr)}`);
  }
  return (u as unknown as Record<string, unknown>) ?? null;
}

/** STEP 2 — THE WORK JUDGE (lib/work/judge judgeWork) on a seeded item (thread item or commitment). */
export async function judge(ctx: RunCtx, s: SeededWorld, key: string) {
  const { judgeWork } = await import('../../../../../lib/work/judge');
  const isCommit = s.resolved.commitments.some((c) => c.key === key);
  const id = s.ids[key];
  if (!id) throw new Error(`case names unknown item "${key}"`);
  return judgeWork(ctx.admin, ctx.userId, { kind: isCommit ? 'commitment' : 'inbox', id });
}

/** Understand every thread item, then judge `key` (the pipeline's order on a fresh world). */
export async function understandAllThenJudge(ctx: RunCtx, s: SeededWorld, key: string) {
  for (const t of s.resolved.threads) if (t.itemKey) await understand(ctx, s, t.key);
  return judge(ctx, s, key);
}

// ── plain prompts ───────────────────────────────────────────────────────────────────────────────

export function plainScaffold(c: EvalCase, now: Date, task: string, fields: LabelField[], extra: Array<{ name: string; gloss: string }> = [], scope: RenderScope = {}): string {
  const schema = answerSchema([
    ...fields.map((f) => (f.kind === 'enum' ? { name: f.name, labels: f.labels } : { name: f.name, gloss: f.gloss })),
    ...extra,
  ]);
  return `${renderWorld(c.world, now, scope)}\n\n---\n${task}\n\n${schema}`;
}

export const parseJSON = (text: string) => parseAnswerJSON(text);

// ── matchers ────────────────────────────────────────────────────────────────────────────────────

const lc = (s: unknown) => String(s ?? '').toLowerCase();

/** Every keyword GROUP must appear (a group is "a|b|c" alternatives), case-insensitive. */
export function keywordsHit(text: string, groups: string[]): boolean {
  const t = lc(text);
  return groups.every((g) => g.split('|').some((alt) => t.includes(alt.trim().toLowerCase())));
}

/** One-to-one greedy match of predicted strings/objects against truth items carrying `keywords`. */
export function matchByKeywords(pred: unknown[], truth: unknown[], textOf: (p: unknown) => string = (p) => (typeof p === 'string' ? p : JSON.stringify(p))): SetMatch {
  const used = new Set<number>();
  let tp = 0;
  for (const t of truth as Array<{ keywords?: string[] }>) {
    const i = pred.findIndex((p, k) => !used.has(k) && keywordsHit(textOf(p), t.keywords ?? []));
    if (i >= 0) { used.add(i); tp++; }
  }
  return { tp, fp: pred.length - used.size, fn: truth.length - tp };
}

/** A date written any common way → YYYY-MM-DD (null when absent / 'none' / unreadable). */
export function normDate(v: unknown, tz = 'UTC'): string | null {
  const s = String(v ?? '').trim();
  if (!s || /^(none|null|unstated|n\/a|no)$/i.test(s)) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : localDate(d, tz);
}

/** Truth dates are authored as Whens ('+3d'); resolve them against the run clock. */
export function truthDate(when: unknown, now: Date, tz = 'UTC'): string {
  if (when == null || when === 'none' || when === 'unstated') return 'none';
  return localDate(resolveWhen(String(when), now, tz), tz);
}

export const clockOf = (iso: string, tz: string) => localClock(new Date(iso), tz);
