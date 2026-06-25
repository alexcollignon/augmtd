// Voice-grounded reply drafting — the single drafter used by BOTH the on-demand route
// (/api/inbox/[id]/draft) and the auto-draft sweep (/api/cron/draft-sweep). Returns the reply body.

import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildVoiceBlock, buildMeetingFollowupContext } from '@/lib/context/voice-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

export async function generateReplyDraft(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceData: Record<string, any>,
  client: DBClient,
  instructions?: string | null,
): Promise<string> {
  const from = String(sourceData.from || sourceData.from_address || '');
  const subject = String(sourceData.subject || '');
  const body = String(sourceData.body || '');

  const [voiceBlock, meetingFollowup] = await Promise.all([
    buildVoiceBlock(userId, from, client).catch(() => ''),
    buildMeetingFollowupContext(userId, from, client).catch(() => ''),
  ]);
  let userName = 'me';
  try {
    const { data: prof } = await client.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    if (prof?.full_name) userName = String(prof.full_name);
  } catch { /* keep default */ }

  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  const res = await aiCreate(ai, {
    model, max_tokens: 600, temperature: 0.6,
    messages: [{ role: 'user', content:
      `${voiceBlock ? voiceBlock + '\n\n' : ''}${meetingFollowup ? meetingFollowup + '\n\n' : ''}` +
      `${instructions?.trim() ? `Follow this guidance for the reply: ${instructions.trim()}\n\n` : ''}` +
      // Anchor the perspective hard — the model otherwise mirrors the sender and signs with THEIR name.
      `You are ${userName}. Write ${userName}'s reply to the email below (which was sent TO ${userName} ` +
      `by ${from}), in ${userName}'s voice. Address the sender, and sign as ${userName} — NEVER sign as ` +
      `the sender or adopt their name. Return ONLY the reply body — no subject line, no preamble, no ` +
      `surrounding quotes. Keep it appropriately concise and ready to send.\n\n` +
      `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 3000)}` }],
  });
  return res.choices?.[0]?.message?.content?.trim() || '';
}
