// ════════════════════════════════════════════════════════════════════════════════════════════════
// A NEW EMAIL FROM THE CHAT (W22 — THE HOME CHAT IS ONE ASSISTANT).
//
// Live eval, Sep 28: "draft an email to sam@acme.test proposing Tuesday 10am for our project
// kick-off" → the chat answered that its drafting hand "can't originate a fresh outbound email from
// scratch" — the draft door only knew how to ANSWER a message (an inbox match, or a paste). A new
// email is the same card with a different first line:
//   · THE ONE DRAFTER writes it (lib/inbox/draft-reply `generateNudgeDraft`, direction 'new') — the
//     user's voice, the mailbox rule, the completion rule, the W18 language check;
//   · THE ONE EMAIL CARD carries it (the standalone lane's assembly, lib/prepare/standalone-reply)
//     — To / From / Subject are editable there, and NOTHING is sent until the user clicks Send.
// NEVER INVENT AN ADDRESS: `to` holds only an address the user actually wrote; a bare name leaves the
// field empty for the card to ask.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { emailsIn } from '@/lib/core/email';
import type { StandaloneEmailDraft } from '@/lib/prepare/email-card';

/** The subject line a new email carries: the model's own when given, else a label cut from the ask. Pure. */
export function newEmailSubject(subject: string | null | undefined, about: string | null | undefined): string {
  const s = String(subject ?? '').replace(/\s+/g, ' ').trim();
  if (s) return s.slice(0, 140);
  const a = String(about ?? '').replace(/\s+/g, ' ').trim();
  if (!a) return '';
  const words = a.split(' ').slice(0, 8).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function composeNewEmail(
  client: SupabaseClient, userId: string,
  args: { to: string; about?: string | null; subject?: string | null; instruction: string; roomKey?: string | null },
): Promise<{ id: string; draft: StandaloneEmailDraft } | { error: string }> {
  const to = emailsIn(args.to ?? '');
  const who = String(args.to ?? '').trim() || 'the recipient';
  const { generateNudgeDraft } = await import('@/lib/inbox/draft-reply');
  const body = await generateNudgeDraft(userId, {
    counterparty: who, description: args.instruction, direction: 'new',
  }, client).catch(() => '');
  if (!body.trim()) return { error: "I couldn't write that email just now — try again in a moment." };
  const { prepareNewStandaloneEmail } = await import('@/lib/prepare/standalone-reply');
  const card = await prepareNewStandaloneEmail(client, userId, {
    body: body.trim(), to, subject: newEmailSubject(args.subject, args.about ?? args.instruction), roomKey: args.roomKey ?? null,
  });
  // A card that cannot survive a reload is not offered — the words still reach the user.
  if (!card) return { error: `Here's the email — I couldn't keep it as a card just now, so copy it before you leave:\n\n${body.trim()}` };
  return card;
}
