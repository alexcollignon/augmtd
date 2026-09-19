'use client';

import React, { useState } from 'react';
import { SegmentedControl } from '@/components/ui';
import { ThreadShell, AvatarStatus, type ThreadItem, type ThreadKind } from '@/components/thread';
import { AliveMark } from '@/components/home/alive-mark';

/**
 * The three fixtures mirror the frozen canvas (docs/design/threads/*.dc.html): a PROJECT thread
 * (Main), a coworker DM (CoworkerDM), and the HOME thread whose attention card mounts through the
 * pinned item's `node` slot — the proof that the deck's delivery form moves into the kit without
 * the kit knowing what a deck is. All content is generic fixture content, no real people.
 */

// ── the Home thread's attention card, mounted through the pinned slot ───────────────────────────
type Row = { id: string; who: string; ask: string; tone: 'overdue' | 'ready' | 'due'; note: string; cta: string };
const ATTENTION_ROWS: Row[] = [
  { id: 'r1', who: 'Jordan Reyes', ask: 'confirm Wednesday’s kickoff slot', tone: 'overdue', note: 'Overdue', cta: 'Open →' },
  { id: 'r2', who: 'Max', ask: 'Atlas onboarding plan, ready to send', tone: 'ready', note: 'ready', cta: 'Review & send →' },
  { id: 'r3', who: 'Pat Winters', ask: 'accelerator invitation, reply drafted', tone: 'due', note: 'due Sep 8', cta: 'Review & send →' },
];

