'use client';

import React, { useState } from 'react';
import { SegmentedControl } from '@/components/ui';
import { ThreadShell, ThreadCardView, AvatarStatus, type ThreadCard, type ThreadItem, type ThreadKind } from '@/components/thread';
// W3-A (Sep 22 — docs/component-map.md §2a): THE PREVIEW STOPS PROMISING MORE THAN THE PRODUCT.
// `approval` and `input` were preview-only kinds while eight hand-drawn copies did the real work.
// The Gates tab below mounts THE PRODUCT'S OWN HOSTS — the very components the room, the deep-dive
// and the Home band mount — so a state seen here is a state that exists.
import ApprovalCard from '@/components/home/approval-card';
import InputCard from '@/components/home/input-card';
// THE CATALOGUE (owner, Sep 22: "update the dev/threads with all components we have") — the INDEX
// beside the five walks: one section per kind of THREAD_CARD_KINDS, every state of each, plus the
// pieces that are not cards. It lives in its own file because a scenario walk and an exhaustive
// index are two different documents, and the harness should stay readable as both.
import { ThreadCatalogue } from './preview-catalogue';

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

/**
 * THE COLLECTION CARD's fixtures (component-map §6, Wave 1) — one calm line per object: name ·
 * status chip · one meta line · a door · at most two verbs. In the product the HOST derives every
 * verb from the object's STATE and points it at the door that object already owns; here they are
 * no-ops, because the kit renders what it is handed and invents nothing.
 *
 * The two-step is LOCAL to the row (click "Run now" to see it swap in place for "Run it · Cancel")
 * — there is no pre-armed fixture, because arming is chrome, not state a host carries.
 */
const WORKFLOWS_COLLECTION: ThreadCard = {
  kind: 'collection', id: 'coll-wf',
  rows: [
    {
      id: 'w1', title: 'Weekly tender briefing', status: { word: 'active', tone: 'active' },
      meta: 'Max · every Monday 08:00 · ran 5d ago', face: { id: 'max', name: 'Max' }, onOpen: noop,
      verbs: [
        { id: 'pause', label: 'Pause', tone: 'quiet', onClick: noop },
        { id: 'run', label: 'Run now', confirm: { label: 'Run it' }, onClick: noop },
      ],
    },
    {
      id: 'w2', title: 'CV triage — ops opening', status: { word: 'active', tone: 'active' },
      meta: 'Clara · when an application arrives · asks for the CV',
      face: { id: 'clara', name: 'Clara' }, onOpen: noop,
      // ASKS FOR MATERIAL ⇒ the deed is a DOOR, never a blind run from a row.
      verbs: [
        { id: 'pause', label: 'Pause', tone: 'quiet', onClick: noop },
        { id: 'run', label: 'Open to run →', onClick: noop },
      ],
    },
    {
      // A SETTLED DEED: the chip already moved, so the row keeps only the way BACK (no word twice).
      id: 'w3', title: 'Competitor digest', status: { word: 'paused', tone: 'paused' },
      meta: 'Max · every Thursday 08:00', face: { id: 'max', name: 'Max' }, onOpen: noop,
      verbs: [{ id: 'undo', label: 'undo', tone: 'quiet', onClick: noop }],
    },
    {
      // …and a RUN has no chip of its own, so THERE the receipt is the word, and the row keeps no
      // button that would start it twice.
      id: 'w6', title: 'Client radar', status: { word: 'active', tone: 'active' },
      meta: 'Max · every Monday 07:00', face: { id: 'max', name: 'Max' }, onOpen: noop,
      receipt: 'running',
    },
    {
      // A DRAFT HAS NO STATUS VERB — nothing runs, so nothing pauses.
      id: 'w4', title: 'Monthly board note', status: { word: 'draft', tone: 'draft' },
      meta: 'never run', onOpen: noop,
    },
    {
      // NO LYING DOORS: a verb with no handler is the word it is, and an honest failure gets one
      // quiet line under its row.
      id: 'w5', title: 'Invoice chaser', status: { word: 'active', tone: 'active' },
      meta: 'Clara · every weekday 17:00', onOpen: noop,
      verbs: [{ id: 'pause', label: 'Pause', tone: 'quiet' }],
      error: 'That could not be changed — try again.',
    },
    {
      // The seventh row proves THE FOLD — past COLLECTION_INLINE_ROWS the tail sits behind the ONE
      // expander idiom every other list in the app uses. Nothing hidden, just folded.
      id: 'w7', title: 'Quarterly renewals sweep', status: { word: 'paused', tone: 'paused' },
      meta: 'Clara · every quarter', face: { id: 'clara', name: 'Clara' }, onOpen: noop,
      verbs: [{ id: 'resume', label: 'Resume', tone: 'quiet', onClick: noop }],
    },
  ],
};

