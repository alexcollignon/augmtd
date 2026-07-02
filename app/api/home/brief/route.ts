import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSystemClient, aiCreate } from '@/lib/ai/factory';
import { buildAnsweredSet } from '@/lib/inbox/needs-reply';
import { classifyItem } from '@/lib/inbox/classify-item';
import { lastMeetingRecall } from '@/lib/context/voice-context';
import { parseModelJSON } from '@/lib/ai/parse-json';

export const maxDuration = 30;

// GET /api/home/brief — the day brief, LAYERED by topic (not a flat task list).
// A meeting with N action items is ONE card (items nested); commitments group under their
// source; emails are one card per thread. The Home stays a brief, not a backlog.

const DAY = 86_400_000;
const BRIEF_TTL = 3 * 60 * 60 * 1000;
const MAX_PRIORITIES = 6;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attendeeEmails(ev: any): string[] {
  return (ev?.attendees ?? []).map((a: any) => (a?.email || '').toLowerCase()).filter(Boolean);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const endOfDay = `${todayStr}T23:59:59Z`;
  const self = user.email?.toLowerCase();

  const since24 = new Date(now.getTime() - DAY).toISOString();
  const [itemsRes, commitsRes, meetingsRes, handledRes, profileRes, triagedRes, summarisedRes, trackedRes, filteredRes, fyiRes] = await Promise.all([
    supabase.from('inbox_items')
      .select('id, work_title, work_state, rule_type, type_override, source, source_id, source_meeting_transcript_id, source_data, created_at')
      .eq('user_id', user.id).eq('status', 'pending')
      // Action work_states (reply-via-email + external tasks + meeting action items) OR a rule that
      // classified it actionable (rule_type) — so a needs_reply the RULES found on a 'noted' email
      // still reaches the Home. classifyItem (which reads rule_type) makes the final call.
      .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
      .order('created_at', { ascending: false }).limit(60),
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
    supabase.from('inbox_items').select('work_title, source_data, rule_type')
      .eq('user_id', user.id).eq('status', 'pending').eq('work_state', 'noted')
      .order('created_at', { ascending: false }).limit(200),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (itemsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commits = (commitsRes.data ?? []) as any[];

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
  const emailCandidates = items
    .filter((it) => it.source !== 'meeting' && it.source !== 'commitment')
    .map((it) => ({ it, posture: classifyItem(it as never) }))
    .filter((x) => x.posture === 'needs_reply' || x.posture === 'to_do');
  // Drop reply threads you've already answered.
  const candThreadIds = [...new Set(emailCandidates.map((c) => c.it.source_data?.thread_id).filter(Boolean))] as string[];
  let answered = new Map<string, string>();
  if (candThreadIds.length) {
    const { data: sent } = await supabase.from('emails')
      .select('thread_id, received_at').eq('user_id', user.id).eq('is_from_user', true).in('thread_id', candThreadIds);
    answered = buildAnsweredSet(sent ?? []);
  }
  // Reconciliation (cross-source): people you already have a meeting with — recently held or upcoming.
  // A scheduling/confirmation email from one of them is SUPERSEDED by that meeting, so it shouldn't be
  // a "must respond" (fixes surfacing "confirm a meeting that already happened").
  const { data: calWide } = await supabase.from('calendar_events')
    .select('attendees')
    .eq('user_id', user.id).eq('status', 'confirmed')
    .gte('start_time', new Date(now.getTime() - 10 * DAY).toISOString())
    .lte('start_time', new Date(now.getTime() + 21 * DAY).toISOString())
    .limit(120);
  const meetingPeople = new Set<string>();
  for (const ev of (calWide ?? []) as Array<{ attendees?: Array<{ email?: string }> }>)
    for (const a of ev.attendees ?? []) { const e = (a?.email || '').toLowerCase(); if (e && e !== self) meetingPeople.add(e); }
  const SCHEDULING = /\b(meeting|schedul|avail|confirm|calendar|invite|slot|reschedul|works for you|time that works)\b/i;
  // needs_reply items (with content) feed the Must-respond brief; they stay in priorities for counts.
  const mustRespondRaw: Array<{ itemId: string; from: string; subject: string; snippet: string }> = [];
  for (const { it, posture } of emailCandidates) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const tid = sd.thread_id as string | undefined;
    const sentAt = tid ? answered.get(tid) : undefined;
    if (posture === 'needs_reply' && sentAt && sentAt > it.created_at) continue; // already replied
    // Superseded by a meeting — a scheduling/confirm email from someone you already meet with is moot.
    if (posture === 'needs_reply') {
      const fromRaw = String((sd.from as string) || (sd.from_address as string) || '').toLowerCase();
      const fromEmail = fromRaw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || fromRaw;
      if (meetingPeople.has(fromEmail) && SCHEDULING.test(`${(sd.subject as string) || ''} ${(sd.body as string) || ''}`)) continue;
    }
    priorities.push({
      id: `email:${it.id}`, source: 'email', posture: posture as Posture,
      title: it.work_title || (sd.subject as string) || 'Email',
      context: (sd.from_name as string) || (sd.from as string) || null,
      href: '/inbox', itemId: it.id,
    });
    if (posture === 'needs_reply') {
      mustRespondRaw.push({
        itemId: it.id,
        from: (sd.from_name as string) || (sd.from as string) || 'Someone',
        subject: it.work_title || (sd.subject as string) || '(no subject)',
        snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      });
    }
  }

  // ── On your plate: commitments you owe — their OWN section (not mixed into Needs you), so the
  // promises you've made are visible, with due dates. Overdue → due-today → dated → undated.
  const commitments = commits
    .filter((c) => c.direction === 'you_owe' && c.source !== 'meeting')
    .map((c) => ({
      id: c.id as string,
      description: c.description as string,
      counterparty: (c.counterparty as string | null) ?? null,
      dueDate: (c.due_date as string | null) ?? null,
      overdue: !!(c.due_date && c.due_date < todayStr),
      dueToday: !!(c.due_date && c.due_date === todayStr),
    }))
    .sort((a, b) => {
      const rk = (x: typeof a) => (x.overdue ? 0 : x.dueToday ? 1 : x.dueDate ? 2 : 3);
      return rk(a) !== rk(b) ? rk(a) - rk(b) : (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    })
    .slice(0, 5);

  // Overdue → reply → to-do → finished meetings last (a past meeting is context, not "do this now").
  const rank = (p: Priority) => (p.overdue ? 0 : p.source === 'meeting' ? 4 : p.posture === 'needs_reply' ? 1 : p.posture === 'to_do' ? 2 : 3);
  priorities.sort((a, b) => rank(a) - rank(b));
  const cappedPriorities = priorities.slice(0, MAX_PRIORITIES);

  // ── Waiting on others → feeds the Follow-ups brief. All awaiting, freshest-quiet first; the age
  // cue tells you which are urgent (a tomorrow-meeting confirm matters even at 0 days). ──
  const waitingOn = commits
    .filter((c) => c.direction === 'awaiting')
    .map((c) => ({ id: c.id, description: c.description, counterparty: c.counterparty, ageDays: Math.floor((now.getTime() - new Date(c.created_at).getTime()) / DAY) }))
    .sort((a, b) => b.ageDays - a.ageDays).slice(0, 6);

  // ── FYI-by-topic: group the awareness emails by sender; the AI digests each group below. ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fyiRows = (fyiRes.data ?? []) as Array<{ work_title: string | null; source_data: any }>;
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

  // ── Today's schedule + light prep on the next meeting ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meetings = (meetingsRes.data ?? []) as any[];
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
      nextPrep = {
        ...(le?.[0] ? { lastEmail: { subject: le[0].subject || '(no subject)' } } : {}),
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

  // ── Status chips (live, alive) ──
  const replyP = priorities.filter((p) => p.posture === 'needs_reply').length;
  const status = {
    needsReply: replyP,
    meetingsToday: schedule.length,
    waitingOn: commits.filter((c) => c.direction === 'awaiting').length,
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
  const commitP = commitments.length;
  const overdueC = commitments.filter((c) => c.overdue).length;
  const overdueP = cappedPriorities.filter((p) => p.overdue).length;
  const fyiSig = fyiTop.map((g) => `${g.label}:${g.count}`).join(',');
  // Freshness: the newest pending item's timestamp (items are ordered created_at desc) + the newest
  // commitment update. Folding these into the signature makes the brief regenerate the moment new
  // actionable mail lands — not just every 3h — so it feels live.
  const freshest = (items[0]?.created_at as string) ?? '';
  const commitFresh = commits.reduce((mx, c) => (c.updated_at && c.updated_at > mx ? c.updated_at : mx), '');
  // Include today's date so the brief re-contextualizes on a day change (ages/overdue shift daily),
  // not only on the 3h TTL — a true daily recheck.
  const sig = `${todayStr}|${emailP}|${meetingP}|${commitP}|${overdueP}|${overdueC}|${status.waitingOn}|${schedule.length}|${fyiSig}|${freshest}|${commitFresh}`;

  const fullName = (profileRes.data as { full_name?: string } | null)?.full_name ?? null;
  const firstName = fullName?.split(' ')[0] ?? null;

  // ── Daily TLDR brief (Phase 1) — a grounded day-summary: teaser + 3–4 bullets + a "don't miss"
  // callout. Cached on profiles.home_brief, busts when the day's shape (sig) changes. ──
  type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
  type FollowUp = { id?: string; who: string; status: string; nextMove: string };
  type Followups = { teaser: string; items: FollowUp[]; closing: string | null };
  type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
  type Reply = { who: string; ask: string; angle: string; itemId: string };
  type MustRespond = { teaser: string; items: Reply[] };
  const cached = (profileRes.data as { home_brief?: { text?: string; tldr?: Tldr; followups?: Followups | null; fyiDigest?: FyiDigest | null; mustRespond?: MustRespond | null; generated_at: string; sig?: string } } | null)?.home_brief ?? null;
  let tldr: Tldr | null = cached?.tldr ?? null;
  let followups: Followups | null = cached?.followups ?? null;
  let fyiDigest: FyiDigest | null = cached?.fyiDigest ?? null;
  let mustRespond: MustRespond | null = cached?.mustRespond ?? null;
  let briefLine = cached?.text ?? null;
  const stale = !cached || cached.sig !== sig || (now.getTime() - new Date(cached.generated_at).getTime()) > BRIEF_TTL;
  if (stale) {
    const { client, model } = getSystemClient('summarization');

    // The four briefs are independent → generate them IN PARALLEL (was sequential ≈ 16s; now ≈ the
    // slowest single call). Each closure assigns its own outer var; failures keep the cached value.
    await Promise.all([
    // Daily TLDR brief (phase 1).
    (async () => {
    try {
      const grounded = [
        `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
        schedule.length
          ? `Meetings today: ${schedule.map((s) => `${new Date(s.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${s.title}`).join('; ')}`
          : 'No meetings scheduled today',
        `Emails needing your reply: ${emailP}`,
        `Triaged in the last 24h: ${handled.triaged}${handled.filtered ? ` (${handled.filtered} were noise/marketing)` : ''}`,
        commitP
          ? `Commitments you owe: ${commitments.map((c) => `"${c.description}"${c.overdue ? ' [OVERDUE]' : c.dueToday ? ' [due today]' : c.dueDate ? ` [due ${c.dueDate}]` : ''}`).join('; ')}`
          : 'No commitments pending',
        status.waitingOn ? `Waiting on others: ${status.waitingOn}` : '',
        cappedPriorities.length
          ? `Top items needing you: ${cappedPriorities.map((p) => `"${p.title}"${p.overdue ? ' [overdue]' : ''} (${p.posture}, from ${p.source})`).join('; ')}`
          : '',
      ].filter(Boolean).join('\n');
      const res = await aiCreate(client, {
        model, max_tokens: 360, temperature: 0.4,
        messages: [{ role: 'user', content: `You are ${firstName || 'the user'}'s assistant writing a short TLDR of their day. Use ONLY these facts — be specific with the real numbers and names, and never invent anything.\n\nReturn JSON only:\n{"teaser": "one short sentence summarising the day", "bullets": ["3 to 4 short, scannable bullets — meetings, todos/commitments, emails; lead with what matters most"], "dontMiss": "the SINGLE most time-sensitive or critical thing not to miss today, phrased as a brief warning grounded in a real item — or null if nothing is genuinely critical"}\n\nFacts:\n${grounded}` }],
      });
      const parsed = parseModelJSON<Tldr>(res.choices?.[0]?.message?.content || '', { teaser: '', bullets: [], dontMiss: null });
      if ((Array.isArray(parsed.bullets) && parsed.bullets.length) || parsed.teaser) {
        tldr = { teaser: parsed.teaser || '', bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 4) : [], dontMiss: parsed.dontMiss || null };
        briefLine = tldr.teaser || briefLine;
      }
    } catch { /* keep cached */ }
    })(),
    // Must-respond brief (phase 2) — the replies you owe: what each sender is asking + a recommended
    // angle for the reply. Grounded in the email content.
    (async () => {
    if (mustRespondRaw.length) {
      try {
        const input = mustRespondRaw.map((m, i) => `[${i}] ${m.from} — "${m.subject}": ${m.snippet}`).join('\n');
        const res = await aiCreate(client, {
          model, max_tokens: 560, temperature: 0.4,
          messages: [{ role: 'user', content: `You are ${firstName || 'the user'}'s assistant. These emails are awaiting ${firstName || 'the user'}'s reply. For each, write what the sender is asking (one line) and a recommended angle for the reply (one line — the gist of what to say). Use ONLY the email content, never invent.\n\nReturn JSON only:\n{"teaser":"one short line","items":[{"i":<the [i] index from the input>,"who":"sender or topic","ask":"what they're asking","angle":"recommended reply gist"}]}\n\nEmails:\n${input}` }],
        });
        const p = parseModelJSON<{ teaser: string; items: { i: number; who: string; ask: string; angle: string }[] }>(res.choices?.[0]?.message?.content || '', { teaser: '', items: [] });
        const items = (Array.isArray(p.items) ? p.items : [])
          .map((x) => ({ who: x.who || '', ask: x.ask || '', angle: x.angle || '', itemId: mustRespondRaw[x.i]?.itemId || '' }))
          .filter((x) => x.who || x.ask);
        mustRespond = items.length ? { teaser: p.teaser || '', items: items.slice(0, 25) } : null;
      } catch { /* keep cached */ }
    } else {
      mustRespond = null;
    }
    })(),
    // Follow-ups brief (phase 2) — "ball in your court": a grounded roundup of the things you're
    // waiting on, each with a recommended Next move. Only when there's something to nudge.
    (async () => {
    if (waitingOn.length) {
      try {
        const threads = waitingOn.map((w, i) => `[${i}] ${w.counterparty || 'Someone'} — "${w.description}" — ${w.ageDays} day${w.ageDays === 1 ? '' : 's'} quiet`).join('\n');
        const res = await aiCreate(client, {
          model, max_tokens: 520, temperature: 0.5,
          messages: [{ role: 'user', content: `You are ${firstName || 'the user'}'s assistant. Below are threads where ${firstName || 'the user'} is waiting on a reply — the ball is now in their court to nudge. For each, write a short status (how long it's gone quiet, what's pending) and a recommended Next move (brief, specific, actionable). Use ONLY these facts, never invent details.\n\nReturn JSON only. Include the [index] of each thread as "i":\n{"teaser":"one short line introducing the roundup","items":[{"i":<the [index] number>,"who":"the person or topic","status":"short status line","nextMove":"the recommended next move"}],"closing":"a short offer to draft these — name the 1-2 you'd tackle first — or null"}\n\nThreads:\n${threads}` }],
        });
        const p = parseModelJSON<{ teaser: string; items: { i?: number; who: string; status: string; nextMove: string }[]; closing: string | null }>(res.choices?.[0]?.message?.content || '', { teaser: '', items: [], closing: null });
        followups = Array.isArray(p.items) && p.items.length
          ? { teaser: p.teaser || '', items: p.items.slice(0, 8).map((x) => ({ id: typeof x.i === 'number' ? waitingOn[x.i]?.id : undefined, who: x.who || '', status: x.status || '', nextMove: x.nextMove || '' })), closing: p.closing || null }
          : null;
      } catch { /* keep cached */ }
    } else {
      followups = null;
    }
    })(),
    // FYI-by-topic brief (phase 2) — one short digest line per sender group, turning the FYI pile
    // into a few thematic digests.
    (async () => {
    if (fyiTop.length) {
      try {
        const input = fyiTop.map((g, i) => `[${i}] ${g.label} (${g.count}): ${g.subjects.slice(0, 5).filter(Boolean).map((s) => `"${s}"`).join('; ')}`).join('\n');
        const res = await aiCreate(client, {
          model, max_tokens: 460, temperature: 0.4,
          messages: [{ role: 'user', content: `You are ${firstName || 'the user'}'s assistant digesting low-priority FYI emails (no reply needed), grouped by sender. For each group, write ONE short line summarising what these are about. Use ONLY these facts, never invent.\n\nReturn JSON only:\n{"groups":[{"i":<the [i] index>,"summary":"one-line digest of what these are about"}]}\n\nGroups:\n${input}` }],
        });
        const p = parseModelJSON<{ groups: { i: number; summary: string }[] }>(res.choices?.[0]?.message?.content || '', { groups: [] });
        const groups = (Array.isArray(p.groups) ? p.groups : [])
          .map((x) => (fyiTop[x.i] ? { label: fyiTop[x.i].label, summary: x.summary || '', kind: fyiTop[x.i].kind } : null))
          .filter((g): g is FyiDigest['groups'][number] => !!g && !!g.summary);
        fyiDigest = groups.length ? { groups, tailGroups: fyiTailGroups, tailItems: fyiTailItems } : null;
      } catch { /* keep cached */ }
    } else {
      fyiDigest = null;
    }
    })(),
    ]);

    await supabase.from('profiles').update({ home_brief: { text: briefLine, tldr, followups, fyiDigest, mustRespond, generated_at: now.toISOString(), sig } }).eq('id', user.id).then(() => {}, () => {});
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

  return NextResponse.json({ firstName, briefLine, tldr, followups, fyiDigest, mustRespond: mustRespondOut, status, priorities: cappedPriorities, commitments, waitingOn, schedule, handled });
}
