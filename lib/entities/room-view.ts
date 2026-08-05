// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROOM VIEW (just-works P7c-c2) — ONE builder for the rail's narration data, shared by BOTH doors:
//   • the item deep-dive (GET /api/items/view — currentItemId marks the open thread)
//   • the project room  (GET /api/entities/[id]/room — no current item; the Overview is focused)
// The prose is the entity's own synthesized state; siblings are bounded parallel reads. The one AI
// touch is the sig-CACHED routing verdict (suggestWorkerForMove, W2) — zero AI on repeat loads.
// One source — the deep-dive and the room can never drift in what "this deal's context" means.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { isAutomatedSender, isCalendarSystemSubject } from '@/lib/inbox/automated';
import { suggestWorkerForMove, type SuggestedWorker } from '@/lib/prepare/route-suggestion';

export type RoomEntity = {
  id: string; name: string;
  tracked: boolean; // T4 — accepted by the user (project) vs merely recognized by memory (context)
  summary: string | null; momentum: string | null; nextMove: string | null; nextMoveHref?: string | null;
  whoOwesYou: string[]; whoOwesThem: string[];
  suggestedWorker: SuggestedWorker | null; // the ONE routing brain's verdict (W2) — served, never client-matched
  /** THE ONE RESPONDER (Aug 5) — the room's whole opening from one reasoned pass over the one
   *  grounding: the paragraph, THE MOVE (board-validated target), and the offer chips. Served
   *  last-good, recomposed in after() when the sig (incl. the board digest) moves. Null until
   *  first compose — the rail falls back to the stitched fields. */
  brief?: string | null;
  move?: { label: string; ref: string | null } | null;
  offers?: Array<{ label: string; say: string }>;
};

export type RoomSiblings = {
  threads: Array<{ id: string; subject: string; who: string | null; at: string | null; current: boolean }>;
  meetings: Array<{ id: string; title: string; at: string | null }>;
  commitments: Array<{ id: string; description: string; who: string | null }>;
  files: Array<{ id: string; filename: string }>;
};

export const emptySiblings = (): RoomSiblings => ({ threads: [], meetings: [], commitments: [], files: [] });