const CALENDAR_COLLECTION: ThreadCard = {
  kind: 'collection', id: 'coll-cal',
  // READ-ONLY BY DESIGN in this wave: RSVP · reschedule · cancel arrive WITH their registry rows.
  rows: [
    { id: 'e0', title: 'Company offsite', status: { word: 'all day', tone: 'neutral' }, meta: 'Thursday' },
    { id: 'e1', title: 'Pipeline review', meta: '09:30 – 10:00 · 3 people', onOpen: noop },
    { id: 'e2', title: 'Free', status: { word: 'free', tone: 'done' }, meta: '10:00 – 12:30' },
    { id: 'e3', title: 'Atlas kickoff', meta: '14:00 – 14:30 · Jordan, Mia', onOpen: noop },
  ],
};

const EMPTY_COLLECTION: ThreadCard = {
  kind: 'collection', id: 'coll-empty', rows: [], emptyLine: 'No workflows yet.',
};

/** THE CITATIONS ARE A DOCUMENTS COLLECTION (Sep 22) — the files a coworker's answer was grounded
 *  in arrive as the SAME card every other set of the user's own objects arrives as. What marks them
 *  as citations is the rows' own status word, `cited`: the product's `documentRows` builds these
 *  from `search_knowledge_base`'s own groups, so every row here IS a source of the answer above. */
const DOCUMENTS_COLLECTION: ThreadCard = {
  kind: 'collection', id: 'coll-docs',
  rows: [
    { id: 'f1', title: 'Harbor pricing review.docx', status: { word: 'cited', tone: 'neutral' }, meta: 'Word · 12 pages · Sep 16', onOpen: noop, verbs: [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: noop }] },
    { id: 'f2', title: 'Atlas pilot terms.pdf', status: { word: 'cited', tone: 'neutral' }, meta: 'PDF · 4 pages · Sep 12', onOpen: noop, verbs: [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: noop }] },
    { id: 'f3', title: 'Seat pricing model.xlsx', status: { word: 'cited', tone: 'neutral' }, meta: 'Spreadsheet · Sep 2', onOpen: noop, verbs: [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: noop }] },
  ],
  // A CAP IS NEVER SILENT.
  more: { count: 12, onOpen: noop },
};

const RECORDINGS_COLLECTION: ThreadCard = {
  kind: 'collection', id: 'coll-rec',
  rows: [
    { id: 'm1', title: 'Atlas kickoff', status: { word: 'ready', tone: 'done' }, meta: 'Tue · 32 min · 4 action items', onOpen: noop, verbs: [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: noop }] },
    { id: 'm2', title: 'Ops weekly', status: { word: 'ready', tone: 'done' }, meta: 'Mon · 24 min', onOpen: noop, verbs: [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: noop }] },
    { id: 'm3', title: 'Harbor renewal call', status: { word: 'transcribing', tone: 'attention' }, meta: 'today · 41 min', onOpen: noop },
  ],
};

/**
 * THE EVENT CARD's fixtures (component-map §6, Wave 2) — ONE calendar event with the verbs its own
 * state PERMITS. In the product the ladder (lib/present/event.ts `validEventVerbs`) computes that
 * set from the user's seat, their current response and the clock, and the host words it from
 * `EVENT_VERB_WORDS`; here the verbs are fixture words, because the kit derives nothing and the
 * whole point of the gate is that it cannot.
 *
 * Every state the card can be in has a seat below: the three invitee sets, the organizer's pair,
 * a proposal-armed refusal with its note, a proposal-armed move with its new window, a spent deed,
 * a past event, a read-only calendar. Arming an unproposed verb is LOCAL chrome — click "Decline"
 * on the first fixture to see the two-step in place.
 */
const eventVerb = (
  id: string, label: string, armedLabel: string,
  extra: Partial<{ consequence: string; notable: boolean; needsWindow: boolean }> = {},
) => ({ id, label, armedLabel, onConfirm: noop, ...extra });

const EVENT_INVITEE_NO_REPLY: ThreadCard = {
  kind: 'event', id: 'ev-1',
  title: 'Atlas × Northwind — kickoff',
  dayLabel: 'Tue 23 Sep', timeLabel: '14:00–15:00',
  attendeesLine: 'with Sam Ortega, Jordan Vance +2',
  location: 'Meeting room 2',
  standing: 'no reply yet',
  verbs: [
    eventVerb('accept', 'Accept', 'Confirm accept'),
    eventVerb('tentative', 'Maybe', 'Confirm maybe'),
    eventVerb('decline', 'Decline', 'Confirm decline', { notable: true }),
  ],
};

const EVENT_INVITEE_ACCEPTED: ThreadCard = {
  kind: 'event', id: 'ev-2',
  title: 'Weekly ops sync',
  dayLabel: 'Wed 24 Sep', timeLabel: '09:30–10:00',
  attendeesLine: 'with Mia Ruiz, Pat Winters',
  standing: 'accepted',
  // THE LADDER DROPS THE ANSWER ALREADY GIVEN — there is no "Accept" on a meeting you accepted.
  verbs: [
    eventVerb('tentative', 'Maybe', 'Confirm maybe'),
    eventVerb('decline', 'Decline', 'Confirm decline', { notable: true }),
  ],
};

