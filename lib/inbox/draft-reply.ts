// Voice-grounded reply drafting — the single drafter used by BOTH the on-demand route
// (/api/inbox/[id]/draft) and the auto-draft sweep (/api/cron/draft-sweep). Returns the reply body.

import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildVoiceBlock, buildMeetingFollowupContext } from '@/lib/context/voice-context';
import { detectLanguage } from '@/lib/inbox/detect-language';
import { coerceUnderstanding, languageName } from '@/lib/inbox/item-understanding';

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

  // The LANGUAGE the reply should be written in. PRIMARY signal: the unified `understanding.language`
  // — reasoned over the full thread in the classification pass, so it's decisive even on short text
  // (where the stopword detector fell back to the user's PT-heavy voice → the A2 wrong-language bug).
  // `detectLanguage` is now only the FALLBACK when there's no understanding (legacy items). The voice
  // block governs TONE only — never the language.
  const understanding = coerceUnderstanding((sourceData as Record<string, unknown>).understanding);
  const detected = languageName(understanding?.language) || detectLanguage(`${subject}\n${body}`);
  const langRule = detected
    ? `IMPORTANT — LANGUAGE: The email you are replying to is written in ${detected}. Write your ENTIRE ` +
      `reply in ${detected}, and ONLY in ${detected}. The example emails above are for STYLE only ` +
      `(greeting shape, warmth, sign-off) — ignore their language; do NOT write in any language other ` +
      `than ${detected}.`
    : `IMPORTANT — LANGUAGE: Write the reply in the SAME language as the "EMAIL TO REPLY TO" above — ` +
      `detect that email's language and reply ONLY in that language. The example emails above are for ` +
      `STYLE only; do NOT copy their language if it differs from the email you are replying to.`;

  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  const res = await aiCreate(ai, {
    model, max_tokens: 600, temperature: 0.6,
    messages: [{ role: 'user', content:
      `${voiceBlock ? voiceBlock + '\n\n' : ''}${meetingFollowup ? meetingFollowup + '\n\n' : ''}` +
      `${instructions?.trim() ? `Follow this guidance for the reply: ${instructions.trim()}\n\n` : ''}` +
      // Anchor the perspective hard — the model otherwise mirrors the sender and signs with THEIR name.
      `You are ${userName}. Write ${userName}'s reply to the email below (which was sent TO ${userName} ` +
      `by ${from}), in ${userName}'s voice. Address the sender, and sign as ${userName} — NEVER sign as ` +
      `the sender or adopt their name. ` +
      `Return ONLY the reply body — no subject line, no preamble, no ` +
      `surrounding quotes. Keep it appropriately concise and ready to send.\n\n` +
      `--- EMAIL TO REPLY TO ---\n` +
      `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 3000)}\n\n` +
      // LANGUAGE RULE — LAST, so it wins over the voice examples above (recency + explicit target).
      langRule }],
  });
  return res.choices?.[0]?.message?.content?.trim() || '';
}

// Voice-grounded NUDGE draft — a polite follow-up from the user to a counterparty they are WAITING
// ON (ball-in-your-court commitment). Reuses the same voice block so it sounds like the user. Used by
// the Home's "Ball in your court" section (Bug #2) — a draft the user reviews + sends, never auto-sent.
export async function generateNudgeDraft(
  userId: string,
  opts: { counterparty: string | null; description: string; ageDays?: number },
  client: DBClient,
): Promise<string> {
  const recipientEmail = (opts.counterparty || '').match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
  const [voiceBlock] = await Promise.all([
    buildVoiceBlock(userId, recipientEmail, client).catch(() => ''),
  ]);
  let userName = 'me';
  try {
    const { data: prof } = await client.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    if (prof?.full_name) userName = String(prof.full_name);
  } catch { /* keep default */ }

  const who = opts.counterparty || 'the recipient';
  const aged = typeof opts.ageDays === 'number' && opts.ageDays > 0 ? ` It has been about ${opts.ageDays} day${opts.ageDays === 1 ? '' : 's'} without a response.` : '';
  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  const res = await aiCreate(ai, {
    model, max_tokens: 400, temperature: 0.6,
    messages: [{ role: 'user', content:
      `${voiceBlock ? voiceBlock + '\n\n' : ''}` +
      `You are ${userName}. Write a brief, friendly NUDGE from ${userName} to ${who}, following up on ` +
      `something ${userName} is waiting on them for: "${opts.description}".${aged} Keep it warm, low-pressure, ` +
      `and short — a gentle check-in, not a demand. Address ${who} and sign as ${userName} — NEVER sign as ` +
      `the recipient. ` +
      // Match the correspondent's language, not the user's default: if the description/recipient makes
      // the language they communicate in evident, write the nudge in THAT language; otherwise English.
      `Write it in the language the recipient communicates in (infer from the recipient and the ` +
      `description above); if unclear, use English. ` +
      `Return ONLY the message body — no subject line, no preamble, no surrounding quotes.` }],
  });
  return res.choices?.[0]?.message?.content?.trim() || '';
}
