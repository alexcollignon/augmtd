// ── Home L1 — reasoned NAMING for the server-side bundles (lib/home/bundle-brief.ts).
// The deterministic bundler groups atoms and hands the client a fallback label (a deal name / meeting
// title / a member's subject). That's already clean for initiative + meeting bundles, but a thread bundle
// falls back to one member's full task sentence ("Follow up: Share an update on the current completion…").
// This pass turns each bundle into a SHORT human NAME (the unit a person thinks in) plus, only when it's
// GROUNDED in the facts, a one-line "why it matters".
//
// CONSERVATIVE by dial (see the home-simplification memory): a `why` is emitted ONLY when a real fact
// supports it — a stated deadline, money at stake, a named client/deal. No inferred urgency, no invented
// stakes. Cheap CLASSIFICATION tier (Haiku / gpt-4o-mini — NOT a reasoning model), one call, cached by the
// caller on the bundle-set signature so it runs only when the bundles actually change.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export type BundleNameInput = {
  key: string;
  kind: 'initiative' | 'meeting' | 'thread';
  label: string;      // the deterministic fallback (already-good for initiative/meeting)
  members: string[];  // short gists of the atoms in the bundle
};
export type BundleName = { name: string; why?: string };

const KIND_HINT: Record<BundleNameInput['kind'], string> = {
  initiative: 'a client / deal / project',
  meeting: "a meeting's follow-ups",
  thread: 'one email conversation',
};

export async function nameBundles(
  userId: string,
  supabase: SupabaseClient,
  inputs: BundleNameInput[],
): Promise<Record<string, BundleName>> {
  if (!inputs.length) return {};
  const { client, model } = await getAIClient(userId, 'classification', supabase);
  const list = inputs
    .map((b) => `[${b.key}] (${KIND_HINT[b.kind]}) fallback name: "${b.label}"\n  items:\n${b.members.slice(0, 6).map((m) => `   - ${m.slice(0, 140)}`).join('\n')}`)
    .join('\n\n');
  const prompt = `You label groups of related work for a busy person's home dashboard. For EACH group give:
- "name": a SHORT human title (≤5 words) — the unit a person thinks in (the client/deal, the meeting topic, the conversation). NOT a task sentence, NOT a verb phrase. Reuse the fallback name when it's already a clean noun.
- "why": ONE short clause on why it matters, ONLY IF it is grounded in the items shown — a stated deadline, money at stake, a named client/decision. If nothing concrete supports a "why", OMIT the field entirely. Never invent urgency or stakes.

Return ONLY JSON: {"<key>": {"name": "...", "why": "..."}, ...} using the exact bracketed keys.

Groups:
${list}`;
  try {
    const res = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: Math.min(1600, 120 + inputs.length * 60),
      response_format: { type: 'json_object' },
    });
    // Some tiers (Bedrock Haiku) ignore response_format and wrap JSON in ```json fences — strip them, then
    // slice to the outermost { … } so a stray preamble can't break the parse.
    let raw = (res.choices?.[0]?.message?.content ?? '{}').replace(/```(?:json)?/gi, '').trim();
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
    const parsed = JSON.parse(raw) as Record<string, { name?: string; why?: string }>;
    const out: Record<string, BundleName> = {};
    for (const b of inputs) {
      const p = parsed[b.key];
      const name = (p?.name || '').trim();
      if (!name) continue; // fall back to the deterministic label
      const why = (p?.why || '').trim();
      out[b.key] = why ? { name, why } : { name };
    }
    return out;
  } catch {
    return {}; // any failure → callers keep the deterministic labels
  }
}