const EVENT_ORGANIZER: ThreadCard = {
  kind: 'event', id: 'ev-3',
  title: 'Pricing review',
  dayLabel: 'Thu 25 Sep', timeLabel: '11:00–11:45',
  attendeesLine: 'with Sam Ortega, Mia Ruiz, Jordan Vance +4',
  standing: 'you organise',
  // BOTH OF THESE NOTIFY EVERYONE AND CANNOT BE TAKEN BACK — so both carry their consequence,
  // and the reschedule's armed step raises the in-card picker (no proposed window here).
  verbs: [
    eventVerb('reschedule', 'Reschedule', 'Confirm new time', { needsWindow: true, consequence: 'Everyone invited gets the update.' }),
    eventVerb('cancel', 'Cancel', 'Confirm cancel', { notable: true, consequence: 'Everyone invited gets the cancellation.' }),
  ],
  pickerDefaults: { date: '2026-09-25', time: '11:00', durationMin: 45 },
};

const EVENT_ARMED_DECLINE: ThreadCard = {
  ...(EVENT_INVITEE_NO_REPLY as Extract<ThreadCard, { kind: 'event' }>),
  id: 'ev-4',
  title: 'Vendor intro call',
  dayLabel: 'Tue 23 Sep', timeLabel: '16:00–16:30',
  attendeesLine: 'with Rowan Patel',
  location: null,
  // THE MODEL SELECTED, THE CARD ARMED — and nothing has been sent. The note it drafted is the
  // user's to edit, right here, while the deed can still be stopped.
  armedVerbId: 'decline',
  note: 'Sorry — I’m double-booked. Happy to take this next week.',
};

const EVENT_ARMED_RESCHEDULE: ThreadCard = {
  ...(EVENT_ORGANIZER as Extract<ThreadCard, { kind: 'event' }>),
  id: 'ev-5',
  title: 'Harbor renewal — working session',
  dayLabel: 'Wed 24 Sep', timeLabel: '10:00–10:30',
  attendeesLine: 'with Sam Ortega, Mia Ruiz',
  // A PROPOSED window stands BESIDE its confirmation, composed by code — so the picker stands down.
  armedVerbId: 'reschedule',
  proposedLabel: 'Thu 25 Sep · 10:00–10:30',
};

const EVENT_DONE: ThreadCard = {
  kind: 'event', id: 'ev-6',
  title: 'Vendor intro call',
  dayLabel: 'Tue 23 Sep', timeLabel: '16:00–16:30',
  attendeesLine: 'with Rowan Patel',
  standing: 'declined',
  // A SPENT DEED KEEPS NO BUTTON — the word stands where the verbs stood.
  done: 'Declined',
};

const EVENT_MOVED: ThreadCard = {
  kind: 'event', id: 'ev-7',
  title: 'Harbor renewal — working session',
  dayLabel: 'Thu 25 Sep', timeLabel: '10:00–10:30',
  attendeesLine: 'with Sam Ortega, Mia Ruiz',
  standing: 'you organise',
  done: 'Moved to Thu 25 Sep · 10:00–10:30',
};

const EVENT_PAST: ThreadCard = {
  kind: 'event', id: 'ev-8',
  title: 'Board prep',
  dayLabel: 'Mon 15 Sep', timeLabel: '08:30–09:00',
  attendeesLine: 'with Mia Ruiz',
  standing: 'accepted',
  // THE LADDER PERMITS NOTHING — and the card says why rather than greying a button.
  verbs: [],
  quietLine: 'This one’s in the past.',
};

const EVENT_READ_ONLY: ThreadCard = {
  kind: 'event', id: 'ev-9',
  title: 'Company offsite',
  dayLabel: 'Fri 26 Sep', timeLabel: 'all day',
  attendeesLine: 'with the whole team',
  verbs: [],
  quietLine: 'Read-only calendar.',
};

const EVENT_FAILED: ThreadCard = {
  kind: 'event', id: 'ev-10',
  title: 'Pipeline review',
  dayLabel: 'Wed 24 Sep', timeLabel: '15:00–15:30',
  attendeesLine: 'with Jordan Vance',
  standing: 'no reply yet',
  verbs: [
    eventVerb('accept', 'Accept', 'Confirm accept'),
    eventVerb('decline', 'Decline', 'Confirm decline', { notable: true }),
  ],
  // AN HONEST FAILURE GETS ONE QUIET LINE — never a toast the thread cannot keep.
  error: 'That’s no longer possible — this event has changed since the card was drawn.',
};

