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
import { GENERIC_WORK_WORDS } from '@/lib/entities/recognize';

export type AskRef = { id: string; kind: 'entity' | 'inbox_item' | 'commitment' | 'meeting' | 'file'; label: string; href: string | null };
export type AskAnswer = { answer: string; refs: AskRef[] };
export type AskTurn = { role: 'user' | 'assistant'; text: string };

const entHref = (id: string) => `/home?view=projects&entity=${id}`;

// ── THE FOCUS MATCH (one-surface § the one grounding, Aug 5): which registered entity does an
// unscoped question NAME? Strict by design — ≥1 distinctive token of the entity's name/aliases
// must appear in the question (an all-generic name never matches; namesOverlap's trust-the-judge
// fallback would make "AI Assessment" match every question). Longest matched-token weight wins.
// Pure + exported for the deterministic gate. ──
export function findEntityFocus(
  question: string,
  ents: Array<{ id: string; name: string; aliases?: string[] | null }>,
): { id: string; name: string } | null {
  const q = ` ${question.toLowerCase()} `;
  let best: { id: string; name: string; score: number } | null = null;
  for (const e of ents) {
    const names = [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])].filter(Boolean);
    let score = 0;
    for (const n of names) {
      const tokens = String(n).toLowerCase().split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !GENERIC_WORK_WORDS.has(t) && !/^(ai|ia|ml)$/.test(t));
      const matched = tokens.filter((t) => q.includes(t));
      if (matched.length) score = Math.max(score, matched.reduce((a, t) => a + t.length, 0));
    }
    if (score > 0 && (!best || score > best.score)) best = { id: e.id, name: e.name, score };
  }
  return best ? { id: best.id, name: best.name } : null;
}

/** Assemble a compact, bounded snapshot of the brain — everything the answer may reason over.
 *  Exported: the converse core grounds global-scope open turns on the SAME read.
 *  With `focusQuery` (THE ONE-GROUNDING UNIFICATION): when the question NAMES a registered
 *  entity, that entity's FULL room grounding — the same assembled page the room itself reads —
 *  is appended as the FOCUSED WORK block, so an answer from the Home and an answer from the
 *  room structurally cannot disagree. */
export async function buildBrainSnapshot(supabase: SupabaseClient, userId: string, focusQuery?: string): Promise<{ text: string; refs: Map<string, AskRef> }> {
  const refs = new Map<string, AskRef>();
  const parts: string[] = [];
  const nowMs = Date.now();

  // Active bodies of work (entities) — the spine. State + next move + who-owes + category.
  const { data: ents } = await supabase.from('work_entities')
    .select('id, name, aliases, state, next_move, priority, last_event_at')
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

  // ── THE ONE-GROUNDING UNIFICATION (one-surface arc, Aug 5): a question that NAMES a body of
  // work gets that entity's FULL room grounding appended — the same assembled page the room's
  // brief/responder/agent loop read, so "status on X?" from the Home and from X's room are the
  // same answer by construction. The block's own [L#]/[F#] tags are STRIPPED (they would collide
  // with the snapshot's tag space and mint wrong links); the entity's [E#] chip carries the link.
  // Non-fatal: a grounding failure serves the plain snapshot (the pre-unification status quo). ──
  if (focusQuery?.trim()) {
    try {
      const focus = findEntityFocus(focusQuery, (ents ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>);
      if (focus) {
        const { assembleRoomGrounding } = await import('@/lib/room/grounding');
        const g = await assembleRoomGrounding(supabase, userId, { kind: 'entity', entityId: focus.id });
        const eTag = [...refs.entries()].find(([, r]) => r.kind === 'entity' && r.id === focus.id)?.[0];
        if (!eTag) refs.set('E0', { id: focus.id, kind: 'entity', label: focus.name, href: entHref(focus.id) });
        parts.push(
          `THE FOCUSED WORK — the question names "${focus.name}"${eTag ? ` (reference as [${eTag}])` : ' (reference as [E0])'}. ` +
          `This is its full current page — deeper and MORE CURRENT than its one-line summary above; ` +
          `prefer it for anything about this work:\n` +
          g.text.replace(/\[(?:L|F)\d+\]\s?/g, '').slice(0, 3200),
        );
      }
    } catch { /* the focus is an enhancement — the plain snapshot still answers */ }
  }

  return { text: parts.join('\n\n') || '(nothing active right now)', refs };
}

export async function answerHomeQuestion(
  supabase: SupabaseClient, userId: string, question: string, history: AskTurn[] = [],
): Promise<AskAnswer> {
  const { text: snapshot, refs } = await buildBrainSnapshot(supabase, userId, question);
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
    `- HARD LIMITS (exceeding them is a failed answer): a simple question = 1-3 sentences. A summary question ("what did I miss", "plan my week") = at most 3 short paragraphs and 100 words TOTAL, separated by blank lines. Pick the 3-4 things that matter MOST and STOP — never inventory; the deck below the chat already lists everything. End a summary with the one thing you'd do first.\n` +
    `- PLAIN PROSE ONLY: no markdown (no **bold**, no headers, no tables, no bullet lists). Whenever the answer runs past two sentences, break it into short paragraphs separated by a BLANK LINE — never one solid block. Never place two refs back-to-back — connect them with words.\n` +
    `- HARD LIMIT: at most 5 tags total, ONE id per bracket ([E7] — NEVER [E7, E8]), placed immediately AFTER the thing it names (\"the Soboplac pilot [E10]\"), never dangling at a sentence end. The app turns each into a link.\n` +
    `- Reason across items when useful (connect a deal to its commitments / its meeting / who owes what).\n` +
    `Return ONLY JSON: {"answer":"<the answer, with [E#]/[C#]/[R#]/[F#] tags>","refs":["E1","C2","F1",...]}`;

  // BUDGET ROUTING (one policy, deterministic): lookups run on the CHEAP tier; only synthesis-intent
  // questions ("what did I miss", "prioritize", "should I…") escalate to deep reasoning. Typical asks
  // become ~5-8x cheaper with no visible loss on the easy majority.
  const deep = /miss|summar|priorit|plan\b|why\b|should|think|advice|catch me up|overview|strategy|recommend/i.test(question) || question.length > 120;
  const res = await aiCall<{ answer?: string; refs?: string[] }>({
    userId, supabase, shape: deep ? { output: 'json', reasoning: 'deep' } : { output: 'json' }, prompt, maxTokens: 450, temperature: 0.2, source: 'brain_synthesis',
  });
  const answer = String(res.json?.answer || '').trim() || "I don't have anything on that yet.";
  const used = (res.json?.refs ?? []).map((t) => refs.get(t)).filter((r): r is AskRef => !!r);
  // Dedup refs (a tag can repeat); keep order.
  const seen = new Set<string>(); const outRefs: AskRef[] = [];
  for (const r of used) { if (!seen.has(r.id)) { seen.add(r.id); outRefs.push(r); } }
  return { answer, refs: outRefs };
}