export async function buildRoomView(
  supabase: SupabaseClient, userId: string, entityId: string, currentItemId: string | null,
): Promise<{ entity: RoomEntity | null; siblings: RoomSiblings }> {
  const siblings = emptySiblings();
  const { data: ent } = await supabase.from('work_entities')
    .select('id, name, summary, state, next_move, tracked').eq('id', entityId).eq('user_id', userId).maybeSingle();
  if (!ent) return { entity: null, siblings };

  const st = ((ent.state ?? {}) as { summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] } });
  const nm = ((ent.next_move ?? null) as { title?: string; entityRef?: string | null } | null);
  const entity: RoomEntity = {
    id: ent.id as string, name: String(ent.name),
    tracked: !!ent.tracked,
    summary: st.summary ?? (ent.summary as string | null) ?? null,
    momentum: st.momentum ?? null,
    nextMove: nm?.title ?? null,
    // The brief's CTA target — the next move's own anchor item (the word is the deed, law 8).
    nextMoveHref: (() => {
      const ref = nm?.entityRef ?? null;
      if (!ref) return null;
      const [k, i] = String(ref).split(':');
      return k === 'inbox' ? `/item/${i}?kind=email` : k === 'commit' ? `/item/${i}?kind=commitment` : k === 'meeting' ? `/item/${i}?kind=meeting` : null;
    })(),
    whoOwesYou: Array.isArray(st.whoOwes?.you) ? st.whoOwes!.you!.slice(0, 3) : [],
    whoOwesThem: Array.isArray(st.whoOwes?.them) ? st.whoOwes!.them!.slice(0, 3) : [],
    suggestedWorker: await suggestWorkerForMove(supabase, userId, entityId, { next_move: ent.next_move }),
    ...(await (async () => {
      const { readRoomResponse } = await import('@/lib/room/brief');
      const r = await readRoomResponse(supabase, userId, entityId);
      return { brief: r?.text ?? null, move: r?.move ?? null, offers: r?.offers ?? [] };
    })()),
  };

  // Everything else on this deal — the "this has 2 other threads" awareness.
  const { data: allLinks } = await supabase.from('entity_links').select('item_kind, item_id')
    .eq('user_id', userId).eq('entity_id', entityId).neq('item_kind', 'email_thread').limit(60);
  const lrows = (allLinks ?? []) as Array<{ item_kind: string; item_id: string }>;
  const idsOf = (k: string) => lrows.filter((l) => l.item_kind === k).map((l) => l.item_id);
  const [thrRes, mtgRes, comRes, fileRes] = await Promise.all([
    idsOf('inbox_item').length
      ? supabase.from('inbox_items').select('id, status, source_data, last_activity_at, created_at').in('id', idsOf('inbox_item').slice(0, 20))
      : Promise.resolve({ data: [] }),
    idsOf('meeting').length
      ? supabase.from('meeting_transcripts').select('id, title, start_time, created_at').in('id', idsOf('meeting').slice(0, 6))
      : Promise.resolve({ data: [] }),
    idsOf('commitment').length
      ? supabase.from('commitments').select('id, description, counterparty, status').in('id', idsOf('commitment').slice(0, 12))
      : Promise.resolve({ data: [] }),
    supabase.from('knowledge_files').select('id, filename').eq('user_id', userId).eq('entity_id', entityId).order('indexed_at', { ascending: false }).limit(5),
  ]);

  // CURATED (P5b): sibling chips are the deal's MEANINGFUL conversations — calendar acceptances,
  // invite-system mail and automated senders are membership (the ledger keeps them) but not context
  // a colleague would point at. Cap small — a rail is a glance, not an index.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siblings.threads = ((thrRes.data ?? []) as any[])
    .filter((t) => t.status === 'pending' || String(t.id) === currentItemId)
    .filter((t) => {
      const sd = (t.source_data ?? {}) as Record<string, unknown>;
      const subj = (sd.subject as string) || '';
      if (isCalendarSystemSubject(subj)) return false;
      if (isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, subj)) return false;
      return true;
    })
    .map((t) => ({
      id: String(t.id),
      subject: String(t.source_data?.subject || 'Conversation').slice(0, 80),
      who: (t.source_data?.from_name as string) || (t.source_data?.from_address as string) || null,
      at: (t.last_activity_at as string) || (t.source_data?.received_at as string) || (t.created_at as string) || null,
      current: String(t.id) === currentItemId,
    }))
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 4);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siblings.meetings = ((mtgRes.data ?? []) as any[])
    .map((m) => ({ id: String(m.id), title: String(m.title || 'Meeting').slice(0, 70), at: (m.start_time as string) || (m.created_at as string) || null }))
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openCommits = ((comRes.data ?? []) as any[])
    .filter((c) => c.status === 'open')
    .map((c) => ({ id: String(c.id), description: String(c.description).slice(0, 110), who: (c.counterparty as string) || null }));
  // Near-dup fold: the same obligation extracted from two meetings must not be two chips.
  const { isNearDuplicate } = await import('@/lib/commitments/extract');
  siblings.commitments = openCommits
    .filter((c, i) => !openCommits.slice(0, i).some((prev) => isNearDuplicate(prev.description, c.description, 0.5)))
    .slice(0, 5);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siblings.files = ((fileRes.data ?? []) as any[]).map((f) => ({ id: String(f.id), filename: String(f.filename).slice(0, 60) }));

  return { entity, siblings };
}

// ── "MIGHT BELONG HERE" (projecthood S2) — loose items whose sender/counterparty sits on this
// entity's PEOPLE FINGERPRINT (identity-first, deterministic — the recognition philosophy; no AI,
// no topic-matching). Used by the entity detail route; ≤3 suggestions. ──
export type MembershipSuggestion = { kind: 'inbox_item' | 'commitment'; id: string; label: string; who: string | null };

export function personMatchesFingerprint(who: string | null, people: string[]): boolean {
  const w = (who ?? '').toLowerCase().replace(/<[^>]*>/g, ' ').trim();
  if (!w) return false;
  return people.some((p) => {
    if (p.startsWith('@')) return w.includes(p); // corporate-domain token
    if (p.includes('@')) return w.includes(p);   // full email
    // name form: token-subset ("jean-marie" ⊆ "jean-marie lambert")
    const pt = p.split(/\s+/).filter(Boolean); const wt = new Set(w.split(/\s+/));
    return pt.length > 0 && pt.every((t) => wt.has(t));
  });
}

// Judge memo (plumbing): the reasoned verdict per (entity, shortlist) signature — a per-process
// cache so re-opening the room doesn't re-ask an unchanged question. 10-min TTL.
const _suggestMemo = new Map<string, { at: number; ids: Set<string> }>();