const EVENT_ITEMS: ThreadItem[] = [
  { type: 'user_bubble', id: 'evu1', text: 'what’s the kickoff on Tuesday?' },
  {
    type: 'actor_bubble', id: 'eva1', actorId: 'clara', actorName: 'Clara', actorRoleLabel: 'chief of staff', ts: '09:12',
    text: 'Tuesday at 14:00, an hour, in meeting room 2 — you haven’t answered it yet.',
    cards: [EVENT_INVITEE_NO_REPLY],
  },
  {
    type: 'actor_bubble', id: 'eva2', actorId: 'clara', actorName: 'Clara', ts: '09:12',
    text: 'The ops sync you already accepted is the one after it.',
    cards: [EVENT_INVITEE_ACCEPTED],
  },
  { type: 'user_bubble', id: 'evu2', text: 'and the pricing review — I might need to move it' },
  {
    type: 'actor_bubble', id: 'eva3', actorId: 'clara', actorName: 'Clara', ts: '09:13',
    text: 'You organise that one, so both doors are open to you.',
    cards: [EVENT_ORGANIZER],
  },
  { type: 'user_bubble', id: 'evu3', text: 'decline the vendor intro, politely' },
  {
    type: 'actor_bubble', id: 'eva4', actorId: 'clara', actorName: 'Clara', ts: '09:14',
    text: 'Ready — the decline is written and armed. Nothing goes out until you confirm.',
    cards: [EVENT_ARMED_DECLINE],
  },
  { type: 'user_bubble', id: 'evu4', text: 'move the harbor session to Thursday morning' },
  {
    type: 'actor_bubble', id: 'eva5', actorId: 'clara', actorName: 'Clara', ts: '09:15',
    text: 'Thursday 10:00 is clear on your calendar — the others get the update when you confirm.',
    cards: [EVENT_ARMED_RESCHEDULE],
  },
  {
    type: 'actor_bubble', id: 'eva6', actorId: 'clara', actorName: 'Clara', ts: '09:16',
    cards: [EVENT_DONE, EVENT_MOVED],
  },
  {
    type: 'actor_bubble', id: 'eva7', actorId: 'clara', actorName: 'Clara', ts: '09:17',
    text: 'These two I can only show you.',
    cards: [EVENT_PAST, EVENT_READ_ONLY],
  },
  {
    type: 'actor_bubble', id: 'eva8', actorId: 'clara', actorName: 'Clara', ts: '09:18',
    cards: [EVENT_FAILED],
  },
];

/**
 * THE DECISION CARD's fixtures (W3-C — component-map §2 item 7). Every state the card can be in:
 * the live question WITH its object (the only state that may mark a recommendation), the same
 * question with NOTHING to review (nothing marked — the structural rule), the armed second step,
 * the click in flight, the settled receipt, and an honest failure. In the product the HOST owns the
 * steer door and computes what may be recommended; here they are no-ops.
 */
const DECISION_OBJECT_NODE = (
  <ThreadCardView card={{
    kind: 'source', id: 'dec-obj', source: 'document', who: 'Max',
    title: 'Atlas shortlist — 4 of 11 advanced',
    excerpt: 'Four candidates clear the rubric on every criterion; the two borderline files are noted with the gap that held them back…',
    onOpen: noop, openLabel: 'Review →',
  }} />
);

const DECISION_OPEN: ThreadCard = {
  kind: 'decision', id: 'dec-open',
  question: 'Jordan needs an answer on the shortlist before Thursday’s board.',
  objectNode: DECISION_OBJECT_NODE,
  options: [
    { id: 'o1', label: 'Advance all four to interviews', recommended: true, consequence: 'Interviews start next week; the two borderline files stay on file.', why: 'All four clear the rubric on every criterion, and the slot count matches the hiring plan you approved.' },
    { id: 'o2', label: 'Advance two, ask for more on the rest', consequence: 'Adds about a week before interviews can start.' },
    { id: 'o3', label: 'Send it back for a wider search', consequence: 'Resets the timeline; the board sees nothing on Thursday.' },
  ],
  confirmLabel: 'Go with this', onConfirm: noop, onDismiss: noop,
};

const DECISION_NO_OBJECT: ThreadCard = {
  ...(DECISION_OPEN as Extract<ThreadCard, { kind: 'decision' }>),
  id: 'dec-no-object',
  // NOTHING ON THE PAGE ⇒ NOTHING RECOMMENDED — no marked route, no chip. W17: and no filler line —
  // the card is its options alone.
  objectNode: undefined,
  options: (DECISION_OPEN as Extract<ThreadCard, { kind: 'decision' }>).options
    .map((o) => ({ id: o.id, label: o.label, ...(o.consequence ? { consequence: o.consequence } : {}) })),
};

const DECISION_ARMED: ThreadCard = {
  ...(DECISION_OPEN as Extract<ThreadCard, { kind: 'decision' }>),
  id: 'dec-armed', armedOptionId: 'o1',
};

const DECISION_BUSY: ThreadCard = {
  ...(DECISION_OPEN as Extract<ThreadCard, { kind: 'decision' }>),
  id: 'dec-busy', state: 'busy',
};

const DECISION_SETTLED: ThreadCard = {
  ...(DECISION_OPEN as Extract<ThreadCard, { kind: 'decision' }>),
  id: 'dec-settled', state: 'settled',
  settledLine: 'Chosen: Advance all four to interviews',
};

const DECISION_ERROR: ThreadCard = {
  ...(DECISION_OPEN as Extract<ThreadCard, { kind: 'decision' }>),
  id: 'dec-error', error: 'That didn’t land — try again.',
};

