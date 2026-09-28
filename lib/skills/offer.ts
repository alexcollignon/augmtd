// ════════════════════════════════════════════════════════════════════════════════════════════════
// W21 — THE SKILL OFFER. When the user asks for the same kind of work in the same way repeatedly —
// ≥3 similar asks across their chats in 30 days (this ask included) with no skill in their library
// covering it — the answer carries ONE offer to save it as a skill. A declined pattern is never
// offered again; a saved one is covered by its own skill from then on.
//
// CHEAP BY DESIGN: chat turns are not embedded, so similarity is ZERO-AI — a normalised ask (content
// tokens, stop-words out, light stemming) compared by Jaccard overlap. Bounded reads (the last 30
// days, capped per source); a read that hits its cap REPORTS it (`truncated`) — NO SILENT CAPS.
//
// The offer is a suggestion, never a deed: nothing is created. Saving goes through the
// from-conversation draft + the user's own review (HUMAN IN THE LOOP).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipLabel } from '@/lib/utils/clip-for-prompt';
import type { SkillOffer } from './chat-contract';

export const OFFER_MIN_ASKS = 3;
export const OFFER_WINDOW_DAYS = 30;
export const OFFER_SIMILARITY = 0.5;
/** Per-source read ceiling (declared through `truncated` when reached). */
export const OFFER_SCAN_CAP = 300;
/** The item_plans kind a decline is stored under (entity_id = the pattern key). */
export const SKILL_OFFER_KIND = 'skill_offer' as const;

const STOP = new Set((
  'the a an and or but for nor so yet to of in on at by from with without into onto about above below over under ' +
  'this that these those there here then than them they their theirs what which who whom whose when where why how ' +
  'can could would should will shall may might must do does did done doing have has had having be is are was were ' +
  'been being get got make made let lets please pls thanks thank you your yours me my mine our ours us we i it its ' +
  'just also again some any all each every more most very really like want need needs needed give send tell show ' +
  'new one two now today tomorrow yesterday not no yes ok okay hey hi hello dear ' +
  'que para com uma por dos das como mais sobre este esta isso não sim ' +
  'der die das und oder für mit ein eine ist sind nicht bitte ' +
  'les des une est pour avec dans sur pas oui'
).split(/\s+/));

/** Light stemming — enough to fold "summaries/summary", "drafting/draft", "posts/post". */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es') && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The normalised ask: distinct content tokens, sorted. Pure. */
export function askTokens(text: string): string[] {
  const words = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    const s = stem(w);
    if (s.length >= 3 && !STOP.has(s)) out.add(s);
  }
  return [...out].sort();
}

/** Jaccard overlap of two token sets. Pure. */
export function askSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const inter = a.filter((t) => B.has(t)).length;
  return inter / (new Set([...a, ...b]).size);
}

const shared = (a: string[], b: string[]) => { const B = new Set(b); return a.filter((t) => B.has(t)).length; };
const similar = (a: string[], b: string[]) => shared(a, b) >= 2 && askSimilarity(a, b) >= OFFER_SIMILARITY;

export const patternKeyOf = (signature: string[]) => `ask:${signature.join('+')}`;
export const tokensOfPatternKey = (key: string) => String(key ?? '').replace(/^ask:/, '').split('+').filter(Boolean);
export const PATTERN_KEY_RE = /^ask:[\p{L}\p{N}]+(\+[\p{L}\p{N}]+){0,7}$/u;

export type OfferInput = {
  current: string;
  /** The user's earlier asks in the window (this ask itself excluded). */
  prior: string[];
  /** The user's skill library (a covering skill suppresses the offer). */
  skills: Array<{ name: string; when_to_use: string | null }>;
  /** Pattern keys the user declined. */
  declined: string[];
};

/** THE DECISION. Pure — the gates call exactly this. */
export function decideSkillOffer(input: OfferInput): SkillOffer | null {
  const cur = askTokens(input.current);
  if (cur.length < 3) return null;
  // Distinct prior asks (a re-sent identical message counts once).
  const seen = new Set<string>();
  const matches: string[][] = [];
  for (const p of input.prior) {
    const t = askTokens(p);
    const k = t.join(' ');
    if (!t.length || seen.has(k)) continue;
    seen.add(k);
    if (similar(cur, t)) matches.push(t);
  }
  if (matches.length + 1 < OFFER_MIN_ASKS) return null;
  // The pattern's signature: the current ask's tokens most of the similar asks share (max 6).
  const need = Math.max(1, Math.ceil(matches.length / 2));
  let sig = cur.filter((t) => matches.filter((m) => m.includes(t)).length >= need);
  if (sig.length < 2) sig = cur.filter((t) => matches[0].includes(t));
  sig = sig.slice(0, 6);
  if (sig.length < 2) return null;
  // Never re-offered once declined — a declined pattern suppresses any ask it resembles.
  for (const d of input.declined) {
    const dt = tokensOfPatternKey(d);
    if (!dt.length) continue;
    if (askSimilarity(sig, dt) >= OFFER_SIMILARITY || dt.every((t) => cur.includes(t))) return null;
  }
  // A skill already covers it (including one saved from an earlier offer).
  for (const s of input.skills) {
    const st = askTokens(`${s.name} ${s.when_to_use ?? ''}`);
    if (shared(sig, st) >= Math.min(2, sig.length)) return null;
  }
  const firstLine = String(input.current).trim().split('\n')[0] ?? '';
  return { patternKey: patternKeyOf(sig), label: clipLabel(firstLine, 80) };
}

