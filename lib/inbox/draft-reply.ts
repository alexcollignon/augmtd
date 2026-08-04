// Voice-grounded reply drafting — the single drafter used by BOTH the on-demand route
// (/api/inbox/[id]/draft) and the auto-draft sweep (/api/cron/draft-sweep). Returns the reply body.

import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildVoiceBlock, buildMeetingFollowupContext } from '@/lib/context/voice-context';
import { renderBrainContext } from '@/lib/context/brain-context';
import { detectLanguage } from '@/lib/inbox/detect-language';
import { coerceUnderstanding, languageName } from '@/lib/inbox/item-understanding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

// ── O3a (orchestrated-loop): drafting belongs to the ASSISTANT coworker. Her identity attributes the
// work ("Clara drafted this") and her assigned SKILLS shape every draft — causal attribution, one
// place, every drafter caller. Memoized per process (60s). ──
const paMemo = new Map<string, { at: number; pa: { id: string; name: string } | null }>();
export async function getDraftingAssistant(client: DBClient, userId: string): Promise<{ id: string; name: string } | null> {
  const c = paMemo.get(userId);
  if (c && Date.now() - c.at < 60_000) return c.pa;
  let pa: { id: string; name: string } | null = null;
  try {
    const { data } = await client.from('custom_agents').select('id, name')
      .eq('user_id', userId).eq('is_worker', true).eq('worker_role', 'personal_assistant').limit(1).maybeSingle();
    if (data) pa = { id: String(data.id), name: String(data.name) };
  } catch { /* non-fatal */ }
  paMemo.set(userId, { at: Date.now(), pa });
  return pa;
}

async function buildAssistantSkillsBlock(client: DBClient, userId: string): Promise<string> {
  try {
    const pa = await getDraftingAssistant(client, userId);
    if (!pa) return '';
    const { buildSkillsBlock } = await import('@/lib/work/worker-skills-context');
    return await buildSkillsBlock(client, pa.id);
  } catch { return ''; }
}