/**
 * THE FORWARD CARD's fixtures (W3-C — component-map §2 item 8). The prepared forward as itself:
 * no recipient yet (no Send at all), ready with the message folded under it, the commit in flight,
 * the receipt, and an honest failure. The addresses are LITERAL — the prepare door evidences them
 * and the card never invents one.
 */
const FORWARD_SOURCE_NODE = (
  <ThreadCardView card={{
    kind: 'source', id: 'fwd-src', source: 'email',
    who: 'Rowan Blake', when: 'Sep 18', title: 'Invoice 4192 — payment terms',
    messages: [{ id: 'fm1', author: 'Rowan Blake', body: 'Following up on 4192 — the terms we agreed were 30 days from delivery, and our finance team has it logged at 60. Could you confirm which stands?' }],
    files: [{ name: 'invoice-4192.pdf', size: 184320, onOpen: noop }],
  }} />
);

const FORWARD_READY: ThreadCard = {
  kind: 'forward', id: 'fwd-ready', state: 'ready',
  to: ['finance@northwind.example'],
  subject: 'Fwd: Invoice 4192 — payment terms',
  note: 'Can you confirm which terms we have on file for this one?',
  onEditNote: noop,
  sourceNode: FORWARD_SOURCE_NODE,
  onSend: noop, onCancel: noop, receipt: 'ready to forward',
};

const FORWARD_NEEDS_RECIPIENT: ThreadCard = {
  ...(FORWARD_READY as Extract<ThreadCard, { kind: 'forward' }>),
  // TRUTH BEFORE PRESENTATION: nothing to mail ⇒ NO Send at all (the email card's law).
  id: 'fwd-needs-recipient', state: 'needs_recipient', to: [], receipt: undefined,
};

const FORWARD_SENDING: ThreadCard = {
  ...(FORWARD_READY as Extract<ThreadCard, { kind: 'forward' }>),
  id: 'fwd-sending', busy: true, receipt: 'forwarding…',
};

const FORWARD_SENT: ThreadCard = {
  ...(FORWARD_READY as Extract<ThreadCard, { kind: 'forward' }>),
  // A SPENT DEED KEEPS NO BUTTON — the receipt is the whole commit row.
  id: 'fwd-sent', state: 'sent', onSend: undefined, onCancel: undefined, onEditNote: undefined,
  receipt: 'Forwarded to finance@northwind.example.',
};

