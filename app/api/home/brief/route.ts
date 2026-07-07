import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSystemClient } from '@/lib/ai/factory';
import { buildAnsweredSet } from '@/lib/inbox/needs-reply';
import { computeThreadReplyState } from '@/lib/inbox/thread-resolution';
import { classifyItem } from '@/lib/inbox/classify-item';
import { lastMeetingRecall } from '@/lib/context/voice-context';
import { buildBriefContext, type EmailSeed } from '@/lib/home/brief-context';
import { synthesizeBrief, type MustRespondCandidate } from '@/lib/home/synthesize-brief';

export const maxDuration = 30;

// GET /api/home/brief — the day brief, LAYERED by topic (not a flat task list).
// A meeting with N action items is ONE card (items nested); commitments group under their
// source; emails are one card per thread. The Home stays a brief, not a backlog.

const DAY = 86_400_000;
const BRIEF_TTL = 3 * 60 * 60 * 1000;
const MAX_PRIORITIES = 6;

// ── Display-level dedup backstop for commitments ──────────────────────────────────────────────
// Even before any data cleanup, existing near-duplicate commitment rows shouldn't double up in a
// lane. General (token-overlap, no text special-casing — mirrors the extractor's write-time dedup):
// two descriptions with heavy content-word overlap are the same obligation; keep the first, drop the
// rest. Works for any wording/language; never merges distinct tasks that merely share a noun.
const DEDUP_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'from', 'up',
  'out', 'over', 'about', 'into', 'as', 'is', 'be', 'will', 'would', 'should', 'need', 'needs',
  'please', 'get', 'send', 'this', 'that', 'it', 'them', 'me', 'you', 'we', 'i', 'he', 'she', 'they',
]);
function dedupNorm(s: string): string { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function dedupTokens(s: string): Set<string> {
  const toks = dedupNorm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => t.length > 2 && !DEDUP_STOPWORDS.has(t));
  return new Set(toks);
}
function sameObligation(a: string, b: string, threshold = 0.6): boolean {
  const na = dedupNorm(a), nb = dedupNorm(b);
  if (na === nb) return true;
  if (na && nb && (na.includes(nb) || nb.includes(na))) return true;
  const ta = dedupTokens(a), tb = dedupTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= threshold;
}
function dedupByDescription<T extends { description: string }>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const r of rows) {
    if (kept.some((k) => sameObligation(k.description, r.description))) continue;
    kept.push(r);
  }
  return kept;
}

// Automated / transactional senders are never a reply YOU owe — a "payment failed", "account
// suspended", "verify your email", or no-reply notification is not a human waiting on you, even if
// the classifier tagged it needs_reply. Keep this heuristic CONSERVATIVE and well-scoped: it only
// removes an item from the must-respond (needs_reply) pool — the item still flows through the FYI /
// awareness path. Matches on the from ADDRESS localpart (no-reply@, notifications@, billing@…), a few
// bulk-sender domains, and unmistakable automated display-name / subject phrases.
function isAutomatedSender(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  const email = (fromEmail || '').toLowerCase();
  const localpart = email.split('@')[0] || '';
  // Address localpart patterns — the classic "do not reply to this mailbox" senders.
  const addrPatterns = [
    'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
    'notifications', 'notification', 'notify', 'mailer', 'mailer-daemon', 'bounce', 'bounces',
    'postmaster', 'automated', 'auto-confirm', 'alerts', 'alert', 'billing', 'invoices', 'receipts',
    'support+', 'updates', 'newsletter', 'news', 'digest',
  ];
  if (addrPatterns.some((p) => localpart.includes(p))) return true;
  // Full-address contains (covers e.g. "team@notifications.stripe.com" style subdomains).
  if (/(^|[.@])(no-?reply|donotreply|notifications?|mailer|bounce|postmaster)([.@])/.test(email)) return true;
  // Display-name + subject signals — transactional / security / dunning mail from a real-looking
  // localpart. Kept tight (well-known phrasings) so we don't nuke genuine human replies.
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const phrasePatterns = [
    'payment failed', 'payment unsuccessful', 'payment declined', 'account suspended',
    'account restricted', 'account has been', 'your subscription', 'subscription renew',
    'verify your', 'confirm your email', 'confirm your account', 'security alert', 'security notice',
    'unusual sign', 'sign-in attempt', 'password reset', 'invoice is', 'your receipt', 'order confirmation',
  ];
  if (phrasePatterns.some((p) => text.includes(p))) return true;
  return false;
}

