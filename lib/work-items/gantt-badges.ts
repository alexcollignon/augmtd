// ════════════════════════════════════════════════════════════════════════════════════════════════
// GANTT EVENT TRAILS — "what happened on this item, WHEN, and BY WHOM", from facts already recorded
// (zero AI):
//   • activity_events   — done / dismissed / delegated / restored / filed, each with its date
//   • source_data       — a prepared draft / nudge (+ the coworker attribution) with its date
// ONE shared builder called by BOTH Gantt serving routes (/api/home/timeline and
// /api/entities/[id]/detail) — a third surface later is one call, never a reimplementation.
// Returns work-item-id → dated events (ascending) — the chart renders them as ticks along the
// row's track: the CONTINUITY of the work, on the axis where "when" already lives.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export type GanttEvent = { date: string; label: string };

type TrailItem = { id: string; entityId: string }; // id = 'inbox:<raw>' | 'commit:<raw>'

const ACTIVITY_LABEL: Record<string, string> = {
  marked_done: 'done',
  commitment_done: 'done',
  dismissed: 'dismissed',
  commitment_dismissed: 'dismissed',
  delegated_prepared: 'delegated',
  restored: 'restored',
  membership_move: 'filed',
};

export async function ganttEventsFor(
  client: SupabaseClient, userId: string, items: TrailItem[],
): Promise<Record<string, GanttEvent[]>> {
  const out: Record<string, GanttEvent[]> = {};
  try {
    const rawToWid = new Map<string, string>();
    const inboxRaw: string[] = [];
    for (const w of items) {
      if (!(w.id.startsWith('inbox:') || w.id.startsWith('commit:'))) continue;
      rawToWid.set(w.entityId, w.id);
      if (w.id.startsWith('inbox:')) inboxRaw.push(w.entityId);
    }
    if (!rawToWid.size) return out;
    const push = (wid: string, date: string | null | undefined, label: string) => {
      if (!date) return;
      const a = out[wid] ?? (out[wid] = []);
      const d = date.slice(0, 10);
      if (!a.some((e) => e.label === label && e.date === d) && a.length < 6) a.push({ date: d, label });
    };

    // ── Actions taken (dated). ──
    const { data: acts } = await client.from('activity_events')
      .select('entity_id, type, metadata, created_at')
      .eq('user_id', userId).in('entity_id', [...rawToWid.keys()].slice(0, 400))
      .order('created_at', { ascending: true }).limit(600);
    for (const a of (acts ?? []) as Array<{ entity_id: string; type: string; metadata: Record<string, unknown> | null; created_at: string }>) {
      const wid = rawToWid.get(a.entity_id);
      if (!wid) continue;
      const base = ACTIVITY_LABEL[a.type];
      if (!base) continue;
      const worker = (a.metadata?.worker as string) ?? null;
      push(wid, a.created_at, base === 'delegated' && worker ? `delegated to ${worker.split(' ')[0]}` : base);
    }

    // ── Prepared work living on the item (inbox only — commitments' pool drafts ride activity). ──
    if (inboxRaw.length) {
      const { data: rows } = await client.from('inbox_items').select('id, source_data')
        .eq('user_id', userId).in('id', inboxRaw.slice(0, 400));
      for (const r of (rows ?? []) as Array<{ id: string; source_data: Record<string, unknown> | null }>) {
        const wid = rawToWid.get(r.id);
        if (!wid) continue;
        const sd = (r.source_data ?? {}) as {
          draft?: { body?: string; generated_at?: string }; nudge_draft?: { body?: string; generated_at?: string };
          prepared_by?: { worker?: string };
        };
        const by = sd.prepared_by?.worker?.split(' ')[0];
        if (sd.draft?.body) push(wid, sd.draft.generated_at, by ? `drafted by ${by}` : 'drafted');
        if (sd.nudge_draft?.body) push(wid, sd.nudge_draft.generated_at, 'nudge ready');
      }
    }
    for (const wid of Object.keys(out)) out[wid].sort((a, b) => a.date.localeCompare(b.date));
  } catch { /* trails are an enhancement — the chart renders without them */ }
  return out;
}
