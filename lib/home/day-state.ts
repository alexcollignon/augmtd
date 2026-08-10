// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DAY-STATE BLOCK (initiative loop STEP 0, Aug 10 — owner: "facts are shared everywhere;
// depth stays with the role"). The compact, judged state of the day — ONE object, two consumers:
//   1. GROUNDING CONSISTENCY: injected into every coworker DM so "what's slipping?" asked to
//      Clara can never contradict the chief/deck (the one-brain promise, made verifiable).
//   2. THE ANTICIPATION PASS (next): this is exactly the object it computes proactively, and
//      what the because-chips will cite.
// Derived from the SAME spine the deck renders (buildWorkItems); cached 10 min (item_plans
// kind='day_state' — the room-scope precedent, no migration). ~500 chars — headline facts only;
// the full picture stays the chief's/deck's job (the grounding boundary law).
// ════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

const CACHE_KIND = 'day_state';
const TTL_MS = 10 * 60_000;

export async function getSharedDayState(client: DBClient, userId: string): Promise<string | null> {
  try {
    // Cache first — one row read; a DM message must never pay the spine walk twice in 10 min.
    const { data: cached } = await client.from('item_plans').select('tasks, updated_at')
      .eq('user_id', userId).eq('kind', CACHE_KIND).eq('entity_id', 'global').maybeSingle();
    if (cached?.tasks?.block && cached.updated_at && Date.now() - new Date(cached.updated_at).getTime() < TTL_MS) {
      return cached.tasks.block as string;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const { buildWorkItems } = await import('@/lib/work-items/model');
    const items = (await buildWorkItems(client, userId, { todayStr, skipReconcile: true }))
      .filter((i: { state: string }) => i.state === 'todo' || i.state === 'waiting' || i.state === 'in_progress');
    const overdue = items.filter((i: { when: { bucket: string } }) => i.when.bucket === 'overdue');
    const today = items.filter((i: { when: { bucket: string } }) => i.when.bucket === 'today');
    const top = [...overdue, ...today, ...items.filter((i: { when: { bucket: string } }) => i.when.bucket === 'this_week')]
      .slice(0, 3)
      .map((i: { title: string; who: string | null; when: { bucket: string; explicit: string | null }; entity: { name: string } | null }) =>
        `- "${i.title.slice(0, 70)}"${i.who ? ` — ${i.who}` : ''}${i.entity?.name ? ` · ${i.entity.name}` : ''}` +
        `${i.when.bucket === 'overdue' ? ' · OVERDUE' : i.when.explicit ? ` · due ${i.when.explicit.slice(0, 10)}` : ''}`);

    const block = (
      `[TODAY — the shared day state (${todayStr}); every teammate sees this same headline. ` +
      `Never contradict it; for the full picture, the user's deck and their chief of staff hold the detail:]\n` +
      `Open: ${items.length} item${items.length === 1 ? '' : 's'}` +
      `${overdue.length ? ` · ${overdue.length} OVERDUE` : ''}${today.length ? ` · ${today.length} due today` : ''}.` +
      `${top.length ? `\nTop of the deck:\n${top.join('\n')}` : ''}`
    ).slice(0, 700);

    await client.from('item_plans').upsert({
      user_id: userId, kind: CACHE_KIND, entity_id: 'global',
      tasks: { block }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' });
    return block;
  } catch { return null; } // grounding is an enhancement — a DM never fails on it
}
