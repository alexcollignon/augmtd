import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildVoiceBlock } from '@/lib/context/voice-context';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { setInboxRules, shouldDraftReply } from '@/lib/inbox/classify-item';
import { detectLanguage } from '@/lib/inbox/detect-language';
import { generateReplyDraft } from '@/lib/inbox/draft-reply';
import { loadPlanStepSummaries, type ItemPlanKind } from '@/lib/home/item-plan';
import { firstEmailIn, looksLikeEmail } from '@/lib/core/email';
import { stagedFilesOf } from '@/lib/prepare/email-card';

export const maxDuration = 30;

// ── Universal drafter — "actions follow intent". Given ANY Home item (meeting / commitment /
// awareness / email), infer the natural recipient(s) and draft the message the user would send, in
// their voice. Powers the deep-dive compose panel: the user reviews/edits/sends via /api/compose/send.
//
// POST /api/compose/draft { kind, entityId, intent? }
//   → { to[], cc[], subject, bodyHTML, recipientName? }
//
// Recipient inference is BEST-EFFORT and never invents an address: if none resolves we return an
// empty `to` + a `recipientName` so the UI shows who it's likely for and the user fills the address.

type Kind = 'meeting' | 'commitment' | 'awareness' | 'email';

const extractEmail = (s?: string | null): string | null => firstEmailIn(s);
const extractName = (s?: string | null): string | null => {
  if (!s) return null;
  const t = s.replace(/<[^>]*>/g, '').trim().replace(/^"|"$/g, '').trim();
  return t && !looksLikeEmail(t) ? t : null;
};

