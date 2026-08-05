// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROJECT-BRAIN CHAT (Prepared-Work Phase D2, docs/prepared-work-plan.md) — talk to ONE deal's
// memory. The grounded Ask core scoped to a single entity: its judged state, its cross-source ledger
// (emails, meetings, commitments, team deliverables), its goals/rules, and its FILES (Phase A: knowledge
// entity-linked at ingest). Answers cite [L#]/[F#] refs the UI turns into links; honest "nothing on that"
// over invention — the same trust laws as the Home Ask, on a deal-sized snapshot (cheap + sharp).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';

export type EntityAskRef = { id: string; kind: 'item' | 'file'; label: string; href: string | null };
export type EntityAskTurn = { role: 'user' | 'assistant'; text: string };

export async function answerEntityQuestion(
  supabase: SupabaseClient, userId: string, entityId: string, question: string, history: EntityAskTurn[] = [],
  // The VIEWING ANCHOR (P7a): the item the user is looking at right now — the answer must be
  // consistent with it (the on-screen-contradiction class is structurally impossible when passed).
  opts: { viewing?: string } = {},
): Promise<{ answer: string; refs: EntityAskRef[] }> {
  // THE ONE GROUNDING (Aug 5, one-system arc): this path used to assemble its own parallel slice
  // of the room's truth — now it reads the SAME page as the responder and the agent loop
  // (lib/room/grounding.ts), so answers structurally cannot disagree with the panel.
  const { assembleRoomGrounding } = await import('@/lib/room/grounding');
  const g = await assembleRoomGrounding(supabase, userId, { kind: 'entity', entityId });
  if (!g.entity) return { answer: "I can't find that project.", refs: [] };

  const refs = new Map<string, EntityAskRef>();
  for (const [id, r] of g.ledgerRefs) refs.set(id, { id, kind: id.startsWith('F') ? 'file' : 'item', label: r.label, href: r.href });

  const priorTurns = history.slice(-6).map((t) => `${t.role === 'user' ? 'THEM' : 'YOU'}: ${t.text}`).join('\n');
  const prompt =
    `You are the user's assistant for ONE body of work: "${g.entity.name}". You hold its full memory below. ` +
    `Answer like a sharp colleague who runs this deal day-to-day — grounded STRICTLY in this context.\n\n` +
    `${g.text}\n` +
    (priorTurns ? `\nEARLIER IN THIS CHAT:\n${priorTurns}\n` : '') +
    (opts.viewing ? `\n${opts.viewing}\n` : '') +
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
