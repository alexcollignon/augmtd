// Voice-grounded reply drafting — the single drafter used by BOTH the on-demand route
// (/api/inbox/[id]/draft) and the auto-draft sweep (/api/cron/draft-sweep). Returns the reply body.

import { conductBlock } from '@/lib/ai/conduct';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { COMPLETION_HONESTY_RULE } from '@/lib/prepare/truth';
import { buildVoiceBlock, buildMeetingFollowupContext } from '@/lib/context/voice-context';
import { renderBrainContext } from '@/lib/context/brain-context';
import { detectLanguage } from '@/lib/inbox/detect-language';
import { coerceUnderstanding, languageName } from '@/lib/inbox/item-understanding';
import { readItemAttachments, renderAttachedDocumentsBlock } from '@/lib/inbox/attachment-context';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { draftInLanguage, exemplarRule } from '@/lib/context/draft-language';
import { plainBody } from '@/lib/core/text';

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


/** W28 — the coworkers' names on this account (a draft signed with one of them is re-signed as the user). */
async function coworkerNames(client: DBClient, userId: string): Promise<string[]> {
  try {
    const { data, error } = await client.from('custom_agents').select('name').eq('user_id', userId).eq('is_worker', true);
    return error ? [] : ((data ?? []) as Array<{ name?: string }>).map((r) => String(r.name ?? '')).filter(Boolean);
  } catch { return []; }
}

// ── THE MAILBOX A DRAFT IS WRITTEN FROM (stabilization W11.1 · connection-scoped signature) ─────────
// Found live (owner walk, Sep 23): a reply on a client thread was signed with the user's OTHER
// identity — a company unrelated to the thread — because the voice exemplars (where the model copies
// its sign-off from) were the newest sent mail of ANY connected mailbox. A draft speaks for the
// mailbox its thread LIVES in: THE THREAD'S CONNECTION (the `connection_id` the mail synced through)
// and that connection's own address. The voice block reads only that mailbox's sent mail
// (lib/context/voice-context.ts voiceScopeFilter), and the prompt names the mailbox and forbids any
// other identity's signature. Unresolvable (no thread, legacy rows) → null → the legacy unscoped read.
export type DraftMailbox = { connectionId: string | null; address: string | null };

/** The connection a thread lives in, and that mailbox's own address. Two bounded reads, zero AI. */
export async function threadMailboxOf(client: DBClient, userId: string, threadId: string | null | undefined, connectionId?: string | null): Promise<DraftMailbox | null> {
  try {
    let connId = connectionId ?? null;
    if (!connId && threadId) {
      const { data, error } = await client.from('emails').select('connection_id')
        .eq('user_id', userId).eq('thread_id', threadId).not('connection_id', 'is', null)
        .order('received_at', { ascending: false }).limit(1).maybeSingle();
      if (!error) connId = (data?.connection_id as string | null) ?? null;
    }
    if (!connId) return null;
    const { data: conn, error: cErr } = await client.from('connections').select('id, metadata, provider_account_id')
      .eq('id', connId).eq('user_id', userId).maybeSingle();
    if (cErr) return { connectionId: connId, address: null };
    const meta = (conn?.metadata ?? {}) as { email?: string };
    const addr = String(meta.email || conn?.provider_account_id || '').trim().toLowerCase();
    return { connectionId: connId, address: /@/.test(addr) ? addr : null };
  } catch { return null; }
}