const FORWARD_ERROR: ThreadCard = {
  ...(FORWARD_READY as Extract<ThreadCard, { kind: 'forward' }>),
  id: 'fwd-error', error: 'Could not forward the email.',
};

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
    // THE JUDGED DECISION (W3-C) — the question, its object on the SAME surface, the routes with
    // their consequences, and the one route the object makes recommendable.
    type: 'actor_bubble', id: 'dec1', actorId: 'clara', actorName: 'Clara', actorRoleLabel: 'chief of staff', ts: '11:20',
    text: 'This one’s yours to call — here’s the shortlist and what each route costs.',
    cards: [DECISION_OPEN],
  },
  {
    type: 'actor_bubble', id: 'dec2', actorId: 'clara', actorName: 'Clara', ts: '11:21',
    text: 'Armed on the recommended route — the second click is the deed.',
    cards: [DECISION_ARMED],
  },
  {
    // THE PREPARED FORWARD, as itself — the message it carries folded underneath it.
    type: 'actor_bubble', id: 'fwd1', actorId: 'clara', actorName: 'Clara', ts: '11:24',
    text: 'Ready to forward to finance — nothing goes out until you confirm.',
    cards: [FORWARD_READY],
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
    // (`routine` was retired Sep 22 — W4-A: a scheduled delivery arrives as the DELIVERABLE it is.)
    cards: [{ kind: 'deliverable', id: 'r1', title: 'Competitor digest — Sep 4', meta: 'Max · every Monday 08:00 · 3 highlights', onOpen: noop }],
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
  { type: 'user_bubble', id: 'dmu2', text: 'find the document about pricing' },
  {
    // THE COLLECTION — the answer is the OBJECTS, with at most one framing sentence above them.
    // ⚠️ AND THE CITATIONS ARE THIS CARD (Sep 22): the files a coworker's answer was grounded in
    // are not a bespoke chip row — they are the SAME documents collection, through the SAME host,
    // with `cited` as the rows' status word. No new kind, no second component.
    type: 'actor_bubble', id: 'dm4', actorId: 'max', actorName: 'Max', ts: '10:26',
    text: 'Three pricing documents — the Harbor review is the one that answers it.',
    cards: [DOCUMENTS_COLLECTION],
  },
  // THE TRACE LINE, UNDER THE ANSWER — the receipt, folded once the answer landed. Machine facts
  // in, the kit's own words out (lib/work/trace.ts); the host never types a tool's name.
  {
    type: 'trace_line', id: 'dm4-trace',
    entries: [{ tool: 'search_knowledge_base', ok: true }, { tool: 'read_document', ok: true }],
  },
  { type: 'user_bubble', id: 'dmu2b', text: 'when is the harbor session, and can you move it?' },
  {
    // THE SAME EVENT CARD IN DM MODE — one card for one event, on every surface (the wave's whole
    // constraint). The coworker's prose frames it; the card carries the deeds.
    type: 'actor_bubble', id: 'dm4b', actorId: 'max', actorName: 'Max', ts: '10:24',
    text: 'Wednesday 10:00. You organise it, so you can move it or call it off from here.',
    cards: [EVENT_ORGANIZER],
  },
  { type: 'user_bubble', id: 'dmu3', text: 'what did I record last week?' },
  {
    type: 'actor_bubble', id: 'dm5', actorId: 'max', actorName: 'Max', ts: '10:28',
    text: 'Three recordings — two ready, one still transcribing.',
    cards: [RECORDINGS_COLLECTION],
  },
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
    cards: [{ kind: 'deliverable', id: 'hr1', title: 'Weekly tender briefing — Sep 5', meta: 'Max · every Monday 08:00 · 14 notices', onOpen: noop }],
  },
  {
    type: 'actor_bubble', id: 'hm2', actorId: 'max', actorName: 'Max', ts: '08:04',
    cards: [{
      kind: 'frame', id: 'hf1', title: 'Pipeline review — live',
      meta: 'frame · by Max',
      // THE ONE RENDERER, COMPOSED (W4-A): in the product this is
      // components/frames/frame-card.tsx — its own header carries the title, the provenance chip
      // and Open. The harness has no stored frame, so it draws that chrome around a static body.
      preview: (
        <div className="flex flex-col rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100">
            <p className="text-[12.5px] font-medium text-neutral-700 truncate min-w-0 flex-1">Pipeline review — live</p>
            <span className="text-[10px] text-neutral-400 flex-shrink-0">live</span>
            <span className="text-[10px] rounded-full px-1.5 py-[1px] font-medium text-teal-700 bg-teal-50 flex-shrink-0">✓ computed in code</span>
            <span className="text-[11px] text-neutral-400 flex-shrink-0">Open ↗</span>
          </div>
          <div className="flex h-[150px] items-end gap-2.5 px-5 pb-4 pt-4">
            {[34, 56, 44, 72, 62].map((h, i) => (
              <span key={i} className="w-9 rounded-t-[3px]" style={{ height: h, background: ['#c7d2fe', '#a5b4fc', '#c7d2fe', '#4f46e5', '#a5b4fc'][i] }} />
            ))}
          </div>
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
      items: ['The account reference', 'Last quarter’s statement'],
      onAttach: noop, onPaste: noop, onPickFile: noop, onProceed: noop,
    }],
  },
  {
    // THE EMAIL CARD'S STANDALONE MODE (Sep 21) — a reply to a message that is in no inbox of ours
    // (a paste, another mailbox). The SAME kind as the item-born reply; its one extra row is FROM,
    // because that is the one fact the item lane never has to ask. With several mailboxes it is a
    // selector; with one it states itself; with none it names the assistant's address.
    type: 'actor_bubble', id: 'hc1b', actorId: 'clara', actorName: 'Clara', ts: 'just now',
    text: 'Here’s the reply to Rowan — check the sender and the wording, then send it from here.',
    cards: [{
      kind: 'email', id: 'he1', state: 'ready',
      from: 'sam@acme.example',
      fromOptions: [{ id: 'c1', label: 'sam@acme.example' }, { id: 'c2', label: 'sam.rivers@northwind.example' }],
      selectedFromId: 'c1', onPickFrom: noop,
      to: ['rowan@driftwood.example'], subject: 'Re: Press timetable',
      body: 'Thanks for the note — Tuesday and Thursday afternoons both work on my side. Either one suits; tell me which you prefer and I will hold it.',
      onEditRecipients: noop, onOpenCc: noop, onEditSubject: noop, onEditBody: noop,
      onSend: noop, sendLabel: 'Send', receipt: 'ready to send',
      bodyHint: 'click anywhere to edit',
    }],
  },
  { type: 'user_bubble', id: 'hu2', text: 'what workflows do I have?' },
  {
    // The framing sentence is COMPOSED BY CODE from the rows (counts and states are arithmetic,
    // never the model's to phrase) — the card is the answer.
    type: 'actor_bubble', id: 'hc1c', actorId: 'clara', actorName: 'Clara', ts: 'just now',
    text: 'You have 7 workflows — 4 active, 2 paused, 1 draft.',
    cards: [WORKFLOWS_COLLECTION],
  },
  { type: 'user_bubble', id: 'hu3', text: 'what’s on tomorrow?' },
  {
    type: 'actor_bubble', id: 'hc1d', actorId: 'clara', actorName: 'Clara', ts: 'just now',
    text: 'Two meetings and an offsite, with the morning free after 10.',
    cards: [CALENDAR_COLLECTION],
  },
  {
    // TRUTH BEFORE PRESENTATION — an empty set says so plainly, never a row-shaped ghost.
    type: 'actor_bubble', id: 'hc1e', actorId: 'clara', actorName: 'Clara',
    text: 'Nothing standing yet on that one.',
    cards: [EMPTY_COLLECTION],
  },
  {
    // THE DECISION'S REMAINING STATES (W3-C) — with NOTHING to review (and so nothing marked as
    // the recommended path), the click in flight, the settled receipt, and an honest failure.
    type: 'actor_bubble', id: 'hdec', actorId: 'clara', actorName: 'Clara', ts: 'just now',
    text: 'The same question in every other state it can stand in.',
    cards: [DECISION_NO_OBJECT, DECISION_BUSY, DECISION_SETTLED, DECISION_ERROR],
  },
  {
    // THE FORWARD'S REMAINING STATES — no recipient (and so no Send at all), in flight, the
    // receipt a spent deed keeps, and an honest failure.
    type: 'actor_bubble', id: 'hfwd', actorId: 'clara', actorName: 'Clara', ts: 'just now',
    text: 'And the forward, through its own life.',
    cards: [FORWARD_NEEDS_RECIPIENT, FORWARD_SENDING, FORWARD_SENT, FORWARD_ERROR],
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

/** THE MARK COMPARISON IS OVER (owner, Sep 20): 'eyes' is seated as the default in alive-mark.tsx,
 *  so this harness no longer mounts a row of candidates or a specimens page. The alternates stay
 *  whole behind the `variant` prop — reverting the call is one word at the seat, not a rebuild. */

// ── THE GATES TAB (W3-A) — every state the two answerable kinds can be in ──────────────────────
// TWO HALVES, deliberately. The `_HOST` items mount the REAL hosts (which own the doors): their
// open state is the product's, byte for byte. The rest are kit cards, because the states a host
// reaches only AFTER a deed cannot be forced from outside without faking a door — and a faked door
// in a preview is exactly the promise this tab exists to stop making.
const GATE_OPEN_HOST: ThreadItem = {
  type: 'actor_bubble', id: 'g-open', actorId: 'max', actorName: 'Max', ts: 'just now', status: 'needs_you',
  text: 'The onboarding plan is ready. Nothing leaves until you say so.',
  cards: [{
    kind: 'custom', id: 'g-open-card',
    node: (
      <ApprovalCard
        id="preview-gate-open"
        spec={{
          runId: 'preview-run',
          title: 'Send the onboarding plan to the client',
          gateKind: 'approval',
          meta: 'From the workflow Onboarding pack · run of today · prepared by Max',
          steps: { done: 4, total: 6 },
          preview: { text: '## Week 1–2\n\nCapture layer live on ten seats.\n\n| Phase | Seats | Owner |\n| --- | --- | --- |\n| 1 | 10 | Ops |\n| 2 | 25 | Ops |', truncated: false },
          notable: true,
        }}
      />
    ),
  }],
};
const GATE_STATION_HOST: ThreadItem = {
  type: 'actor_bubble', id: 'g-station', actorId: 'clara', actorName: 'Clara', ts: 'just now', status: 'needs_you',
  cards: [{
    kind: 'custom', id: 'g-station-card',
    node: (
      <InputCard
        id="preview-station"
        spec={{
          shape: 'station',
          runId: 'preview-run',
          ask: 'Paste the signed addendum — the run stopped here waiting for it.',
          meta: 'Contract pack stopped here and needs this from you · feeds the summary step',
          steps: { done: 2, total: 5 },
        }}
      />
    ),
  }],
};
const ASK_ENGINE_HOST: ThreadItem = {
  type: 'actor_bubble', id: 'g-ask', actorId: 'clara', actorName: 'Clara', ts: 'just now',
  text: 'Two things I can’t see anywhere — give me either and I’ll finish the reply.',
  cards: [{
    kind: 'custom', id: 'g-ask-card',
    node: (
      <InputCard
        id="preview-ask"
        spec={{
          shape: 'engine',
          turnId: 'preview-turn',
          ask: '',
          items: ['The account reference', 'Last quarter’s statement'],
          context: ['Reply to the collection notice'],
          onAttach: noop,
          onPointToIt: noop,
        }}
      />
    ),
  }],
};
// THE GO-AHEAD IS NOT ALWAYS A DOOR (lib/room/go-ahead.ts): the missing thing IS the deliverable,
// so the never-blocking door is absent and the honest answers are the whole row.
const ASK_NO_GO_AHEAD: ThreadItem = {
  type: 'actor_bubble', id: 'g-ask2', actorId: 'clara', actorName: 'Clara', ts: 'just now',
  cards: [{
    kind: 'custom', id: 'g-ask2-card',
    node: (
      <InputCard
        id="preview-ask-blocked"
        spec={{
          shape: 'engine',
          turnId: 'preview-turn-2',
          ask: 'I need the bank details before I can send anything.',
          items: ['The bank details'],
          context: ['Send the bank details to the supplier'],
          onAttach: noop,
          onPointToIt: noop,
        }}
      />
    ),
  }],
};
// W4-B — THE TYPE-IT DOOR. The same ask, answered without leaving the thread: a fact-shaped row
// leads with Type it, a document-shaped row leads with Attach, and BOTH keep all three doors.
const ASK_TYPE_IT: ThreadItem = {
  type: 'actor_bubble', id: 'g-ask3', actorId: 'clara', actorName: 'Clara', ts: 'just now',
  cards: [{
    kind: 'custom', id: 'g-ask3-card',
    node: (
      <InputCard
        id="preview-ask-typeit"
        spec={{
          shape: 'engine',
          turnId: 'preview-turn-3',
          ask: 'I need two things before the payment instruction can go out — the reference is probably faster typed than found.',
          items: ['The account reference', 'The signed addendum'],
          context: ['Reply to the collection notice'],
          onAttach: noop,
          onPointToIt: noop,
          // The reader already said it in the composer: the row OFFERS, it never consumes.
          recentUserText: 'REF-0000-2026',
        }}
      />
    ),
  }],
};
const GATE_KIT_STATES: ThreadItem[] = [
  { type: 'divider', id: 'g-div', variant: 'day', label: 'The states after a deed' },
  {
    type: 'actor_bubble', id: 'g-states', actorId: 'max', actorName: 'Max',
    cards: [
      // busy — the reader's own click is in flight; the card stands down rather than moving twice.
      {
        kind: 'approval', id: 'GATE_BUSY', state: 'busy', title: 'Send the onboarding plan',
        gateWord: 'Your approval', meta: 'From the workflow Onboarding pack · run of today',
        approveLabel: 'Approve — deliver it', onApprove: noop, rejectLabel: 'Hold back', onReject: noop,
      },
      // approved / held back / answered elsewhere — NO verbs at all, one receipt line.
      {
        kind: 'approval', id: 'GATE_SETTLED_APPROVED', state: 'settled', title: 'Send the onboarding plan',
        gateWord: 'Your approval', statusChip: '✓ approved — delivering',
        settledLine: 'Approved — the run is delivering.',
      },
      {
        kind: 'approval', id: 'GATE_SETTLED_REJECTED', state: 'settled', title: 'Send the onboarding plan',
        gateWord: 'Your approval', statusChip: 'held back',
        settledLine: 'Held back — nothing was delivered.',
      },
      {
        kind: 'approval', id: 'GATE_SETTLED_ELSEWHERE', state: 'settled', title: 'Send the onboarding plan',
        gateWord: 'Your approval', settledLine: 'This one has already been answered.',
      },
      // an honest failure is a LINE ON the card — the question it was asking is still the question.
      {
        kind: 'approval', id: 'GATE_ERROR', state: 'open', title: 'Send the onboarding plan',
        gateWord: 'Your approval', error: 'That decision did not land — try again.',
        approveLabel: 'Approve — deliver it', onApprove: noop, rejectLabel: 'Hold back', onReject: noop,
      },
      { kind: 'input', id: 'ASK_BUSY', state: 'busy', ask: 'Paste the signed addendum.', items: ['The signed addendum'], onAttach: noop },
      { kind: 'input', id: 'ASK_SETTLED', state: 'settled', ask: 'Paste the signed addendum.', settledLine: 'Sent — the run picked up from there.' },
      { kind: 'input', id: 'ASK_ERROR', state: 'open', ask: 'Paste the signed addendum.', items: ['The signed addendum'], onAttach: noop, error: 'That didn’t go through — try it again in a moment.' },
    ],
  },
];
const GATE_ITEMS: ThreadItem[] = [
  GATE_OPEN_HOST, GATE_STATION_HOST, ASK_ENGINE_HOST, ASK_NO_GO_AHEAD, ASK_TYPE_IT, ...GATE_KIT_STATES,
];

export function ThreadPreview() {
  // The Event tab is a FIXTURE tab, not a fourth thread kind — it renders through the same Home
  // shell, so the card is seen exactly where the product mounts it.
  const [tab, setTab] = useState<ThreadKind | 'event' | 'gates' | 'catalogue'>('project');

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b border-neutral-200/80 bg-white px-6 py-3">
        <div className="text-[13px] font-semibold text-neutral-900">Thread kit preview</div>
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as ThreadKind | 'event' | 'gates' | 'catalogue')}
          items={[
            { value: 'project', label: 'Project' },
            { value: 'dm', label: 'Coworker DM' },
            { value: 'home', label: 'Home' },
            { value: 'event', label: 'Event' },
            { value: 'gates', label: 'Gates & asks' },
            // THE INDEX, ALWAYS LAST — the five before it are walks; this one is the whole kit.
            { value: 'catalogue', label: 'Catalogue' },
          ]}
        />
        <span className="flex-grow" />
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
      {tab === 'event' && (
        <ThreadShell
          className="h-[calc(100dvh-120px)] min-h-[480px]"
          kind="home"
          header={{ title: 'The event card — every state' }}
          items={EVENT_ITEMS}
          composer={{ placeholder: 'Ask about your calendar…' }}
        />
      )}
      {tab === 'gates' && (
        <ThreadShell
          className="h-[calc(100dvh-120px)] min-h-[480px]"
          kind="home"
          header={{ title: 'The gate and the ask — every state' }}
          items={GATE_ITEMS}
        />
      )}
      {tab === 'catalogue' && <ThreadCatalogue />}
    </div>
  );
}
