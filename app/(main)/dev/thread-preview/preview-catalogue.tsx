'use client';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CATALOGUE (owner, Sep 22: "update the dev/threads with all components we have")
 *
 * The five scenario tabs beside this one are WALKS — a project room, a DM, the Home, the calendar
 * lane, the gates — each a story that happens to contain cards. This tab is the INDEX: one section
 * per kind of `THREAD_CARD_KINDS`, and inside it EVERY state that kind's contract can be in, each
 * labelled with the words the gate reads.
 *
 * THREE RULES IT KEEPS:
 *  1. EVERY FIXTURE IS A REAL RENDER. Cards render through `ThreadCardView` — the same switch every
 *     surface mounts — and where a HOST owns the kind's data (the approval gate, the ask, the
 *     decision, the collection, the event) one specimen mounts THAT HOST, with a served-shaped spec,
 *     so the preview never promises a rendering the product does not have.
 *  2. THE STATES ARE THE CONTRACT'S, NOT A DESIGNER'S. Each section's specimens are derived from the
 *     kind's own `state` union in components/thread/types.ts; gate T37.2 fails the day a literal is
 *     added to that union without a fixture here.
 *  3. A HOST THAT CANNOT RENDER FROM A SPEC IS NOT FAKED. `components/home/forward-card.tsx` reads
 *     its prepared artifact on mount (entityId → the prepare door), so this index mounts the KIT
 *     card for the forward's five states rather than pointing a host at a fabricated id. The
 *     section header says so — the preview's own honesty floor.
 *
 * NO REAL NAMES ANYWHERE: the cast is the harness's own (Clara · Max · Luca · Jordan Vance ·
 * Mia Ruiz · Sam Ortega · Pat Winters · Rowan Blake) against Atlas / Northwind / Harbor / Acme.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import {
  AvatarStatus, FacePile, ThreadCardView, ThreadComposer, ThreadHeader, ThreadTimeline,
  type ThreadCard, type ThreadCardKind, type ThreadItem,
} from '@/components/thread';
import { THREAD_CARD_KINDS } from '@/components/thread/types';
// THE HOSTS — the very components the room, the deep-dive and the Home band mount.
import ApprovalCard from '@/components/home/approval-card';
import InputCard from '@/components/home/input-card';
import DecisionCard from '@/components/home/decision-card';
import CollectionCard from '@/components/home/collection-card';
import EventCard from '@/components/home/event-card';
import ChangeCard from '@/components/home/change-card';
import { WorkerMentionInput } from '@/components/workers/worker-mention-input';
import { AliveMark } from '@/components/home/alive-mark';
import { OrbSeat, type OrbEntrance } from '@/components/home/orb-entrance';

const noop = () => {};

// ── the index's own chrome ──────────────────────────────────────────────────────────────────────

type Specimen = { label: string; node: React.ReactNode; note?: string };
type Section = {
  /** THE SECTION MARKER the gate reads — one per kind of THREAD_CARD_KINDS, in that order. */
  section: ThreadCardKind;
  /** Which surfaces mount this kind. */
  mounts: string;
  /** Which host owns its data (or the honest "the kit alone"). */
  owner: string;
  specimens: Specimen[];
};

function SpecimenBlock({ label, node, note }: Specimen) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-neutral-400">{label}</span>
        {note && <span className="text-[11px] text-neutral-300">{note}</span>}
      </div>
      {node}
    </div>
  );
}

function SectionBlock({ s }: { s: Section }) {
  return (
    <section className="flex flex-col gap-4 border-t border-neutral-200/70 pt-6">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13px] font-semibold text-neutral-900">
          {s.section}
          <span className="ml-2 font-normal text-[11px] text-neutral-400">{s.specimens.length} states</span>
        </h2>
        <p className="text-[11.5px] leading-[1.5] text-neutral-400">{s.mounts} · {s.owner}</p>
      </div>
      <div className="flex flex-col gap-5">
        {s.specimens.map((sp) => <SpecimenBlock key={sp.label} {...sp} />)}
      </div>
    </section>
  );
}

// ── shared fixture parts ────────────────────────────────────────────────────────────────────────

/**
 * A STAND-IN FOR THE ONE FRAME RENDERER (components/frames/frame-card.tsx).
 *
 * The real renderer fetches a STORED frame and puts its HTML in a sandboxed srcdoc iframe; the
 * harness has no stored frame, so it draws the renderer's own CHROME (header · title · the live and
 * provenance chips · Open) around a static body, exactly as the kit composes it in the product.
 * The catalogue shows the SHAPE the kit produces — it never opens a second sandbox.
 */
const FRAME_PREVIEW = (
  <div className="flex flex-col rounded-xl border border-neutral-200 bg-white overflow-hidden">
    <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100">
      <p className="text-[12.5px] font-medium text-neutral-700 truncate min-w-0 flex-1">Pipeline review — live</p>
      <span className="text-[10px] text-neutral-400 flex-shrink-0">live</span>
      <span className="text-[10px] rounded-full px-1.5 py-[1px] font-medium text-teal-700 bg-teal-50 flex-shrink-0">✓ computed in code</span>
      <span className="text-[11px] text-neutral-400 flex-shrink-0">Open ↗</span>
    </div>
    <div className="flex h-[150px] items-end gap-2.5 px-5 pb-4 pt-4 bg-white">
      {[34, 56, 44, 72, 62].map((h, i) => (
        <span key={i} className="w-9 rounded-t-[3px]" style={{ height: h, background: ['#c7d2fe', '#a5b4fc', '#c7d2fe', '#4f46e5', '#a5b4fc'][i] }} />
      ))}
    </div>
  </div>
);

/** The message being forwarded / decided on — THE ONE OBJECT CARD, mounted whole. */
const SOURCE_EMAIL_NODE = (
  <ThreadCardView card={{
    kind: 'source', id: 'cat-src-obj', source: 'email',
    who: 'Rowan Blake', when: 'Sep 18', title: 'Invoice 4192 — payment terms',
    messages: [{ id: 'cm1', author: 'Rowan Blake', body: 'Following up on 4192 — the terms we agreed were 30 days from delivery, and our finance team has it logged at 60. Could you confirm which stands?' }],
    files: [{ name: 'invoice-4192.pdf', size: 184_320, onOpen: noop }],
  }} />
);

// ── THE SECTIONS — one per kind, in THREAD_CARD_KINDS order ─────────────────────────────────────

