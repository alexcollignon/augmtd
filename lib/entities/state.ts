// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE BRAIN — ENTITY STATE synthesis (Phase B→C bridge). The brains move INTO the entity registry:
// for each entity, ONE reasoned pass over its linked ledger (all sources) produces where-it-stands,
// momentum, whoOwes, the ONE next move, and — new — the REASONED PRIORITY {weight, reason} that replaces
// the hand-tuned verdict weight tables (the demolition promise: judgment is reasoned, never a formula).
//
// Same discipline as the initiative/person brains: assembly is deterministic + cheap; the AI call is
// sig-gated (unchanged ledger = no AI); classification-shape via the router. Consumers read these fields
// in Phase C exactly where they read initiative_state/verdict today.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';

export type EntityState = {
  summary: string;                                  // where it stands right now
  momentum: 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
  category?: 'client' | 'internal' | 'personal' | 'admin'; // what KIND of work (reasoned)
  whoOwes: { you: string[]; them: string[] };
  stage: string | null;
  blocking: string | null;
};
export type EntityNextMove = { kind: 'reply' | 'send' | 'followup' | 'none'; title: string; reason: string; entityRef: string | null };
export type EntityPriority = { weight: number; reason: string };

type LedgerLine = { at: string; kind: string; who: string | null; text: string; ref: string };

const daysBetween = (a: string, b: number) => Math.floor((b - new Date(a).getTime()) / 86400000);

// The user's own name (so the synthesis says "you") — same memo pattern as the brains.
const nameMemo = new Map<string, { at: number; name: string | null }>();
async function getUserName(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const c = nameMemo.get(userId);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.name;
  let name: string | null = null;
  try { const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(); name = (data as { full_name?: string } | null)?.full_name?.trim() || null; } catch { /* non-fatal */ }
  nameMemo.set(userId, { at: Date.now(), name });
  return name;
}

