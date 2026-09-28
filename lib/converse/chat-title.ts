// ════════════════════════════════════════════════════════════════════════════════════════════════
// W23.B — A CHAT NAMES ITSELF (the conversation's topic, not its first 60 characters).
//
// After the FIRST assistant answer in a new Home chat (`chat:<uuid>`) or a coworker DM thread, ONE cheap
// call on the volume slot (the factory's 'classification' task, ~50 output tokens) names the
// conversation: 3–6 words, Title Case, in the conversation's own language, no quotes or emoji. The
// doors run it in `after()` — the answer never waits on it — and every failure leaves the fallback
// label (the first ask) standing.
//
// STORED ONCE, AND A RENAME WINS:
//   • Home chat → item_plans kind 'room_title' (the SAME record a user's rename writes — ONE FACT, ONE
//     HOME). The generated title is an INSERT (`insertPlan`): the unique (user, kind, key) index makes it
//     land at most once, and never over a rename that already exists; a rename is an upsert, so a later
//     rename always replaces it.
//   • DM thread → `work_threads.title`, updated only WHERE the title is still the one the request saw
//     at its start (compare-and-set): a rename that landed meanwhile wins, a retry writes nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { clipWithRule } from '@/lib/utils/pack-context';

/** The whole call's budget: a title is decoration, never worth a long wait. */
export const TITLE_TIMEOUT_MS = 15_000;
/** ~50 output tokens (the contract): room for six words in any language, nothing more. */
export const TITLE_MAX_TOKENS = 50;
/** What of the exchange the namer reads (declared cuts — the excerpt law). */
const QUESTION_CHARS = 700;
const ANSWER_CHARS = 700;

/** The namer's prompt. Pure (exported for the gate). */
export function titlePrompt(question: string, answer: string): string {
  return (
    `Name this conversation. Reply with ONLY the title: 3 to 6 words, Title Case, naming the conversation's ` +
    `TOPIC, written in the same language the user wrote in. No quotes, no emoji, no trailing punctuation, ` +
    `no prefix like "Title:".\n\n` +
    `USER:\n${clipWithRule(question, QUESTION_CHARS)}\n\nASSISTANT:\n${clipWithRule(answer, ANSWER_CHARS)}`
  );
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** The model's reply → a clean title, or null when nothing usable came back. Pure. */
export function cleanTitle(raw: string | null | undefined): string | null {
  let t = String(raw ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  t = t.replace(/^(?:title|titre|título|titel|titolo)\s*[:：-]\s*/i, '')
    .replace(EMOJI, '')
    .replace(/[*_#`]/g, '')
    .replace(/^["'“”‘’«»\s]+|["'“”‘’«»\s]+$/g, '')
    .replace(/[.!?;:,。！？]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const words = t.split(' ');
  if (words.length > 6) t = words.slice(0, 6).join(' ');
  if (t.length > 80) return null;
  return t.charAt(0).toLocaleUpperCase() + t.slice(1);
}

/** ONE cheap call on the volume slot. Null on any failure (the fallback label stays). */
export async function generateChatTitle(
  client: SupabaseClient, userId: string, exchange: { question: string; answer: string },
): Promise<string | null> {
  try {
    if (!exchange.question?.trim()) return null;
    const resolved = await getAIClient(userId, 'classification', client);
    const res = await aiCreate(resolved.client, {
      model: resolved.model, max_tokens: TITLE_MAX_TOKENS, temperature: 0.2,
      messages: [{ role: 'user', content: titlePrompt(exchange.question, exchange.answer ?? '') }],
    }, { timeoutMs: TITLE_TIMEOUT_MS });
    void logAIUsage(client, {
      userId, source: 'chat', provider: resolved.endpoint?.provider ?? 'unknown', model: resolved.model,
      tier: resolved.tier ?? undefined, taskType: 'classification', usage: res.usage,
    }).catch(() => {});
    return cleanTitle(res.choices?.[0]?.message?.content ?? '');
  } catch { return null; }
}

export type TitleOutcome = 'stored' | 'exists' | 'skipped' | 'failed';

/** A Home chat's title, stored ONCE, never over a rename. Idempotent: a title that exists (generated or
 *  renamed) makes it a no-op without a model call. */
export async function ensureHomeChatTitle(
  client: SupabaseClient, userId: string, roomKey: string, exchange: { question: string; answer: string },
): Promise<TitleOutcome> {
  try {
    if (!/^chat:[0-9a-f-]{36}$/i.test(roomKey) || !exchange.answer?.trim()) return 'skipped';
    const { readPlan, insertPlan } = await import('@/lib/store/item-plans');
    const existing = await readPlan(client, userId, 'room_title', roomKey);
    if ((existing?.tasks as { title?: string | null } | null)?.title) return 'exists';
    const title = await generateChatTitle(client, userId, exchange);
    if (!title) return 'failed';
    const r = await insertPlan(client, userId, 'room_title', roomKey, { title, auto: true, at: new Date().toISOString() });
    return r.inserted ? 'stored' : 'exists';
  } catch { return 'failed'; }
}

/** A DM thread's title, set only while the thread still carries the title this request started with
 *  (compare-and-set): a rename that landed meanwhile wins; a second run writes nothing. */
export async function ensureThreadTitle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient | any, userId: string, threadId: string, titleAtStart: string,
  exchange: { question: string; answer: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aiClient?: SupabaseClient | any,
): Promise<TitleOutcome> {
  try {
    if (!exchange.answer?.trim()) return 'skipped';
    const title = await generateChatTitle(aiClient ?? client, userId, exchange);
    if (!title) return 'failed';
    if (title === titleAtStart) return 'exists';
    const { data, error } = await client.from('work_threads').update({ title })
      .eq('id', threadId).eq('user_id', userId).eq('title', titleAtStart).select('id');
    if (error) return 'failed';
    return ((data ?? []) as unknown[]).length ? 'stored' : 'exists';
  } catch { return 'failed'; }
}