const SECTIONS: Section[] = [
  {
    section: 'deliverable',
    mounts: 'project room · coworker DM · Home thread',
    owner: 'the kit alone — the host hands a title, a meta line and ONE door',
    specimens: [
      {
        label: 'deliverable · ready (mail)',
        node: <ThreadCardView card={{
          kind: 'deliverable', id: 'cat-dl-1', icon: 'mail',
          title: 'Confirmation — Wednesday 11:00',
          meta: 'Reply to Jordan, Mia · ready to review', onOpen: noop,
        }} />,
      },
      {
        label: 'deliverable · ready (document)',
        node: <ThreadCardView card={{
          kind: 'deliverable', id: 'cat-dl-2', icon: 'document',
          title: 'Atlas onboarding plan — v2', meta: 'Prepared by Max · 6 pages', onOpen: noop,
        }} />,
      },
      {
        label: 'deliverable · ready (file · calendar icons)',
        node: (
          <div className="flex flex-col gap-2">
            <ThreadCardView card={{ kind: 'deliverable', id: 'cat-dl-3', icon: 'file', title: 'Seat pricing model.xlsx', meta: 'Spreadsheet · computed in code', onOpen: noop }} />
            <ThreadCardView card={{ kind: 'deliverable', id: 'cat-dl-4', icon: 'calendar', title: 'Kickoff hold — Wednesday', meta: 'Calendar · expires tomorrow', onOpen: noop }} />
          </div>
        ),
      },
      {
        label: 'deliverable · no door (no handler)',
        note: 'NO LYING DOORS — the word renders as text',
        node: <ThreadCardView card={{ kind: 'deliverable', id: 'cat-dl-5', title: 'Harbor renewal summary', meta: 'nowhere to open it yet' }} />,
      },
    ],
  },

  {
    section: 'approval',
    mounts: 'run drawer gate card · deck deep-dive · room stream · Home band',
    owner: 'components/home/approval-card.tsx (the ONE resume door) — states after a deed are the kit’s',
    specimens: [
      {
        label: 'approval · open — THE HOST',
        note: 'the product’s own gate, byte for byte',
        node: (
          <ApprovalCard
            id="cat-gate-open"
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
      },
      {
        label: 'approval · open — THE CHANGE HOST (a prepared state change awaiting the click)',
        note: 'components/home/change-card.tsx — the same kit kind, a different object: a class-A change from a tool-bearing lane (stabilization W0.3b). Apply runs the executor through /api/changes/[id]/apply; nothing ran when the card was drawn',
        node: (
          <ChangeCard
            spec={{
              id: 'cat-change-open', tool: 'update_task',
              summary: 'Change "Weekly tender briefing": email recipients → ops@northwind.example',
              lines: ['Email recipients → ops@northwind.example'],
              lane: 'coworker_dm', preparedBy: 'Clara', status: 'pending',
              expiresAt: '2099-01-01T00:00:00.000Z',
            }}
          />
        ),
      },
      {
        label: 'approval · settled — THE CHANGE HOST (applied)',
        node: (
          <ChangeCard
            spec={{
              id: 'cat-change-applied', tool: 'delete_task',
              summary: 'Delete "Competitor digest" permanently', lines: ['This cannot be undone.'],
              lane: 'home_chat', status: 'applied', expiresAt: '2099-01-01T00:00:00.000Z',
              result: '"Competitor digest" has been permanently deleted.',
            }}
          />
        ),
      },
      {
        label: 'approval · open (kit · plain preview, no note door)',
        node: <ThreadCardView card={{
          kind: 'approval', id: 'cat-ap-open', state: 'open',
          title: 'Atlas onboarding plan — v2', gateWord: 'Your approval',
          meta: 'From the workflow Onboarding pack · run of today',
          preview: 'Week 1–2: capture layer live on ten seats. Week 3–4: first workflow automated with your team. Week 5–6: review, pricing…',
          approveLabel: 'Approve & send', onApprove: noop, openLabel: 'Open', onOpen: noop, onReject: noop,
        }} />,
      },
      {
        label: 'approval · open + the note door',
        node: <ThreadCardView card={{
          kind: 'approval', id: 'cat-ap-note', state: 'open',
          title: 'Send the onboarding plan', gateWord: 'Your approval',
          meta: 'From the workflow Onboarding pack · run of today',
          noteValue: '', onNote: noop, notePlaceholder: 'Add a note for the thread…',
          approveLabel: 'Approve — deliver it', onApprove: noop, rejectLabel: 'Hold back', onReject: noop,
          footer: <span className="text-[11px] text-neutral-400">Receipts · the run’s own trail</span>,
        }} />,
      },
      {
        label: 'approval · busy (the reader’s click in flight)',
        node: <ThreadCardView card={{
          kind: 'approval', id: 'cat-ap-busy', state: 'busy', title: 'Send the onboarding plan',
          gateWord: 'Your approval', meta: 'From the workflow Onboarding pack · run of today',
          approveLabel: 'Approve — deliver it', onApprove: noop, rejectLabel: 'Hold back', onReject: noop,
        }} />,
      },
      {
        label: 'approval · settled (approved)',
        node: <ThreadCardView card={{
          kind: 'approval', id: 'cat-ap-ok', state: 'settled', title: 'Send the onboarding plan',
          gateWord: 'Your approval', statusChip: '✓ approved — delivering',
          settledLine: 'Approved — the run is delivering.',
        }} />,
      },
      {
        label: 'approval · settled (held back)',
        node: <ThreadCardView card={{
          kind: 'approval', id: 'cat-ap-no', state: 'settled', title: 'Send the onboarding plan',
          gateWord: 'Your approval', statusChip: 'held back',
          settledLine: 'Held back — nothing was delivered.',
        }} />,
      },
      {
        label: 'approval · settled (answered elsewhere)',
        node: <ThreadCardView card={{
          kind: 'approval', id: 'cat-ap-else', state: 'settled', title: 'Send the onboarding plan',
          gateWord: 'Your approval', settledLine: 'This one has already been answered.',
        }} />,
      },
      {
        label: 'approval · open + error',
        note: 'a failure is a LINE ON the card, never a state it becomes',
        node: <ThreadCardView card={{
          kind: 'approval', id: 'cat-ap-err', state: 'open', title: 'Send the onboarding plan',
          gateWord: 'Your approval', error: 'That decision did not land — try again.',
          approveLabel: 'Approve — deliver it', onApprove: noop, rejectLabel: 'Hold back', onReject: noop,
        }} />,
      },
    ],
  },

  {
    section: 'input',
    mounts: 'run drawer station · room ask · Home “Needs your input” band',
    owner: 'components/home/input-card.tsx — two shapes (engine ask · input station)',
    specimens: [
      {
        label: 'input · open — THE HOST (engine ask)',
        node: (
          <InputCard
            id="cat-ask-engine"
            spec={{
              shape: 'engine', turnId: 'preview-turn',
              ask: '', items: ['The account reference', 'Last quarter’s statement'],
              context: ['Reply to the collection notice'],
              onAttach: noop, onPointToIt: noop,
            }}
          />
        ),
      },
      {
        // W4-B — THE TYPE-IT DOOR. A fact-shaped gap leads with Type it (an IBAN is faster said
        // than found); every row still carries all three doors.
        label: 'input · open — THE HOST (fact-led: Type it leads)',
        node: (
          <InputCard
            id="cat-ask-fact"
            spec={{
              shape: 'engine', turnId: 'preview-turn-fact',
              ask: 'I need the account reference before I can send the payment instruction.',
              items: ['The account reference', 'The IBAN'],
              context: ['Reply to the collection notice'],
              onAttach: noop, onPointToIt: noop,
            }}
          />
        ),
      },
      {
        label: 'input · open — THE HOST (document-led: Attach leads, Type it stays)',
        node: (
          <InputCard
            id="cat-ask-doc"
            spec={{
              shape: 'engine', turnId: 'preview-turn-doc',
              ask: 'I need the signed addendum to finish the reply.',
              items: ['The signed addendum', 'Last quarter’s statement'],
              context: ['Reply to the supplier'],
              onAttach: noop, onPointToIt: noop,
            }}
          />
        ),
      },
      {
        // The kit's own row states: mid-typing · supplied (the receipt is the row) · the said-it
        // offer. Fictitious values only — a zeroed IBAN, never a real one.
        label: 'input · rows (mid-typing · supplied ✓ · the said-it offer)',
        node: <ThreadCardView card={{
          kind: 'input', id: 'cat-in-rows', state: 'open',
          ask: 'Two things are missing before the payment instruction can go out.',
          items: ['The IBAN', 'The account reference', 'The signed addendum'],
          rowDoors: [
            { lead: 'fact', supplied: 'PT50 0000 0000 0000 0000 0000 0' },
            { lead: 'fact', onType: noop, onAttach: noop, onPointToIt: noop, saidIt: { label: 'Use this as the account reference ✓', text: 'REF-0000-2026', onUse: noop } },
            { lead: 'document', onType: noop, onAttach: noop, onPointToIt: noop },
          ],
        }} />,
      },
      {
        label: 'input · row mid-deed (busy) + a row that refused',
        node: <ThreadCardView card={{
          kind: 'input', id: 'cat-in-rowbusy', state: 'open',
          ask: 'I need the account reference before I can send the payment instruction.',
          items: ['The account reference', 'The IBAN'],
          rowDoors: [
            { lead: 'fact', onType: noop, onAttach: noop, busy: true },
            { lead: 'fact', onType: noop, onAttach: noop, error: 'That’s longer than this door takes — attach it as a file instead.' },
          ],
        }} />,
      },
      {
        label: 'input · open — THE HOST (input station)',
        node: (
          <InputCard
            id="cat-ask-station"
            spec={{
              shape: 'station', runId: 'preview-run',
              ask: 'Paste the signed addendum — the run stopped here waiting for it.',
              meta: 'Contract pack stopped here and needs this from you · feeds the summary step',
              steps: { done: 2, total: 5 },
            }}
          />
        ),
      },
      {
        label: 'input · open (kit · the three chips + the never-blocking door)',
        node: <ThreadCardView card={{
          kind: 'input', id: 'cat-in-open', state: 'open',
          ask: 'I need the account reference for the collection reply — it isn’t anywhere I can see.',
          items: ['The account reference', 'Last quarter’s statement'],
          meta: 'Clara stopped here and needs this from you',
          onAttach: noop, onPaste: noop, onPickFile: noop, onProceed: noop,
        }} />,
      },
      {
        label: 'input · open (no go-ahead — the missing thing IS the deliverable)',
        node: <ThreadCardView card={{
          kind: 'input', id: 'cat-in-block', state: 'open',
          ask: 'I need the bank details before I can send anything.',
          items: ['The bank details'], onAttach: noop, onPaste: noop,
        }} />,
      },
      {
        label: 'input · busy',
        node: <ThreadCardView card={{
          kind: 'input', id: 'cat-in-busy', state: 'busy', ask: 'Paste the signed addendum.',
          items: ['The signed addendum'], onAttach: noop,
        }} />,
      },
      {
        label: 'input · settled',
        node: <ThreadCardView card={{
          kind: 'input', id: 'cat-in-settled', state: 'settled', ask: 'Paste the signed addendum.',
          statusChip: 'answered', settledLine: 'Sent — the run picked up from there.',
        }} />,
      },
      {
        label: 'input · open + error',
        node: <ThreadCardView card={{
          kind: 'input', id: 'cat-in-err', state: 'open', ask: 'Paste the signed addendum.',
          items: ['The signed addendum'], onAttach: noop,
          error: 'That didn’t go through — try it again in a moment.',
        }} />,
      },
    ],
  },

  {
    section: 'frame',
    mounts: 'Home chat · coworker DM (anywhere the ONE production door ships a frame)',
    owner: 'components/home/home-ask.tsx mounts THE ONE RENDERER (components/frames/frame-card.tsx) as `preview` — one srcdoc sandbox, opaque origin, no second header',
    specimens: [
      {
        label: 'frame · the one renderer, composed (its own header carries the title, the provenance chip and Open)',
        node: <ThreadCardView card={{
          kind: 'frame', id: 'cat-fr-1', title: 'Pipeline review — live',
          meta: 'frame · by Max',
          preview: FRAME_PREVIEW, onOpen: noop,
        }} />,
      },
      {
        label: 'frame · the handle (no render yet — title · meta · one door, never an empty preview box)',
        node: <ThreadCardView card={{ kind: 'frame', id: 'cat-fr-2', title: 'Renewal radar', meta: 'building…', onOpen: noop }} />,
      },
      {
        label: 'frame · the handle, no door',
        node: <ThreadCardView card={{ kind: 'frame', id: 'cat-fr-3', title: 'Renewal radar', meta: 'building…' }} />,
      },
    ],
  },

  {
    section: 'proposal',
    mounts: 'item room · project room — THE ROOM’S MOVE, in the pinned opening',
    owner: 'lib/room/brief.ts composes {brief, move, offers}; components/home/item-rail.tsx validates the ref against the board and owns the click ladder',
    specimens: [
      {
        label: 'proposal · the move, with the object it is the deed for',
        node: <ThreadCardView card={{
          kind: 'proposal', id: 'cat-pr-1', title: 'Reply to the pilot renewal',
          detail: 'by Clara',
          confirmLabel: 'Confirm Wednesday 11:00 →', onConfirm: noop,
        }} />,
      },
      {
        label: 'proposal · the move alone (the commonest shape — the words ARE the deed)',
        node: <ThreadCardView card={{ kind: 'proposal', id: 'cat-pr-2', confirmLabel: 'Send the revised scope →', onConfirm: noop }} />,
      },
      {
        label: 'proposal · no validated target — the move still SPEAKS, and is not a button (no lying doors)',
        node: <ThreadCardView card={{ kind: 'proposal', id: 'cat-pr-3', confirmLabel: 'Confirm the Q3 figures →' }} />,
      },
      {
        label: 'proposal · with offers (each chip SAYS its sentence through the composer; the room itself seats none — owner, Sep 14)',
        node: <ThreadCardView card={{
          kind: 'proposal', id: 'cat-pr-4', confirmLabel: 'Draft the reply →', onConfirm: noop,
          offers: [
            { label: 'Hand it to Max', say: 'Max, take this one over.' },
            { label: 'Give me the background first', say: 'Catch me up on this thread before I answer.' },
          ],
          onSay: noop,
        }} />,
      },
      {
        label: 'proposal · busy (the reader’s own click is in flight)',
        node: <ThreadCardView card={{
          kind: 'proposal', id: 'cat-pr-5', confirmLabel: 'Draft the reply →', onConfirm: noop, busy: true,
          offers: [{ label: 'Hand it to Max', say: 'Max, take this one over.' }], onSay: noop,
        }} />,
      },
    ],
  },

  {
    section: 'invite',
    mounts: 'project room · Home thread (the prepared calendar invite)',
    owner: 'lib/prepare/invite — the grounded slots; the commit is the host’s one door',
    specimens: [
      {
        label: 'invite · ready',
        node: <ThreadCardView card={{
          kind: 'invite', id: 'cat-iv-1', state: 'ready',
          title: 'Atlas × Northwind — kickoff',
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
        }} />,
      },
      {
        label: 'invite · ready (the open row picked — the card carries its own time field)',
        node: <ThreadCardView card={{
          kind: 'invite', id: 'cat-iv-2', state: 'ready',
          title: 'Atlas × Northwind — kickoff',
          dateLabel: { month: 'Sep', day: '9' }, whenLabel: 'Tuesday, Sep 9 · 11:00–11:30',
          attendees: [{ name: 'Jordan Vance' }],
          options: [
            { id: 'a', label: 'Tuesday, Sep 9 · 11:00', annotation: 'filled in above' },
            { id: 'open', label: 'Suggest another time…', open: true },
          ],
          selectedOptionId: 'open', onPickOption: noop, onPickTime: noop, pickedTimeValue: '2026-09-10T11:00',
          onSend: noop, receipt: 'ready',
        }} />,
      },
      {
        label: 'invite · needs_time',
        note: 'the selector ALONE — never an empty form, never a commit row for a thing that cannot send',
        node: <ThreadCardView card={{
          kind: 'invite', id: 'cat-iv-3', state: 'needs_time',
          options: [
            { id: 'a', label: 'Thursday morning', annotation: 'they said “some time Thursday”' },
            { id: 'open', label: 'Suggest another time…', open: true },
          ],
          onPickOption: noop,
        }} />,
      },
      {
        label: 'invite · ready + busy (the working state)',
        node: <ThreadCardView card={{
          kind: 'invite', id: 'cat-iv-4', state: 'ready', busy: true,
          title: 'Atlas × Northwind — kickoff', dateLabel: { month: 'Sep', day: '9' },
          whenLabel: 'Tuesday, Sep 9 · 11:00–11:30', attendees: [{ name: 'Mia Ruiz' }],
          options: [{ id: 'a', label: 'Tuesday, Sep 9 · 11:00' }], selectedOptionId: 'a',
          onPickOption: noop, onSend: noop, receipt: 'sending…',
        }} />,
      },
      {
        label: 'invite · ready + error',
        node: <ThreadCardView card={{
          kind: 'invite', id: 'cat-iv-5', state: 'ready',
          title: 'Atlas × Northwind — kickoff', dateLabel: { month: 'Sep', day: '9' },
          whenLabel: 'Tuesday, Sep 9 · 11:00–11:30', attendees: [{ name: 'Mia Ruiz' }],
          options: [{ id: 'a', label: 'Tuesday, Sep 9 · 11:00' }], selectedOptionId: 'a',
          onPickOption: noop, onSend: noop,
          error: 'That slot was taken while the card stood open.',
        }} />,
      },
    ],
  },

  {
    section: 'email',
    mounts: 'item room · Home thread · coworker DM (the drafted message, in the thread)',
    owner: 'lib/prepare/email-card composes the body; the send is the host’s ONE commit door',
    specimens: [
      {
        label: 'email · ready (the item lane — tabs · thread door · selector · tone · attachments)',
        node: <ThreadCardView card={{
          kind: 'email', id: 'cat-em-1', state: 'ready',
          variants: [
            { id: 'v1', label: 'Confirm Thursday' },
            { id: 'v2', label: 'Ask for the reference first' },
            { id: 'v3', label: '＋ another way', open: true },
          ],
          selectedVariantId: 'v1', onPickVariant: noop, onOpenThread: noop,
          to: ['rowan@driftwood.example'], subject: 'Re: Invoice 4192 — payment terms',
          body: 'Thanks for chasing — the terms on our copy are 30 days from delivery. I’ve asked finance to correct the 60-day entry today and will confirm once it’s done.',
          onEditRecipients: noop, onOpenCc: noop, onOpenBcc: noop, onEditSubject: noop, onEditBody: noop,
          contextFiles: [{ name: 'invoice-4192.pdf', size: 184_320, onOpen: noop }],
          attachments: [{ name: 'terms-of-supply.pdf', onRemove: noop }],
          onAttachFile: noop, onAttachFromKb: noop,
          options: [
            { id: 'o1', label: 'Keep it short', annotation: 'as drafted' },
            { id: 'o2', label: 'Name the correction date', annotation: 'grounded in your reply' },
            { id: 'oo', label: '…or tell me what to change', open: true },
          ],
          selectedOptionId: 'o1', onPickOption: noop, onSteer: noop,
          toneOptions: [{ id: 't1', label: 'Warmer' }, { id: 't2', label: 'More formal' }],
          onPickTone: noop,
          onSend: noop, sendLabel: 'Send reply', receipt: 'ready to send',
          bodyHint: 'click anywhere to edit · mirrors the thread’s language',
        }} />,
      },
      {
        label: 'email · ready (the standalone lane — the FROM row, several mailboxes)',
        node: <ThreadCardView card={{
          kind: 'email', id: 'cat-em-2', state: 'ready',
          from: 'sam@acme.example',
          fromOptions: [{ id: 'c1', label: 'sam@acme.example' }, { id: 'c2', label: 'sam.ortega@northwind.example' }],
          selectedFromId: 'c1', onPickFrom: noop,
          to: ['rowan@driftwood.example'], subject: 'Re: Press timetable',
          body: 'Thanks for the note — Tuesday and Thursday afternoons both work on my side. Either one suits; tell me which you prefer and I will hold it.',
          onEditRecipients: noop, onEditSubject: noop, onEditBody: noop,
          onSend: noop, sendLabel: 'Send', receipt: 'ready to send',
          bodyHint: 'click anywhere to edit',
        }} />,
      },
      {
        label: 'email · ready (Cc and Bcc rows open)',
        node: <ThreadCardView card={{
          kind: 'email', id: 'cat-em-3', state: 'ready',
          to: ['jordan@northwind.example'], cc: ['mia@northwind.example'], bcc: ['sam@acme.example'],
          ccEditor: <span className="rounded-full border border-neutral-200/80 px-[9px] py-[2px] text-[12px] text-neutral-700">mia@northwind.example</span>,
          bccEditor: <span className="rounded-full border border-neutral-200/80 px-[9px] py-[2px] text-[12px] text-neutral-700">sam@acme.example</span>,
          subject: 'Kickoff — Wednesday 11:00',
          body: 'Confirming Wednesday at 11:00. Invite to follow.',
          onEditBody: noop, onSend: noop, receipt: 'ready to send',
        }} />,
      },
      {
        label: 'email · needs_recipient',
        note: 'a card that cannot mail never wears a Send button',
        node: <ThreadCardView card={{
          kind: 'email', id: 'cat-em-4', state: 'needs_recipient',
          to: [], subject: 'Re: Press timetable', onEditRecipients: noop,
          body: 'Thanks for the note — Tuesday and Thursday afternoons both work on my side.',
          onEditBody: noop,
        }} />,
      },
      {
        label: 'email · ready + busy (redrafting — the commit row stands down)',
        node: <ThreadCardView card={{
          kind: 'email', id: 'cat-em-5', state: 'ready', busy: true,
          variants: [{ id: 'v1', label: 'Confirm Thursday' }, { id: 'v2', label: 'Ask for the reference first', loading: true }],
          selectedVariantId: 'v2', onPickVariant: noop,
          to: ['rowan@driftwood.example'], subject: 'Re: Invoice 4192',
          body: 'Thanks for chasing — the terms on our copy are 30 days from delivery.',
          onEditBody: noop, onSend: noop, receipt: 'redrafting…', steerBusy: true,
        }} />,
      },
      {
        label: 'email · ready + error',
        node: <ThreadCardView card={{
          kind: 'email', id: 'cat-em-6', state: 'ready',
          to: ['rowan@driftwood.example'], subject: 'Re: Invoice 4192',
          body: 'Thanks for chasing — the terms on our copy are 30 days from delivery.',
          onEditBody: noop, onSend: noop, error: 'That didn’t send — the mailbox refused it.',
        }} />,
      },
      {
        label: 'email · ready (sent — read-only prose, the receipt is the whole row)',
        node: <ThreadCardView card={{
          kind: 'email', id: 'cat-em-7', state: 'ready',
          to: ['rowan@driftwood.example'], subject: 'Re: Invoice 4192',
          body: 'Thanks for chasing — the terms on our copy are 30 days from delivery. I’ve asked finance to correct the 60-day entry today.',
          receipt: 'sent · 09:41',
        }} />,
      },
    ],
  },

  {
    section: 'bulk',
    mounts: 'Home thread (the triage deck’s natural verb, confirmed in the thread)',
    owner: 'lib/deeds/bulk.ts composes every word from the STORED deed',
    specimens: [
      {
        label: 'bulk · pending',
        node: <ThreadCardView card={{
          kind: 'bulk', id: 'cat-bk-1', state: 'pending',
          intro: 'Archive 31 messages from Notices.',
          lines: ['22 automated notifications, none answered', '9 senders unsubscribe automatically (one-click)'],
          undoNote: 'Undo from Activity for 30 days.',
          commitLabel: 'Archive them', onCommit: noop, cancelLabel: 'Not now', onCancel: noop,
          receipt: 'ready',
        }} />,
      },
      {
        label: 'bulk · pending (the honest subset, NAMED)',
        node: <ThreadCardView card={{
          kind: 'bulk', id: 'cat-bk-2', state: 'pending',
          intro: 'Unsubscribe from 12 senders.',
          lines: ['9 unsubscribe automatically (one-click)'],
          needsClick: [
            { subject: 'Northwind product digest', onOpen: noop },
            { subject: 'Harbor weekly roundup', onOpen: noop },
            { subject: 'Acme partner news' },
          ],
          undoNote: 'An unsubscribe cannot be undone from here.',
          commitLabel: 'Unsubscribe', onCommit: noop, onCancel: noop,
        }} />,
      },
      {
        label: 'bulk · committing (the working idiom)',
        node: <ThreadCardView card={{
          kind: 'bulk', id: 'cat-bk-3', state: 'committing',
          intro: 'Archive 31 messages from Notices.',
          lines: ['22 automated notifications, none answered'],
          commitLabel: 'Archive them', onCommit: noop, onCancel: noop, receipt: 'archiving…',
        }} />,
      },
      {
        label: 'bulk · done (measured from real outcomes)',
        node: <ThreadCardView card={{
          kind: 'bulk', id: 'cat-bk-4', state: 'done',
          intro: 'Archive 31 messages from Notices.',
          receipt: 'Archived 31 · undo in Activity',
        }} />,
      },
      {
        label: 'bulk · done + the posture tail (the offer)',
        node: <ThreadCardView card={{
          kind: 'bulk', id: 'cat-bk-5', state: 'done',
          intro: 'Archive 31 messages from Notices.',
          receipt: 'Archived 28 of 31 · 3 refused · undo in Activity',
          postureAsk: 'Keep archiving Notices as they arrive?', onKeepDoingThis: noop,
        }} />,
      },
      {
        label: 'bulk · done + the posture read back',
        node: <ThreadCardView card={{
          kind: 'bulk', id: 'cat-bk-6', state: 'done',
          intro: 'Archive 31 messages from Notices.',
          receipt: 'Archived 31 · undo in Activity',
          postureNote: 'Kept: Notices are archived on arrival. Change it any time from Activity.',
        }} />,
      },
      {
        label: 'bulk · pending + error',
        node: <ThreadCardView card={{
          kind: 'bulk', id: 'cat-bk-7', state: 'pending',
          intro: 'Archive 31 messages from Notices.',
          commitLabel: 'Archive them', onCommit: noop, onCancel: noop,
          error: 'That didn’t run — the mailbox refused the batch.',
        }} />,
      },
    ],
  },

  {
    section: 'doc',
    mounts: 'coworker DM · Home thread · run deliveries (the review-first handle)',
    owner: 'lib/documents/doc-card resolves the glyph + type word; Review raises the ONE panel',
    specimens: [
      {
        label: 'doc · word (the full handle + composed intro)',
        node: <ThreadCardView card={{
          kind: 'doc', id: 'cat-dc-1', title: 'Harbor pricing review', docType: 'word',
          typeLabel: 'Word', pages: 12, versionLabel: 'v3', owner: 'Max',
          intro: 'Third pass — the two numbers you flagged are corrected and the appendix is new.',
          onReview: noop,
        }} />,
      },
      {
        label: 'doc · pdf',
        node: <ThreadCardView card={{ kind: 'doc', id: 'cat-dc-2', title: 'Atlas pilot terms', docType: 'pdf', typeLabel: 'PDF', pages: 4, owner: 'Clara', onReview: noop }} />,
      },
      {
        label: 'doc · slides',
        node: <ThreadCardView card={{ kind: 'doc', id: 'cat-dc-3', title: 'Board update — September', docType: 'slides', typeLabel: 'Presentation', pages: 9, onReview: noop }} />,
      },
      {
        label: 'doc · sheet',
        node: <ThreadCardView card={{ kind: 'doc', id: 'cat-dc-4', title: 'Seat pricing model', docType: 'sheet', typeLabel: 'Spreadsheet', onReview: noop }} />,
      },
      {
        label: 'doc · generic (pages unknown, and silent about it)',
        node: <ThreadCardView card={{ kind: 'doc', id: 'cat-dc-5', title: 'Supplier addendum', docType: 'doc', onReview: noop }} />,
      },
      {
        label: 'doc · with a send-deed (the commit row)',
        node: <ThreadCardView card={{
          kind: 'doc', id: 'cat-dc-6', title: 'Atlas onboarding plan', docType: 'word',
          typeLabel: 'Word', pages: 6, owner: 'Max', onReview: noop,
          sendLabel: 'Send it to Jordan', onSend: noop, receipt: 'ready',
        }} />,
      },
      {
        label: 'doc · error',
        node: <ThreadCardView card={{
          kind: 'doc', id: 'cat-dc-7', title: 'Atlas onboarding plan', docType: 'word',
          typeLabel: 'Word', onReview: noop, sendLabel: 'Send it', onSend: noop,
          error: 'That didn’t send — try again.',
        }} />,
      },
    ],
  },

  {
    section: 'source',
    mounts: 'under every ask, decision and brief — THE OPENING CONTRACT, clause 1',
    owner: 'lib/inbox/thread-door.ts serves the tail; the kit clips nothing and reads no clock',
    specimens: [
      {
        label: 'source · email (the thread tail + what came with it)',
        node: <ThreadCardView card={{
          kind: 'source', id: 'cat-so-1', source: 'email',
          who: 'Jordan Vance', when: 'Sep 16', title: 'Re: pilot terms',
          messages: [
            { id: 'sm1', author: 'Jordan Vance', body: 'Thanks — taking this to the board on Thursday. Two things I need first: the early-graduation wording, and whether the platform fee is waived for the whole pilot…' },
            { id: 'sm2', author: 'Mia Ruiz', body: 'Adding our ops lead — she owns the seat rollout on our side.' },
          ],
          files: [{ name: 'pilot-terms.pdf', size: 184_320, onOpen: noop }],
          openLabel: 'Thread →', onOpen: noop,
        }} />,
      },
      {
        label: 'source · meeting (the single excerpt lane)',
        node: <ThreadCardView card={{
          kind: 'source', id: 'cat-so-2', source: 'meeting',
          who: 'Atlas kickoff', when: 'Tue · 32 min', title: 'Atlas kickoff',
          excerpt: 'Agreed the pilot starts on ten seats, with the ops pair joining from week one. Jordan takes the pricing note to the board on Thursday.',
          openLabel: 'Open →', onOpen: noop,
        }} />,
      },
      {
        label: 'source · document (the handle idiom, never the document)',
        node: <ThreadCardView card={{
          kind: 'source', id: 'cat-so-3', source: 'document', who: 'Max',
          title: 'Atlas shortlist — 4 of 11 advanced',
          excerpt: 'Four candidates clear the rubric on every criterion; the two borderline files are noted with the gap that held them back…',
          openLabel: 'Review →', onOpen: noop,
        }} />,
      },
      {
        label: 'source · email, no door and a file that is a FACT (no handler)',
        node: <ThreadCardView card={{
          kind: 'source', id: 'cat-so-4', source: 'email', who: 'Rowan Blake', when: 'Sep 18',
          title: 'Invoice 4192 — payment terms',
          messages: [{ id: 'sm3', author: 'Rowan Blake', body: 'Could you confirm which terms stand?' }],
          files: [{ name: 'invoice-4192.pdf', size: 184_320 }],
        }} />,
      },
    ],
  },

  {
    section: 'collection',
    mounts: 'Home thread · coworker DM — the answer to “what X do I have”',
    owner: 'components/home/collection-card.tsx over lib/present/collection (four kinds)',
    specimens: [
      {
        label: 'collection · workflows — THE HOST (served spec, real verbs)',
        node: (
          <CollectionCard
            spec={{
              kind: 'workflows',
              framing: 'You have 4 workflows — 3 active, 1 draft.',
              rows: [
                { id: 'w1', title: 'Weekly tender briefing', status: { word: 'active', tone: 'active' }, meta: 'Max · every Monday 08:00 · ran 5d ago', owner: 'Max', state: 'active' },
                { id: 'w2', title: 'CV triage — ops opening', status: { word: 'active', tone: 'active' }, meta: 'Clara · when an application arrives', owner: 'Clara', state: 'active', facts: { asksForMaterial: true } },
                { id: 'w3', title: 'Competitor digest', status: { word: 'paused', tone: 'paused' }, meta: 'Max · every Thursday 08:00', owner: 'Max', state: 'paused' },
                { id: 'w4', title: 'Monthly board note', status: { word: 'draft', tone: 'draft' }, meta: 'never run', state: 'draft' },
              ],
            }}
            onAsk={noop}
          />
        ),
      },
      {
        label: 'collection · documents (the kit — a cap is never silent)',
        node: <ThreadCardView card={{
          kind: 'collection', id: 'cat-cl-2',
          rows: [
            { id: 'f1', title: 'Harbor pricing review.docx', status: { word: 'indexed', tone: 'done' }, meta: 'Word · 12 pages · Sep 16', onOpen: noop, verbs: [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: noop }] },
            { id: 'f2', title: 'Atlas pilot terms.pdf', status: { word: 'indexed', tone: 'done' }, meta: 'PDF · 4 pages · Sep 12', onOpen: noop, verbs: [{ id: 'ask', label: 'Ask about it', tone: 'quiet', onClick: noop }] },
            { id: 'f3', title: 'Seat pricing model.xlsx', status: { word: 'pending', tone: 'attention' }, meta: 'Spreadsheet · still indexing', onOpen: noop },
          ],
          more: { count: 12, onOpen: noop },
        }} />,
      },
      {
        label: 'collection · a row’s life (two-step verb · receipt · error · a verb with no hands)',
        node: <ThreadCardView card={{
          kind: 'collection', id: 'cat-cl-3', title: 'Your workflows',
          rows: [
            { id: 'r1', title: 'Weekly tender briefing', status: { word: 'active', tone: 'active' }, meta: 'Max · every Monday 08:00', face: { id: 'max', name: 'Max' }, onOpen: noop, verbs: [{ id: 'pause', label: 'Pause', tone: 'quiet', onClick: noop }, { id: 'run', label: 'Run now', confirm: { label: 'Run it' }, onClick: noop }] },
            { id: 'r2', title: 'Client radar', status: { word: 'active', tone: 'active' }, meta: 'Max · every Monday 07:00', face: { id: 'max', name: 'Max' }, receipt: 'running' },
            { id: 'r3', title: 'Competitor digest', status: { word: 'paused', tone: 'paused' }, meta: 'Max · every Thursday 08:00', onOpen: noop, verbs: [{ id: 'undo', label: 'undo', tone: 'quiet', onClick: noop }] },
            { id: 'r4', title: 'Invoice chaser', status: { word: 'active', tone: 'active' }, meta: 'Clara · every weekday 17:00', onOpen: noop, verbs: [{ id: 'pause', label: 'Pause', tone: 'quiet' }], error: 'That could not be changed — try again.' },
            { id: 'r5', title: 'Quarterly renewals sweep', status: { word: 'paused', tone: 'paused' }, meta: 'Clara · every quarter', onOpen: noop, verbs: [{ id: 'resume', label: 'Resume', tone: 'quiet', onClick: noop }] },
          ],
        }} />,
      },
      {
        label: 'collection · calendar (read-only) + a row that opens IN PLACE',
        node: <ThreadCardView card={{
          kind: 'collection', id: 'cat-cl-4',
          rows: [
            { id: 'e0', title: 'Company offsite', status: { word: 'all day', tone: 'neutral' }, meta: 'Thursday' },
            { id: 'e1', title: 'Pipeline review', meta: '09:30 – 10:00 · 3 people', onOpen: noop },
            { id: 'e2', title: 'Free', status: { word: 'free', tone: 'done' }, meta: '10:00 – 12:30' },
            {
              id: 'e3', title: 'Atlas kickoff', meta: '14:00 – 14:30 · Jordan, Mia', onOpen: noop,
              expanded: <ThreadCardView card={{ kind: 'event', id: 'cat-cl-ev', title: 'Atlas kickoff', dayLabel: 'Tue 23 Sep', timeLabel: '14:00–14:30', attendeesLine: 'with Jordan Vance, Mia Ruiz', standing: 'accepted', verbs: [] }} />,
            },
          ],
        }} />,
      },
      {
        label: 'collection · the fold (past COLLECTION_INLINE_ROWS)',
        node: <ThreadCardView card={{
          kind: 'collection', id: 'cat-cl-5',
          rows: Array.from({ length: 9 }, (_, i) => ({
            id: `fold-${i}`, title: `Recording ${i + 1}`,
            status: { word: 'ready' as const, tone: 'done' as const },
            meta: 'Mon · 24 min', onOpen: noop,
          })),
        }} />,
      },
      {
        label: 'collection · empty',
        node: <ThreadCardView card={{ kind: 'collection', id: 'cat-cl-6', rows: [], emptyLine: 'No workflows yet.' }} />,
      },
    ],
  },

  {
    section: 'event',
    mounts: 'Home thread · coworker DM · inside a calendar collection row',
    owner: 'components/home/event-card.tsx over lib/present/event (the verb ladder is SERVED)',
    specimens: [
      {
        label: 'event · invitee, no reply — THE HOST (the real ladder, the real deed door)',
        node: (
          <EventCard
            spec={{
              id: 'preview-event', title: 'Atlas × Northwind — kickoff',
              dayLabel: 'Tue 23 Sep', timeLabel: '14:00–15:00',
              startISO: '2026-09-23T14:00:00.000Z', endISO: '2026-09-23T15:00:00.000Z',
              attendees: ['Sam Ortega', 'Jordan Vance'], moreAttendees: 2,
              location: 'Meeting room 2',
              facts: { seat: 'invitee', myResponse: null, passed: false, allDay: false, writable: true },
              verbs: ['accept', 'tentative', 'decline'],
            }}
          />
        ),
      },
      {
        label: 'event · invitee, accepted (the ladder drops the answer already given)',
        node: <ThreadCardView card={{
          kind: 'event', id: 'cat-ev-2', title: 'Weekly ops sync',
          dayLabel: 'Wed 24 Sep', timeLabel: '09:30–10:00',
          attendeesLine: 'with Mia Ruiz, Pat Winters', standing: 'accepted',
          verbs: [
            { id: 'tentative', label: 'Maybe', armedLabel: 'Confirm maybe', onConfirm: noop },
            { id: 'decline', label: 'Decline', armedLabel: 'Confirm decline', notable: true, onConfirm: noop },
          ],
        }} />,
      },
      {
        label: 'event · organizer (both verbs irreversible; reschedule raises the picker)',
        node: <ThreadCardView card={{
          kind: 'event', id: 'cat-ev-3', title: 'Pricing review',
          dayLabel: 'Thu 25 Sep', timeLabel: '11:00–11:45',
          attendeesLine: 'with Sam Ortega, Mia Ruiz, Jordan Vance +4', standing: 'you organise',
          verbs: [
            { id: 'reschedule', label: 'Reschedule', armedLabel: 'Confirm new time', needsWindow: true, consequence: 'Everyone invited gets the update.', onConfirm: noop },
            { id: 'cancel', label: 'Cancel', armedLabel: 'Confirm cancel', notable: true, consequence: 'Everyone invited gets the cancellation.', onConfirm: noop },
          ],
          pickerDefaults: { date: '2026-09-25', time: '11:00', durationMin: 45 },
        }} />,
      },
      {
        label: 'event · armed by a proposal (decline, with its drafted note)',
        node: <ThreadCardView card={{
          kind: 'event', id: 'cat-ev-4', title: 'Vendor intro call',
          dayLabel: 'Tue 23 Sep', timeLabel: '16:00–16:30', attendeesLine: 'with Pat Winters',
          standing: 'no reply yet', armedVerbId: 'decline',
          note: 'Sorry — I’m double-booked. Happy to take this next week.',
          verbs: [
            { id: 'accept', label: 'Accept', armedLabel: 'Confirm accept', onConfirm: noop },
            { id: 'decline', label: 'Decline', armedLabel: 'Confirm decline', notable: true, onConfirm: noop },
          ],
        }} />,
      },
      {
        label: 'event · armed by a proposal (reschedule — the window stands beside its confirmation)',
        node: <ThreadCardView card={{
          kind: 'event', id: 'cat-ev-5', title: 'Harbor renewal — working session',
          dayLabel: 'Wed 24 Sep', timeLabel: '10:00–10:30',
          attendeesLine: 'with Sam Ortega, Mia Ruiz', standing: 'you organise',
          armedVerbId: 'reschedule', proposedLabel: 'Thu 25 Sep · 10:00–10:30',
          verbs: [
            { id: 'reschedule', label: 'Reschedule', armedLabel: 'Confirm new time', needsWindow: true, consequence: 'Everyone invited gets the update.', onConfirm: noop },
            { id: 'cancel', label: 'Cancel', armedLabel: 'Confirm cancel', notable: true, onConfirm: noop },
          ],
        }} />,
      },
      {
        label: 'event · busy (a verb in flight)',
        node: <ThreadCardView card={{
          kind: 'event', id: 'cat-ev-6', title: 'Vendor intro call',
          dayLabel: 'Tue 23 Sep', timeLabel: '16:00–16:30', standing: 'no reply yet',
          armedVerbId: 'decline',
          verbs: [{ id: 'decline', label: 'Decline', armedLabel: 'Confirm decline', notable: true, busy: true, onConfirm: noop }],
        }} />,
      },
      {
        label: 'event · done (a spent deed keeps no button)',
        node: (
          <div className="flex flex-col gap-2">
            <ThreadCardView card={{ kind: 'event', id: 'cat-ev-7', title: 'Vendor intro call', dayLabel: 'Tue 23 Sep', timeLabel: '16:00–16:30', attendeesLine: 'with Pat Winters', standing: 'declined', done: 'Declined' }} />
            <ThreadCardView card={{ kind: 'event', id: 'cat-ev-8', title: 'Harbor renewal — working session', dayLabel: 'Thu 25 Sep', timeLabel: '10:00–10:30', standing: 'you organise', done: 'Moved to Thu 25 Sep · 10:00–10:30' }} />
          </div>
        ),
      },
      {
        label: 'event · quiet (the ladder permits nothing — past · read-only)',
        node: (
          <div className="flex flex-col gap-2">
            <ThreadCardView card={{ kind: 'event', id: 'cat-ev-9', title: 'Board prep', dayLabel: 'Mon 15 Sep', timeLabel: '08:30–09:00', attendeesLine: 'with Mia Ruiz', standing: 'accepted', verbs: [], quietLine: 'This one’s in the past.' }} />
            <ThreadCardView card={{ kind: 'event', id: 'cat-ev-10', title: 'Company offsite', dayLabel: 'Fri 26 Sep', timeLabel: 'all day', attendeesLine: 'with the whole team', verbs: [], quietLine: 'Read-only calendar.' }} />
          </div>
        ),
      },
      {
        label: 'event · error',
        node: <ThreadCardView card={{
          kind: 'event', id: 'cat-ev-11', title: 'Pipeline review',
          dayLabel: 'Wed 24 Sep', timeLabel: '15:00–15:30', attendeesLine: 'with Jordan Vance',
          standing: 'no reply yet',
          verbs: [
            { id: 'accept', label: 'Accept', armedLabel: 'Confirm accept', onConfirm: noop },
            { id: 'decline', label: 'Decline', armedLabel: 'Confirm decline', notable: true, onConfirm: noop },
          ],
          error: 'That’s no longer possible — this event has changed since the card was drawn.',
        }} />,
      },
    ],
  },

  {
    section: 'decision',
    mounts: 'project room · item room · Home thread (the judged question)',
    owner: 'components/home/decision-card.tsx over the steer door (lib/room/decision-object)',
    specimens: [
      {
        label: 'decision · open — THE HOST (with THE ONE OBJECT CARD under the ask)',
        node: (
          <DecisionCard
            id="cat-dec-host"
            spec={{
              itemKind: 'email', itemId: 'preview-item',
              title: 'Rowan needs an answer on the invoice terms before month end.',
              options: [
                { label: 'Confirm 30 days and ask finance to correct it', tradeoff: 'Commits us to the original terms.' },
                { label: 'Ask for their copy of the signed agreement first', tradeoff: 'Adds a few days before anything is settled.' },
              ],
            }}
            objectNode={SOURCE_EMAIL_NODE}
            onDismiss={noop}
          />
        ),
      },
      {
        label: 'decision · open (kit — the marked recommendation and its why)',
        node: <ThreadCardView card={{
          kind: 'decision', id: 'cat-de-1', state: 'open',
          question: 'Jordan needs an answer on the shortlist before Thursday’s board.',
          objectNode: SOURCE_EMAIL_NODE,
          options: [
            { id: 'o1', label: 'Advance all four to interviews', recommended: true, consequence: 'Interviews start next week; the two borderline files stay on file.', why: 'All four clear the rubric on every criterion, and the slot count matches the hiring plan you approved.' },
            { id: 'o2', label: 'Advance two, ask for more on the rest', consequence: 'Adds about a week before interviews can start.' },
            { id: 'o3', label: 'Send it back for a wider search', consequence: 'Resets the timeline; the board sees nothing on Thursday.' },
          ],
          confirmLabel: 'Go with this', onConfirm: noop, onDismiss: noop,
        }} />,
      },
      {
        label: 'decision · open, nothing to review (so nothing is recommended)',
        node: <ThreadCardView card={{
          kind: 'decision', id: 'cat-de-2', state: 'open',
          question: 'Jordan needs an answer on the shortlist before Thursday’s board.',
          quietLine: 'Nothing is attached to review yet.',
          options: [
            { id: 'o1', label: 'Advance all four to interviews' },
            { id: 'o2', label: 'Advance two, ask for more on the rest' },
          ],
          onConfirm: noop, onDismiss: noop,
        }} />,
      },
      {
        label: 'decision · open, armed (the second click is the deed)',
        node: <ThreadCardView card={{
          kind: 'decision', id: 'cat-de-3', state: 'open', armedOptionId: 'o1',
          question: 'Jordan needs an answer on the shortlist before Thursday’s board.',
          options: [
            { id: 'o1', label: 'Advance all four to interviews', recommended: true, consequence: 'Interviews start next week.' },
            { id: 'o2', label: 'Advance two, ask for more on the rest' },
          ],
          confirmLabel: 'Go with this', onConfirm: noop, onDismiss: noop,
        }} />,
      },
      {
        label: 'decision · busy',
        node: <ThreadCardView card={{
          kind: 'decision', id: 'cat-de-4', state: 'busy',
          question: 'Jordan needs an answer on the shortlist before Thursday’s board.',
          options: [
            { id: 'o1', label: 'Advance all four to interviews', recommended: true },
            { id: 'o2', label: 'Advance two, ask for more on the rest' },
          ],
          onConfirm: noop, onDismiss: noop,
        }} />,
      },
      {
        label: 'decision · settled',
        node: <ThreadCardView card={{
          kind: 'decision', id: 'cat-de-5', state: 'settled',
          question: 'Jordan needs an answer on the shortlist before Thursday’s board.',
          objectNode: SOURCE_EMAIL_NODE,
          options: [{ id: 'o1', label: 'Advance all four to interviews' }],
          settledLine: 'Chosen: Advance all four to interviews',
        }} />,
      },
      {
        label: 'decision · open + error',
        node: <ThreadCardView card={{
          kind: 'decision', id: 'cat-de-6', state: 'open',
          question: 'Jordan needs an answer on the shortlist before Thursday’s board.',
          options: [{ id: 'o1', label: 'Advance all four to interviews' }, { id: 'o2', label: 'Send it back for a wider search' }],
          onConfirm: noop, onDismiss: noop, error: 'That didn’t land — try again.',
        }} />,
      },
    ],
  },

  {
    section: 'forward',
    mounts: 'item room · deep-dive artifact row (the prepared forward, as itself)',
    owner: 'components/home/forward-card.tsx — it READS its prepared artifact on mount, so this index '
      + 'mounts the KIT card rather than pointing a host at a fabricated entity id',
    specimens: [
      {
        label: 'forward · ready (the message folded underneath)',
        node: <ThreadCardView card={{
          kind: 'forward', id: 'cat-fw-1', state: 'ready',
          to: ['finance@northwind.example'], subject: 'Fwd: Invoice 4192 — payment terms',
          note: 'Can you confirm which terms we have on file for this one?', onEditNote: noop,
          sourceNode: SOURCE_EMAIL_NODE, onSend: noop, onCancel: noop, receipt: 'ready to forward',
        }} />,
      },
      {
        label: 'forward · needs_recipient (no Send at all)',
        node: <ThreadCardView card={{
          kind: 'forward', id: 'cat-fw-2', state: 'needs_recipient',
          to: [], subject: 'Fwd: Invoice 4192 — payment terms',
          note: 'Can you confirm which terms we have on file for this one?', onEditNote: noop,
          sourceNode: SOURCE_EMAIL_NODE, onCancel: noop,
        }} />,
      },
      {
        label: 'forward · ready + busy (the commit in flight)',
        node: <ThreadCardView card={{
          kind: 'forward', id: 'cat-fw-3', state: 'ready', busy: true,
          to: ['finance@northwind.example'], subject: 'Fwd: Invoice 4192 — payment terms',
          note: 'Can you confirm which terms we have on file for this one?', onEditNote: noop,
          sourceNode: SOURCE_EMAIL_NODE, onSend: noop, onCancel: noop, receipt: 'forwarding…',
        }} />,
      },
      {
        label: 'forward · ready + loading (the prepare read is still in flight)',
        node: <ThreadCardView card={{
          kind: 'forward', id: 'cat-fw-4', state: 'ready', loading: true,
          to: ['finance@northwind.example'], subject: 'Fwd: Invoice 4192 — payment terms',
          sourceNode: SOURCE_EMAIL_NODE, onSend: noop, onCancel: noop,
        }} />,
      },
      {
        label: 'forward · sent (a spent deed keeps only its receipt)',
        node: <ThreadCardView card={{
          kind: 'forward', id: 'cat-fw-5', state: 'sent',
          to: ['finance@northwind.example'], subject: 'Fwd: Invoice 4192 — payment terms',
          note: 'Can you confirm which terms we have on file for this one?',
          sourceNode: SOURCE_EMAIL_NODE, receipt: 'Forwarded to finance@northwind.example.',
        }} />,
      },
      {
        label: 'forward · ready + error',
        node: <ThreadCardView card={{
          kind: 'forward', id: 'cat-fw-6', state: 'ready',
          to: ['finance@northwind.example'], subject: 'Fwd: Invoice 4192 — payment terms',
          onEditNote: noop, sourceNode: SOURCE_EMAIL_NODE, onSend: noop, onCancel: noop,
          error: 'Could not forward the email.',
        }} />,
      },
    ],
  },

  {
    section: 'confirm',
    mounts: 'item room (the looks-done question — the machine’s looks_done state, W16.2)',
    owner: 'components/home/item-detail.tsx confirmCardOf (Mark done = the item’s own done door · Keep open = POST /api/work/looks-done)',
    specimens: [
      {
        label: 'confirm · open (the evidence line + "Mark done" / "Keep open")',
        node: <ThreadCardView card={{ kind: 'confirm', id: 'cat-cf-1', state: 'open', line: 'You replied on Sep 23', onDone: noop, onKeep: noop }} />,
      },
      {
        label: 'confirm · busy (a deed in flight — the verbs stand down)',
        node: <ThreadCardView card={{ kind: 'confirm', id: 'cat-cf-2', state: 'busy', line: 'Sam delivered it on Sep 3', onDone: noop, onKeep: noop }} />,
      },
      {
        label: 'confirm · settled (kept open — no verbs, one receipt line)',
        node: <ThreadCardView card={{ kind: 'confirm', id: 'cat-cf-3', state: 'settled', line: 'You met on Sep 3', settledLine: 'Kept open — it comes back if something new arrives.' }} />,
      },
    ],
  },

  {
    section: 'custom',
    mounts: 'every surface — THE CARD SLOT: a host mounts its own rich component whole',
    owner: 'the host’s component; the kit only reserves the 560px seat',
    specimens: [
      {
        label: 'custom · a host component mounted whole (the gate)',
        node: <ThreadCardView card={{
          kind: 'custom', id: 'cat-cu-1',
          node: (
            <ApprovalCard
              id="cat-custom-gate"
              spec={{
                runId: 'preview-run-2', title: 'Approve the tender shortlist',
                gateKind: 'approval', meta: 'From the workflow Tender matching · run of today',
                steps: { done: 3, total: 4 },
              }}
            />
          ),
        }} />,
      },
      {
        label: 'custom · an arbitrary node (a mention/attachment chip row riding a user turn)',
        node: <ThreadCardView card={{
          kind: 'custom', id: 'cat-cu-2',
          node: (
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11.5px] text-indigo-700">@Max</span>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11.5px] text-violet-700">Atlas pilot terms.pdf</span>
            </div>
          ),
        }} />,
      },
    ],
  },
];

