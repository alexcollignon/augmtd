// Reasoned classifier for calendar events that DON'T resolve deterministically (topic-new / ambiguous).
// Mirrors classify-outbound.ts: one content pass reads title + attendees + recurrence and emits a CANONICAL
// initiative — so a masterclass/cohort/interview SERIES shares ONE label regardless of title noise
// ("Placeholder:", "MC1" vs "Masterclass 1", dates). This is what finally clusters a calendar-driven user's
// work (a calendar-heavy user's recurring cohorts/programs), where string-matching the raw title just fragments. Cheap
// classification-tier batch call; caller caches the result.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';

export type CalendarEventForClassify = { id: string; title: string; attendees: string[]; recurring: boolean };

export async function classifyCalendarEvents(
  supabase: SupabaseClient,
  userId: string,
  events: CalendarEventForClassify[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!events.length) return result;

  const { client, model } = await getAIClient(userId, 'classification', supabase);
  const listing = events
    .map((e, i) => `[${i}] "${e.title || '(no title)'}"${e.recurring ? ' (recurring)' : ''} — with ${e.attendees.slice(0, 4).join(', ') || 'no external attendees'}`)
    .join('\n');

  const prompt = `These are calendar events (your meetings). For EACH, give the canonical INITIATIVE it belongs to — the deal / client / program / series / project / recurring engagement — as a SHORT proper-noun label, chosen so that RELATED or RECURRING events share ONE identical label. MERGE title noise: drop "Placeholder:", session/module numbers ("MC1", "Masterclass 2", "Cohort 5", "Part 3"), dates, and "TBC"/"FW:" prefixes — a cohort's sessions are all the same initiative. Use null for a genuine one-off (a standalone intro, a personal appointment) with no larger effort.

Return ONLY JSON: {"items":[{"i":0,"initiative":"..."}]} — one object per input, SAME order, using the [i] index.

${listing}`;

  try {
    const res = await aiCreate(client, {
      model,
      response_format: { type: 'json_object' as const },
      max_tokens: Math.min(2500, events.length * 40 + 200),
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseModelJSON<{ items?: Array<{ i?: number; initiative?: string | null }> }>(res.choices?.[0]?.message?.content, { items: [] });
    for (const it of parsed.items ?? []) {
      if (typeof it.i !== 'number' || !events[it.i]) continue;
      const raw = typeof it.initiative === 'string' ? it.initiative.trim() : '';
      result.set(events[it.i].id, raw && !/^(null|none|n\/?a|one[- ]?off|unknown)$/i.test(raw) ? raw.slice(0, 60) : null);
    }
  } catch (e) {
    console.error('[classify-events] failed (non-fatal):', (e as Error).message);
  }
  return result;
}
