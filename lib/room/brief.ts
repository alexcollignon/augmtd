// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE-VOICE BRIEF (Aug 3 — experience-spec laws 2, 4, 5, 6, 9 applied to the room's opening).
// The living brief was ASSEMBLED from fields (state summary + debt line + next move + lifted ask),
// and stitched parts can never sound like one colleague — the same fact spoke three times, nothing
// said what changed or why now. This module AUTHORS the opening as ONE reasoned paragraph over the
// room's judged state — the room-scope analogue of the Home briefing composer (same doctrine:
// derived not remembered, deltas not events, speak consequence, never restate the settled, earned
// calm). Zero AI on the serving path: the GET serves last-good from the cache; every room open
// fires ensure*Brief in after(), which recomposes ONLY when the sig moved (entity synthesis,
// a new ask, new prepared work, a new narration, or a new day).
//
// TWO DOORS, ONE COMPOSER: an entity room briefs over the deal's judged state; a LOOSE room
// (`<kind>:<id>` key) briefs over the item's own anchor + its room turns. Same laws, same cache
// (item_plans kind='room_brief', entity_id = the room key), same voice.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export const ROOM_BRIEF_VERSION = 2; // v2 — the loose-room door (Aug 3)

type TurnRow = {
  id: string; role: string; text: string | null; dedupe_key: string | null;
  author: { name?: string } | null;
  component: { key?: string; state?: { items?: unknown[]; proceeded?: boolean } } | null;
  created_at: string;
};

/** Last-good read for the serving path (zero AI, one select). Freshness is after()'s job.
 *  roomKey = the entity id (deal room) or `<kind>:<id>` (loose room). */
export async function readRoomBrief(client: SupabaseClient, userId: string, roomKey: string): Promise<string | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', 'room_brief').eq('entity_id', roomKey).maybeSingle();
    const t = (data?.tasks ?? null) as { text?: string; v?: number } | null;
    // A version bump invalidates even the last-good serve (the prompt-version lesson, learned 3×).
    return t?.v === ROOM_BRIEF_VERSION && typeof t.text === 'string' && t.text.trim() ? t.text : null;
  } catch { return null; }
}

// ── The shared gather: the room's own conversation-derived inputs (asks / prepared / deltas). ──
async function roomTurnInputs(client: SupabaseClient, userId: string, roomKey: string) {
  const sel = 'id, role, text, dedupe_key, author, component, created_at';
  let q = await client.from('room_turns').select(sel)
    .eq('user_id', userId).eq('room_key', roomKey).is('archived_at', null)
    .order('created_at', { ascending: false }).limit(15);
  // Pre-migration (no archived_at column) — match lib/room/turns.ts: retry unfiltered.
  if (q.error) {
    q = await client.from('room_turns').select(sel)
      .eq('user_id', userId).eq('room_key', roomKey)
      .order('created_at', { ascending: false }).limit(15);
  }
  const turns = (q.data ?? []) as TurnRow[];
  const asks = turns
    .filter((t) => t.component?.key === 'input_checklist' && Array.isArray(t.component.state?.items) && t.component.state!.items!.length)
    .flatMap((t) => (t.component!.state!.items as unknown[]).map((m) => String(m)).filter(Boolean))
    .slice(0, 4);
  const prepared = turns.find((t) => t.dedupe_key && /^(prep:|meeting-prep:)/.test(t.dedupe_key)) ?? null;
  const latestSystem = turns.find((t) => t.role === 'system') ?? null;
  const deltas = turns
    .filter((t) => t.role === 'system' && !t.component?.key)
    .slice(0, 4)
    .map((t) => String(t.text ?? '').replace(/\s+/g, ' ').slice(0, 140))
    .filter(Boolean);
  return { asks, prepared, latestSystem, deltas };
}