// ── THE PIECES — everything in the kit that is NOT a card ───────────────────────────────────────

const PIECE_TIMELINE: ThreadItem[] = [
  {
    type: 'pinned', id: 'pc-pin', actorId: 'clara', actorName: 'Clara', actorRoleLabel: 'chief of staff',
    text: 'Jordan and Mia accepted Wednesday’s kickoff — the slot still needs your confirmation so the invitation can go out.',
    actions: [
      { label: 'Confirm Wednesday 11:00 →', onClick: noop, tone: 'primary' },
      { label: 'Propose another time', onClick: noop, tone: 'link' },
    ],
  },
  { type: 'divider', id: 'pc-div', variant: 'day', label: 'Today' },
  {
    type: 'event_line', id: 'pc-since',
    text: 'Since you were here — the pricing brief went out Tuesday · 2 low-stakes items settled quietly',
    refs: [{ label: 'the brief', onClick: noop }],
  },
  { type: 'user_bubble', id: 'pc-u1', text: 'what’s slipping this week?' },
  {
    type: 'actor_bubble', id: 'pc-a1', actorId: 'max', actorName: 'Max', actorRoleLabel: 'research & briefings',
    ts: '09:40', text: 'Two things. The Atlas kickoff slot, and the collection notice that needs a reference only you have.',
  },
  // THE SLACK GROUPING RULE — the second and third bubbles share the first one's face+name header.
  { type: 'actor_bubble', id: 'pc-a2', actorId: 'max', actorName: 'Max', text: 'Everything else is on pace.' },
  { type: 'actor_bubble', id: 'pc-a3', actorId: 'max', actorName: 'Max', text: 'I’ll flag the moment Jordan comes back.' },
  {
    type: 'actor_bubble', id: 'pc-a4', actorId: 'clara', actorName: 'Clara', ts: '09:41', status: 'needs_you',
    statusHint: 'Clara needs your approval on the onboarding plan',
    text: 'A change of speaker is what raises a header — the run above shared one.',
  },
  {
    type: 'working_line', id: 'pc-work', actorId: 'luca', actorName: 'Luca',
    line: 'Luca is researching Atlas’ current stack — a few minutes',
  },
];