export async function generateReplyDraft(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceData: Record<string, any>,
  client: DBClient,
  instructions?: string | null,
  // ── PLAN COHERENCE (Fix 3): the item's Identified-tasks step summaries. When present, the draft is
  // generated AWARE of the plan so the reply and the tasks narrate ONE story — the draft can reference a
  // calendar invite the plan sends, and a promise the draft makes ("I'll send the deck") is the SAME
  // commitment as the corresponding task, not a duplicated orphan. Non-fatal: absent → today's behavior.
  planSteps?: string[] | null,
): Promise<string> {
  const from = String(sourceData.from || sourceData.from_address || '');
  const fromName = String(sourceData.from_name || '');
  const subject = String(sourceData.subject || '');
  const body = String(sourceData.body || '');

  // The unified `understanding` (coerced up-front) — its `initiative` grounds the Brain-context read below.
  const understanding = coerceUnderstanding((sourceData as Record<string, unknown>).understanding);

  const [voiceBlock, meetingFollowup, brainBlock, assistantSkills] = await Promise.all([
    buildVoiceBlock(userId, from, client).catch(() => ''),
    buildMeetingFollowupContext(userId, from, client).catch(() => ''),
    // Step 2: read the durable Person + Initiative brains — the draft reasons WITH the relationship (who
    // they are, who owes whom, how they write) + where the deal stands. Additive, non-fatal, no AI.
    renderBrainContext(client, userId, { personEmail: from, personName: fromName, initiative: understanding?.initiative ?? null }).catch(() => ''),
    // O3a: drafting is the ASSISTANT coworker's craft — her assigned skills shape every draft, which is
    // what makes the "{assistant} drafted this" attribution causal, not cosmetic.
    buildAssistantSkillsBlock(client, userId),
  ]);
  let userName = 'me';
  try {
    const { data: prof } = await client.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    if (prof?.full_name) userName = String(prof.full_name);
  } catch { /* keep default */ }

  // The LANGUAGE the reply should be written in — mirror the CONCRETE text being replied to.
  // Promise fix #6: the stored `understanding.language` can be STALE or wrong for the message at
  // hand (a thread that switched language; a mis-judged pass → an English ask drafted in
  // Portuguese). Precedence: detect on the ACTUAL body first (stopword detection on real prose is
  // reliable; it returns null on short/ambiguous text rather than guessing) → the stored
  // understanding fills that null (the A2 lesson — short text must never fall through to the
  // user's PT-heavy voice). The voice block governs TONE only — never the language.
  const detected = detectLanguage(`${subject}\n${body}`) || languageName(understanding?.language);
  const langRule = detected
    ? `IMPORTANT — LANGUAGE: The email you are replying to is written in ${detected}. Write your ENTIRE ` +
      `reply in ${detected}, and ONLY in ${detected}. The example emails above are for STYLE only ` +
      `(greeting shape, warmth, sign-off) — ignore their language; do NOT write in any language other ` +
      `than ${detected}.`
    : `IMPORTANT — LANGUAGE: Write the reply in the SAME language as the "EMAIL TO REPLY TO" above — ` +
      `detect that email's language and reply ONLY in that language. The example emails above are for ` +
      `STYLE only; do NOT copy their language if it differs from the email you are replying to.`;

  // The plan block — the concrete steps AUGMTD identified for handling this item. The reply should be
  // COHERENT with them (one story): reference an invite the plan sends; treat a "I'll send X" promise as
  // the SAME commitment as its task (don't duplicate it); don't presume answers to steps the plan marks
  // as still open. Only included when a real, non-trivial step list is passed.
  const planBlock = (planSteps && planSteps.length)
    ? `PLAN — AUGMTD has identified these steps for handling this (the reply must be COHERENT with them, ` +
      `telling ONE story with the plan — do not contradict a still-open step, and do not duplicate a ` +
      `promise that is already its own task; you MAY reference what the plan will do, e.g. an invite it sends):\n` +
      planSteps.map((s) => `- ${s}`).join('\n') + '\n\n'
    : '';

  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  const res = await aiCreate(ai, {
    model, max_tokens: 600, temperature: 0.6,
    messages: [{ role: 'user', content:
      `${voiceBlock ? voiceBlock + '\n\n' : ''}${meetingFollowup ? meetingFollowup + '\n\n' : ''}${brainBlock ? brainBlock + '\n\n' : ''}${assistantSkills ? assistantSkills + '\n\n' : ''}` +
      `${planBlock}` +
      `${instructions?.trim() ? `Follow this guidance for the reply: ${instructions.trim()}\n\n` : ''}` +
      // Anchor the perspective hard — the model otherwise mirrors the sender and signs with THEIR name.
      `You are ${userName}. Write ${userName}'s reply to the email below (which was sent TO ${userName} ` +
      `by ${from}), in ${userName}'s voice. Address the sender, and sign as ${userName} — NEVER sign as ` +
      `the sender or adopt their name. ` +
      // The voice exemplars are HTML-stripped and may have LOST line breaks (a signature run
      // together like "Name CompanyRole" is a formatting artifact, not the user's style) — always
      // format the sign-off block on separate lines (name / role or company / phone / links).
      `Format the signature block on separate lines; never reproduce run-together artifacts from the examples. ` +
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
  // `instructions` — optional extra guidance folded into the nudge (the steer channel's regenerate path).
  opts: { counterparty: string | null; description: string; ageDays?: number; instructions?: string | null;
    /** The counterparty's OWN latest message text — the CONCRETE language signal (promise fix:
     *  mirror the correspondent's actual words, never the user's voice-block language). */
    mirrorText?: string | null },
  client: DBClient,
): Promise<string> {
  const recipientEmail = (opts.counterparty || '').match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
  const [voiceBlock, brainBlock, assistantSkills] = await Promise.all([
    buildVoiceBlock(userId, recipientEmail, client).catch(() => ''),
    // Step 2: the nudge reasons WITH the relationship — who they are, what's actually open with them, their
    // register — so a check-in lands right instead of generic. Additive, non-fatal, no AI.
    renderBrainContext(client, userId, { personEmail: recipientEmail, personName: recipientEmail ? null : opts.counterparty }).catch(() => ''),
    buildAssistantSkillsBlock(client, userId), // O3a — the assistant's skills shape nudges too
  ]);
  let userName = 'me';
  try {
    const { data: prof } = await client.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    if (prof?.full_name) userName = String(prof.full_name);
  } catch { /* keep default */ }

  const who = opts.counterparty || 'the recipient';
  const mirrorLang = opts.mirrorText ? detectLanguage(opts.mirrorText) : null;
  const aged = typeof opts.ageDays === 'number' && opts.ageDays > 0 ? ` It has been about ${opts.ageDays} day${opts.ageDays === 1 ? '' : 's'} without a response.` : '';
  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  const res = await aiCreate(ai, {
    model, max_tokens: 400, temperature: 0.6,
    messages: [{ role: 'user', content:
      `${voiceBlock ? voiceBlock + '\n\n' : ''}${brainBlock ? brainBlock + '\n\n' : ''}${assistantSkills ? assistantSkills + '\n\n' : ''}` +
      `You are ${userName}. Write a brief, friendly NUDGE from ${userName} to ${who}, following up on ` +
      `something ${userName} is waiting on them for: "${opts.description}".${aged} Keep it warm, low-pressure, ` +
      `and short — a gentle check-in, not a demand. Address ${who} and sign as ${userName} — NEVER sign as ` +
      `the recipient. ` +
      // THE LANGUAGE MIRROR (same precedence as the reply drafter): detect on the counterparty's
      // CONCRETE words first; only when there is no text signal, infer — and never let the voice
      // block's language leak in.
      (mirrorLang
        ? `IMPORTANT — LANGUAGE: ${who} writes in ${mirrorLang}. Write the ENTIRE nudge in ${mirrorLang}, and ONLY ${mirrorLang} — the style examples above are for tone, never language. `
        : `Write it in the language the recipient communicates in (infer from the recipient and the ` +
          `description above); if unclear, use English. The style examples above are for tone, never language. `) +
      (opts.instructions ? `\n${opts.instructions}\n` : '') +
      `Return ONLY the message body — no subject line, no preamble, no surrounding quotes.` }],
  });
  return res.choices?.[0]?.message?.content?.trim() || '';
}