function AttentionCard() {
  return (
    <div className="flex flex-col">
      {ATTENTION_ROWS.map((r, i) => (
        <div key={r.id} className={`flex items-center gap-2.5 py-2.5 ${i < ATTENTION_ROWS.length - 1 ? 'border-b border-neutral-200/55' : ''}`}>
          <span className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${r.tone === 'overdue' ? 'bg-red-500' : 'bg-indigo-500'}`} />
          <span className="min-w-0 flex-grow truncate text-[13px]">
            <span className="font-semibold text-neutral-900">{r.who}</span>
            <span className="text-neutral-500"> — {r.ask}</span>
          </span>
          <span className={`flex-shrink-0 text-[11px] ${r.tone === 'overdue' ? 'font-semibold uppercase tracking-[0.04em] text-red-500' : r.tone === 'ready' ? 'font-medium text-emerald-500' : 'text-neutral-500'}`}>
            {r.note}
          </span>
          <span className="flex-shrink-0 text-[13px] font-medium text-indigo-600">{r.cta}</span>
        </div>
      ))}
    </div>
  );
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
const noop = () => {};

const PROJECT_ITEMS: ThreadItem[] = [
  {
    type: 'pinned', id: 'brief', actorId: 'clara', actorName: 'Clara', actorRoleLabel: 'chief of staff',
    text: 'Jordan and Mia accepted Wednesday’s kickoff — the slot still needs your confirmation so the invitation can go out. The pricing brief is approved and with Jordan; nothing else here is waiting on you.',
    actions: [
      { label: 'Confirm Wednesday 11:00 →', onClick: noop, tone: 'primary' },
      { label: 'Propose another time', onClick: noop, tone: 'link' },
    ],
  },
  { type: 'event_line', id: 'h1', text: 'Since you were here — the pricing brief went out Tuesday · 2 low-stakes items settled quietly' },
  { type: 'actor_bubble', id: 'h2', actorId: 'max', actorName: 'Max', ts: 'Tue 16:20', text: 'Pricing brief is with Jordan. I’ll flag the moment they come back.' },
  {
    type: 'actor_bubble', id: 'c1', actorId: 'clara', actorName: 'Clara', ts: '09:40',
    text: 'Both sides accepted. I drafted the confirmation to Jordan and Mia — it only goes out when you say.',
    cards: [{ kind: 'deliverable', id: 'd1', icon: 'mail', title: 'Confirmation — Wednesday 11:00', meta: 'Reply to Jordan, Mia · ready to review', onOpen: noop }],
  },
  {
    // THE CARD CONTRACT's first interactive kind — filled, editable, one commit, with the grounded
    // alternatives in the IN-CARD SELECTOR (docs/design/threads/InviteCard.dc.html).
    type: 'actor_bubble', id: 'i1', actorId: 'clara', actorName: 'Clara', ts: '09:41',
    text: 'They offered two slots — Tuesday’s filled in below, Wednesday is one tap away. Your calendar is clear for both.',
    cards: [{
      kind: 'invite', id: 'inv1', state: 'ready',
      title: 'Atlas × AUGMTD — kickoff',
      dateLabel: { month: 'Sep', day: '9' },
      whenLabel: 'Tuesday, Sep 9 · 11:00–11:30',
      attendees: [{ name: 'Jordan Vance' }, { name: 'Mia Ruiz' }],
      description: 'Kickoff for the pilot — capture layer demo, the first workflow, next steps.',
      options: [
        { id: 'a', label: 'Tuesday, Sep 9 · 11:00', annotation: 'filled in above' },
        { id: 'b', label: 'Wednesday, Sep 10 · 11:00', annotation: 'their other slot' },
        { id: 'open', label: 'Suggest another time…', open: true },
      ],
      selectedOptionId: 'a', onPickOption: noop, onEdit: noop, onSend: noop, receipt: 'ready',
    }],
  },
  {
    type: 'actor_bubble', id: 'm1', actorId: 'max', actorName: 'Max', ts: '11:12', status: 'needs_you',
    text: 'The onboarding plan is ready — ten seats, phased over six weeks. Approve and I’ll send it to Jordan from your address.',
    cards: [{
      kind: 'approval', id: 'a1', title: 'Atlas onboarding plan — v2',
      preview: 'Week 1–2: capture layer live on ten seats. Week 3–4: first workflow automated with your team. Week 5–6: review, pricing…',
      approveLabel: 'Approve & send', onApprove: noop, openLabel: 'Open', onOpen: noop, onReject: noop,
    }],
  },
  { type: 'user_bubble', id: 'u1', text: 'Looks good — have the ops pair join from day one.' },
  {
    type: 'actor_bubble', id: 'm2', actorId: 'max', actorName: 'Max', ts: '11:14',
    text: 'Noted — I’ll fold them into week one.',
  },
  {
    type: 'working_line', id: 'l1', actorId: 'luca', actorName: 'Luca',
    line: 'Luca is researching Atlas’ current stack — a few minutes',
  },
];

const DM_ITEMS: ThreadItem[] = [
  { type: 'divider', id: 'd-thu', variant: 'day', label: 'Thursday' },
  {
    type: 'actor_bubble', id: 'dm1', actorId: 'max', actorName: 'Max', ts: 'Thu 08:00 · weekly workflow',
    text: 'Competitor digest for the week — three moves worth your minute; the rest is quiet.',
    cards: [{ kind: 'routine', id: 'r1', title: 'Competitor digest — Sep 4', meta: 'Document · 3 highlights', onOpen: noop }],
  },
  {
    // THE REVIEW-FIRST DOC CARD (attention-plan D): the HANDLE — glyph · title · the known facts ·
    // one deed. The document is never in the thread; Review raises the panel.
    type: 'actor_bubble', id: 'dm1b', actorId: 'max', actorName: 'Max', ts: 'Thu 08:04',
    cards: [{
      kind: 'doc', id: 'doc1', title: 'Harbor pricing review', docType: 'word',
      typeLabel: 'Word', pages: 12, versionLabel: 'v3', owner: 'Max',
      intro: 'Third pass — the two numbers you flagged are corrected and the appendix is new.',
      onReview: noop,
    }],
  },
  { type: 'divider', id: 'd-today', variant: 'day', label: 'Today' },
  { type: 'user_bubble', id: 'dmu1', text: 'where did we land on Atlas pricing? and can you do the same exercise for Harbor?' },
  {
    type: 'actor_bubble', id: 'dm2', actorId: 'max', actorName: 'Max', ts: '10:20',
    text: 'From the Atlas Pilot room: the brief went to Jordan on Tuesday — €500 for six months, ten seats, early-graduation clause at month three. No counter yet.',
    // THE ONE OBJECT CARD (THE OPENING CONTRACT, clause 1): what the answer is ABOUT, shown with
    // it. In the product the host reads the thread door once and hands these facts over; here they
    // are fixture words, because the kit renders what it is handed and invents nothing.
    cards: [{
      kind: 'source', id: 'src1', source: 'email',
      who: 'Jordan Wills', when: 'Sep 16', title: 'Re: pilot terms',
      messages: [{
        id: 'm1', author: 'Jordan Wills',
        body: 'Thanks — taking this to the board on Thursday. Two things I need first: the early-graduation wording, and whether the platform fee is waived for the whole pilot…',
      }],
      files: [{ name: 'pilot-terms.pdf', size: 184_320, onOpen: noop }],
      openLabel: 'Thread →', onOpen: noop,
    }],
  },
  {
    type: 'actor_bubble', id: 'dm3', actorId: 'max', actorName: 'Max',
    text: 'For Harbor I’ll build the same structure against their seat count. Give me twenty minutes — I’ll post it in the Harbor Renewal room and flag you here.',
  },
  { type: 'event_line', id: 'dme1', text: 'Max is working in Harbor Renewal — you’ll hear from him here when it lands' },
];

const HOME_ITEMS: ThreadItem[] = [
  {
    type: 'pinned', id: 'attention', actorId: 'clara', actorName: 'Clara', actorRoleLabel: 'chief of staff',
    node: <AttentionCard />,
    actions: [{ label: 'When you can · 6 →', onClick: noop, tone: 'link' }],
  },
  { type: 'divider', id: 'hm-morning', variant: 'day', label: 'This morning' },
  {
    type: 'actor_bubble', id: 'hm1', actorId: 'max', actorName: 'Max', ts: '08:00 · weekly workflow',
    text: 'Your Monday tender briefing is ready — 14 in-window notices, two above your value floor.',
    cards: [{ kind: 'routine', id: 'hr1', title: 'Weekly tender briefing — Sep 5', meta: 'Document · 14 notices', onOpen: noop }],
  },
  {
    type: 'actor_bubble', id: 'hm2', actorId: 'max', actorName: 'Max', ts: '08:04',
    cards: [{
      kind: 'frame', id: 'hf1', title: 'Pipeline review — live',
      meta: 'interactive · updates on every run · ✓ computed in code',
      preview: (
        <div className="flex h-full items-end gap-2.5 px-5 pb-0 pt-4">
          {[34, 56, 44, 72, 62].map((h, i) => (
            <span key={i} className="w-9 rounded-t-[3px]" style={{ height: h, background: ['#c7d2fe', '#a5b4fc', '#c7d2fe', '#4f46e5', '#a5b4fc'][i] }} />
          ))}
        </div>
      ),
      onOpen: noop,
    }],
  },
  { type: 'user_bubble', id: 'hu1', text: 'what’s slipping this week?' },
  {
    type: 'actor_bubble', id: 'hc1', actorId: 'clara', actorName: 'Clara', ts: 'just now',
    text: 'Two things. The Atlas kickoff slot — Jordan’s been waiting since Tuesday, and the calendar hold expires tomorrow. And the collection notice — it needs the account reference only you have. Everything else is on pace.',
    cards: [{
      kind: 'input', id: 'hi1',
      ask: 'I need the account reference for the collection reply — it isn’t anywhere I can see. Attach it, paste it, or point me to the file.',
      onAttach: noop, onPaste: noop, onPickFile: noop, onProceed: noop,
    }],
  },
  {
    type: 'actor_bubble', id: 'hc2', actorId: 'clara', actorName: 'Clara',
    cards: [{
      kind: 'proposal', id: 'hp1', title: 'New workflow — Weekly Atlas status note',
      detail: 'Every Friday 16:00 · Max drafts it from the Atlas room · lands here for your approval before anything is sent.',
      onConfirm: noop, onDismiss: noop,
    }],
  },
];

const FACES = [
  { id: 'jordan', name: 'Jordan' }, { id: 'mia', name: 'Mia' },
  { id: 'clara', name: 'Clara' }, { id: 'max', name: 'Max', status: 'working' as const },
];

/** THE MARKS ROW — the two renderers side by side, at the seat size and at the loading energy, so
 *  the call between them is made by looking rather than by describing. This harness is the ONLY
 *  place both are mounted; the product mounts exactly one, through the entrance's seat. */
function MarksRow() {
  return (
    <span className="flex items-center gap-5">
      {([
        { v: 'v4' as const, label: 'v4 · alive' },
        { v: 'v3' as const, label: 'v3 · disco' },
      ]).map(({ v, label }) => (
        <span key={v} className="flex items-center gap-2">
          <AliveMark size={44} variant={v} />
          <AliveMark size={44} variant={v} loading />
          <span className="text-[11px] leading-tight text-neutral-400">
            {label}
            <br />
            <span className="text-neutral-300">rest · loading</span>
          </span>
        </span>
      ))}
    </span>
  );
}

export function ThreadPreview() {
  const [tab, setTab] = useState<ThreadKind>('project');

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b border-neutral-200/80 bg-white px-6 py-3">
        <div className="text-[13px] font-semibold text-neutral-900">Thread kit preview</div>
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as ThreadKind)}
          items={[
            { value: 'project', label: 'Project' },
            { value: 'dm', label: 'Coworker DM' },
            { value: 'home', label: 'Home' },
          ]}
        />
        <span className="flex-grow" />
        <MarksRow />
        <span className="flex items-center gap-3">
          {(['idle', 'working', 'needs_you', 'blocked'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <AvatarStatus name={s === 'idle' ? 'Clara' : s === 'working' ? 'Max' : 'Luca'} actorId={s} size={28} status={s} count={1} hint={`${s} state`} />
              <span className="text-[11px] text-neutral-400">{s}</span>
            </span>
          ))}
        </span>
      </div>

      {tab === 'project' && (
        <ThreadShell
          className="h-[calc(100dvh-120px)] min-h-[480px]"
          kind="project"
          header={{ title: 'Atlas Pilot', state: 'active', stateLabel: 'Active', faces: FACES }}
          items={PROJECT_ITEMS}
        />
      )}
      {tab === 'dm' && (
        <ThreadShell
          className="h-[calc(100dvh-120px)] min-h-[480px]"
          kind="dm"
          header={{ title: 'Max', leadFace: { id: 'max', name: 'Max' }, subtitle: 'Research & briefings · 2 workflows running' }}
          items={DM_ITEMS}
          composer={{ placeholder: 'Message Max…' }}
        />
      )}
      {tab === 'home' && (
        <ThreadShell
          className="h-[calc(100dvh-120px)] min-h-[480px]"
          kind="home"
          header={{ title: 'Saturday, September 5' }}
          items={HOME_ITEMS}
          composer={{ chips: [{ label: 'Plan my week' }, { label: 'What did I miss?' }, { label: 'Add a task' }] }}
        />
      )}
    </div>
  );
}