export type OfferEvaluation = { offer: SkillOffer | null; scanned: number; truncated: boolean };

/** Asks written in the last ECHO_MS are this very message (the doors persist the ask before or while
 *  answering) — they are not an earlier ask. */
const ECHO_MS = 90_000;

/** Read the window and decide. Best-effort: any failure = no offer. */
export async function evaluateSkillOffer(
  client: SupabaseClient, userId: string, current: string, now = new Date(),
): Promise<OfferEvaluation> {
  try {
    if (askTokens(current).length < 3) return { offer: null, scanned: 0, truncated: false };
    const since = new Date(now.getTime() - OFFER_WINDOW_DAYS * 86_400_000).toISOString();
    const echoAfter = now.getTime() - ECHO_MS;
    const { readPlans } = await import('@/lib/store/item-plans');
    const { readSkillLibrary } = await import('./for-turn');
    let listingFailed = false;
    const [turnsRes, threadsRes, skills, declined] = await Promise.all([
      client.from('room_turns').select('text, created_at')
        .eq('user_id', userId).eq('role', 'user').gte('created_at', since)
        .order('created_at', { ascending: false }).limit(OFFER_SCAN_CAP),
      client.from('work_threads').select('id')
        .eq('user_id', userId).gte('updated_at', since)
        .order('updated_at', { ascending: false }).limit(OFFER_SCAN_CAP),
      // Full listings page (NO SILENT CAPS): the library and the declines are small, but whole.
      readSkillLibrary(client, userId).catch(() => { listingFailed = true; return []; }),
      // Through THE item_plans DOOR (lib/store/item-plans.ts — paged, typed).
      readPlans(client, userId, SKILL_OFFER_KIND, { withTasks: false })
        .catch(() => { listingFailed = true; return []; }),
    ]);
    const prior: string[] = [];
    let truncated = false;
    if (!turnsRes.error) {
      const rows = (turnsRes.data ?? []) as Array<{ text: string; created_at: string }>;
      if (rows.length >= OFFER_SCAN_CAP) truncated = true;
      for (const r of rows) if (new Date(r.created_at).getTime() < echoAfter) prior.push(String(r.text ?? ''));
    }
    const threadIds = threadsRes.error ? [] : ((threadsRes.data ?? []) as Array<{ id: string }>).map((t) => t.id);
    if (threadIds.length >= OFFER_SCAN_CAP) truncated = true;
    if (threadIds.length) {
      const { data, error } = await client.from('work_messages').select('content, created_at')
        .in('thread_id', threadIds).eq('role', 'user').gte('created_at', since)
        .order('created_at', { ascending: false }).limit(OFFER_SCAN_CAP);
      if (!error) {
        const rows = (data ?? []) as Array<{ content: string; created_at: string }>;
        if (rows.length >= OFFER_SCAN_CAP) truncated = true;
        for (const r of rows) if (new Date(r.created_at).getTime() < echoAfter) prior.push(String(r.content ?? ''));
      }
    }
    // A skills/declines read that fails suppresses the offer (never offer what we cannot check).
    if (listingFailed) return { offer: null, scanned: prior.length, truncated };
    const offer = decideSkillOffer({
      current, prior,
      skills: skills.map((s) => ({ name: s.name, when_to_use: s.when_to_use })),
      declined: declined.map((r) => r.key),
    });
    if (truncated) console.info(`[skills/offer] window read reached its cap (${OFFER_SCAN_CAP}/source); scanned ${prior.length} asks`);
    return { offer, scanned: prior.length, truncated };
  } catch {
    return { offer: null, scanned: 0, truncated: false };
  }
}

/** Record a decline (idempotent). The ONE writer of the decline store. */
export async function recordOfferDecline(client: SupabaseClient, userId: string, patternKey: string): Promise<boolean> {
  if (!PATTERN_KEY_RE.test(patternKey)) return false;
  const { upsertPlan } = await import('@/lib/store/item-plans');
  const { error } = await upsertPlan(client, userId, SKILL_OFFER_KIND, patternKey, { state: 'declined', at: new Date().toISOString() });
  return !error;
}