export async function suggestLooseForEntity(
  supabase: SupabaseClient, userId: string, peopleRaw: unknown,
  entity?: { id: string; name: string; summary: string | null },
): Promise<MembershipSuggestion[]> {
  const people = (Array.isArray(peopleRaw) ? (peopleRaw as string[]) : []).map((p) => p.toLowerCase());
  if (!people.length) return [];
  const [liRes, lcRes] = await Promise.all([
    supabase.from('inbox_items').select('id, work_title, source_data')
      .eq('user_id', userId).eq('status', 'pending').eq('source', 'email')
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(60),
    supabase.from('commitments').select('id, description, counterparty')
      .eq('user_id', userId).eq('status', 'open').order('created_at', { ascending: false }).limit(40),
  ]);
  const candIds = [
    ...((liRes.data ?? []) as Array<{ id: string }>).map((r) => r.id),
    ...((lcRes.data ?? []) as Array<{ id: string }>).map((r) => r.id),
  ];
  if (!candIds.length) return [];
  const { data: posLinks } = await supabase.from('entity_links').select('item_id')
    .eq('user_id', userId).in('item_id', candIds).not('entity_id', 'is', null);
  const linkedIds = new Set((posLinks ?? []).map((l) => l.item_id as string));
  const out: MembershipSuggestion[] = [];
  for (const it of (liRes.data ?? []) as Array<Record<string, unknown>>) {
    if (linkedIds.has(it.id as string)) continue;
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const who = `${sd.from_name ?? ''} ${sd.from_address ?? ''}`.trim() || null;
    if (personMatchesFingerprint(who, people)) out.push({ kind: 'inbox_item', id: it.id as string, label: String(it.work_title || sd.subject || 'Email').slice(0, 70), who: (sd.from_name as string) || null });
  }
  for (const c of (lcRes.data ?? []) as Array<Record<string, unknown>>) {
    if (linkedIds.has(c.id as string)) continue;
    if (personMatchesFingerprint((c.counterparty as string) || null, people)) out.push({ kind: 'commitment', id: c.id as string, label: String(c.description).slice(0, 70), who: (c.counterparty as string) || null });
  }
  const shortlist = out.slice(0, 8);
  if (!shortlist.length || !entity) return shortlist.slice(0, 3);

  // ── THE JUDGE (Phase 3 doctrine): the fingerprint match is only RECALL — a shared person is a
  // fact, not membership (one person sits on many deals: the person-prior bug). ONE batched reasoned
  // judgment decides "does this loose item belong to THIS body of work?" — the recognition
  // pipeline's own shape. Sig-memoized; on judge failure, suggest NOTHING (grounded-or-absent).
  const sig = `${entity.id}|${shortlist.map((c) => c.id).join(',')}`;
  const memo = _suggestMemo.get(sig);
  if (memo && Date.now() - memo.at < 10 * 60 * 1000) return shortlist.filter((c) => memo.ids.has(c.id)).slice(0, 3);
  try {
    const { aiCall } = await import('@/lib/ai/call');
    const lines = shortlist.map((c, i) => `[${i + 1}] (${c.kind === 'inbox_item' ? 'email' : 'commitment'}) ${c.who ? `${c.who} · ` : ''}${c.label}`).join('\n');
    const res = await aiCall<{ belongs?: number[] }>({
      userId, supabase, shape: { output: 'json' }, maxTokens: 200, temperature: 0, source: 'brain_synthesis',
      prompt:
        `ONE body of work: "${entity.name}"${entity.summary ? ` — ${entity.summary.slice(0, 160)}` : ''}\n` +
        `Loose items that SHARE A PERSON with it (a shared person is NOT enough — the same person can be on ` +
        `several separate matters):\n${lines}\n\n` +
        `Which items are genuinely PART OF this body of work (same matter, not merely same person)? ` +
        `Be conservative — when unsure, exclude. Return ONLY JSON: {"belongs":[numbers]}`,
    });
    const ids = new Set((res.json?.belongs ?? []).map((n) => shortlist[Number(n) - 1]?.id).filter(Boolean) as string[]);
    _suggestMemo.set(sig, { at: Date.now(), ids });
    return shortlist.filter((c) => ids.has(c.id)).slice(0, 3);
  } catch { return []; }
}
