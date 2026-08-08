// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORKERS READ THE ONE GROUNDING (production-floor arc step 1, Aug 8 — the coherence law
// extended to the last reasoner outside the tent). Until now a coworker grounded through its own
// stack (KB search, inbox snapshot, calendar): ask the room "where does EG Bank stand?" and ask
// Clara the same thing, and they were two systems that could disagree. Now, when the user's
// message NAMES a registered project, the worker receives that project's FULL room page — the
// SAME `assembleRoomGrounding` the room's responder, the room Q&A, and the chief's agent loop
// read — so a worker's answer structurally cannot contradict the room.
//
// Deterministic entry: the SAME focus matcher as the Home ask (zero AI; distinctive-token match;
// an all-generic name never matches). Non-fatal, bounded; the block's [L#]/[F#] tags are
// STRIPPED (they would mint dead refs in a worker's prose). Injected on BOTH runtimes — the
// native loop's context parts and the AgentOS bridge's user_context.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

import { findEntityFocus } from '@/lib/home/ask';

export async function focusedProjectGrounding(
  client: DBClient,
  userId: string,
  text: string,
  opts?: { excludeName?: string | null },
): Promise<string | null> {
  try {
    let q = String(text ?? '').trim();
    if (q.length < 3) return null;
    // THE ADDRESSED-NAME STRIP (found live: "Clara, report on EG Bank" matched the entity
    // "Madalena Clara" — the coworker's own name collided with a person-named project). The
    // address is the ENVELOPE, never the subject — remove it before matching.
    const ex = opts?.excludeName?.trim().split(/\s+/)[0];
    if (ex && ex.length >= 3) q = q.replace(new RegExp(`\\b${ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
    const { data: ents } = await client.from('work_entities').select('id, name, aliases')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active')
      .order('last_event_at', { ascending: false }).limit(200);
    const focus = findEntityFocus(q, (ents ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>);
    if (!focus) return null;
    const { assembleRoomGrounding } = await import('@/lib/room/grounding');
    const g = await assembleRoomGrounding(client, userId, { kind: 'entity', entityId: focus.id });
    if (!g?.text) return null;
    return (
      `[THE PROJECT PAGE — the user's message names "${focus.name}". This is its full current ` +
      `state from the one brain (the same page the project's room reads). Ground every claim ` +
      `about this work HERE — never contradict it, never re-derive what it already states:]\n` +
      g.text.replace(/\[(?:L|F)\d+\]\s?/g, '').slice(0, 3800)
    );
  } catch { return null; }
}
