// ════════════════════════════════════════════════════════════════════════════════════════════════
// W21 — "SAVE AS SKILL" FROM A CONVERSATION. Reads one conversation the user owns (a room's turns, or
// a coworker DM thread's messages), hands it to THE SKILL SYNTHESIS (lib/skills/synthesize.ts — the
// interview builder's own prompt, pre-filled from the conversation) and returns a DRAFT.
//
// HUMAN IN THE LOOP: this module WRITES NOTHING. No skill row, no assignment, no marker. The UI opens
// the existing skill editor prefilled; only the user's own Save (POST /api/skills) creates the skill.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt, EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import type { FromConversationResponse } from './chat-contract';
import type { SkillDraft, SkillSynthesisInput } from './synthesize';

export type ConversationTurn = { role: 'user' | 'assistant'; text: string };

/** How many of the conversation's latest turns ride (declared in the transcript head when more exist). */
export const CONVERSATION_TURNS = 40;
const TURN_MAX = 1500;

export const ROOM_KEY_RE = /^[A-Za-z0-9:_.-]{3,200}$/;
const THREAD_KEY_RE = /^thread:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The transcript the synthesis reads. Pure. Each turn is clipped through the excerpt law. */
export function conversationTranscript(turns: ConversationTurn[], olderOmitted = false): string {
  const lines = turns
    .filter((t) => t.text?.trim())
    .map((t) => `[${t.role === 'user' ? 'user' : 'assistant'}] ${clipForPrompt(t.text.replace(/\s+/g, ' '), TURN_MAX)}`);
  const clipped = lines.some((l) => l.endsWith(EXCERPT_MARK));
  return (olderOmitted ? `(older turns of this conversation are not included — only the latest ${CONVERSATION_TURNS})\n` : '') +
    (clipped ? `(${EXCERPT_RULE})\n` : '') + lines.join('\n');
}

/** The objective the interview prompt asks for, derived from the conversation's first ask. Pure. */
export function objectiveFromConversation(turns: ConversationTurn[]): string {
  const first = turns.find((t) => t.role === 'user' && t.text?.trim())?.text ?? '';
  return first
    ? `How the user wants this kind of work done, as shown in a conversation that began with: "${clipForPrompt(first.replace(/\s+/g, ' '), 240)}"`
    : 'How the user wants this kind of work done, as shown in the conversation below';
}

/** Read one conversation the user owns — latest CONVERSATION_TURNS, oldest first. Reads only. */
export async function readConversation(
  client: SupabaseClient, userId: string, roomKey: string,
): Promise<{ turns: ConversationTurn[]; olderOmitted: boolean } | null> {
  const thread = THREAD_KEY_RE.exec(roomKey);
  if (thread) {
    const { data: t, error: tErr } = await client.from('work_threads').select('id')
      .eq('id', thread[1]).eq('user_id', userId).maybeSingle();
    if (tErr || !t) return null;
    const { data, error } = await client.from('work_messages').select('role, content, created_at')
      .eq('thread_id', thread[1]).order('created_at', { ascending: false }).limit(CONVERSATION_TURNS + 1);
    if (error) return null;
    const rows = (data ?? []) as Array<{ role: string; content: string | null }>;
    return {
      olderOmitted: rows.length > CONVERSATION_TURNS,
      turns: rows.slice(0, CONVERSATION_TURNS).reverse()
        .map((r) => ({ role: r.role === 'user' ? 'user' as const : 'assistant' as const, text: String(r.content ?? '') })),
    };
  }
  if (!ROOM_KEY_RE.test(roomKey)) return null;
  const base = () => client.from('room_turns').select('role, text, created_at')
    .eq('user_id', userId).eq('room_key', roomKey);
  let res = await base().is('archived_at', null).order('created_at', { ascending: false }).limit(CONVERSATION_TURNS + 1);
  // Pre-migration (no archived_at column yet — 20260727c is pending): read without the filter.
  if (res.error) res = await base().order('created_at', { ascending: false }).limit(CONVERSATION_TURNS + 1);
  if (res.error) return null;
  const rows = (res.data ?? []) as Array<{ role: string; text: string | null }>;
  return {
    olderOmitted: rows.length > CONVERSATION_TURNS,
    turns: rows.slice(0, CONVERSATION_TURNS).reverse()
      .map((r) => ({ role: r.role === 'user' ? 'user' as const : 'assistant' as const, text: String(r.text ?? '') })),
  };
}

/** The synthesis input for a conversation. Pure. */
export function conversationSynthesisInput(turns: ConversationTurn[], olderOmitted = false): SkillSynthesisInput {
  return { objective: objectiveFromConversation(turns), conversation: conversationTranscript(turns, olderOmitted) };
}

export type Synthesize = (client: SupabaseClient, userId: string, input: SkillSynthesisInput) => Promise<SkillDraft>;

/** The door's whole body: read → synthesize → map to the contract's draft. Null = no conversation. */
export async function draftSkillFromConversation(
  client: SupabaseClient, userId: string, roomKey: string, synth?: Synthesize,
): Promise<FromConversationResponse['draft'] | null> {
  const convo = await readConversation(client, userId, roomKey);
  if (!convo || !convo.turns.some((t) => t.role === 'user' && t.text.trim())) return null;
  const run: Synthesize = synth ?? (await import('./synthesize')).synthesizeSkillDraft;
  const d = await run(client, userId, conversationSynthesisInput(convo.turns, convo.olderOmitted));
  return { name: d.name, whenToUse: d.when_to_use, instructions: d.content };
}
