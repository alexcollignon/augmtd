// ════════════════════════════════════════════════════════════════════════════════════════════════
// FOUNDING NARRATION (one-room R4 — docs/one-room-plan.md). Projects are HUMAN-CREATED; the brain's
// recognition keeps running underneath — so the moment a user founds/tracks a project, the entity's
// EXISTING links ARE the member proposal. This narrates it into the project's room as a durable
// turn ("Started X — 4 emails, 1 meeting and 2 tasks already connect — they're in."), honest-zero
// when nothing connects yet. Zero AI — the counts come straight from what recognition stored.
// One module, three callers: POST /api/entities, PATCH action:'track', the chat create_project tool.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { writeRoomTurn } from '@/lib/room/turns';

export type FoundingCounts = { emails: number; meetings: number; tasks: number; total: number };
export type FoundingAdoption = { id: string; name: string; count: number };

const norm = (s: string): string[] =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 2);

/** CREATION-TIME RECOGNITION (the near-name lesson): founding a project must recognize what the
 *  brain ALREADY KNOWS under near-names — "Widget" should find "Widget Alpha Rollout".
 *  Deterministic name/alias token-subset match (the shorter name's tokens all appear in the
 *  longer's), guarded by the user's own company token (too broad to match on — the locked July-15
 *  lesson). The user CONFIRMS each adoption — this proposes, never merges silently. */
export async function proposeFoundingAdoptions(
  client: SupabaseClient, userId: string, entityId: string, name: string,
): Promise<FoundingAdoption[]> {
  const out: FoundingAdoption[] = [];
  try {
    const nameToks = norm(name);
    if (!nameToks.length) return out;
    // The user's own company token (from their login domain SLD) is too broad to drive a match.
    let companyTok: string | null = null;
    try {
      const { data: prof } = await client.from('profiles').select('email').eq('id', userId).maybeSingle();
      const dom = String(prof?.email ?? '').split('@')[1] ?? '';
      const sld = dom.split('.')[0] ?? '';
      if (sld.length > 2) companyTok = sld.toLowerCase();
    } catch { /* non-fatal */ }
    const { data: ents } = await client.from('work_entities').select('id, name, aliases')
      .eq('user_id', userId).eq('kind', 'initiative').neq('id', entityId)
      .in('status', ['active', 'archived']).limit(500);
    for (const e of (ents ?? []) as Array<{ id: string; name: string; aliases: unknown }>) {
      const forms = [e.name, ...(Array.isArray(e.aliases) ? (e.aliases as string[]) : [])];
      const matches = forms.some((f) => {
        const ft = norm(f);
        if (!ft.length) return false;
        const [short, long] = nameToks.length <= ft.length ? [nameToks, new Set(ft)] : [ft, new Set(nameToks)];
        if (!short.every((t) => long.has(t))) return false;
        // Distinctiveness: at least one shared token that is NOT the company token.
        return short.some((t) => t !== companyTok);
      });
      if (!matches) continue;
      // Members live in TWO memories: entity links (the one-brain era) AND the label-era
      // `initiative` strings still on items (entities synthesized before link backfills carry
      // state but zero links — the label-era-shell case). Count both; the adopt endpoint links the
      // label-era members on confirm. (NB: head:true counts return null on this client.)
      const { data: lks } = await client.from('entity_links').select('item_id')
        .eq('user_id', userId).eq('entity_id', e.id).limit(60);
      let n = (lks ?? []).length;
      try {
        const { data: li } = await client.from('inbox_items').select('id')
          .eq('user_id', userId).eq('status', 'pending')
          .filter('source_data->understanding->>initiative', 'ilike', e.name).limit(40);
        const { data: lc } = await client.from('commitments').select('id')
          .eq('user_id', userId).eq('status', 'open').ilike('initiative', e.name).limit(40);
        n += (li ?? []).length + (lc ?? []).length;
      } catch { /* label-era read is best-effort */ }
      if (n > 0) out.push({ id: e.id, name: e.name, count: n });
    }
    out.sort((a, b) => b.count - a.count);
  } catch { /* proposals are an enhancement */ }
  return out.slice(0, 4);
}

export async function narrateFounding(
  client: SupabaseClient, userId: string, entityId: string, name: string,
  verb: 'started' | 'tracking',
): Promise<FoundingCounts> {
  const counts: FoundingCounts = { emails: 0, meetings: 0, tasks: 0, total: 0 };
  try {
    const { data } = await client.from('entity_links').select('item_kind')
      .eq('user_id', userId).eq('entity_id', entityId);
    for (const r of (data ?? []) as Array<{ item_kind: string }>) {
      if (r.item_kind === 'inbox_item') counts.emails++;
      else if (r.item_kind === 'meeting') counts.meetings++;
      else if (r.item_kind === 'commitment') counts.tasks++;
    }
    counts.total = counts.emails + counts.meetings + counts.tasks;

    const lead = verb === 'started' ? `Started ${name}` : `Now tracking ${name}`;
    const parts = [
      counts.emails ? `${counts.emails} email${counts.emails === 1 ? '' : 's'}` : null,
      counts.meetings ? `${counts.meetings} meeting${counts.meetings === 1 ? '' : 's'}` : null,
      counts.tasks ? `${counts.tasks} task${counts.tasks === 1 ? '' : 's'}` : null,
    ].filter(Boolean) as string[];
    const text = counts.total
      ? `${lead} — I've been seeing this already: ${parts.join(', ')} connect. They're in; new work about it will attach as it arrives.`
      : `${lead} — nothing connects yet. New mail and meetings about it will attach as they arrive.`;
    await writeRoomTurn(client, userId, entityId, { role: 'system', text, dedupeKey: 'founded' });

    // ── CREATION-TIME RECOGNITION → THE PROPOSAL TURN (the "first sync", in the room's
    // conversation, confirmable — never a popup, never a silent merge). Durable: the options ride
    // the turn's `component` payload; the rail renders them as the numbered idiom, and
    // /api/entities/adopt updates this turn as options are taken. ──
    const adoptions = await proposeFoundingAdoptions(client, userId, entityId, name);
    if (adoptions.length) {
      await writeRoomTurn(client, userId, entityId, {
        role: 'system',
        text: `I already know work that looks like ${name}: ${adoptions.map((a) => `"${a.name}" (${a.count} item${a.count === 1 ? '' : 's'})`).join(' · ')}. Bring it in?`,
        component: { key: 'founding_proposal', state: { targetId: entityId, options: adoptions.map((a) => ({ label: `Bring in "${a.name}" — ${a.count} item${a.count === 1 ? '' : 's'}`, sourceId: a.id })) } },
        dedupeKey: 'founding-proposal',
      });
    }
  } catch { /* narration is an enhancement — the founding already landed */ }
  return counts;
}