/** Assemble the entity's cross-source ledger from its links — deterministic, no AI. */
async function assembleLedger(supabase: SupabaseClient, userId: string, entityId: string): Promise<{ ledger: LedgerLine[]; sig: string; quietDays: number | null }> {
  const { data: links } = await supabase.from('entity_links')
    .select('item_kind, item_id').eq('user_id', userId).eq('entity_id', entityId).neq('item_kind', 'email_thread').limit(200);
  const byKind = new Map<string, string[]>();
  for (const l of (links ?? []) as Array<{ item_kind: string; item_id: string }>) {
    (byKind.get(l.item_kind) ?? byKind.set(l.item_kind, []).get(l.item_kind)!).push(l.item_id);
  }
  const ledger: LedgerLine[] = [];
  const inboxIds = byKind.get('inbox_item') ?? [];
  if (inboxIds.length) {
    const { data } = await supabase.from('inbox_items').select('id, work_title, source_data, created_at, status').in('id', inboxIds.slice(0, 100));
    for (const it of (data ?? []) as Array<Record<string, any>>) {
      const sd = it.source_data ?? {};
      // Resolution status rides the line (L2): a handled/dismissed item must read as SETTLED — so the
      // synthesis can see "he already dealt with this" instead of re-arguing it as open.
      const res = it.status === 'completed' ? ' (handled)' : it.status === 'dismissed' ? ' (dismissed)' : '';
      ledger.push({ at: sd.received_at ?? it.created_at ?? '', kind: 'email', who: sd.from_name ?? sd.from_address ?? null, text: `${String(it.work_title || sd.subject || '')}${res}`, ref: `inbox:${it.id}` });
    }
  }
  const mtgIds = byKind.get('meeting') ?? [];
  if (mtgIds.length) {
    const { data } = await supabase.from('meeting_transcripts').select('id, title, start_time').in('id', mtgIds.slice(0, 40));
    for (const m of (data ?? []) as Array<Record<string, any>>) ledger.push({ at: m.start_time ?? '', kind: 'meeting', who: null, text: String(m.title || 'Meeting'), ref: `meeting:${m.id}` });
  }
  const cIds = byKind.get('commitment') ?? [];
  if (cIds.length) {
    const { data } = await supabase.from('commitments').select('id, description, counterparty, direction, due_date, created_at, status').in('id', cIds.slice(0, 60));
    for (const c of (data ?? []) as Array<Record<string, any>>) {
      const owes = String(c.direction || 'you_owe') === 'awaiting' ? 'they owe' : 'you owe';
      ledger.push({ at: c.created_at ?? '', kind: 'commitment', who: c.counterparty ?? null, text: `${owes}${c.status === 'done' ? ' (done)' : ''}: ${c.description}${c.due_date ? ` (due ${c.due_date})` : ''}`, ref: `commit:${c.id}` });
    }
  }
  const calIds = byKind.get('calendar_event') ?? [];
  if (calIds.length) {
    const { data } = await supabase.from('calendar_events').select('id, title, start_time').in('id', calIds.slice(0, 40));
    const nowIso = new Date().toISOString();
    for (const e of (data ?? []) as Array<Record<string, any>>) ledger.push({ at: e.start_time ?? '', kind: 'meeting', who: null, text: `${(e.start_time ?? '') > nowIso ? 'Upcoming meeting' : 'Meeting'}: ${e.title || ''}`, ref: `event:${e.id}` });
  }
  ledger.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const nowMs = Date.now();
  const past = ledger.filter((l) => l.at && new Date(l.at).getTime() <= nowMs);
  const quietDays = past.length ? Math.max(0, daysBetween(past[0].at, nowMs)) : null;
  // CONTENT-HASH sig (L2) — the old `length:newest-at` was DEAF to user actions: resolving an item adds no
  // line and moves no timestamp, so the brain literally could not notice a dismissal/completion. Hashing
  // the line texts (which now carry resolution status) makes any status flip count as change.
  let h = 0; for (const l of ledger) { const s = `${l.at}|${l.text}`; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; }
  const sig = `${ledger.length}:${h}`;
  return { ledger: ledger.slice(0, 28), sig, quietDays };
}