/** The prompt's identity line for a mailbox — '' when none resolved (the legacy prompt stands). Pure. */
export function mailboxIdentityRule(mb: DraftMailbox | null | undefined): string {
  if (!mb?.address) return '';
  return `IDENTITY — this message is sent FROM the mailbox ${mb.address}. Sign with the name, company, ` +
    `title and signature the user uses IN THIS MAILBOX (the example emails above were sent from it); ` +
    `NEVER use a company, title or signature block that belongs to another of the user's mailboxes or ` +
    `identities, and never invent one — when unsure, sign with the name alone.`;
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
  // W18.B: a stored body that is really HTML (a mailer's text/plain part carrying markup) reads as text.
  let body = plainBody(String(sourceData.body || ''));
  // THE GROUND LAW, content half (Aug 13, found live by the ground-walk fixture: a re-draft after
  // the counterparty moved a meeting still confirmed the OLD time): the stored sourceData holds the
  // thread's FOUNDING message forever — a reply must answer the thread's PRESENT. When a newer
  // inbound exists, ITS words are the material (quote-stripped to the sender's own words per THE
  // TOP MESSAGE law) and the founding message demotes to context. One fix here upgrades every
  // drafting door (sweep · on-demand route · the pass).
  let earlierContext = '';
  try {
    const tid = String(sourceData.thread_id || '');
    if (tid) {
      const { data: last } = await client.from('emails').select('body, received_at')
        .eq('user_id', userId).eq('thread_id', tid).eq('is_from_user', false)
        .order('received_at', { ascending: false }).limit(1).maybeSingle();
      const lastBody = plainBody(String(last?.body ?? '')).trim();
      const storedAt = Date.parse(String(sourceData.received_at || '')) || 0;
      const lastAt = Date.parse(String(last?.received_at || '')) || 0;
      if (lastBody && lastAt > storedAt) {
        const { topMessageOf } = await import('@/lib/inbox/top-message');
        const top = topMessageOf(lastBody);
        if (top && top.trim()) {
          earlierContext = body ? `
--- EARLIER IN THE THREAD (context only — the reply answers the newest message above) ---
${clipForPrompt(body, 1200)}
` : '';
          body = top;
        }
      }
    }
  } catch { /* no thread resolvable — the stored body stands */ }

  // The unified `understanding` (coerced up-front) — its `initiative` grounds the Brain-context read below.
  const understanding = coerceUnderstanding((sourceData as Record<string, unknown>).understanding);

  // W11.1 · THE MAILBOX this reply is written FROM — the thread's connection (read off the thread's
  // own synced mail), and only that mailbox's voice + signature.
  const mailbox = await threadMailboxOf(client, userId, String(sourceData.thread_id || '') || null);
  // The LANGUAGE the reply is written in — mirror the CONCRETE text being replied to.
  // Promise fix #6: the stored `understanding.language` can be STALE or wrong for the message at
  // hand (a thread that switched language; a mis-judged pass → an English ask drafted in
  // Portuguese). Precedence: detect on the ACTUAL body first (stopword detection on real prose is
  // reliable; it returns null on short/ambiguous text rather than guessing) → the stored
  // understanding fills that null (the A2 lesson — short text must never fall through to the
  // user's PT-heavy voice). W18.B: resolved BEFORE the voice block, which shows only exemplars in
  // this language, and the output is checked against it (draftInLanguage).
  const detected = detectLanguage(`${subject}\n${body}`) || languageName(understanding?.language);
  const [voiceBlock, meetingFollowup, brainBlock, assistantSkills] = await Promise.all([
    buildVoiceBlock(userId, from, client, mailbox, { language: detected }).catch(() => ''),
    buildMeetingFollowupContext(userId, from, client).catch(() => ''),
    // Step 2: read the durable Person + Initiative brains — the draft reasons WITH the relationship (who
    // they are, who owes whom, how they write) + where the deal stands. Additive, non-fatal, no AI.
    // THE WIDER WORK rides the item's ENTITY LINK (resolved via the thread — W2.2), never the
    // classifier's `understanding.initiative` label.
    renderBrainContext(client, userId, { personEmail: from, personName: fromName, threadId: String(sourceData.thread_id || '') || null }).catch(() => ''),
    // O3a: drafting is the ASSISTANT coworker's craft — her assigned skills shape every draft, which is
    // what makes the "{assistant} drafted this" attribution causal, not cosmetic.
    buildAssistantSkillsBlock(client, userId),
  ]);
  let userName = 'me';
  try {
    const { data: prof } = await client.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    if (prof?.full_name) userName = String(prof.full_name);
  } catch { /* keep default */ }

  // The voice block governs TONE only — never the language, never the greeting or sign-off words.
  // The guidance above (a direction, a steer) never changes the language either.
  const langRule = detected
    ? `IMPORTANT — LANGUAGE: The email you are replying to is written in ${detected}. Write your ENTIRE ` +
      `reply in ${detected}, and ONLY in ${detected} — the greeting and sign-off included. ${exemplarRule(detected)} ` +
      `Any guidance above is about WHAT to say, never which language: do NOT write in any language other ` +
      `than ${detected}.`
    : `IMPORTANT — LANGUAGE: Write the reply in the SAME language as the "EMAIL TO REPLY TO" above — ` +
      `detect that email's language and reply ONLY in that language, the greeting and sign-off included. ` +
      `${exemplarRule(null)} Do NOT copy the examples' language if it differs from the email you are replying to.`;

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

  // ── AN ITEM'S OWN DOCUMENT IS THE ITEM'S OWN CONTEXT (owner walk, Sep 10). The files that came
  // WITH this email — fetched at sync, stored, extracted — reach the drafter as text. Without this
  // the drafter saw a subject and a body only, and wrote "I did not receive the attachment, could
  // you resend it?" about a debt notice sitting in our own storage, one click from being sent.
  // Non-fatal: no attachments, or an unreadable one, leaves the block empty/honest. ──
  const attachBlock = await readItemAttachments(client, userId, sourceData as Record<string, unknown>)
    .then(renderAttachedDocumentsBlock)
    .catch(() => '');

  // ── LAW 7 · THE OUTCOME LOOP (proactive-reach): how much of our drafts this user actually
  // rewrites before sending is MEASURED, and until now nobody read it. It arrives as a FACT about
  // their habit — never an instruction to hedge, never a claim the ledger cannot support (edit
  // share is recorded; length is not, so nothing here speaks about length). Silent under the
  // N-floor: a ledger too thin to be a pattern says nothing at all. ──
  const registerFact = await (async () => {
    try {
      const { readOutcomeFacts, outcomeRegisterFact } = await import('@/lib/prepare/outcome-facts');
      const { userTimezone, localNow } = await import('@/lib/utils/user-time');
      const day = localNow(await userTimezone(client, userId)).dateStr;
      return outcomeRegisterFact(await readOutcomeFacts(client, userId, day));
    } catch { return ''; }
  })();

  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  // W18.B · A DRAFT SPEAKS THE THREAD'S LANGUAGE — the output is checked (zero AI); a wrong-language
  // draft gets ONE revise pass with the hard instruction appended LAST, and a draft still wrong after
  // it is not served ('' — every caller's honest not-prepared state).
  const checked = await draftInLanguage(async (languageFix) => {
    const res = await aiCreate(ai, {
      model, max_tokens: 600, temperature: 0.6,
      messages: [{ role: 'user', content:
        `${voiceBlock ? voiceBlock + '\n\n' : ''}${meetingFollowup ? meetingFollowup + '\n\n' : ''}${brainBlock ? brainBlock + '\n\n' : ''}${assistantSkills ? assistantSkills + '\n\n' : ''}` +
        `${registerFact ? registerFact + '\n' : ''}` +
        `${planBlock}` +
        `${instructions?.trim() ? `Follow this guidance for the reply: ${instructions.trim()}\n\n` : ''}` +
        // W28 — ONE CONDUCT (lib/ai/conduct.ts `draft`): the user's guidance is the format contract.
        `${conductBlock('draft')}\n\n` +
        // Anchor the perspective hard — the model otherwise mirrors the sender and signs with THEIR name.
        `You are ${userName}. Write ${userName}'s reply to the email below (which was sent TO ${userName} ` +
        `by ${from}), in ${userName}'s voice. Address the sender, and sign as ${userName} — NEVER sign as ` +
        `the sender or adopt their name. ` +
        // The voice exemplars are HTML-stripped and may have LOST line breaks (a signature run
        // together like "Name CompanyRole" is a formatting artifact, not the user's style) — always
        // format the sign-off block on separate lines (name / role or company / phone / links).
        `Format the signature block on separate lines; never reproduce run-together artifacts from the examples. ` +
        `${mailboxIdentityRule(mailbox) ? `${mailboxIdentityRule(mailbox)} ` : ''}` +
        // THE COMPLETION RULE (W5a): the reply may claim only deeds the facts above (staged
        // attachments, the artifact truth) support.
        `${COMPLETION_HONESTY_RULE} ` +
        `Return ONLY the reply body — no subject line, no preamble, no ` +
        `surrounding quotes. Keep it appropriately concise and ready to send.\n\n` +
        `--- EMAIL TO REPLY TO ---\n` +
        `From: ${from}\nSubject: ${subject}\n\n${clipForPrompt(body, 3000)}\n${earlierContext}\n` +
        // The item's OWN documents, with their text — placed directly under the email they arrived
        // with, so no reader can compose a claim about them without having read them.
        `${attachBlock ? `\n${attachBlock}\n\n` : ''}` +
        // EXCERPT-HONESTY: our own length clips declare themselves; the rule says they are ours.
        `${EXCERPT_RULE}\n` +
        // LANGUAGE RULE — LAST, so it wins over the voice examples above (recency + explicit target).
        langRule +
        (languageFix ? `\n\n${languageFix}` : '') }],
    });
    return res.choices?.[0]?.message?.content?.trim() || '';
  }, detected);
  // W28.10 · A REPLY PROMISES ONLY WHAT THE USER SAID (full eval: "Tuesday or Wednesday afternoon would work
  // well for me" with no calendar; "I'll send the SOW by end of day Thursday"). When the draft states an
  // availability or a dated commitment on the user's behalf, the claims floor checks it against the thread
  // and the user's guidance; an unsupported one becomes a [SLOT] the user fills. Only then (a regex
  // precheck), so an ordinary reply costs nothing extra.
  if (checked.body) {
    const { COMMITMENT_OR_AVAILABILITY, groundClaims } = await import('@/lib/prepare/claims-floor');
    if (COMMITMENT_OR_AVAILABILITY.test(checked.body)) {
      // Everything the drafter itself was grounded in (the thread, the meeting follow-up, the brain, the plan,
      // attachments, the user's guidance) — a slot fires only on what NONE of it supports.
      const material = [`Subject: ${subject}`, earlierContext, body, String(meetingFollowup ?? ''), String(brainBlock ?? ''), String(planBlock ?? ''), String(attachBlock ?? ''), String(registerFact ?? ''),
        instructions ? `The user's guidance: ${instructions}` : ''].filter((x) => x && x.trim()).join('\n\n');
      checked.body = (await groundClaims(client, userId, { draft: checked.body, material, focus: 'commitments' })).text;
    }
    const { enforceUserSignOff } = await import('@/lib/inbox/sign-off');
    checked.body = enforceUserSignOff(checked.body, userName, await coworkerNames(client, userId));
  }
  return checked.body;
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
    mirrorText?: string | null;
    /** WHO OWES (Q8, the paste pack): 'them' (default — the historical nudge: we are waiting on
     *  them) or 'you' (the user owes this, and a message about their own obligation must never be
     *  written as a chase). One drafter, told the truth about the direction; every existing caller
     *  keeps its exact behaviour by omitting it. */
    direction?: 'them' | 'you' | 'new';
    /** W11.1 — the conversation this message belongs to: its MAILBOX scopes the voice + signature. */
    threadId?: string | null },
  client: DBClient,
): Promise<string> {
  const recipientEmail = (opts.counterparty || '').match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
  const mailbox = opts.threadId ? await threadMailboxOf(client, userId, opts.threadId) : null;
  // THE LANGUAGE MIRROR (same precedence as the reply drafter): the counterparty's CONCRETE words.
  // W18.B: a caller that names the thread but no mirror text (the redraft lane) gets the thread's
  // newest inbound read here, so every nudge producer has the same target to check against.
  let mirrorText = opts.mirrorText ?? null;
  if (!mirrorText && opts.threadId) {
    try {
      const { data: last, error } = await client.from('emails').select('body, received_at')
        .eq('user_id', userId).eq('thread_id', opts.threadId).eq('is_from_user', false)
        .order('received_at', { ascending: false }).limit(1).maybeSingle();
      if (!error) mirrorText = plainBody(String(last?.body ?? '')).trim() || null;
    } catch { /* no mirror — the prompt infers */ }
  }
  const mirrorLang = mirrorText ? detectLanguage(plainBody(mirrorText)) : null;
  const [voiceBlock, brainBlock, assistantSkills] = await Promise.all([
    buildVoiceBlock(userId, recipientEmail, client, mailbox, { language: mirrorLang }).catch(() => ''),
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
  const aged = typeof opts.ageDays === 'number' && opts.ageDays > 0 ? ` It has been about ${opts.ageDays} day${opts.ageDays === 1 ? '' : 's'} without a response.` : '';
  const { client: ai, model } = await getAIClient(userId, 'conversation', client);
  const checked = await draftInLanguage(async (languageFix) => { // W18.B — the same output check
    const res = await aiCreate(ai, {
      model, max_tokens: 400, temperature: 0.6,
      messages: [{ role: 'user', content:
        `${voiceBlock ? voiceBlock + '\n\n' : ''}${brainBlock ? brainBlock + '\n\n' : ''}${assistantSkills ? assistantSkills + '\n\n' : ''}` +
        (opts.direction === 'new'
          // W22 — A NEW EMAIL (the chat's "draft an email to Sam proposing Tuesday 10am"): the SAME
          // drafter, told the truth — this is the first message, neither a reply nor a chase.
          ? `You are ${userName}. Write a NEW email from ${userName} to ${who}: ${opts.description}. It is the ` +
            `first message on this subject — not a reply and not a follow-up, so never refer to an earlier ` +
            `message. Say exactly what is asked, concretely, and keep it short. Address ${who} and sign as ` +
            `${userName} — NEVER sign as the recipient. ${COMPLETION_HONESTY_RULE} `
          : opts.direction === 'you'
          ? `You are ${userName}. Write a brief, friendly message from ${userName} to ${who} about something ` +
            `${userName} OWES THEM: "${opts.description}". ${userName} is the one on the hook here — write it as ` +
            `an update/hand-over from ${userName}, never as a chase and never as a request for something from ` +
            `${who}. Keep it warm and short. Address ${who} and sign as ${userName} — NEVER sign as the recipient. ` +
            // THE COMPLETION RULE (W5a): an update about an open obligation speaks status, never a deed.
            `${COMPLETION_HONESTY_RULE} `
          : `You are ${userName}. Write a brief, friendly NUDGE from ${userName} to ${who}, following up on ` +
            `something ${userName} is waiting on them for: "${opts.description}".${aged} Keep it warm, low-pressure, ` +
            `and short — a gentle check-in, not a demand. Address ${who} and sign as ${userName} — NEVER sign as ` +
            `the recipient. `) +
        // THE LANGUAGE MIRROR (same precedence as the reply drafter): detect on the counterparty's
        // CONCRETE words first; only when there is no text signal, infer — and never let the voice
        // block's language leak in.
        (mirrorLang
          ? `IMPORTANT — LANGUAGE: ${who} writes in ${mirrorLang}. Write the ENTIRE nudge in ${mirrorLang}, and ONLY ${mirrorLang} — the greeting and sign-off included. ${exemplarRule(mirrorLang)} `
          : `Write it in the language the recipient communicates in (infer from the recipient and the ` +
            `description above); if unclear, use English. ${exemplarRule(null)} `) +
        (opts.instructions ? `\n${opts.instructions}\n` : '') +
        // W28 — ONE CONDUCT (lib/ai/conduct.ts `draft`): the user's guidance is the format contract.
        `\n${conductBlock('draft')}\n` +
        `${mailboxIdentityRule(mailbox) ? `${mailboxIdentityRule(mailbox)} ` : ''}` +
        `Return ONLY the message body — no subject line, no preamble, no surrounding quotes.` +
        (languageFix ? `\n\n${languageFix}` : '') }],
    });
    return res.choices?.[0]?.message?.content?.trim() || '';
  }, mirrorLang);
  return checked.body;
}