function paraHTML(text: string): string {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .filter((p) => p !== '<p></p>')
    .join('');
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, entityId, intent } = (await request.json()) as { kind: Kind; entityId: string; intent?: string };
    if (!entityId || !kind) return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });

    // The user's own addresses — never draft TO yourself.
    const userEmails = new Set<string>([(user.email ?? '').toLowerCase()].filter(Boolean));
    try {
      const { data: conns } = await supabase.from('connections').select('metadata, provider_account_id').eq('user_id', user.id);
      for (const c of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string }>) {
        const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase();
        if (e) userEmails.add(e);
      }
    } catch { /* non-fatal */ }
    const isSelf = (e?: string | null) => !!e && userEmails.has(e.toLowerCase());

    let userName = 'me';
    try {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      if (prof?.full_name) userName = String(prof.full_name);
    } catch { /* keep default */ }

    // Resolved fields.
    let to: string[] = [];
    // W11.1 · REPLY-ALL — the thread's other participants (lib/prepare/addressee.ts replyAllCc).
    let cc: string[] = [];
    // W11.1 · THE MAILBOX the words are written FROM (the thread's connection) — scopes voice + signature.
    let mailbox: import('@/lib/inbox/draft-reply').DraftMailbox | null = null;
    let recipientName: string | null = null;
    let subject = '';
    // The prompt describing what to write + the context the model grounds on.
    let task = '';
    let context = '';
    // The best recipient email we can find for the voice block (per-recipient tone).
    let voiceRecipient: string | null = null;
    // When true, we resolve the recipient/subject but do NOT auto-generate a reply body — an FYI/`noted`
    // inbox item should never get a canned reply (the user can still write one). Set only in the
    // awareness/email branch, from the item's own classification (never sender/subject keywords).
    let skipDraft = false;
    let pooledBody = '';            // W2.1 — a pooled nudge served in place of a fresh draft
    let pooledBy: string | null = null;
    // W9.1 THE USER'S HAND: the pooled message is the user's own saved edit (and whether the thread
    // moved since) — the card says so rather than presenting their words as ours.
    let pooledHand: { edited: true; staleUnderEdit?: true } | null = null;
    // W7.3 TRUE ADDRESSEES — candidates the ladder saw but may not claim (offered on the card, never sent).
    let pooledAddressee: import('@/lib/prepare/addressee').Addressee | null = null;
    // W13 · A CLAIM RENDERS — the file the pooled draft carries (staged by the pass under the staging
    // law). Served so the card shows it as a chip, and Send attaches exactly the chips that stand.
    let pooledAttachment: unknown = null;
    let suggestions: Array<{ name: string | null; email: string | null }> = [];
    // For an email/awareness item that genuinely owes a reply, we draft via the shared reply drafter
    // (`generateReplyDraft`) — it detects + mirrors the INCOMING email's language (the A2 fix), so the
    // reply comes back in the thread's language, not the user's default. Set to the item's source_data.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let replyItemSD: Record<string, any> | null = null;
    // W12.1 · EVERY DRAFT PASSES THE SAME TRUTH — the facts this door's generated words are vetted
    // against (lib/prepare/truth vetDraft, the ONE function the reader + evaluator call). Nothing is
    // ever staged with a generated compose body. A commitment the user owes sets `obligationOpen`.
    const vetFacts: import('@/lib/prepare/truth').DraftVetFacts = { obligationOpen: false, staged: false };
    // W12.1 · NO PAY-PER-OPEN — a generated commitment draft is pooled once (set in that branch).
    let poolCommitment: { id: string; direction: string | null; addr: import('@/lib/prepare/addressee').AddresseeResolution } | null = null;

    if (kind === 'meeting') {
      // entityId = the meeting transcript id. Pull its calendar event's attendees (minus the user).
      const { data: tr } = await supabase
        .from('meeting_transcripts')
        .select('id, title, summary, suggested_next_step, calendar_event_id, decisions')
        .eq('id', entityId).eq('user_id', user.id).maybeSingle();
      if (!tr) return NextResponse.json({ error: 'not found' }, { status: 404 });

      let attendees: Array<{ email?: string; name?: string; displayName?: string }> = [];
      let title = (tr.title as string) || 'our meeting';
      if (tr.calendar_event_id) {
        const { data: ev } = await supabase
          .from('calendar_events')
          .select('title, attendees')
          .eq('id', tr.calendar_event_id).eq('user_id', user.id).maybeSingle();
        if (ev) {
          attendees = (ev.attendees ?? []) as typeof attendees;
          if (ev.title) title = ev.title as string;
        }
      }
      const others = attendees.filter((a) => a.email && !isSelf(a.email));
      to = others.map((a) => a.email!).filter(Boolean).slice(0, 20);
      recipientName = others[0]?.name || others[0]?.displayName || null;
      voiceRecipient = to[0] ?? null;

      subject = `Follow-up: ${title}`;
      const nextStep = (tr.suggested_next_step as string) || '';
      context = [
        `Meeting: ${title}`,
        (tr.summary as string) ? `Summary:\n${(tr.summary as string).slice(0, 2000)}` : '',
        nextStep ? `Suggested next step: ${nextStep}` : '',
      ].filter(Boolean).join('\n\n');
      task = intent?.trim()
        ? intent.trim()
        : `Write a brief follow-up email to the meeting attendees, summarizing what was decided and confirming the next step. Keep it warm and concise.`;
    } else if (kind === 'commitment') {
      // W2.1 ONE READER PER OBJECT: the prepare pass already wrote this commitment's nudge to the
      // pool — serve THAT (live: unsent, not superseded) instead of paying for a fresh draft on
      // every open; a fresh draft only when nothing is pooled. Recipient/subject still resolve below.
      try {
        const { preparedState } = await import('@/lib/prepare/read');
        const st = await preparedState(supabase, user.id, { kind: 'commitment', id: entityId });
        const pooled = st.live.find((a) => (a.kind === 'nudge_draft' || a.kind === 'reply_draft') && a.content.trim());
        if (pooled && !intent?.trim()) {
          pooledBody = pooled.content; pooledBy = pooled.by; pooledAddressee = pooled.addressee ?? null;
          pooledAttachment = pooled.attachment ?? null;
          if (pooled.hand) pooledHand = { edited: true, ...(pooled.staleUnderEdit ? { staleUnderEdit: true as const } : {}) };
        }
      } catch { /* the reader is an enhancement — fall through to drafting */ }
      // entityId = the commitment id.
      const { data: c } = await supabase
        .from('commitments')
        .select('id, description, counterparty, direction, status, source, source_id, thread_id, due_date')
        .eq('id', entityId).eq('user_id', user.id).maybeSingle();
      if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });

      // ── TRUE ADDRESSEES (W7.3): THE ONE LADDER — counterparty → the source email's other party →
      // the MEETING's attendees minus the user → the project's one external person. A meeting-born
      // commitment used to consult nobody (141 open with no resolvable address). The pooled draft's
      // own stamp wins when it carries an address: the words were written for that person. Nothing
      // resolves ⇒ an empty To + the candidates as suggestions — the card ASKS, never pretends. ──
      const { resolveCommitmentAddressee, addresseeLabel } = await import('@/lib/prepare/addressee');
      const addr = await resolveCommitmentAddressee(supabase, user.id, c as never);
      const stamped = pooledAddressee?.email && !isSelf(pooledAddressee.email) ? pooledAddressee : null;
      const toList = stamped ? [stamped] : addr.recipients;
      to = toList.map((a) => a.email).filter((e): e is string => !!e && !isSelf(e)).slice(0, 20);
      // W11.1 · REPLY-ALL: the ladder's Cc (the thread's participants minus the user, the To, and
      // automated addresses) — never empty merely because nobody asked.
      cc = (addr.cc ?? []).map((a) => a.email).filter((e): e is string => !!e && !isSelf(e) && !to.includes(e)).slice(0, 10);
      recipientName = addresseeLabel(stamped ?? addr.addressee);
      {
        const { threadMailboxOf } = await import('@/lib/inbox/draft-reply');
        let tid = (c.thread_id as string | null) ?? null;
        if (!tid && c.source === 'email' && c.source_id) {
          const { data: se } = await supabase.from('emails').select('thread_id').eq('id', c.source_id).eq('user_id', user.id).maybeSingle();
          tid = (se?.thread_id as string | null) ?? null;
        }
        mailbox = await threadMailboxOf(supabase, user.id, tid);
      }
      suggestions = addr.suggestions.map((a) => ({ name: a.name, email: a.email }));
      let sourceSubject: string | null = null;
      let sourceBody: string | null = null;
      if (c.source === 'email' && c.source_id) {
        const { data: e } = await supabase
          .from('emails')
          .select('subject, body')
          .eq('id', c.source_id).eq('user_id', user.id).maybeSingle();
        if (e) {
          sourceSubject = (e.subject as string) || null;
          sourceBody = typeof e.body === 'string' ? (e.body as string).replace(/\s+/g, ' ').trim().slice(0, 1500) : null;
        }
      }
      voiceRecipient = to[0] ?? null;

      subject = sourceSubject ? `Re: ${sourceSubject}` : `Following up`;
      context = [
        `What you owe / committed to: ${c.description ?? ''}`,
        (c.due_date as string) ? `Due: ${c.due_date}` : '',
        recipientName ? `Recipient: ${recipientName}` : '',
        sourceBody ? `From the original message:\n${sourceBody}` : '',
      ].filter(Boolean).join('\n\n');
      // W12.1 · THE DIRECTION FRAMES THE TASK (lib/prepare/truth commitmentComposeTask): on work the
      // user OWES the message DELIVERS — never a request to the counterparty; on work THEY owe a
      // chase is the valid message. The one vet below holds the words to the same fact.
      vetFacts.obligationOpen = String(c.status ?? '') === 'open' && String(c.direction ?? '') === 'you_owe';
      if (!pooledBody && !intent?.trim()) poolCommitment = { id: String(c.id), direction: (c.direction as string | null) ?? null, addr };
      const { commitmentComposeTask } = await import('@/lib/prepare/truth');
      task = intent?.trim()
        ? intent.trim()
        : commitmentComposeTask({ direction: c.direction as string | null, description: c.description as string | null }, recipientName);
    } else {
      // awareness | email — entityId = an inbox item id. Recipient = the sender. Draft a reply.
      const { data: item } = await supabase
        .from('inbox_items')
        .select('id, work_title, source_data, work_state, rule_type, type_override, status, source')
        .eq('id', entityId).eq('user_id', user.id).maybeSingle();
      if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const sd = (item.source_data ?? {}) as Record<string, unknown>;
      // Gate the auto-draft on the item's own classification — an FYI/`noted` item never gets a canned
      // reply (a newsletter must never be auto-drafted). Recipient/subject still resolve so the user can
      // write manually; only the AI body is suppressed. Never sender/subject keywords.
      try {
        const rules = await loadUserRules(user.id, supabase);
        setInboxRules(rules);
      } catch { /* fall back to default rules */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!shouldDraftReply(item as any)) skipDraft = true;
      else replyItemSD = sd; // route through the language-mirroring reply drafter below
      const from = String(sd.from || sd.from_address || '');
      const email = extractEmail(from);
      recipientName = (sd.from_name as string) || extractName(from);
      if (email && !isSelf(email)) to = [email];
      voiceRecipient = to[0] ?? null;
      // W11.1 · REPLY-ALL on a shared thread: the message's other participants stay on Cc.
      try {
        const { replyAllCc, participantsOf, loadUserIdentity } = await import('@/lib/prepare/addressee');
        const ident = await loadUserIdentity(supabase, user.id);
        const parts = participantsOf({ from_address: email, from_name: (sd.from_name as string | null) ?? null, to_addresses: sd.to, cc_addresses: sd.cc });
        cc = replyAllCc({ participants: parts, to: to.map((e) => ({ name: null, email: e })), user: ident.forms, userAddresses: ident.addresses })
          .map((a) => a.email).filter((e): e is string => !!e && !isSelf(e));
      } catch { cc = []; }

      const subj = String(sd.subject || item.work_title || '');
      subject = subj ? (/^re:/i.test(subj) ? subj : `Re: ${subj}`) : 'Re: your message';
      context = [
        subj ? `Subject: ${subj}` : '',
        from ? `From: ${from}` : '',
        typeof sd.body === 'string' ? `Message:\n${(sd.body as string).slice(0, 2500)}` : '',
      ].filter(Boolean).join('\n\n');
      task = intent?.trim()
        ? intent.trim()
        : `Write a concise, appropriate reply to the message below in ${userName}'s voice.`;
    }

    // Draft in the user's voice — same voice block the reply drafter uses (per-recipient tone). Skipped
    // for FYI/`noted` inbox items (recipient/subject still returned; the user writes the body themselves).
    let body = pooledBody;
    // W12.1 · EVERY DRAFT PASSES THE SAME TRUTH: a GENERATED body goes through `draftThroughVet` —
    // the ONE vet (chase on work the user owes · "attached" with nothing staged · a deed not done),
    // regenerated ONCE with the failure named, else NOT served (the card's honest empty state). A
    // pooled body already passed THE ONE READER (the same vet, at stampTruth) — never re-vetted here.
    let withheld: string | null = null;
    const { draftThroughVet, withheldLine } = await import('@/lib/prepare/truth');
    if (pooledBody) { /* served from the pool — no AI call */ }
    else if (!skipDraft && replyItemSD) try {
      // Fix 3 — draft ↔ plan coherence: load this item's LIVE plan step summaries (deep-dives plan
      // inbox items under kind 'email') so the reply narrates one story with the Identified tasks.
      const planSteps = await loadPlanStepSummaries(supabase, user.id, 'email' as ItemPlanKind, entityId).catch(() => []);
      // Email/awareness reply → the shared reply drafter, which mirrors the incoming email's language.
      const sd = replyItemSD;
      const vetted = await draftThroughVet(async (objection) => generateReplyDraft(user.id, sd, supabase,
        [intent?.trim() || '', objection ? `REVIEWER'S OBJECTION — fix this: ${objection}` : ''].filter(Boolean).join('\n') || null, planSteps), vetFacts);
      body = vetted.body;
      if (vetted.failed) withheld = withheldLine(vetted.failed);
    } catch (e) {
      console.error('[compose/draft] reply drafting failed:', e);
    } else if (!skipDraft) try {
      const voiceBlock = await buildVoiceBlock(user.id, voiceRecipient, supabase, mailbox).catch(() => '');
      const { mailboxIdentityRule } = await import('@/lib/inbox/draft-reply');
      const identityRule = mailboxIdentityRule(mailbox);
      const { client: ai, model } = await getAIClient(user.id, 'conversation', supabase);
      const generate = async (objection: string | null): Promise<string> => {
        const res = await aiCreate(ai, {
          model, max_tokens: 600, temperature: 0.6,
          messages: [{ role: 'user', content:
            `${voiceBlock ? voiceBlock + '\n\n' : ''}` +
            `You are ${userName}. ${task}\n\n` +
            `Write the message in ${userName}'s voice and sign as ${userName} — NEVER sign as anyone else. ` +
            `${identityRule ? `${identityRule} ` : ''}` +
            `Return ONLY the message body — no subject line, no preamble, no surrounding quotes. Keep it ready to send.\n\n` +
            `--- CONTEXT ---\n${context}\n\n` +
            (objection ? `REVIEWER'S OBJECTION to your previous draft — fix this: ${objection}\n\n` : '') +
            // Language mirrors the correspondent, not the user's default. A concrete detected language wins
            // over the voice examples (which may be in another language); fall back to "match the context".
            (detectLanguage(context)
              ? `IMPORTANT — LANGUAGE: The context above is in ${detectLanguage(context)}. Write the ENTIRE ` +
                `message in ${detectLanguage(context)}, and ONLY in ${detectLanguage(context)}. The voice ` +
                `examples are for STYLE only — ignore their language.`
              : `IMPORTANT — LANGUAGE: Write in the SAME language as the context above — detect it and match ` +
                `it; if there's no clear language, use English. The voice examples are for STYLE only.`) }],
        });
        return res.choices?.[0]?.message?.content?.trim() || '';
      };
      const vetted = await draftThroughVet(generate, vetFacts);
      body = vetted.body;
      if (vetted.failed) withheld = withheldLine(vetted.failed);
    } catch (e) {
      console.error('[compose/draft] drafting failed:', e);
    }

    // W12.1 · NO PAY-PER-OPEN: a generated commitment draft that PASSED the vet is written ONCE to the
    // pool as the commitment's prepared artifact (lib/prepare/truth composeDraftRow — the pass's shape,
    // `prepared_from` ground + addressee stamps), so the next open serves it through THE ONE READER at
    // zero AI, and from then on it obeys the-users-hand-wins + regeneration-only-on-ground-move. Never
    // over the user's own words (a held newest draft stands), never twice (a row that landed while we
    // drafted wins), never for an intent-driven one-off. Non-fatal: the words are served regardless.
    let pooledNow = false;
    if (poolCommitment && body && !withheld) try {
      const startedAt = requestStartedAt;
      const { data: prior, error: priorErr } = await supabase.from('item_deliverables').select('id, content, metadata, created_at')
        .eq('user_id', user.id).eq('kind', 'commitment').eq('entity_id', poolCommitment.id).eq('type', 'draft')
        .filter('metadata->>version_of', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { isPoolRowHandHeld } = await import('@/lib/prepare/hand');
      const landedMeanwhile = !!prior && Date.parse(String(prior.created_at ?? '')) >= startedAt;
      if (!priorErr && !isPoolRowHandHeld('reply_draft', prior) && !isPoolRowHandHeld('nudge_draft', prior) && !landedMeanwhile) {
        const [{ groundOf }, { addresseeStamp, recipientsLabel }, { composeDraftRow }] = await Promise.all([
          import('@/lib/prepare/ground'), import('@/lib/prepare/addressee'), import('@/lib/prepare/truth'),
        ]);
        const ground = await groundOf(supabase, user.id, { kind: 'commitment', id: poolCommitment.id }).catch(() => null);
        const row = composeDraftRow({
          userId: user.id, commitmentId: poolCommitment.id, direction: poolCommitment.direction, body,
          recipientLabel: recipientsLabel(poolCommitment.addr.recipients) || recipientName,
          preparedFrom: ground ? { emailId: ground.emailId ?? null, receivedAt: ground.receivedAt ?? null } : null,
          addresseeStamp: addresseeStamp(poolCommitment.addr),
        });
        const { error: insErr } = await supabase.from('item_deliverables').insert(row);
        if (insErr) console.error('[compose/draft] pooling the draft failed (non-fatal):', insErr.message);
        else pooledNow = true;
      }
    } catch (e) {
      console.error('[compose/draft] pooling the draft failed (non-fatal):', e);
    }

    return NextResponse.json({
      to,
      cc,
      subject,
      bodyHTML: body ? paraHTML(body) : '',
      // W7.3: the plain words too — the ONE email card authors plain text / its own editor HTML.
      bodyText: body || '',
      recipientName: recipientName ?? null,
      ...(suggestions.length ? { suggestions } : {}),
      ...(pooledBody ? { prepared: true, preparedBy: pooledBy } : {}),
      // W13: the staged file(s) riding the served words — the card's chips (KB-held only).
      ...(pooledBody && stagedFilesOf(pooledAttachment).length ? { attachments: stagedFilesOf(pooledAttachment) } : {}),
      ...(pooledBody && pooledHand ? pooledHand : {}),
      // W12.1: the honest empty state — why no words were served (the draft failed the one vet twice).
      ...(withheld ? { withheld } : {}),
      ...(pooledNow ? { pooled: true } : {}),
    });
  } catch (error) {
    console.error('[compose/draft] error:', error);
    return NextResponse.json({ error: 'Could not draft the message.' }, { status: 500 });
  }
}