/** Sig-gated synthesis of ONE entity's state + next move + reasoned priority. */
export async function refreshEntityState(supabase: SupabaseClient, userId: string, entityId: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    const { data: ent } = await supabase.from('work_entities')
      .select('id, name, summary, aliases, sig').eq('id', entityId).eq('user_id', userId).maybeSingle();
    if (!ent) return;
    const { ledger, sig, quietDays } = await assembleLedger(supabase, userId, entityId);
    if (!ledger.length) return;
    if (!opts.force && ent.sig === sig) return; // unchanged → no AI

    const userName = await getUserName(supabase, userId);
    const lines = ledger.map((l) => `${(l.at || '').slice(0, 10)} · ${l.kind}${l.who ? ` · ${l.who}` : ''}: ${l.text.slice(0, 110)}`).join('\n');
    const prompt =
      `You maintain the live STATE of one body of work in a person's life, pick its single NEXT MOVE, and judge ` +
      `its PRIORITY. It can be anything bounded — a deal, a program, a hire, an operation, a personal matter. ` +
      `No funnel assumptions.\n\n` +
      (userName ? `The owner is ${userName} — always "you", never the name.\n` : '') +
      `Body of work: ${ent.name}${ent.summary ? ` — ${ent.summary}` : ''}\n` +
      `Days since last real touch: ${quietDays ?? 'unknown'}\n\n` +
      `Event ledger (most recent first — ALL you know; never invent beyond it):\n${lines}\n\n` +
      `Return ONLY JSON:\n` +
      `{"summary":"<=15 words: where it stands right now, factual",` +
      `"momentum":"active|needs_you|waiting|gone_quiet|stalled",` +
      `"whoOwes":{"you":["short items YOU owe"],"them":["short items OTHERS owe you"]},` +
      `"stage":"<=4 words in its own terms, or null",` +
      `"blocking":"<=12 words if something concrete blocks it, else null",` +
      `"next_move":{"kind":"reply|send|followup|none","title":"<=10 words imperative","reason":"<=15 words why now"},` +
      `"priority":{"weight":0-100,"reason":"<=12 words"}}\n` +
      `priority calibration — judge against a busy person's whole day: 80+ = drop-everything (a major matter ` +
      `needs you now / hard deadline); 50-79 = important active matter; 20-49 = routine upkeep; <20 = background ` +
      `noise/awareness. Judge by stakes IN THE LEDGER (who's waiting, money, deadlines, momentum) — never inflate.\n` +
      `next_move — honest: "none" when nothing is owed (do NOT invent a move).`;

    const res = await aiCall<{
      summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] }; stage?: string | null; blocking?: string | null;
      next_move?: { kind?: string; title?: string; reason?: string }; priority?: { weight?: number; reason?: string };
    }>({ userId, supabase, shape: { output: 'json' }, prompt, temperature: 0, maxTokens: 500, source: 'brain_synthesis' });
    const p = res.json ?? {};
    if (!p.summary) return;

    const mo = ['active', 'needs_you', 'waiting', 'gone_quiet', 'stalled'].includes(p.momentum as string) ? p.momentum : 'active';
    // Category is owned by the GROUNDED classifier (scripts/backfill-entity-category.ts — domain-aware),
    // NOT this ledger-only pass. PRESERVE the existing grounded value so a state refresh never overwrites it.
    let priorCategory: EntityState['category'] | undefined;
    try { const { data: cur } = await supabase.from('work_entities').select('state').eq('id', entityId).maybeSingle(); priorCategory = ((cur?.state ?? null) as { category?: EntityState['category'] } | null)?.category; } catch { /* non-fatal */ }
    const state: EntityState = {
      summary: String(p.summary).slice(0, 200), momentum: mo as EntityState['momentum'],
      category: priorCategory,
      whoOwes: { you: (p.whoOwes?.you ?? []).slice(0, 5).map(String), them: (p.whoOwes?.them ?? []).slice(0, 5).map(String) },
      stage: p.stage ? String(p.stage).slice(0, 40) : null,
      blocking: p.blocking ? String(p.blocking).slice(0, 120) : null,
    };
    let nextMove: EntityNextMove | null = null;
    const nm = p.next_move;
    if (nm?.kind && ['reply', 'send', 'followup'].includes(nm.kind) && nm.title) {
      const latestInbound = ledger.find((l) => l.kind === 'email')?.ref ?? null;
      nextMove = { kind: nm.kind as EntityNextMove['kind'], title: String(nm.title).slice(0, 120), reason: String(nm.reason || '').slice(0, 140), entityRef: latestInbound };
    }
    const priority: EntityPriority = {
      weight: Math.max(0, Math.min(100, Math.round(Number(p.priority?.weight ?? 20)))),
      reason: String(p.priority?.reason || '').slice(0, 100),
    };
    await supabase.from('work_entities').update({
      state, next_move: nextMove, priority, sig,
      last_event_at: ledger[0]?.at || new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', entityId).eq('user_id', userId);
  } catch { /* non-fatal */ }
}

/** Batch refresh (sig-gated per entity — unchanged ones cost nothing). */
export async function refreshEntityStates(supabase: SupabaseClient, userId: string, entityIds?: string[]): Promise<void> {
  let ids = entityIds;
  if (!ids) {
    const { data } = await supabase.from('work_entities').select('id').eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(300);
    ids = (data ?? []).map((r) => r.id as string);
  }
  const CH = 4;
  for (let i = 0; i < ids.length; i += CH) {
    await Promise.all(ids.slice(i, i + CH).map((id) => refreshEntityState(supabase, userId, id)));
  }
}
