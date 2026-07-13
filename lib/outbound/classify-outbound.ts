// Reasoned classifier for cold outbound threads — replaces brittle keyword/subject filters with ONE content
// judgment (the "reason once at labeling" pattern used across the machine). For each sent-with-no-reply
// thread it decides: is it AWAITING a reply (real outreach) vs one-way (filed doc / calendar response /
// notification), and what INITIATIVE it's about — labeled from the BODY, so different subject wordings for
// the same effort ("Internship" / "Estágio" / "Candidatura") collapse to one initiative (which subject-string
// matching can never do). Cheap classification-tier (Haiku) batch call; caller caches the result.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import type { OutboundCandidate } from './sent-threads';

export type OutboundVerdict = { awaiting: boolean; initiative: string | null };

export async function classifyOutbound(
  supabase: SupabaseClient,
  userId: string,
  candidates: OutboundCandidate[],
): Promise<Map<string, OutboundVerdict>> {
  const result = new Map<string, OutboundVerdict>();
  if (!candidates.length) return result;

  const { client, model } = await getAIClient(userId, 'classification', supabase);
  const listing = candidates
    .map((c, i) => `[${i}] to ${c.recipient} — "${c.subject || '(no subject)'}": ${c.snippet.slice(0, 180)}`)
    .join('\n');

  const prompt = `These are emails YOU sent that have received NO reply yet. For EACH, judge from its CONTENT (not the subject wording):
- "awaiting": true if it's outreach you'd expect a REPLY to (a pitch, intro, question, request, application, follow-up directed at a person). false if it's one-way / no reply expected (a forwarded document/receipt/invoice for filing, a calendar decline or accept, an automated notification, a pure FYI send).
- "initiative": the deal / client / project / campaign / role it's about — a SHORT proper-noun label derived from the content, so different subject wordings for the SAME effort share ONE label (e.g. an internship/estágio/candidatura outreach → one hiring label). null for a genuine one-off with no larger effort.

Return ONLY JSON: {"items":[{"i":0,"awaiting":true,"initiative":"..."}]} — one object per input, in the SAME order, using the [i] index.

${listing}`;

  try {
    const res = await aiCreate(client, {
      model,
      response_format: { type: 'json_object' as const },
      max_tokens: Math.min(2200, candidates.length * 60 + 200),
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseModelJSON<{ items?: Array<{ i?: number; awaiting?: boolean; initiative?: string | null }> }>(res.choices?.[0]?.message?.content, { items: [] });
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const it of items) {
      if (typeof it.i !== 'number' || !candidates[it.i]) continue;
      const raw = typeof it.initiative === 'string' ? it.initiative.trim() : '';
      const initiative = raw && !/^(null|none|n\/?a|one[- ]?off|unknown)$/i.test(raw) ? raw.slice(0, 60) : null;
      result.set(candidates[it.i].recipient, { awaiting: it.awaiting === true, initiative });
    }
  } catch (e) {
    console.error('[classify-outbound] failed (non-fatal):', (e as Error).message);
  }
  return result;
}
