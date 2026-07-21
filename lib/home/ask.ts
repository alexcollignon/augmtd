// ════════════════════════════════════════════════════════════════════════════════════════════════
// HOME ASK — the entry to the brain. A grounded Q&A over the ONE registry: the user's active bodies of
// work (entities: state / next-move / who-owes / category), the people needing attention, open
// commitments, today's schedule, and recent replies they owe. ONE reasoned pass, GROUNDED — it answers
// only from this context, cites the items it used, and is honest ("nothing on that") rather than guessing
// (the trust invariant; hallucination is what kills these products). Read-only in v1; actions come later.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { resolveFileUniversal } from '@/lib/knowledge/resolve';
import { getTodaySchedule, renderScheduleBlock } from '@/lib/calendar/today-schedule';

export type AskRef = { id: string; kind: 'entity' | 'inbox_item' | 'commitment' | 'meeting' | 'file'; label: string; href: string | null };
export type AskAnswer = { answer: string; refs: AskRef[] };
export type AskTurn = { role: 'user' | 'assistant'; text: string };

const entHref = (id: string) => `/?view=projects&entity=${id}`;

/** Assemble a compact, bounded snapshot of the brain — everything the answer may reason over. */
async function buildBrainSnapshot(supabase: SupabaseClient, userId: string): Promise<{ text: string; refs: Map<string, AskRef> }> {
  const refs = new Map<string, AskRef>();
  const parts: string[] = [];
  const nowMs = Date.now();

  // Active bodies of work (entities) — the spine. State + next move + who-owes + category.
  const { data: ents } = await supabase.from('work_entities')
    .select('id, name, state, next_move, priority, last_event_at')
    .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null)
    .order('last_event_at', { ascending: false }).limit(60);
  const sorted = (ents ?? []).map((e) => e as Record<string, unknown>)
    .sort((a, b) => Number((b.priority as { weight?: number } | null)?.weight ?? 0) - Number((a.priority as { weight?: number } | null)?.weight ?? 0));
  if (sorted.length) {
    const lines: string[] = [];
    sorted.slice(0, 40).forEach((e, i) => {
      const id = `E${i + 1}`; const st = (e.state ?? {}) as { summary?: string; momentum?: string; category?: string; whoOwes?: { you?: string[]; them?: string[] } };
      const nm = (e.next_move ?? null) as { title?: string } | null;
      const q = e.last_event_at ? Math.floor((nowMs - new Date(e.last_event_at as string).getTime()) / 86400000) : null;
      refs.set(id, { id: e.id as string, kind: 'entity', label: e.name as string, href: entHref(e.id as string) });
      lines.push(`[${id}] ${e.name}${st.category ? ` (${st.category})` : ''} — ${st.summary ?? ''}${st.momentum ? ` [${st.momentum}${q != null && (st.momentum === 'gone_quiet' || st.momentum === 'stalled') ? ` ${q}d` : ''}]` : ''}${st.whoOwes?.you?.length ? ` · you owe: ${st.whoOwes.you.join('; ')}` : ''}${nm?.title ? ` · next: ${nm.title}` : ''}`);
    });
    parts.push(`ACTIVE WORK (the user's bodies of work — reference as [E#]):\n${lines.join('\n')}`);
  }

  // People needing attention.
  const { data: ppl } = await supabase.from('work_entities')
    .select('name, state').eq('user_id', userId).eq('kind', 'person').eq('status', 'active').not('state', 'is', null).limit(200);
  const attn = ((ppl ?? []) as Array<{ name: string; state: { summary?: string; momentum?: string } | null }>)
    .filter((p) => p.state?.summary && (p.state.momentum === 'you_owe' || p.state.momentum === 'gone_quiet' || p.state.momentum === 'needs_you'))
    .slice(0, 12);
  if (attn.length) parts.push(`PEOPLE NEEDING ATTENTION:\n${attn.map((p) => `- ${p.name} [${p.state!.momentum}]: ${p.state!.summary}`).join('\n')}`);

  // Open commitments.
  const { data: commits } = await supabase.from('commitments')
    .select('id, description, counterparty, direction, due_date').eq('user_id', userId).in('status', ['open', 'pending']).limit(40);
  if ((commits ?? []).length) {
    const lines = (commits ?? []).map((c, i) => { const id = `C${i + 1}`; const r = c as Record<string, unknown>; refs.set(id, { id: r.id as string, kind: 'commitment', label: String(r.description || '').slice(0, 60), href: `/item/${r.id}?kind=commitment` }); return `[${id}] ${String(r.direction) === 'awaiting' ? 'they owe' : 'you owe'}: ${r.description}${r.counterparty ? ` (${r.counterparty})` : ''}${r.due_date ? ` — due ${r.due_date}` : ''}`; });
    parts.push(`OPEN COMMITMENTS (reference as [C#]):\n${lines.join('\n')}`);
  }

  // Today's schedule — THE ONE READ (single-source with the brief/report) + the NOW anchor, so the
  // answer never lists this morning's meetings as if they were still ahead.
  const sched = await getTodaySchedule(supabase, userId);
  parts.push(renderScheduleBlock(sched));

  // Recent replies owed.
  const { data: items } = await supabase.from('inbox_items')
    .select('id, work_title, source_data, rule_type, status').eq('user_id', userId).eq('source', 'email').order('created_at', { ascending: false }).limit(60);
  const mr = ((items ?? []) as Array<Record<string, unknown>>).filter((it) => it.status !== 'completed' && it.status !== 'dismissed' && (it.rule_type === 'needs_reply' || (it.source_data as { understanding?: { relevance?: string } } | null)?.understanding?.relevance === 'reply')).slice(0, 12);
  if (mr.length) parts.push(`REPLIES YOU OWE (reference as [R#]):\n${mr.map((it, i) => { const id = `R${i + 1}`; const sd = (it.source_data ?? {}) as { from_name?: string }; refs.set(id, { id: it.id as string, kind: 'inbox_item', label: String(it.work_title || '').slice(0, 50), href: `/item/${it.id}?kind=email` }); return `[${id}] ${sd.from_name ?? ''} · ${it.work_title}`; }).join('\n')}`);

  return { text: parts.join('\n\n') || '(nothing active right now)', refs };
}

