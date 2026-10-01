/**
 * TRANSCRIPTION VOCABULARY — the proper nouns a meeting is likely to contain, handed to Whisper as
 * prompt context so "Acme" is not heard as "Akme". Derived at runtime from the user's own data
 * (agnostic: no client names in code): the workspace's company name, the meeting's attendee names,
 * and the user's most recently active tracked entities (projects + people).
 *
 * The box (infra/meeting-bot/transcription_worker.py) appends the list to its punctuated seed
 * prompt; an OLD box ignores the field (pydantic drops unknown body keys), so sending it is safe
 * before the redeploy. The Vercel fallback (whisper-client.ts) builds the same prompt via
 * `whisperPrompt` — the two sides share caps (VOCAB_MAX_TERMS / VOCAB_MAX_CHARS) by value.
 *
 * Bounded by design (Whisper keeps only the last ~224 prompt tokens): the list is a declared budget,
 * not a listing — attendees and the company first, then entities by recency, until the cap.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const VOCAB_MAX_TERMS = 40;
export const VOCAB_MAX_TERM_CHARS = 48;
export const VOCAB_MAX_CHARS = 400; // ≈100–130 tokens: seed + names inside Whisper's 223-token prompt half
/** The punctuation seed — large-v3-turbo without it emits lowercase, punctuation-free text. */
export const WHISPER_SEED_PROMPT = 'Okay, let us begin.';
const ENTITY_BUDGET = 40;

/** Pure: clean, dedupe (case-insensitive, first spelling wins), cap by count and total length.
 *  Groups are in priority order. Drops e-mail addresses, URLs, digits-only and 1-char noise. */
export function composeVocabulary(groups: Array<Array<string | null | undefined>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const group of groups) {
    for (const raw of group) {
      if (typeof raw !== 'string') continue;
      const term = raw.replace(/[\u0000-\u001f<>{}[\]"]/g, ' ').replace(/\s+/g, ' ').trim();
      if (term.length < 2 || term.length > VOCAB_MAX_TERM_CHARS) continue;
      if (/@|:\/\/|^www\./i.test(term) || /^[\d\s.,:/-]+$/.test(term)) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      const cost = term.length + 2;
      if (out.length >= VOCAB_MAX_TERMS || chars + cost > VOCAB_MAX_CHARS) return out;
      seen.add(key);
      out.push(term);
      chars += cost;
    }
  }
  return out;
}

/** The Whisper prompt: the punctuated seed, then the names as a sentence. Same shape the box builds. */
export function whisperPrompt(vocabulary?: string[] | null): string {
  const terms = composeVocabulary([vocabulary ?? []]);
  return terms.length ? `${WHISPER_SEED_PROMPT} Names: ${terms.join(', ')}.` : WHISPER_SEED_PROMPT;
}

type Attendee = { name?: string | null; displayName?: string | null; email?: string | null };

/** The user's transcription vocabulary for one meeting. Never throws — a failed read just narrows it. */
export async function transcriptionVocabulary(
  client: SupabaseClient, userId: string, calendarEventId?: string | null,
): Promise<string[]> {
  const [company, attendees, entities] = await Promise.all([
    (async () => {
      const { data: mem, error } = await client.from('company_members').select('company_id')
        .eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
      if (error || !mem?.company_id) return [] as string[];
      const { data: co, error: coErr } = await client.from('companies').select('name')
        .eq('id', mem.company_id as string).maybeSingle();
      return coErr || !co?.name ? [] : [co.name as string];
    })().catch(() => [] as string[]),
    (async () => {
      if (!calendarEventId) return [] as string[];
      const { data, error } = await client.from('calendar_events').select('attendees')
        .eq('id', calendarEventId).eq('user_id', userId).maybeSingle();
      if (error || !data) return [];
      return ((data.attendees ?? []) as Attendee[]).map((a) => a?.displayName || a?.name || null)
        .filter((n): n is string => !!n);
    })().catch(() => [] as string[]),
    (async () => {
      // Declared budget (not a listing): the most recently active entities, newest first.
      const { data, error } = await client.from('work_entities').select('name')
        .eq('user_id', userId).eq('status', 'active').in('kind', ['initiative', 'person'])
        .order('last_event_at', { ascending: false, nullsFirst: false }).limit(ENTITY_BUDGET);
      if (error) return [] as string[];
      return (data ?? []).map((r) => r.name as string);
    })().catch(() => [] as string[]),
  ]);
  return composeVocabulary([company, attendees, entities]);
}