// Bug C — "can't reply" ≠ "no action needed". An automated / no-reply item you cannot reply to can
// still DEMAND action: a payment failed, an account suspended/restricted, a security alert, a "verify
// your…", something expiring. These are ACTION-WORTHY: they must NOT be buried in the FYI digest
// (nobody sees them), but they're also NOT a reply (no human is waiting) — so they belong in the
// ACTION lane (a to-do priority card), not must-respond. This tells them apart from informational
// automated mail (newsletters, receipts, "order shipped", digests) which stays FYI.
//   • work_state ∈ (action_required | decision_required) — the classifier already flagged it needs a
//     decision/action (e.g. iCloud full, Google security alert land here), OR
//   • the subject/name carries an unmistakable action signal (dunning / suspension / security /
//     verification / expiry). Kept tight so marketing "act now!" copy doesn't trip it.
function isActionWorthyAutomated(workState: string | null, fromName: string | null, subject: string | null): boolean {
  if (workState === 'action_required' || workState === 'decision_required') return true;
  const text = `${(fromName || '').toLowerCase()} ${(subject || '').toLowerCase()}`;
  const actionPhrases = [
    'payment failed', 'payment unsuccessful', 'payment declined', 'payment could not',
    'account suspended', 'account restricted', 'account limited', 'account locked', 'account disabled',
    'account has been suspended', 'has been restricted', 'has been limited', 'has been locked',
    'security alert', 'security notice', 'unusual sign', 'suspicious', 'verify your', 'confirm your account',
    'action required', 'action needed', 'immediate action', 'expiring', 'expires', 'will expire',
    'storage is full', 'storage full', 'past due', 'overdue', 'update your payment', 'billing problem',
  ];
  return actionPhrases.some((p) => text.includes(p));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attendeeEmails(ev: any): string[] {
  return (ev?.attendees ?? []).map((a: any) => (a?.email || '').toLowerCase()).filter(Boolean);
}

// A calendar-CANCELLATION event whose title is the raw provider string ("Canceled event: …",
// "Cancelled: …") is not an upcoming meeting even when its row status is still 'confirmed'. These
// ARE the literal Google/Outlook-generated titles, so a small prefix list is the right tool.
function isCancelledEventTitle(title: string | null | undefined): boolean {
  const t = (title || '').trimStart().toLowerCase();
  return t.startsWith('canceled event:') || t.startsWith('cancelled event:') ||
    t.startsWith('canceled:') || t.startsWith('cancelled:');
}

// Calendar-SYSTEM email subjects (invite created/updated/cancelled, RSVP replies) leak into the
// "last thread" subtitle as raw provider strings. These are the literal multi-language subjects
// providers auto-generate — a prefix/pattern list is correct here (not a content heuristic). When a
// related email's subject matches, suppress the subtitle rather than show the raw string.
function isCalendarSystemSubject(subject: string | null | undefined): boolean {
  const s = (subject || '').trim();
  if (!s) return false;
  return /^(convite atualizado|invitation updated|updated invitation|updated:|canceled event|cancelled event|canceled:|cancelled:|convite cancelado|convite:|invitation:|invite:|accepted:|declined:|tentative:|aceito:|recusado:|talvez:|einladung|aktualisierte einladung|abgesagt:)/i.test(s);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const endOfDay = `${todayStr}T23:59:59Z`;
  // Start-of-today (UTC approximation) — the boundary for "cleared TODAY" counts. Computed fresh
  // per request so the ring's `cleared` half rises as the day goes on and resets each morning.
  const startOfDay = `${todayStr}T00:00:00Z`;
  const self = user.email?.toLowerCase();

  const since24 = new Date(now.getTime() - DAY).toISOString();
  const [itemsRes, commitsRes, meetingsRes, handledRes, profileRes, triagedRes, summarisedRes, trackedRes, filteredRes, fyiRes] = await Promise.all([
    supabase.from('inbox_items')
      .select('id, work_title, work_state, rule_type, type_override, source, source_id, source_meeting_transcript_id, source_data, created_at, last_activity_at')
      .eq('user_id', user.id).eq('status', 'pending')
      // Action work_states (reply-via-email + external tasks + meeting action items) OR a rule that
      // classified it actionable (rule_type) — so a needs_reply the RULES found on a 'noted' email
      // still reaches the Home. classifyItem (which reads rule_type) makes the final call.
      .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
      // Order by latest THREAD activity, not first-seen created_at: a fresh reply to an old thread
      // (sync bumps last_activity_at) must rank as current, not stale. NULLS LAST guards legacy rows
      // synced before the column existed / before backfill.
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(60),
    supabase.from('commitments').select('*').eq('user_id', user.id).eq('status', 'open'),
    supabase.from('calendar_events')
      .select('id, title, start_time, attendees')
      .eq('user_id', user.id).eq('status', 'confirmed')
      .gte('start_time', new Date(now.getTime() - 30 * 60_000).toISOString())
      .lte('start_time', endOfDay).order('start_time', { ascending: true }).limit(6),
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('status', 'done').gte('updated_at', new Date(now.getTime() - DAY).toISOString()),
    supabase.from('profiles').select('full_name, home_brief').eq('id', user.id).single(),
    // ── Heartbeat (Slice D): what the system handled autonomously in the last 24h ──
    supabase.from('inbox_items').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24),                                  // triaged
    supabase.from('meeting_transcripts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24),                                  // summarised
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24),                                  // tracked
    supabase.from('inbox_items').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24)
      .or('work_state.eq.noise,rule_type.eq.marketing,rule_type.eq.notifications'),         // filtered as noise
    // FYI tier (for the FYI-by-topic brief): awareness emails, grouped by sender downstream. Wide
    // window so high-volume people (not just recent newsletters) surface in the people section.
    // (id/created_at carried so a PERSON-kind awareness email can be promoted to "keep an eye on".)
    supabase.from('inbox_items').select('id, work_title, source_data, rule_type, created_at, last_activity_at')
      .eq('user_id', user.id).eq('status', 'pending').eq('work_state', 'noted')
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(200),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (itemsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commits = (commitsRes.data ?? []) as any[];

  // The item's freshness = latest thread activity. Prefer the explicit last_activity_at column
  // (bumped by sync on every new message), fall back to the newest message time in source_data,
  // then to created_at. Used for ordering, the "already replied" check, and the cache signature so
  // a fresh reply to an old thread is treated as current everywhere in the brief.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activityAt = (it: any): string =>
    (it?.last_activity_at as string) || (it?.source_data?.received_at as string) || (it?.created_at as string) || '';

  // A source card: grouped by where it's from (email thread / meeting), carrying the unified
  // posture (what it needs) — the digest shape from docs/unified-classifier-digest-plan.md.
  type Posture = 'needs_reply' | 'to_do' | 'waiting_on';
  type Priority = { id: string; source: 'email' | 'meeting'; posture: Posture; title: string; context: string | null; href: string; itemId?: string; items?: { id: string; text: string }[]; overdue?: boolean };
  const priorities: Priority[] = [];

  // ── Meetings: group action items under their meeting (LAYERED — one card, items nested) ──
  const byMeeting = new Map<string, { title: string; items: { id: string; text: string }[] }>();
  for (const it of items) {
    if (it.source === 'meeting' && it.source_meeting_transcript_id) {
      const key = it.source_meeting_transcript_id;
      const m = byMeeting.get(key) ?? { title: (it.source_data?.meeting_title as string) || 'Meeting', items: [] };
      m.items.push({ id: it.id, text: it.work_title || 'Action item' });
      byMeeting.set(key, m);
    }
  }
  for (const [tid, m] of byMeeting) {
    priorities.push({
      id: `meeting:${tid}`, source: 'meeting', posture: 'to_do', title: m.title,
      // Past-tense framing — this meeting already happened; these are follow-ups, not a "do this now".
      context: `You had this meeting · ${m.items.length} follow-up${m.items.length > 1 ? 's' : ''} to consider`,
      href: `/meetings`, items: m.items.slice(0, 6),
    });
  }

  // ── Email cards — via the SHARED classifier (rule-aware). needs_reply AND to_do (email tasks),
  // so the Home is as complete as the inbox, not just replies.
  const classifiedEmails = items
    .filter((it) => it.source !== 'meeting' && it.source !== 'commitment')
    .map((it) => ({ it, posture: classifyItem(it as never) }));
  const emailCandidates = classifiedEmails
    .filter((x) => x.posture === 'needs_reply' || x.posture === 'to_do');
  // Awareness candidates for the "keep an eye on" tier. Two sources:
  //  (a) cc'd-important items the SHARED classifier demoted to 'fyi' purely because the user is only
  //      cc'd (isCcOnlyBystander). We do NOT change classify-item.ts (the inbox depends on that blunt
  //      rule) — instead the Home re-surfaces these as awareness candidates so the synthesis can
  //      PROMOTE the substantive ones (e.g. a cc'd urgent meeting request). Scoped to the Home only.
  //  (b) person-kind FYI emails (real senders, not newsletters) — added below where the FYI groups
  //      are split by sender kind.
  // The synthesis judges which few of these rise to keep_an_eye_on; the rest stay in the FYI digest.
  const awarenessRaw = new Map<string, { it: (typeof items)[number]; ccOnly: boolean }>();
  for (const { it, posture } of classifiedEmails) {
    if (posture !== 'fyi') continue;
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    // Only worth promoting if there's a real sender AND the user was cc'd (i.e. it was demoted for
    // being a bystander, not because it's inherently noise). Newsletters have no personal signal.
    if (sd.is_cc_only === true && (sd.from_address || sd.from)) awarenessRaw.set(it.id, { it, ccOnly: true });
  }
  // Drop reply threads you've already answered. Also pull the FULL thread messages (both directions)
  // so we can compute the STRUCTURAL reply-state (computeThreadReplyState — direction+time only, no
  // keyword matching) per thread and feed it to the synthesis as a first-class "already handled" signal.
  const candThreadIds = [...new Set(emailCandidates.map((c) => c.it.source_data?.thread_id).filter(Boolean))] as string[];
  let answered = new Map<string, string>();
  const threadMsgsById = new Map<string, { is_from_user: boolean; received_at: string | null }[]>();
  if (candThreadIds.length) {
    const { data: threadRows } = await supabase.from('emails')
      .select('thread_id, is_from_user, received_at').eq('user_id', user.id).in('thread_id', candThreadIds);
    for (const r of (threadRows ?? []) as { thread_id: string | null; is_from_user: boolean; received_at: string | null }[]) {
      if (!r.thread_id) continue;
      const arr = threadMsgsById.get(r.thread_id) ?? [];
      arr.push({ is_from_user: r.is_from_user, received_at: r.received_at });
      threadMsgsById.set(r.thread_id, arr);
    }
    // The "already replied" set is the user's SENT messages only — same shape as before.
    answered = buildAnsweredSet(
      (threadRows ?? []).filter((r: { is_from_user: boolean }) => r.is_from_user).map((r: { thread_id: string | null; received_at: string | null }) => ({ thread_id: r.thread_id, received_at: r.received_at })),
    );
  }
  // needs_reply items (with content) feed the Must-respond synthesis; they stay in priorities for
  // counts. NOTE: supersession/staleness is NO LONGER hardcoded here (the old SCHEDULING regex +
  // meeting-supersession `continue` were bandaids that patched one observed case). Layer 3 (the
  // grounded synthesis pass) now reasons about supersession/staleness over the full per-person
  // context and returns the ids to drop — general for any phrasing, any person. Here we only apply
  // the deterministic "already replied" resolution + collect the candidates.
  const mustRespondRaw: MustRespondCandidate[] = [];
  const emailSeeds: EmailSeed[] = [];
  // itemId → whether the NEWEST message on the thread is the user's own (structural, direction+time).
  // `lastFromUser === false` means the newest message is INBOUND, i.e. a genuinely unanswered reply the
  // user still owes — such an item is PROTECTED and can never be dropped by the AI synthesis. Only items
  // where the user has the last word (`lastFromUser === true`) may be closure-dropped by the model.
  const lastFromUserByItem = new Map<string, boolean>();
  const fromEmailOf = (sd: Record<string, unknown>): string | null => {
    const raw = String((sd.from_address as string) || (sd.from as string) || '').toLowerCase();
    return raw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || (raw.includes('@') ? raw : null);
  };
  for (const { it, posture } of emailCandidates) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const tid = sd.thread_id as string | undefined;
    const sentAt = tid ? answered.get(tid) : undefined;
    // Answered only if our reply is newer than the latest inbound activity — a fresh reply that
    // landed AFTER we last sent still needs us.
    if (posture === 'needs_reply' && sentAt && sentAt > activityAt(it)) continue; // already replied
    const fromEmail = fromEmailOf(sd);
    const subj = it.work_title || (sd.subject as string) || null;
    const fromName = (sd.from_name as string) || null;
    const automated = posture === 'needs_reply' && isAutomatedSender(fromEmail, fromName, subj);
    // Bug C — an AUTOMATED item classified needs_reply isn't a reply you owe (no human is waiting), but
    // it may still DEMAND action (payment failed / account suspended / security alert / expiring). If
    // so, re-posture it to `to_do` so it surfaces as a visible ACTION card (the "Worth acting on"
    // path), never buried in FYI. Informational automated mail (posture stays needs_reply here) is
    // dropped from must-respond below and flows to the FYI/awareness digest as before — no reply-flood.
    const actionWorthy = automated && isActionWorthyAutomated((it.work_state as string) || null, fromName, subj);
    const effectivePosture: Posture = actionWorthy ? 'to_do' : (posture as Posture);
    priorities.push({
      id: `email:${it.id}`, source: 'email', posture: effectivePosture,
      title: subj || 'Email',
      context: fromName || (sd.from as string) || null,
      href: '/inbox', itemId: it.id,
    });
    // Structural reply-state for this thread (direction+time only — no keyword/text matching). The
    // synthesis reasons "the user already responded → drop/deprioritize" over the REAL thread, not a
    // regex. `since` = the item's created_at so only a reply AFTER the item appeared counts.
    const threadMsgs = tid ? threadMsgsById.get(tid) : undefined;
    const replyState = threadMsgs && threadMsgs.length
      ? computeThreadReplyState(threadMsgs, it.created_at ? new Date(it.created_at as string) : null)
      : null;
    // Feed the per-person entity map (Layer 1) — identity carried by the counterparty email.
    emailSeeds.push({
      itemId: it.id, fromAddress: fromEmail, fromName: (sd.from_name as string) || null,
      subject: it.work_title || (sd.subject as string) || '(no subject)',
      at: activityAt(it), posture: effectivePosture,
      snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      userResponded: replyState?.userReplied ?? undefined,
      lastFromUser: replyState?.lastMessageFromUser ?? undefined,
    });
    if (replyState && typeof replyState.lastMessageFromUser === 'boolean') {
      lastFromUserByItem.set(it.id, replyState.lastMessageFromUser);
    }
    if (effectivePosture === 'needs_reply') {
      // Automated / transactional mail is not a reply you owe — keep it OUT of must-respond (it still
      // flows through FYI/awareness). This cleans the pool so "show every real reply" isn't polluted by
      // no-reply notifications the model then over-drops. Action-worthy automated items were already
      // re-postured to `to_do` above (so they surface as action cards), so anything still automated
      // here is informational → drop it from must-respond (it flows to the FYI/awareness digest).
      if (automated) continue;
      mustRespondRaw.push({
        itemId: it.id,
        from: (sd.from_name as string) || (sd.from as string) || 'Someone',
        fromEmail: fromEmail || '',
        subject: it.work_title || (sd.subject as string) || '(no subject)',
        snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        receivedAt: activityAt(it),
      });
    }
  }
  // Layer 1: assemble the reconciled per-person context (meetings + commitments + these emails).
  const briefCtx = await buildBriefContext(user.id, self, now, supabase, emailSeeds);

  // ── Commitment CANDIDATES — every open commitment, normalized. The raw ingest `direction` is only
  // a DEFAULT hint here: the grounded synthesis (Layer 3) re-judges each one's placement (on_your_plate
  // / ball_in_court / informational) so a REQUESTED action (the user is waiting on someone) can't sit
  // in "On your plate" just because the extractor guessed you_owe.
  // See docs/brief-and-labeling-plan.md ("DIRECTION corrected July 2") + Bug #1.
  //
  // Bug B: meeting-sourced commitments are INCLUDED. They used to be excluded wholesale (`source !==
  // 'meeting'`) on the assumption they'd double the meeting action-item priority cards — but those
  // cards come from `inbox_items` (a distinct table/extraction), so the exclusion instead HID every
  // "you owe X" promise captured from a meeting (21 real open items → an empty "On your plate"). A
  // meeting commitment is a genuine thing the user owes and belongs in the same placement pipeline as
  // any other; the synthesis + the top-N cap keep the section a brief, not a backlog.
  // Source-derived fallback label for commitments with NO counterparty — so the UI never prints a
  // placeholder ("Someone"). For a meeting commitment we resolve the meeting title ("from <title>");
  // an email commitment has no better source string, so it stays null and the UI omits the name.
  // General: keyed off the commitment's own source_id, no hardcoded titles/ids.
  const meetingCommitTids = [...new Set(commits
    .filter((c) => c.source === 'meeting' && !c.counterparty && c.source_id)
    .map((c) => c.source_id as string))];
  const meetingTitleById = new Map<string, string>();
  if (meetingCommitTids.length) {
    const { data: mts } = await supabase.from('meeting_transcripts')
      .select('id, title').eq('user_id', user.id).in('id', meetingCommitTids);
    for (const m of (mts ?? []) as { id: string; title: string | null }[]) {
      if (m.title) meetingTitleById.set(m.id, m.title);
    }
  }
  // The label shown when counterparty is null: a source-derived string ("from <meeting title>") or
  // null (UI omits the name entirely). NEVER a literal placeholder.
  const sourceLabelOf = (c: (typeof commits)[number]): string | null => {
    if (c.source === 'meeting' && c.source_id) {
      const t = meetingTitleById.get(c.source_id as string);
      return t ? `from ${t}` : null;
    }
    return null;
  };
  const commitmentCands = commits
    .map((c) => ({
      id: c.id as string,
      description: c.description as string,
      counterparty: (c.counterparty as string | null) ?? null,
      // A display-only fallback (never printed as the person's name in prose contexts that need a
      // real name — the UI uses it only where it currently showed "Someone"/"them").
      sourceLabel: sourceLabelOf(c),
      direction: (c.direction as string) || 'you_owe',
      dueDate: (c.due_date as string | null) ?? null,
      overdue: !!(c.due_date && c.due_date < todayStr),
      dueToday: !!(c.due_date && c.due_date === todayStr),
      ageDays: Math.floor((now.getTime() - new Date(c.created_at).getTime()) / DAY),
    }));
  // Default placement from the ingest direction — used as the fallback when the synthesis has no
  // verdict for a commitment (failure / not enumerated), so behavior degrades to the old routing.
  const defaultPlacement = (dir: string): 'on_your_plate' | 'ball_in_court' | 'informational' =>
    dir === 'awaiting' ? 'ball_in_court' : 'on_your_plate';

  // Overdue → reply → to-do → finished meetings last (a past meeting is context, not "do this now").
  const rank = (p: Priority) => (p.overdue ? 0 : p.source === 'meeting' ? 4 : p.posture === 'needs_reply' ? 1 : p.posture === 'to_do' ? 2 : 3);
  priorities.sort((a, b) => rank(a) - rank(b));
  const cappedPriorities = priorities.slice(0, MAX_PRIORITIES);

  // ── FYI-by-topic: group the awareness emails by sender; the AI digests each group below. ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fyiRows = (fyiRes.data ?? []) as Array<{ id: string; work_title: string | null; source_data: any; created_at: string }>;
  const fyiBySender = new Map<string, { subjects: string[]; address: string; unsub: boolean }>();
  for (const r of fyiRows) {
    const sd = (r.source_data ?? {}) as Record<string, unknown>;
    const label = (sd.from_name as string) || (sd.from as string);
    if (!label) continue;
    const g = fyiBySender.get(label) ?? { subjects: [], address: ((sd.from as string) || '').toLowerCase(), unsub: false };
    g.subjects.push(r.work_title || (sd.subject as string) || '');
    if (sd.has_unsubscribe) g.unsub = true;
    fyiBySender.set(label, g);
  }
  // People vs newsletters/services. PRIMARY signal: List-Unsubscribe (captured in sync — definitive
  // for bulk mail). The sender local-part regex is only a FALLBACK for items synced before that.
  const NEWSLETTER = /(^|[.\-_])(no-?reply|do-?not-?reply|donotreply|newsletter|news|notifications?|notify|updates?|mailer|marketing|digest|hello|team|info|support|alerts?|members?|email|mail)([.\-_+@0-9]|$)/i;
  const isNewsletter = (addr: string) => NEWSLETTER.test((addr.split('@')[0] || ''));
  const fyiGroupsAll = [...fyiBySender.entries()]
    .map(([label, g]) => ({ label, subjects: g.subjects, count: g.subjects.length, kind: (g.unsub || isNewsletter(g.address) ? 'newsletter' : 'person') as 'newsletter' | 'person' }))
    .sort((a, b) => b.count - a.count);
  const peopleGroups = fyiGroupsAll.filter((g) => g.kind === 'person').slice(0, 5);
  const newsletterGroups = fyiGroupsAll.filter((g) => g.kind === 'newsletter').slice(0, 5);
  const fyiTop = [...peopleGroups, ...newsletterGroups];
  const fyiTailItems = fyiGroupsAll.reduce((n, g) => n + g.count, 0) - fyiTop.reduce((n, g) => n + g.count, 0);
  const fyiTailGroups = Math.max(0, fyiGroupsAll.length - fyiTop.length);

  // DETERMINISTIC FYI DIGEST — a fallback the section can ALWAYS render when FYI groups exist, even
  // if the AI synthesis omits/returns null for fyiDigest (Bug A: the model frequently drops the fyi
  // block on a large mailbox, and the enrich path only overwrote fyiDigest when synth.fyiDigest was
  // non-null OR there were no groups — so with groups + a null model result the section stayed empty
  // forever). This builds one plain digest line per group directly from the sender + a couple of its
  // subjects, so "For your awareness" is never blank while noted mail exists. The AI's nicer prose
  // still wins when present (used only as the fallback below + when no cache/synth is available).
  const buildDeterministicFyiDigest = (): FyiDigest | null => {
    if (!fyiTop.length) return null;
    const groups = fyiTop.map((g) => {
      const subs = g.subjects.map((s) => (s || '').trim()).filter(Boolean).slice(0, 2);
      const summary = subs.length
        ? `${g.count} message${g.count > 1 ? 's' : ''} — ${subs.map((s) => `“${s.length > 60 ? s.slice(0, 57) + '…' : s}”`).join(', ')}`
        : `${g.count} message${g.count > 1 ? 's' : ''}`;
      return { label: g.label, summary, kind: g.kind };
    });
    return { groups, tailGroups: fyiTailGroups, tailItems: fyiTailItems };
  };

  // ── Awareness candidates (source b): FYI emails the digest ITSELF treats as a real person (not a
  // newsletter/service) — reuse that exact person/newsletter split (labels in `peopleGroups`) so the
  // pool can't disagree with the digest, and we don't grow a second heuristic. Bulk mail stays in the
  // digest; only human FYI is offered up for possible promotion. The synthesis makes the final call.
  const personLabels = new Set(peopleGroups.map((g) => g.label));
  for (const r of fyiRows) {
    const sd = (r.source_data ?? {}) as Record<string, unknown>;
    const label = (sd.from_name as string) || (sd.from as string);
    if (!label || !personLabels.has(label)) continue; // not a person the digest recognises → digest only
    if (!awarenessRaw.has(r.id)) awarenessRaw.set(r.id, { it: r as unknown as (typeof items)[number], ccOnly: sd.is_cc_only === true });
  }
  const fromEmailFrom = (sd: Record<string, unknown>): string | null => {
    const raw = String((sd.from_address as string) || (sd.from as string) || '').toLowerCase();
    return raw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || (raw.includes('@') ? raw : null);
  };
  // Order cc'd human threads first (someone deliberately looped the user in — the strongest awareness
  // signal), then freshest. Cap the pool small so the prompt stays lean and selective.
  const keepAnEyeOnRaw = [...awarenessRaw.values()]
    .sort((a, b) => (a.ccOnly === b.ccOnly ? activityAt(b.it).localeCompare(activityAt(a.it)) : a.ccOnly ? -1 : 1))
    .slice(0, 12)
    .map(({ it, ccOnly }) => {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    return {
      itemId: it.id,
      from: (sd.from_name as string) || (sd.from as string) || 'Someone',
      fromEmail: fromEmailFrom(sd) || '',
      subject: it.work_title || (sd.subject as string) || '(no subject)',
      snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      receivedAt: activityAt(it),
      ccOnly,
    };
  });

  // ── Today's schedule + light prep on the next meeting ──
  // Drop provider cancellation rows: the query already excludes status='cancelled', but a cancellation
  // can arrive as a still-'confirmed' row with a raw "Canceled event: …" title — that's not upcoming.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meetings = ((meetingsRes.data ?? []) as any[]).filter((m) => !isCancelledEventTitle(m.title));
  let nextPrep: { lastEmail?: { subject: string }; openCommitments: string[]; lastMeeting?: { title: string; date: string; recall: string; person: string } } | null = null;
  if (meetings[0]) {
    const others = attendeeEmails(meetings[0]).filter((e) => e !== self);
    if (others.length) {
      const { data: le } = await supabase.from('emails').select('subject')
        .eq('user_id', user.id).contains('to_addresses', [others[0]])
        .order('received_at', { ascending: false }).limit(1);
      const related = commits.filter((c) => others.includes((c.counterparty || '').toLowerCase())).map((c) => c.description);
      // Reminder (Slice C): if you've met this person before, recall what was discussed.
      const recall = await lastMeetingRecall(user.id, others[0], supabase);
      // Suppress the "last thread" subtitle when the only related email is a calendar-system
      // notification (invite update/cancel/RSVP) — its raw subject would leak in as noise.
      const lastSubject = le?.[0]?.subject && !isCalendarSystemSubject(le[0].subject) ? le[0].subject : null;
      nextPrep = {
        ...(lastSubject ? { lastEmail: { subject: lastSubject } } : {}),
        openCommitments: related.slice(0, 3),
        ...(recall ? { lastMeeting: { ...recall, person: (others[0].split('@')[0] || others[0]) } } : {}),
      };
    }
  }
  const schedule = meetings.map((m, i) => ({
    id: m.id, time: m.start_time, title: m.title || '(untitled)',
    attendees: attendeeEmails(m).filter((e) => e !== self).length,
    prep: i === 0 ? nextPrep : null,
  }));

  // ── Status chips (live, alive) ── waitingOn counts commitments the INGEST flagged awaiting; the
  // synthesis may re-place some, but this pre-synthesis count is a stable input for the cache sig.
  const replyP = priorities.filter((p) => p.posture === 'needs_reply').length;
  const status = {
    needsReply: replyP,
    meetingsToday: schedule.length,
    waitingOn: commitmentCands.filter((c) => c.direction === 'awaiting').length,
    handledToday: handledRes.count ?? 0,
  };

  // ── Heartbeat: what was handled autonomously in the last 24h (the "I'm on top of it" panel) ──
  const handled = {
    triaged: triagedRes.count ?? 0,
    filtered: filteredRes.count ?? 0,
    summarised: summarisedRes.count ?? 0,
    tracked: trackedRes.count ?? 0,
    resolved: handledRes.count ?? 0,
  };

  // ── Cached one-line narration (posture-aware + busts when the day's shape changes) ──
  const emailP = cappedPriorities.filter((p) => p.posture === 'needs_reply').length;
  const meetingP = cappedPriorities.filter((p) => p.source === 'meeting').length;
  // Sig uses the pre-synthesis (ingest-default) owed set — stable regardless of the AI verdict, so the
  // signature is deterministic. Placements are cached alongside so a cache-hit still routes correctly.
  const owedByIngest = commitmentCands.filter((c) => c.direction !== 'awaiting');
  const commitP = owedByIngest.length;
  const overdueC = owedByIngest.filter((c) => c.overdue).length;
  const overdueP = cappedPriorities.filter((p) => p.overdue).length;
  const fyiSig = fyiTop.map((g) => `${g.label}:${g.count}`).join(',');
  // Freshness: the newest pending item's LATEST-ACTIVITY timestamp + the newest commitment update.
  // Folding these into the signature makes the brief regenerate the moment new activity lands (a
  // fresh reply on an old thread now bumps last_activity_at) — not just every 3h — so it feels live.
  const freshest = items.reduce((mx, it) => { const a = activityAt(it); return a > mx ? a : mx; }, '');
  const commitFresh = commits.reduce((mx, c) => (c.updated_at && c.updated_at > mx ? c.updated_at : mx), '');
  // Include today's date so the brief re-contextualizes on a day change (ages/overdue shift daily),
  // not only on the 3h TTL — a true daily recheck.
  // Awareness signature: count + freshest awareness item, so promoting/refreshing "keep an eye on"
  // regenerates the brief when the awareness pool shifts (not just on the 3h TTL).
  const eyeFresh = keepAnEyeOnRaw.reduce((mx, k) => (k.receivedAt > mx ? k.receivedAt : mx), '');
  const sig = `${todayStr}|${emailP}|${meetingP}|${commitP}|${overdueP}|${overdueC}|${status.waitingOn}|${schedule.length}|${fyiSig}|${freshest}|${commitFresh}|${keepAnEyeOnRaw.length}|${eyeFresh}`;

  const fullName = (profileRes.data as { full_name?: string } | null)?.full_name ?? null;
  const firstName = fullName?.split(' ')[0] ?? null;

  // ── Daily brief — ONE grounded synthesis pass (Layer 3) over the reconciled per-person context,
  // replacing the four blind silo passes. It writes the whole brief (TLDR + must-respond + follow-ups
  // + FYI) coherently and cross-aware BY CONSTRUCTION: it drops scheduling emails a meeting already
  // superseded (subsumes the retired SCHEDULING regex), never emits two fragments about one person,
  // and drops stale asks. It returns the ids it dropped so the cards match the prose. Cached on
  // profiles.home_brief, busts when the day's shape (sig) changes. ──
  type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
  type FollowUp = { id?: string; who: string; status: string; nextMove: string };
  type Followups = { teaser: string; items: FollowUp[]; closing: string | null };
  type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
  type Reply = { who: string; ask: string; angle: string; itemId: string; subject?: string; snippet?: string; receivedAt?: string };
  type MustRespond = { teaser: string; items: Reply[] };
  type KeepAnEyeOn = { items: { who: string; why: string; itemId: string }[] };
  type CommitmentPlacement = 'on_your_plate' | 'ball_in_court' | 'informational';
  const cached = (profileRes.data as { home_brief?: { text?: string; tldr?: Tldr; followups?: Followups | null; fyiDigest?: FyiDigest | null; mustRespond?: MustRespond | null; keepAnEyeOn?: KeepAnEyeOn | null; droppedItemIds?: string[]; commitmentPlacements?: Record<string, CommitmentPlacement>; generated_at: string; sig?: string } } | null)?.home_brief ?? null;
  let tldr: Tldr | null = cached?.tldr ?? null;
  let followups: Followups | null = cached?.followups ?? null;
  let fyiDigest: FyiDigest | null = cached?.fyiDigest ?? null;
  let mustRespond: MustRespond | null = cached?.mustRespond ?? null;
  let keepAnEyeOn: KeepAnEyeOn | null = cached?.keepAnEyeOn ?? null;
  let briefLine = cached?.text ?? null;
  let droppedItemIds: string[] = cached?.droppedItemIds ?? [];
  // The synthesis's per-commitment placement verdict (Bug #1). Cached so a cache-hit routes the same
  // way it did when generated. Falls back to the ingest-direction default per-commitment below.
  let commitmentPlacements: Record<string, CommitmentPlacement> = cached?.commitmentPlacements ?? {};
  // A cache blob written BEFORE the placement fix has no `commitmentPlacements` field at all (a code
  // revert doesn't touch cached data). Serving it makes every open commitment fall back to the ingest
  // direction — so a REQUESTED action (e.g. a refund you're owed) wrongly sits in "On your plate". Force
  // a one-time regen for such legacy caches when there are open commitments to (re-)place, so the
  // synthesis verdict actually takes without a manual cache wipe. General — no hardcoded item.
  const legacyPlacements = cached != null && cached.commitmentPlacements === undefined && commitmentCands.length > 0;
  const stale = !cached || cached.sig !== sig || legacyPlacements || (now.getTime() - new Date(cached.generated_at).getTime()) > BRIEF_TTL;
  if (stale) {
    // ── OPTIMISTIC SURFACING ─────────────────────────────────────────────────────────────────────
    // The AI synthesis (~10–30s) is what enriches the brief (ask/angle/ordering/supersession drops).
    // "What needs you" items must NOT wait on it: build a BASIC mustRespond from the deterministic
    // candidates so a freshly-synced item is PRESENT immediately, then enrich in the BACKGROUND.
    //
    // 1. BASIC mustRespond — same shape the synthesis returns, minus the AI ask/angle (the Home
    //    position-fallbacks the missing ones). Freshest-first, capped to the synthesis's own cap (25).
    // Reuse the AI ask/angle from the LAST-GOOD cache for items we already enriched, keyed by itemId —
    // so a reload/regenerate KEEPS the beautiful synthesized context line for known items. Only a
    // genuinely NEW item has no cached ask (the UI shows its snippet until the bg enrich fills it in).
    const cachedAsk = new Map((cached?.mustRespond?.items ?? []).map((i) => [i.itemId, { ask: i.ask, angle: i.angle }]));
    const basicMustItems: Reply[] = [...mustRespondRaw]
      .sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''))
      // High safety bound, not a functional gate — real replies must never be hidden by a cap.
      .slice(0, 100)
      .map((c) => {
        const prev = cachedAsk.get(c.itemId);
        return { who: c.from, ask: prev?.ask || '', angle: prev?.angle || '', itemId: c.itemId, subject: c.subject, snippet: c.snippet, receivedAt: c.receivedAt };
      });
    const basicMustRespond: MustRespond | null = basicMustItems.length ? { teaser: '', items: basicMustItems } : null;

    // 2. Assemble the basic brief: NEW must-respond (so new items appear now) + the last-good CACHED
    //    AI content for the other lanes (so they don't blank on a refresh). Falls back to null/empty
    //    when there's no cache. Commitment placements keep the cached verdicts (or {}) so the routing
    //    below degrades to the ingest-direction default — never breaks.
    mustRespond = basicMustRespond;
    // tldr / followups / keepAnEyeOn / droppedItemIds / commitmentPlacements already initialized
    // from `cached` above — leave them as-is (last-good, or null/[]/{}).
    // fyiDigest: seed the DETERMINISTIC fallback if the cache has none but groups exist (Bug A), so
    // "For your awareness" renders immediately on the basic brief and never depends on the AI pass.
    if ((!fyiDigest || !fyiDigest.groups?.length) && fyiTop.length) fyiDigest = buildDeterministicFyiDigest();

    // 3. Persist the basic brief IMMEDIATELY with the NEW sig. This is the anti-regen-storm guard:
    //    the very next request (poll / realtime refetch) is a cache-HIT on this basic brief and does
    //    NOT trigger a second synthesis while the background one is still running.
    await supabase.from('profiles').update({ home_brief: { text: briefLine, tldr, followups, fyiDigest, mustRespond, keepAnEyeOn, droppedItemIds, commitmentPlacements, generated_at: now.toISOString(), sig } }).eq('id', user.id).then(() => {}, () => {});

    // 4. Enrich in the BACKGROUND — same inputs as before — and persist the ENRICHED brief with the
    //    SAME sig (upgrades the cache in place: real ask/angle, ordering, supersession drops,
    //    placements). Non-fatal: any failure leaves the basic brief cached, which is still correct.
    const owedFacts = owedByIngest.map((c) => ({ description: c.description, overdue: c.overdue, dueToday: c.dueToday, dueDate: c.dueDate }));
    // PROTECTED members = must-respond candidates whose newest thread message is INBOUND
    // (lastFromUser === false), i.e. genuinely unanswered human replies the user still owes. These
    // can NEVER be dropped by the AI (no appear-then-vanish); only items where the user has the last
    // word (lastFromUser === true) remain droppable for closure. Missing from the map (no thread
    // reply-state) → treated as unanswered/protected, the safe default (don't silently drop).
    const protectedItemIds = new Set<string>(
      mustRespondRaw.filter((c) => lastFromUserByItem.get(c.itemId) !== true).map((c) => c.itemId),
    );
    after(async () => {
      try {
        const synth = await synthesizeBrief(getSystemClient('summarization'), {
          firstName, now, ctx: briefCtx, schedule,
          commitments: owedFacts,
          commitmentCandidates: commitmentCands,
          waitingOnCount: status.waitingOn, triaged: handled.triaged, filtered: handled.filtered,
          emailReplyCount: emailP,
          topPriorities: cappedPriorities.map((p) => ({ title: p.title, posture: p.posture, source: p.source, overdue: !!p.overdue })),
          mustRespond: mustRespondRaw,
          protectedItemIds,
          // Waiting candidates = the ingest-awaiting commitments — the synthesis writes the follow-up
          // prose (status + nextMove) over these. Final lane routing is by the placement verdict below;
          // a commitment re-placed to ball_in_court that wasn't here still appears via the raw fallback.
          waiting: commitmentCands.filter((c) => c.direction === 'awaiting').map((c) => ({ id: c.id, counterparty: c.counterparty || c.sourceLabel, description: c.description, ageDays: c.ageDays })),
          fyiGroups: fyiTop.map((g) => ({ label: g.label, count: g.count, kind: g.kind, subjects: g.subjects })),
          keepAnEyeOn: keepAnEyeOnRaw,
        });
        // Start from the basic brief we just persisted; upgrade each section the synthesis produced
        // (nulls only overwrite when we got something, same rule as before). This is the ENRICHED blob.
        let enrTldr = tldr, enrFollowups = followups, enrFyiDigest = fyiDigest;
        let enrMustRespond = mustRespond, enrKeepAnEyeOn = keepAnEyeOn, enrBriefLine = briefLine;
        let enrDropped = droppedItemIds, enrPlacements = commitmentPlacements;
        if (synth.tldr) { enrTldr = synth.tldr; enrBriefLine = synth.tldr.teaser || enrBriefLine; }
        if (synth.mustRespond !== null || !mustRespondRaw.length) enrMustRespond = synth.mustRespond;
        if (synth.keepAnEyeOn !== null || !keepAnEyeOnRaw.length) enrKeepAnEyeOn = synth.keepAnEyeOn;
        if (synth.followups !== null || !commitmentCands.some((c) => c.direction === 'awaiting')) enrFollowups = synth.followups;
        // FYI: the AI's nicer summary wins when present; otherwise, whenever groups exist, fall back to
        // the DETERMINISTIC digest so the section never goes empty while noted mail exists (Bug A). Only
        // a genuinely empty FYI pool (no groups) yields null.
        enrFyiDigest = synth.fyiDigest
          ? { ...synth.fyiDigest, tailGroups: fyiTailGroups, tailItems: fyiTailItems }
          : buildDeterministicFyiDigest();
        // Belt-and-suspenders: a protected (unanswered inbound) item can NEVER be in droppedItemIds,
        // so it can't be removed from the priority cards either — enriched membership ⊇ protected set.
        enrDropped = synth.droppedItemIds.filter((id) => !protectedItemIds.has(id));
        if (Object.keys(synth.commitmentPlacements).length) enrPlacements = synth.commitmentPlacements;
        // Persist the enriched brief under the SAME sig — upgrades the cache in place so the next
        // refetch is a cache-hit on the fully-synthesized version.
        await supabase.from('profiles').update({ home_brief: { text: enrBriefLine, tldr: enrTldr, followups: enrFollowups, fyiDigest: enrFyiDigest, mustRespond: enrMustRespond, keepAnEyeOn: enrKeepAnEyeOn, droppedItemIds: enrDropped, commitmentPlacements: enrPlacements, generated_at: now.toISOString(), sig } }).eq('id', user.id).then(() => {}, () => {});
      } catch { /* non-fatal — basic brief stays cached */ }
    });
  }

  // ── Route each open commitment by the synthesis's VERDICT (fallback = the ingest-direction default).
  // on_your_plate → "On your plate" (you owe, act) · ball_in_court → "Ball in your court" (waiting,
  // nudge) · informational → neither lane (awareness only). This is the real Bug #1/#3 fix: a REQUESTED
  // action the extractor mislabeled you_owe now lands in ball_in_court (or informational), never in the
  // action lane. General — driven by grounded judgment, no hardcoded senders/subjects.
  const placementOf = (c: (typeof commitmentCands)[number]): CommitmentPlacement =>
    commitmentPlacements[c.id] ?? defaultPlacement(c.direction);
  // Display dedup backstop (general): collapse near-identical descriptions within each lane so
  // existing bad rows can't double up even before the data-cleanup script runs. `counterparty` falls
  // back to the source-derived label (never a placeholder); UI omits the name when both are null.
  // NOTE: "On your plate" is NO LONGER hard-capped — it renders a few and expands (Show N more) in the
  // UI; we pass the full deduped set (bounded only by the 60-row commitments query upstream).
  const commitments = dedupByDescription(
    commitmentCands
      .filter((c) => placementOf(c) === 'on_your_plate')
      .map((c) => ({ id: c.id, description: c.description, counterparty: c.counterparty || c.sourceLabel, dueDate: c.dueDate, overdue: c.overdue, dueToday: c.dueToday })),
  )
    .sort((a, b) => {
      const rk = (x: typeof a) => (x.overdue ? 0 : x.dueToday ? 1 : x.dueDate ? 2 : 3);
      return rk(a) !== rk(b) ? rk(a) - rk(b) : (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });
  const waitingOn = dedupByDescription(
    commitmentCands
      .filter((c) => placementOf(c) === 'ball_in_court')
      .map((c) => ({ id: c.id, description: c.description, counterparty: c.counterparty || c.sourceLabel, ageDays: c.ageDays })),
  )
    .sort((a, b) => b.ageDays - a.ageDays);
  // Keep the status chip honest with the routed set.
  status.waitingOn = waitingOn.length;

  // Reconcile the synthesized follow-up prose with the ball_in_court routing so the "Ball in your
  // court" lane and the counts agree. Keep only follow-up items whose commitment is ball_in_court,
  // then append any ball_in_court commitment the prose didn't cover (with a plain status/nextMove) so
  // a re-placed you_owe→waiting item still surfaces with a nudge affordance. General, id-grounded.
  const ballIds = new Set(waitingOn.map((w) => w.id));
  {
    const covered = new Set<string>();
    const keptItems = (followups?.items ?? []).filter((f) => {
      if (!f.id || !ballIds.has(f.id)) return false;
      covered.add(f.id);
      return true;
    });
    const extras = waitingOn
      .filter((w) => !covered.has(w.id))
      // `who` = the counterparty or its source-derived label; NEVER a placeholder. Falls back to the
      // description when there's no name/source at all, so a row still reads as a real thing to nudge.
      .map((w) => ({ id: w.id, who: w.counterparty || w.description, status: `Waiting ${w.ageDays}d`, nextMove: 'Send a nudge' }));
    const allItems = [...keptItems, ...extras];
    followups = allItems.length
      ? { teaser: followups?.teaser || '', items: allItems, closing: followups?.closing ?? null }
      : null;
  }

  // Apply the synthesis's supersession/staleness verdict to the CARDS too, so the "Needs you" grid
  // can't contradict the prose (a reply the synthesis dropped as superseded shouldn't reappear as a
  // priority card). Deterministic: we only hide ids the model returned as dropped.
  if (droppedItemIds.length) {
    const dropped = new Set(droppedItemIds);
    for (let i = cappedPriorities.length - 1; i >= 0; i--) {
      if (cappedPriorities[i].itemId && dropped.has(cappedPriorities[i].itemId!)) cappedPriorities.splice(i, 1);
    }
    // Keep the "N replies needed" chip honest — a superseded reply is no longer a reply you owe.
    status.needsReply = Math.max(0, status.needsReply - droppedItemIds.length);
  }

  // Attach any prepared auto-draft (from the draft-sweep) to its must-respond item, so the Home can
  // show "Draft ready" + a pre-filled, editable, sendable reply. Done at response time so it reflects
  // the latest draft even when the brief prose is served from cache.
  const draftByItem = new Map<string, string>();
  for (const it of items) {
    const b = (it.source_data as { draft?: { body?: string } })?.draft?.body;
    if (b && it.id) draftByItem.set(it.id, b);
  }
  // Drop must-respond items whose inbox item is no longer pending (dismissed/completed since the
  // brief prose was cached) — so the list + count reflect actions on reload without a full regen.
  const pendingItemIds = new Set(items.map((it) => it.id));
  const mustRespondOut = mustRespond
    ? { ...mustRespond, items: mustRespond.items
        .filter((r) => !r.itemId || pendingItemIds.has(r.itemId))
        .map((r) => ({ ...r, draft: draftByItem.get(r.itemId) ?? null })) }
    : mustRespond;
  // "Keep an eye on" is awareness — no action buttons — but still drop items that are no longer
  // pending (dismissed elsewhere) so a stale cached tier can't show a gone item. Also enforce the
  // cross-tier dedup (Bug #2) HERE too, as a route-level backstop: even if the cache mixes a fresh
  // mustRespond with a stale keepAnEyeOn (or vice-versa), an itemId that surfaces as a must-respond
  // reply must never ALSO appear in keep-an-eye-on. Must-respond wins.
  const mustItemIds = new Set((mustRespondOut?.items ?? []).map((r) => r.itemId).filter(Boolean));
  const keepAnEyeOnOut = keepAnEyeOn
    ? { items: keepAnEyeOn.items.filter((k) => (!k.itemId || pendingItemIds.has(k.itemId) || awarenessRaw.has(k.itemId)) && !mustItemIds.has(k.itemId)) }
    : keepAnEyeOn;

  // ── "Day cleared" progress ring — the LIVE half. `cleared` = things the user handled TODAY.
  // Computed fresh here (NOT baked into the cached AI blob) via a cheap batch of head-count queries,
  // so new activity moves the ring on the very next load. `needYou` is the current count of things
  // still on the user's plate — the same live section data the dashboard already shows (must-respond
  // replies + non-meeting/needs-you priority cards + on-your-plate commitments). The client re-derives
  // `needYou` from its own live state and increments `cleared` as the user acts, so the ring rises
  // instantly without a reload. This route value is the fresh baseline on each load.
  const [inboxClearedRes, commitClearedRes, repliesSentRes] = await Promise.all([
    supabase.from('inbox_items').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).in('status', ['completed', 'dismissed']).gte('updated_at', startOfDay),
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).in('status', ['done', 'dismissed']).gte('updated_at', startOfDay),
    supabase.from('emails').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_from_user', true).gte('received_at', startOfDay),
  ]);
  const clearedToday = (inboxClearedRes.count ?? 0) + (commitClearedRes.count ?? 0) + (repliesSentRes.count ?? 0);
  // needYou baseline = live counts already computed above: replies you owe (mustRespondOut) +
  // non-meeting/needs-you priority cards + on-your-plate commitments still pending.
  const needYouReplies = (mustRespondOut?.items ?? []).length;
  // Meeting cards ARE shown in "What needs you" (a Review action + follow-ups), so each meeting CARD
  // counts as 1 unit of needYou — otherwise the ring reads "1 needs you" while 2 items show, and
  // handling the meeting never moves it. (One card per meeting, not per nested action item.) Cleared
  // already counts meeting follow-ups: they're inbox_items (source='meeting') and inboxClearedRes has
  // no source filter — so clearing them moves the cleared half. The two halves stay consistent.
  const needYouCards = cappedPriorities.filter((p) => p.posture !== 'needs_reply').length;
  const needYou = needYouReplies + needYouCards + commitments.length;
  const dayProgress = { cleared: clearedToday, needYou };

  return NextResponse.json({ firstName, briefLine, tldr, followups, fyiDigest, mustRespond: mustRespondOut, keepAnEyeOn: keepAnEyeOnOut, status, priorities: cappedPriorities, commitments, waitingOn, schedule, handled, dayProgress });
}