// ── The shared compose+store: one prompt, one cache row, one set of laws. ──
async function composeAndStore(
  client: SupabaseClient, userId: string, roomKey: string,
  name: string, facts: string, sig: string,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const { aiCall } = await import('@/lib/ai/call');
  const res = await aiCall<{ brief?: string }>({
    userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 220,
    source: 'brain_synthesis',
    prompt:
      `You are the user's chief of staff opening the room for ONE body of work: "${name}". ` +
      `Today is ${day}. Write the brief you would SAY as they walk in — one short paragraph, ` +
      `1–3 sentences, second person ("you"), first person ("I") only for work the team did.\n\n` +
      `GROUND TRUTH — you may use ONLY this, never invent names/dates/files:\n${facts}\n\n` +
      `THE LAWS:\n` +
      `- Lead with what changed or what is most consequential NOW — never a status inventory.\n` +
      `- Speak consequence (due dates, who is waiting, since when) — say each fact ONCE.\n` +
      `- Work already prepared: say it exists and what happens on sign-off — never re-describe its contents.\n` +
      `- Settled work is never restated as open. Never ask for anything the facts show as provided.\n` +
      `- If nothing needs the user, say so plainly in ONE sentence — the calm is earned; never pad.\n` +
      `- A sender that is an organization keeps its full name — never shorten it to one word.\n` +
      `- The "one next move" renders as its own button BELOW your paragraph — never restate it as ` +
      `a closing instruction ("Next, send…"); your job is the position and the why, the button is the deed.\n` +
      `- No greetings, no bullet points, no headers — plain prose a competent colleague would say.\n` +
      `JSON only: {"brief":"..."}`,
  });
  const text = String(res.json?.brief ?? '').trim().replace(/\s+/g, ' ').slice(0, 600);
  if (!text) return; // AI failure never overwrites last-good (failure ≠ a blank room)
  await client.from('item_plans').upsert({
    user_id: userId, kind: 'room_brief', entity_id: roomKey,
    tasks: { v: ROOM_BRIEF_VERSION, sig, text }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
}

async function cachedSig(client: SupabaseClient, userId: string, roomKey: string): Promise<string | null> {
  const { data } = await client.from('item_plans').select('tasks')
    .eq('user_id', userId).eq('kind', 'room_brief').eq('entity_id', roomKey).maybeSingle();
  return ((data?.tasks ?? null) as { sig?: string } | null)?.sig ?? null;
}

/** ENTITY ROOM: recompose the deal's brief when its inputs moved — after() on every room open. */
export async function ensureRoomBrief(client: SupabaseClient, userId: string, entityId: string): Promise<void> {
  try {
    const [{ data: ent }, inputs, prior] = await Promise.all([
      client.from('work_entities').select('id, name, summary, state, next_move, sig')
        .eq('id', entityId).eq('user_id', userId).maybeSingle(),
      roomTurnInputs(client, userId, entityId),
      cachedSig(client, userId, entityId),
    ]);
    if (!ent) return;
    const { asks, prepared, latestSystem, deltas } = inputs;
    const st = ((ent.state ?? {}) as { summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] } });
    const nm = ((ent.next_move ?? null) as { title?: string } | null);
    const day = new Date().toISOString().slice(0, 10);

    // The sig — every input that should change what the colleague says. A stale sig serves
    // last-good while this recompose runs; the next open speaks the new position.
    const sig = [
      ROOM_BRIEF_VERSION, day, String(ent.sig ?? ''),
      asks.join('|').slice(0, 200), prepared?.id ?? '', latestSystem?.id ?? '',
    ].join(':');
    if (prior === sig) return;

    const facts = [
      st.summary ? `Position: ${st.summary}` : null,
      st.momentum ? `Momentum: ${st.momentum}` : null,
      st.whoOwes?.you?.length ? `The user owes: ${st.whoOwes.you.slice(0, 3).join(' · ')}` : null,
      st.whoOwes?.them?.length ? `Owed to the user: ${st.whoOwes.them.slice(0, 3).join(' · ')}` : null,
      nm?.title ? `The one next move: ${nm.title}` : null,
      prepared?.text ? `Already prepared and waiting for review: ${String(prepared.text).replace(/\s+/g, ' ').slice(0, 140)}` : null,
      asks.length ? `Still needed from the user (the live ask): ${asks.join(' · ')}` : null,
      deltas.length ? `Recent events, newest first: ${deltas.join(' | ')}` : null,
    ].filter(Boolean).join('\n');
    if (!facts.trim()) return; // nothing judged yet — grounded-or-absent, never an invented brief

    await composeAndStore(client, userId, entityId, String(ent.name), facts, sig);
  } catch (e) {
    console.error('[room-brief] compose error:', e instanceof Error ? e.message : e);
  }
}

/** LOOSE ROOM (`<kind>:<id>`): the same voice over the item's own anchor + its conversation.
 *  anchor = the item's served truth (who · title · ask · prepared-by), passed by the view route. */
export async function ensureLooseRoomBrief(
  client: SupabaseClient, userId: string, roomKey: string,
  anchor: { title: string | null; who: string | null; ask: string | null; prepared: string | null },
): Promise<void> {
  try {
    const [inputs, prior] = await Promise.all([
      roomTurnInputs(client, userId, roomKey),
      cachedSig(client, userId, roomKey),
    ]);
    const { asks, prepared, latestSystem, deltas } = inputs;
    const day = new Date().toISOString().slice(0, 10);
    const anchorSig = `${anchor.who ?? ''}|${(anchor.ask ?? '').slice(0, 120)}|${anchor.prepared ?? ''}`;
    const sig = [
      ROOM_BRIEF_VERSION, day, anchorSig,
      asks.join('|').slice(0, 200), prepared?.id ?? '', latestSystem?.id ?? '',
    ].join(':');
    if (prior === sig) return;

    const facts = [
      anchor.who ? `From: ${anchor.who}` : null,
      anchor.ask ? `What it needs: ${anchor.ask}` : null,
      anchor.prepared ? `A reply is already drafted${anchor.prepared !== 'draft' ? ` by ${anchor.prepared}` : ''} and waiting for review.` : null,
      prepared?.text && !anchor.prepared ? `Already prepared and waiting for review: ${String(prepared.text).replace(/\s+/g, ' ').slice(0, 140)}` : null,
      asks.length ? `Still needed from the user (the live ask): ${asks.join(' · ')}` : null,
      deltas.length ? `Recent events, newest first: ${deltas.join(' | ')}` : null,
      `This is a standalone item — not part of a tracked project.`,
    ].filter(Boolean).join('\n');
    // Grounded-or-absent: a loose item with no ask, no prep and no events has nothing to brief.
    if (!anchor.ask && !anchor.prepared && !asks.length && !deltas.length) return;

    await composeAndStore(client, userId, roomKey, String(anchor.title ?? 'this work'), facts, sig);
  } catch (e) {
    console.error('[room-brief] loose compose error:', e instanceof Error ? e.message : e);
  }
}
