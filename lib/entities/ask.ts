// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROJECT-BRAIN CHAT (Prepared-Work Phase D2, docs/prepared-work-plan.md) — talk to ONE deal's
// memory. The grounded Ask core scoped to a single entity: its judged state, its cross-source ledger
// (emails, meetings, commitments, team deliverables), its goals/rules, and its FILES (Phase A: knowledge
// entity-linked at ingest). Answers cite [L#]/[F#] refs the UI turns into links; honest "nothing on that"
// over invention — the same trust laws as the Home Ask, on a deal-sized snapshot (cheap + sharp).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { assembleLedger } from './state';

export type EntityAskRef = { id: string; kind: 'item' | 'file'; label: string; href: string | null };
export type EntityAskTurn = { role: 'user' | 'assistant'; text: string };

const hrefOfRef = (ref: string): string | null => {
  const [k, id] = ref.split(':');
  if (k === 'inbox') return `/item/${id}`;
  if (k === 'commit') return `/item/${id}?kind=commitment`;
  if (k === 'meeting') return `/item/${id}?kind=meeting`;
  return null;
};

export async function answerEntityQuestion(
  supabase: SupabaseClient, userId: string, entityId: string, question: string, history: EntityAskTurn[] = [],
): Promise<{ answer: string; refs: EntityAskRef[] }> {
  const [{ data: ent }, { ledger }, { data: files }] = await Promise.all([
    supabase.from('work_entities')
      .select('name, summary, state, next_move, goals, rules')
      .eq('id', entityId).eq('user_id', userId).maybeSingle(),
    assembleLedger(supabase, userId, entityId),
    supabase.from('knowledge_files').select('id, filename, summary')
      .eq('user_id', userId).eq('entity_id', entityId).order('indexed_at', { ascending: false }).limit(10),
  ]);
  if (!ent) return { answer: "I can't find that project.", refs: [] };

  const refs = new Map<string, EntityAskRef>();
  const st = (ent.state ?? {}) as { summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] } };
  const nm = (ent.next_move ?? null) as { title?: string; reason?: string } | null;
  const goals = Array.isArray(ent.goals) ? (ent.goals as string[]) : [];
  const rules = Array.isArray(ent.rules) ? (ent.rules as string[]) : [];

  const ledgerLines = ledger.slice(0, 22).map((l, i) => {
    const id = `L${i + 1}`;
    refs.set(id, { id, kind: 'item', label: l.text.slice(0, 60), href: hrefOfRef(l.ref) });
    return `[${id}] ${(l.at || '').slice(0, 10)} · ${l.kind}${l.who ? ` · ${l.who}` : ''}: ${l.text.slice(0, 110)}`;
  });
  const fileLines = ((files ?? []) as Array<{ id: string; filename: string; summary: string | null }>).map((f, i) => {
    const id = `F${i + 1}`;
    refs.set(id, { id, kind: 'file', label: f.filename, href: null });
    return `[${id}] ${f.filename}${f.summary ? ` — ${String(f.summary).slice(0, 100)}` : ''}`;
  });

  const priorTurns = history.slice(-6).map((t) => `${t.role === 'user' ? 'THEM' : 'YOU'}: ${t.text}`).join('\n');
  const prompt =
    `You are the user's assistant for ONE body of work: "${ent.name}". You hold its full memory below. ` +
    `Answer like a sharp colleague who runs this deal day-to-day — grounded STRICTLY in this context.\n\n` +
    `WHERE IT STANDS: ${st.summary ?? ent.summary ?? '(no summary yet)'}${st.momentum ? ` [${st.momentum}]` : ''}\n` +
    (st.whoOwes?.you?.length ? `YOU OWE: ${st.whoOwes.you.join('; ')}\n` : '') +
    (st.whoOwes?.them?.length ? `THEY OWE: ${st.whoOwes.them.join('; ')}\n` : '') +
    (nm?.title ? `NEXT MOVE: ${nm.title}${nm.reason ? ` (${nm.reason})` : ''}\n` : '') +
    (goals.length ? `GOALS: ${goals.join(' · ')}\n` : '') +
    (rules.length ? `RULES: ${rules.join(' · ')}\n` : '') +
    `\nHISTORY (newest first — reference as [L#]):\n${ledgerLines.join('\n') || '(nothing yet)'}\n` +
    (fileLines.length ? `\nFILES on this work (reference as [F#]):\n${fileLines.join('\n')}\n` : '') +
    (priorTurns ? `\nEARLIER IN THIS CHAT:\n${priorTurns}\n` : '') +
    `\nTHEIR QUESTION: ${question}\n\n` +
    `Rules:\n` +
    `- Answer ONLY from this context. If it doesn't cover the question, say so plainly — NEVER invent people, dates, or facts.\n` +
    `- Brief and specific, a couple of sentences; lead with the answer. Reference items/files by [L#]/[F#] inline.\n` +
    `- PLAIN PROSE ONLY: no markdown of any kind. Never place two refs back-to-back — connect with words.\n` +
    `Return ONLY JSON: {"answer":"<with [L#]/[F#] tags>","refs":["L1","F2",...]}`;

  const deep = /miss|summar|priorit|plan\b|why\b|should|think|advice|strategy|recommend|overview/i.test(question) || question.length > 120;
  const res = await aiCall<{ answer?: string; refs?: string[] }>({
    userId, supabase, shape: deep ? { output: 'json', reasoning: 'deep' } : { output: 'json' }, prompt, maxTokens: 500, temperature: 0.2, source: 'brain_synthesis',
  });
  const answer = String(res.json?.answer || '').trim() || "I don't have anything on that yet.";
  const used = (res.json?.refs ?? []).map((t) => refs.get(t)).filter((r): r is EntityAskRef => !!r);
  const seen = new Set<string>(); const outRefs: EntityAskRef[] = [];
  for (const r of used) { if (!seen.has(r.id)) { seen.add(r.id); outRefs.push(r); } }
  return { answer, refs: outRefs };
}