export async function answerHomeQuestion(
  supabase: SupabaseClient, userId: string, question: string, history: AskTurn[] = [],
): Promise<AskAnswer> {
  const { text: snapshot, refs } = await buildBrainSnapshot(supabase, userId);
  // FILE LANE via THE ONE RESOLVER (single-source #2): question-driven retrieval across pool → KB →
  // connected drives, so "do we have the deck?" is answerable. Top hits ride as [F#] refs. Non-fatal.
  let fileBlock = '';
  try {
    const fCands = await resolveFileUniversal(supabase, { userId }, question, 4);
    if (fCands.length) {
      const lines = fCands.map((c, i) => {
        const id = `F${i + 1}`;
        refs.set(id, { id, kind: 'file', label: c.filename, href: null });
        return `[${id}] ${c.filename}${c.snippet ? ` — ${c.snippet.slice(0, 90)}` : ''}${c.source === 'gdrive' || c.source === 'onedrive' ? ` (${c.source})` : ''}`;
      });
      fileBlock = `\n\nFILES that may relate to the question (reference as [F#]):\n${lines.join('\n')}`;
    }
  } catch { /* no file lane */ }
  const priorTurns = history.slice(-6).map((t) => `${t.role === 'user' ? 'THEM' : 'YOU'}: ${t.text}`).join('\n');
  const prompt =
    `You are the user's assistant inside their work app — you hold their whole working context (emails, ` +
    `meetings, projects, calendar, commitments, people) and answer like a sharp, calm colleague who already ` +
    `knows their world. Answer their question GROUNDED STRICTLY in the context below.\n\n` +
    `THEIR CONTEXT:\n${snapshot}${fileBlock}\n\n` +
    (priorTurns ? `EARLIER IN THIS CHAT:\n${priorTurns}\n\n` : '') +
    `THEIR QUESTION: ${question}\n\n` +
    `Rules:\n` +
    `- Answer ONLY from the context. If it doesn't cover the question, say so plainly ("I don't have anything on that yet") — NEVER invent people, dates, or facts.\n` +
    `- Be brief and specific — a couple of sentences, the way a colleague would say it out loud. Lead with the answer.\n` +
    `- PLAIN PROSE ONLY: no markdown (no **bold**, no headers, no tables, no bullet lists). Never place two refs back-to-back — connect them with words.\n` +
    `- Reference the items you used by their tag ([E#]/[C#]/[R#]/[F#]) inline where natural — the app turns them into links.\n` +
    `- Reason across items when useful (connect a deal to its commitments / its meeting / who owes what).\n` +
    `Return ONLY JSON: {"answer":"<the answer, with [E#]/[C#]/[R#]/[F#] tags>","refs":["E1","C2","F1",...]}`;

  // BUDGET ROUTING (one policy, deterministic): lookups run on the CHEAP tier; only synthesis-intent
  // questions ("what did I miss", "prioritize", "should I…") escalate to deep reasoning. Typical asks
  // become ~5-8x cheaper with no visible loss on the easy majority.
  const deep = /miss|summar|priorit|plan\b|why\b|should|think|advice|catch me up|overview|strategy|recommend/i.test(question) || question.length > 120;
  const res = await aiCall<{ answer?: string; refs?: string[] }>({
    userId, supabase, shape: deep ? { output: 'json', reasoning: 'deep' } : { output: 'json' }, prompt, maxTokens: 700, temperature: 0.2, source: 'brain_synthesis',
  });
  const answer = String(res.json?.answer || '').trim() || "I don't have anything on that yet.";
  const used = (res.json?.refs ?? []).map((t) => refs.get(t)).filter((r): r is AskRef => !!r);
  // Dedup refs (a tag can repeat); keep order.
  const seen = new Set<string>(); const outRefs: AskRef[] = [];
  for (const r of used) { if (!seen.has(r.id)) { seen.add(r.id); outRefs.push(r); } }
  return { answer, refs: outRefs };
}