/** THE TRACE LINE, IN ITS THREE STATES (Sep 22 — the coworker's receipt layer).
 *
 *  These are the ONLY inputs the item takes: `{tool, ok}`. Every word on screen is composed by
 *  `traceLine` from the ONE wording table (lib/work/trace.ts) — which is exactly why this block can
 *  be written as machine facts and still be an honest specimen of what the reader sees.
 *    · IN PROGRESS   — one entry, no outcome yet: present tense.
 *    · ONE RECEIPT   — that same call, settled: past tense, in place.
 *    · THE FOLD      — the whole turn's consults on one line, WITH A FAILURE INSIDE (the case a
 *                      dedupe must never swallow: a refusal is not a variant of a success). */
const PIECE_TRACE: Array<{ label: string; items: ThreadItem[] }> = [
  { label: 'trace · in progress', items: [{ type: 'trace_line', id: 'tr-1', entries: [{ tool: 'check_calendar' }] }] },
  { label: 'trace · one receipt', items: [{ type: 'trace_line', id: 'tr-2', entries: [{ tool: 'check_calendar', ok: true }] }] },
  {
    label: 'trace · the fold, with a failure inside',
    items: [{
      type: 'trace_line', id: 'tr-3',
      entries: [
        { tool: 'check_calendar', ok: true },
        { tool: 'search_knowledge_base', ok: true },
        { tool: 'get_emails', ok: true },
        { tool: 'slack_read_messages', ok: false },
      ],
    }],
  },
];

