// UNIFIED READ-TIME CONTEXT (Step 2) — the single reader that folds the durable BRAINS (person_state +
// initiative_state) into a compact prose block for any generative surface (the drafter first; brief /
// coworker chat later). This is the "context kept at the top" move: surfaces READ precomputed judgment
// instead of re-deriving it, so a draft/brief reasons WITH the relationship + where the deal stands.
//
// Read-only, cheap (two keyed lookups, NO AI, NO recompute). Returns '' when nothing is known — purely
// additive, never blocks the caller.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPersonState } from '@/lib/people/state-store';
import { canonicalPerson } from '@/lib/projects/identity';
import type { PersonStateData } from '@/lib/people/brain';

const emailOf = (s?: string | null): string | null =>
  String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

export type BrainContextOpts = { personEmail?: string | null; personName?: string | null; initiative?: string | null };

export async function renderBrainContext(supabase: SupabaseClient, userId: string, opts: BrainContextOpts): Promise<string> {
  const parts: string[] = [];

  // ── The PERSON — who they are to you + where you stand + how they write (so the draft matches).
  // ENTITY-FIRST (One Brain cutover #4): one row per human, alias-matched — no per-address duplicates.
  // person_state is the fallback until demolition. ──
  try {
    const email = emailOf(opts.personEmail);
    let rendered = false;
    try {
      const { getPersonEntities, findPersonEntity } = await import('@/lib/entities/people');
      const pe = findPersonEntity(await getPersonEntities(supabase, userId), email, opts.personName ?? null);
      const s = pe?.state ?? null;
      if (s?.summary) {
        const p = [`[WHO YOU'RE WRITING TO — ${pe!.name}${s.relationship && s.relationship !== 'unknown' ? ` · ${s.relationship}` : ''}]`, `Where you stand: ${s.summary}`];
        if (s.whoOwes?.you?.length) p.push(`You owe them: ${s.whoOwes.you.join('; ')}`);
        if (s.whoOwes?.them?.length) p.push(`They owe you: ${s.whoOwes.them.join('; ')}`);
        if (s.style) p.push(`How they communicate (match this register): ${s.style}`);
        parts.push(p.join('\n'));
        rendered = true;
      }
    } catch { /* fall through */ }
    const key = (email || (opts.personName ? canonicalPerson(opts.personName) : null) || '').toLowerCase();
    if (!rendered && key) {
      const ps = await getPersonState(supabase, userId, key);
      const s = (ps?.state ?? null) as PersonStateData | null;
      if (s?.summary) {
        const p = [`[WHO YOU'RE WRITING TO — ${ps!.display_name || key}${s.relationship !== 'unknown' ? ` · ${s.relationship}` : ''}]`, `Where you stand: ${s.summary}`];
        if (s.whoOwes?.you?.length) p.push(`You owe them: ${s.whoOwes.you.join('; ')}`);
        if (s.whoOwes?.them?.length) p.push(`They owe you: ${s.whoOwes.them.join('; ')}`);
        if (s.style) p.push(`How they communicate (match this register): ${s.style}`);
        parts.push(p.join('\n'));
      }
    }
  } catch { /* non-fatal */ }

  // ── The INITIATIVE — the wider work this touches, so the reply fits the deal, not just the message. ──
  try {
    if (opts.initiative) {
      // ONE BRAIN: resolve the wider work in the ENTITY registry (name/alias match on the label).
      const nk = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const want = nk(opts.initiative);
      if (want) {
        const { data: wents } = await supabase.from('work_entities').select('name, aliases, state')
          .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null).limit(400);
        const hit = ((wents ?? []) as Array<{ name: string; aliases: unknown; state: { summary?: string; stage?: string | null } | null }>)
          .find((e) => nk(e.name) === want || (Array.isArray(e.aliases) && (e.aliases as string[]).some((a) => nk(a) === want)));
        if (hit?.state?.summary) {
          const p = [`[THE WIDER WORK — ${hit.name}]`, `Where it stands: ${hit.state.summary}`];
          if (hit.state.stage) p.push(`Stage: ${hit.state.stage}`);
          parts.push(p.join('\n'));
        }
      }
    }
  } catch { /* non-fatal */ }

  if (!parts.length) return '';
  return `[RELATIONSHIP & DEAL CONTEXT — what you already know about this person and this work; ground the reply in it, do NOT restate it verbatim]\n${parts.join('\n\n')}`;
}

// ── Per-USER "your world" summary — for the COWORKER CHAT, so a teammate reasons WITH your live initiatives
// + the relationships needing attention, instead of a cold prompt. Compact, read-only, no AI. Reads the top
// active brains, attention-first (needs-you / you-owe / gone-quiet lead). Returns '' when nothing is known.
const IRANK: Record<string, number> = { needs_you: 0, gone_quiet: 1, stalled: 1, waiting: 2, active: 3 };
export async function renderWorldContext(supabase: SupabaseClient, userId: string, opts: { maxInitiatives?: number; maxPeople?: number } = {}): Promise<string> {
  const maxI = opts.maxInitiatives ?? 8, maxP = opts.maxPeople ?? 6;
  const parts: string[] = [];
  try {
    // ONE BRAIN: the user's live work = the ENTITY registry (attention-first).
    const { data } = await supabase.from('work_entities').select('name, state, last_event_at')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null)
      .order('last_event_at', { ascending: false }).limit(30);
    const rows = ((data ?? []) as Array<{ name: string; state: { summary?: string; momentum?: string } | null }>).filter((r) => r.state?.summary);
    rows.sort((a, b) => (IRANK[a.state?.momentum ?? 'active'] ?? 4) - (IRANK[b.state?.momentum ?? 'active'] ?? 4));
    const top = rows.slice(0, maxI);
    if (top.length) parts.push(`[YOUR ACTIVE WORK — the user's live work; reason WITH the deals, don't restate them]\n${top.map((r) => `- ${r.name} [${r.state!.momentum}]: ${r.state!.summary}`).join('\n')}`);
  } catch { /* non-fatal */ }
  try {
    // ENTITY-FIRST (cutover #4): one row per human (alias-deduped) — no duplicate relationship lines.
    const { getPersonEntities } = await import('@/lib/entities/people');
    const pes = (await getPersonEntities(supabase, userId))
      .filter((p) => p.state?.summary && (p.state.momentum === 'you_owe' || p.state.momentum === 'gone_quiet'))
      .sort((a, b) => (b.lastEventAt || '').localeCompare(a.lastEventAt || ''));
    if (pes.length) {
      parts.push(`[KEY RELATIONSHIPS NEEDING ATTENTION]\n${pes.slice(0, maxP).map((p) => `- ${p.name} [${p.state!.momentum}]: ${p.state!.summary}`).join('\n')}`);
    } else {
      const { data } = await supabase.from('person_state').select('display_name, state, last_touch_at').eq('user_id', userId).order('last_touch_at', { ascending: false }).limit(40);
      const rows = ((data ?? []) as Array<{ display_name: string | null; state: { summary?: string; momentum?: string } | null }>).filter((r) => r.state?.summary && (r.state.momentum === 'you_owe' || r.state.momentum === 'gone_quiet'));
      const top = rows.slice(0, maxP);
      if (top.length) parts.push(`[KEY RELATIONSHIPS NEEDING ATTENTION]\n${top.map((r) => `- ${r.display_name} [${r.state!.momentum}]: ${r.state!.summary}`).join('\n')}`);
    }
  } catch { /* non-fatal */ }
  return parts.join('\n\n');
}
