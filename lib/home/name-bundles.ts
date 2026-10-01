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
import { aiCall } from '@/lib/ai/call';

/** The bundle-naming prompt's version — rides the `home_brief.bundleNames.sig` (W2.6: the sig was the
 *  bare bundle-key set, so a prompt change never re-named an unchanged set). BUMP on prompt change. */
export const BUNDLE_NAMES_VERSION = 2;

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
  const list = inputs
    .map((b) => `[${b.key}] (${KIND_HINT[b.kind]}) fallback name: "${b.label}"\n  items:\n${b.members.slice(0, 6).map((m) => `   - ${m.slice(0, 140)}`).join('\n')}`)
    .join('\n\n');
  const prompt = `You label groups of related work for a busy person's home dashboard. For EACH group give:
- "name": a SHORT human title (≤5 words) — the unit a person thinks in (the client/deal, the meeting topic, the conversation). NOT a task sentence, NOT a verb phrase. Reuse the fallback name only when it's already a clean noun of ≤5 words — a fallback that is a task sentence is never reused. Write it in the language the items are written in.
- "why": ONE short clause on why it matters, ONLY IF the items STATE a deadline (a date or day), an amount of money, or a named decision — one short clause of your own that states that fact (never pasted item fragments). Restating a task, a question someone asked, or a next step is NOT a why. If no such fact is stated, OMIT the field entirely. Never invent urgency or stakes.

Return ONLY JSON: {"<key>": {"name": "...", "why": "..."}, ...} using the exact bracketed keys.

Groups:
${list}`;
  try {
    // Shape-routed (aiCall {output:'json'}) — fence-stripping + provider quirks are the router's job now.
    const res = await aiCall<Record<string, { name?: string; why?: string }>>({
      userId, supabase, shape: { output: 'json' }, prompt, temperature: 0,
      maxTokens: Math.min(1600, 120 + inputs.length * 60), source: 'bundle_naming',
    });
    const parsed = res.json ?? {};
    const out: Record<string, BundleName> = {};
    for (const b of inputs) {
      const p = parsed[b.key];
      const name = (p?.name || '').trim();
      // A name is ≤5 words (W37 eval: the 25-word task-sentence fallback came back as the "name").
      if (!name || name.split(/\s+/).length > 6) continue; // fall back to the deterministic label
      const why = groundedWhy((p?.why || '').trim(), [b.label, ...b.members].join('\n'));
      out[b.key] = why ? { name, why } : { name };
    }
    return out;
  } catch {
    return {}; // any failure → callers keep the deterministic labels
  }
}

/** W37 · A "WHY" CARRIES A STATED FACT (eval decoration.bundle-names: "Sam asked about layout and status",
 *  "seguir decisões e ações acordadas" — whys with no deadline, amount or decision behind them). Kept only when
 *  it names a figure or a date/day the items themselves state (digits, a month or weekday word present in the
 *  items); anything else is dropped and the group shows its name alone. Pure. */
export function groundedWhy(why: string, items: string): string | null {
  const w = String(why ?? '').trim();
  if (!w) return null;
  const src = String(items ?? '').toLowerCase();
  // A figure is an amount or a count (two digits or more) — a label's digit ("Q4", "phase 2") is not a stake.
  const nums = (w.match(/\d[\d.,]*/g) ?? []).filter((n) => n.replace(/\D/g, '').length >= 2);
  if (nums.some((n) => src.includes(n.replace(/[.,]$/, '')))) return w;
  const DAYS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|januar|februar|märz|juni|juli|oktober|dezember|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|lundi|mardi|mercredi|jeudi|vendredi|montag|dienstag|mittwoch|donnerstag|freitag|segunda|terça|quarta|quinta|sexta)\b/giu;
  const days = w.toLowerCase().match(DAYS) ?? [];
  if (days.some((d) => src.includes(d))) return w;
  return null;
}