/** THE COMPOSER ACCESSORIES — the Home's own seat furniture. The markup of these two chips lives
 *  inline in components/home/home-ask.tsx (it is not an exported component), so what is REAL here
 *  is the seat: the product's own composer, taking an accessory exactly as the Home hands it one. */
function TemporaryChip() {
  return (
    <span className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-500">
      Temporary — not saved
    </span>
  );
}
function ScopeChip() {
  return (
    <span className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-indigo-600">
      Atlas Pilot ✓
    </span>
  );
}

function PiecesBlock() {
  // THE ORB'S SEAT, DRIVEN DIRECTLY: `useOrbEntrance` plays its choreography ONCE per page load
  // (a module-level flag), which a catalogue must not consume. The seat itself is the real
  // component and the caption is its own — the phase is simply handed to it here.
  const seatRef = React.useRef<HTMLSpanElement>(null);
  const flyRef = React.useRef<HTMLSpanElement>(null);
  const coldEntrance: OrbEntrance = { phase: 'cold', seatRef, flyRef, veil: () => ({}) };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 border-t border-neutral-200/70 pt-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[13px] font-semibold text-neutral-900">the header</h2>
          <p className="text-[11.5px] text-neutral-400">components/thread/thread-header.tsx · all four marks, the DM form, the faces</p>
        </div>
        <div className="flex flex-col gap-2">
          {(['active', 'quiet', 'blocked', 'done'] as const).map((st) => (
            <ThreadHeader key={st} title="Atlas Pilot" state={st} stateLabel={st === 'active' ? 'Active' : undefined}
              faces={[{ id: 'jordan', name: 'Jordan' }, { id: 'mia', name: 'Mia' }, { id: 'clara', name: 'Clara' }, { id: 'max', name: 'Max', status: 'working' }]} />
          ))}
          <ThreadHeader title="Max" leadFace={{ id: 'max', name: 'Max', status: 'working' }}
            subtitle="Research & briefings · 2 workflows running" />
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-neutral-200/70 pt-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[13px] font-semibold text-neutral-900">the avatar ring</h2>
          <p className="text-[11.5px] text-neutral-400">components/thread/avatar-status.tsx · the face IS the status system</p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          {(['idle', 'working', 'needs_you', 'blocked'] as const).map((s) => (
            <span key={s} className="flex items-center gap-2">
              <AvatarStatus name={s === 'idle' ? 'Clara' : s === 'working' ? 'Max' : 'Luca'} actorId={s} size={28} status={s} count={2} hint={`${s} state`} />
              <span className="font-mono text-[11px] text-neutral-400">{s}</span>
            </span>
          ))}
          <span className="flex items-center gap-2">
            <AvatarStatus name="Ops assistant" actorId="custom-worker" size={28} status="working" hint="a custom worker — the accent derives from its id" />
            <span className="font-mono text-[11px] text-neutral-400">a custom worker</span>
          </span>
          <span className="flex items-center gap-2">
            <FacePile faces={[{ id: 'jordan', name: 'Jordan' }, { id: 'mia', name: 'Mia' }, { id: 'clara', name: 'Clara' }, { id: 'max', name: 'Max', status: 'needs_you', count: 1 }, { id: 'luca', name: 'Luca' }]} onClick={noop} label="In this room" />
            <span className="font-mono text-[11px] text-neutral-400">the pile (+N)</span>
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-neutral-200/70 pt-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[13px] font-semibold text-neutral-900">the timeline’s items</h2>
          <p className="text-[11.5px] text-neutral-400">
            components/thread/thread-timeline.tsx · the pinned opening · the day divider · the event line
            (“Since you were here”) · the user bubble · a grouped actor run · the working line
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200/70 bg-[#F9FAFB] p-4">
          <ThreadTimeline items={PIECE_TIMELINE} />
        </div>
        {/* THE TRACE LINE — a receipt is a DELTA, so it is an item in the event-line grammar and
            never a card (a card is a thing you can act on). It renders through the timeline's own
            muted-line piece; these three specimens are the whole state space. */}
        <div className="flex flex-col gap-3">
          <p className="text-[11.5px] text-neutral-400">
            the trace line · components/thread/thread-timeline.tsx (the event-line piece) · words from
            lib/work/trace.ts — a tool with no word in that table renders nothing, never its id
          </p>
          {PIECE_TRACE.map((t) => (
            <SpecimenBlock key={t.label} label={t.label} node={<ThreadTimeline items={t.items} />} />
          ))}
        </div>
        {/* THE RETIRED FOLD, NAMED RATHER THAN REDRAWN (Sep 14, owner): the timeline's "earlier (N)"
            handle was DELETED when the record moved to the ONE drawer. There is no producer and no
            renderer, so this index shows nothing for it — a catalogue that drew it would resurrect a
            repealed law as a picture. */}
        <p className="text-[11.5px] leading-[1.5] text-neutral-400">
          The “earlier (N)” fold is not here: it was retired on Sep 14 when the record moved to the one
          drawer, and its handle was deleted rather than left unfed. The room’s past lives in
          components/room/filed-drawer.tsx, which is a host surface, not a kit piece.
        </p>
      </section>

      <section className="flex flex-col gap-4 border-t border-neutral-200/70 pt-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[13px] font-semibold text-neutral-900">the composer</h2>
          <p className="text-[11.5px] text-neutral-400">
            components/thread/thread-composer.tsx (the kit’s own) · and the SEAT taken whole by the
            product’s WorkerMentionInput, which is what the Home and every DM actually mount
          </p>
        </div>
        <div className="flex flex-col gap-5">
          <SpecimenBlock label="composer · default" node={<ThreadComposer placeholder="Ask anything — @ mentions your team" />} />
          <SpecimenBlock label="composer · with utterance chips" node={
            <ThreadComposer placeholder="Ask anything — @ mentions your team"
              chips={[{ label: 'Plan my week', onClick: noop }, { label: 'What did I miss?', onClick: noop }, { label: 'Add a task', onClick: noop }]} />
          } />
          <SpecimenBlock label="composer · the slots filled (mention · attach · trailing)" node={
            <ThreadComposer
              placeholder="Message the team — @ hands it to someone"
              mentionSlot={<span className="text-[12px] font-medium text-indigo-600">@ Mention</span>}
              attachSlot={<span className="text-[12px] font-medium text-indigo-600">Attach</span>}
              trailingSlot={<ScopeChip />}
            />
          } />
          <SpecimenBlock label="composer · disabled" node={<ThreadComposer placeholder="Sending…" disabled />} />
          <SpecimenBlock label="composer · the product’s own (type @ for the mention picker)" node={
            <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
              <WorkerMentionInput frameless onSubmit={noop} placeholder="Ask anything — @ mentions your team" />
            </div>
          } />
          <SpecimenBlock label="composer · temporary armed" node={
            <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
              <WorkerMentionInput frameless onSubmit={noop} placeholder="Ask anything — @ mentions your team" accessory={<TemporaryChip />} />
            </div>
          } />
          <SpecimenBlock label="composer · a project scope chip + a buffered attachment" node={
            <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
              <WorkerMentionInput
                frameless onSubmit={noop} placeholder="Ask anything — @ mentions your team"
                accessory={<ScopeChip />}
                attachments={[{ id: 'a1', name: 'Atlas pilot terms.pdf', size: 184_320 }]}
                onRemoveAttachment={noop}
              />
            </div>
          } />
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-neutral-200/70 pt-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[13px] font-semibold text-neutral-900">the mark</h2>
          <p className="text-[11.5px] text-neutral-400">components/home/alive-mark.tsx (the eyes, seated Sep 20) · components/home/orb-entrance.tsx</p>
        </div>
        <div className="flex flex-wrap items-start gap-12 pb-10">
          <span className="flex flex-col items-center gap-2">
            <AliveMark size={70} mood="calm" />
            <span className="font-mono text-[11px] text-neutral-400">calm</span>
          </span>
          <span className="flex flex-col items-center gap-2">
            <AliveMark size={70} mood="working" loading />
            <span className="font-mono text-[11px] text-neutral-400">working</span>
          </span>
          <span className="flex flex-col items-center gap-2">
            <OrbSeat entrance={coldEntrance} size={70} loading />
            <span className="mt-8 font-mono text-[11px] text-neutral-400">the entrance caption (cold)</span>
          </span>
        </div>
      </section>
    </div>
  );
}

// ── the tab ─────────────────────────────────────────────────────────────────────────────────────

export function ThreadCatalogue() {
  return (
    <div className="min-h-0 flex-grow overflow-y-auto bg-white">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-8 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-[18px] font-semibold text-neutral-900">The catalogue</h1>
          <p className="text-[12px] leading-[1.6] text-neutral-500">
            Every kind the thread kit owns ({THREAD_CARD_KINDS.length} of them), in every state its contract can
            be in — rendered through the real components, and through the real hosts wherever a host owns the
            kind’s data. The five tabs beside this one are scenario walks; this one is the index.
          </p>
        </div>
        {SECTIONS.map((s) => <SectionBlock key={s.section} s={s} />)}
        <PiecesBlock />
      </div>
    </div>
  );
}

export default ThreadCatalogue;
