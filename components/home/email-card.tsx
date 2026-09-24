'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { announceDeed } from '@/lib/room/deed-echo';
import { ThreadCardView, type ThreadCard } from '@/components/thread';
import { AttendeeChips } from '@/components/home/people-chips';
import KbFilePicker from '@/components/inbox/kb-file-picker';
// THE ONE VIEWER (T25.4) — the item drawer, the shared thread renderer and the project room all
// raise THIS one; the card is simply another mount of it, never a second file modal.
import { AttachmentLightbox, type LightboxFile } from '@/components/ui/attachment-lightbox';
import { useFeatures } from '@/context/workspace-context';
import {
  emailCardOf, directionVariantId, emailBodyHTML, emailBodyText, sameBody,
  EMAIL_BASE_VARIANT, EMAIL_OPEN_VARIANT, EMAIL_USER_VARIANT, EMAIL_TONES, sendFromLabel,
  stagedFilesOf, UNATTACHED_CLAIM_NOTE,
  type EmailDirection, type StandaloneEmailDraft, type StagedFile,
} from '@/lib/prepare/email-card';
// W13 · the ONE attachment claim (pure, client-safe) — the card re-vets the words against its chips.
import { claimsUnstagedAttachment } from '@/lib/prepare/truth';
import { draftReadinessOf, mayClaimReady, EMPTY_DRAFT_NOTE } from '@/lib/prepare/card-readiness'; // W15.2

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EMAIL CARD'S HOST (docs/threads-plan.md — THE CARD CONTRACT, the `email_draft` clause).
//
// The kit renders; this file DOES. It is the successor of `EmailDraftCard`, which retires with it:
// the donor's mechanics — the editable recipients/subject/body, the coworker send with its
// `draftId` write-back — survive byte-for-byte; only the presentation moved to the kit's `email`
// card, so the SAME card renders in the item room, in a coworker DM, and in the Home thread.
//
// ONE HOST, TWO DOORS, THREE PRODUCERS — the commit DESCRIPTOR decides where Send goes:
//   · `item`     the prepared reply on an inbox item → /api/inbox/<id>/send-reply (as the USER,
//                through their own connected mailbox; exactly-once by the route's content hash).
//   · `coworker` a coworker's drafted email in a DM → /api/work/threads/<id>/send-coworker-email
//                (as the COWORKER, Resend; the route stamps `sent_at` on the draft so a reload
//                finds it sent).
//   · the CHIEF's own answer in the Home thread is the `coworker` descriptor with the delegated
//                thread's binding — the same door, deliberately not a third one.
// Every Send is the user's own click. No producer path may mail anything.
//
// Laws honoured here:
//  · FILLED FROM THE ONE GROUNDING — the item lane reads the SAME prepared draft the pass wrote
//    and the room brief already speaks (/api/inbox/<id>/draft); it never re-drafts on its own.
//  · OPTIONS ARE REASONED — the tabs are the reply-directions organ's own directions, and a
//    variant beyond the first REGENERATES THROUGH THE ONE REDRAFT PATH (/api/items/steer, the one
//    conversation core), lazily, cached per variant. There is no second drafter here.
//  · THE EDIT IS THE USER'S, AND IT NEVER KILLS A CONTROL (owner walk, Sep 9) — a real change to
//    the words (compared as CONTENT, never inferred from a click) gives the user their own leading
//    tab; every machine tab stays live, and coming back to "Your edit" returns their words exactly.
//    A machine version never overwrites theirs; nothing is lost, and nothing renders inert.
//  · EVERY REGENERATING CLICK SHOWS ITSELF — a variant, a tone, a typed steer puts the card in its
//    working state within the same frame (the body pulses, the commit row stands down).
//  · THE THREAD IS NEVER INLINED — the door points at the room that already renders the thread.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The coworker lane's draft, exactly the shape `compose_email` mints (lib/tools/coworker-email). */
export interface CoworkerEmailDraft {
  id?: string; to: string[]; cc: string[]; subject: string; body: string;
  from: string; fromName: string; sent_at?: string;
}

/** What rides a send as an attachment — exactly the inbox reply's own base64 shape. */
type PendingAttachment = { filename: string; content: string; mimeType: string };
/** ~4 MB JSON body budget; base64 inflates ~1.37×, so the raw cap keeps the request under it. */
const ATTACH_MAX_TOTAL_BYTES = 3_800_000;

/** PRE-GENERATION IS BOUNDED: at most this many direction tabs are warmed, one at a time… */
const PREGEN_MAX = 3;
/** …and only once the card has been sitting still this long (never during the first paint). */
const PREGEN_IDLE_MS = 1000;

export function EmailCard({ item, coworker, standalone, compose, sourceFiles, onOpenThread, onSent, preparedBody }: {
  /** THE ITEM LANE — the prepared reply on a judged inbox item. `to`/`subject` come from the room
   *  when the host already serves them; otherwise the card reads the thread itself. */
  item?: { id: string; to?: string[]; subject?: string };
  /** THE COWORKER LANE — a drafted email that arrived WITH its turn (DM, and the Home thread). */
  coworker?: { threadId: string; agentId: string; draft: CoworkerEmailDraft };
  /** THE STANDALONE LANE (Sep 21 — the owner's convergence call: "reuse the email draft component,
   *  and leave the reply-FROM open for the user"). A reply to a message that is in no inbox of
   *  ours — a paste, another mailbox. The payload arrives already drafted and already stored, so
   *  the card fetches nothing; Send commits through /api/emails/send, which re-reads THAT row.
   *  Its one extra fact is the FROM: resolved by the pure ladder, chosen here where several. */
  standalone?: { emailId: string; draft: StandaloneEmailDraft };
  /** THE COMPOSE LANE (W7.3 ONE STAGE — Sep 23). A commitment's prepared message: the SAME card the
   *  inbox reply wears, in the conversation — never the retired split-stage ComposePanel. Filled by
   *  /api/compose/draft (the pooled nudge through THE ONE READER, addressed by THE ONE ADDRESSEE
   *  LADDER); Send commits through /api/compose/send (the commit door, as the user's mailbox or the
   *  assistant's address), carrying what we prepared for the outcome ledger. When nothing resolves
   *  a recipient the card is `needs_recipient`: it ASKS who the message goes to and offers the
   *  candidates the ladder saw — it never ships a placeholder address. */
  compose?: { kind: 'commitment'; id: string };
  /** WHAT CAME WITH THE MESSAGE BEING ANSWERED (owner walk, Sep 10: "wasn't considered in the
   *  email context… nor to open/see the document"). The source thread's own attachments, which the
   *  host already holds — read in the email context, not only in the drawer's Files tab. They are
   *  NOT outgoing files: they open in THE ONE viewer and never ride the send. */
  sourceFiles?: LightboxFile[] | null;
  /** "Open thread" (W15.1 · one label) — the card's own door to the message it is answering.
   *
   *  ⚠️ THE DOOR IS STRUCTURAL NOW (owner, Sep 14: "amazing, much better! just missing the see
   *  email thread… that opens the side panel"). It used to be "supplied only where the raw thread
   *  is NOT already on screen" — a Sep 9 deviation that made sense while a thread pane still stood
   *  beside the card. No room docks the thread any more (it reads in the drawer, or as the room's
   *  focused stage), so the exception has no cases left and a host that forgets the prop simply
   *  loses the door. A host may still OVERRIDE where the door lands — it knows its own drawer —
   *  but on the ITEM lane the card falls back to its item's own address, so the door renders at
   *  EVERY mount of a card that has a thread at all. The coworker lane has no thread to open. */
  onOpenThread?: () => void;
  onSent?: () => void;
  /** W17 · NO WAITING (item lane only) — the prepared words the host ALREADY holds (the item view
   *  serves THE ONE READER's live reply draft). The card paints them at once instead of a skeleton;
   *  the draft door's answer still lands (hand flags · staged files · a correction if the door
   *  regenerated), and never over words the user typed. Absent → the card reads for itself. */
  preparedBody?: string | null;
}) {
  const router = useRouter();
  // THE DOOR ALWAYS RENDERS ON THE ITEM LANE — the host's handler when it has one (it knows where
  // its own thread reads), the item's own address when it doesn't. A card that is answering a real
  // mail thread can never be mounted without a way back to it.
  const openThread = onOpenThread ?? (item ? () => router.push(`/item/${item.id}?kind=email`) : undefined);
  const features = useFeatures();
  // THE TIER LAW: the mailbox reply lane exists only where the workspace has email. The COWORKER
  // lane (Resend, `compose_email`'s own channel) is feature-null and works everywhere — a sovereign
  // workspace drafts and sends coworker mail exactly as any other does.
  const mailboxLane = features.email !== false;

  // THE LANES, named once. `itemLane` is the only one with a thread behind it — directions, tones,
  // a typed steer, attachments and Bcc all belong to it, and a lane whose door cannot carry a field
  // must never render that field (the card never wears a control its send would drop).
  const itemLane = !!item && !coworker && !standalone;
  const composeLane = !!compose && !item && !coworker && !standalone;
  const seededBody = !coworker && !standalone && !!item && !!preparedBody?.trim() ? preparedBody : null;
  const [loading, setLoading] = useState(!coworker && !standalone && !seededBody);
  // THE COMPOSE LANE's honest ask: who the ladder could not choose between (offered, never sent),
  // and the name it resolved without an address.
  const [suggestions, setSuggestions] = useState<Array<{ name: string | null; email: string | null }>>([]);
  const [recipientName, setRecipientName] = useState<string | null>(null);
  // FILLED OR LOADING, NEVER HOLLOW (owner walk round 2, Sep 14). The card was mounted with an id
  // its doors could not resolve (the spine key instead of the row id), so all three fetches came
  // back empty and it rendered an EDITABLE SHELL: placeholder recipients, an empty body under a
  // "click anywhere to edit" hint, no tabs, no Send. Every one of those states is individually
  // lawful — together they are a card pretending to be a workspace over nothing.
  // The law: when the item lane RESOLVES with neither words nor a recipient, there is nothing to
  // edit, and the card says so and points at the thread instead of inviting the user to type into
  // a draft that does not exist. (A draft with a missing recipient is a different, honest state —
  // `needs_recipient` — and is untouched.)
  const [unfilled, setUnfilled] = useState(false);
  const [to, setTo] = useState<string[]>(coworker?.draft.to ?? standalone?.draft.to ?? item?.to ?? []);
  const [cc, setCc] = useState<string[]>(coworker?.draft.cc ?? standalone?.draft.cc ?? []);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState(coworker?.draft.subject ?? standalone?.draft.subject ?? item?.subject ?? '');
  const [body, setBody] = useState(coworker?.draft.body ?? standalone?.draft.body ?? seededBody ?? '');
  // THE SENDING MAILBOX — resolved server-side by the pure ladder, the user's to change where they
  // hold more than one. Purely local until Send: the door re-validates the pick against their own
  // active connections, so a browser can never widen who a message comes from.
  const [fromId, setFromId] = useState<string | null>(standalone?.draft.from?.selectedId ?? null);
  // THE STANDALONE LANE with no connected mailbox falls to the OAuth-free coworker channel — the
  // same fallback the universal compose door has always had, and the card SAYS so on its From row
  // rather than substituting a sender silently.
  // ⚠️ READ FROM THE LIVE SELECTION, not the served draft (Sep 21, review). Derived from the served
  // payload alone, a draft with mailbox options but no chosen one rendered the From selector AND
  // claimed the coworker lane — it would have withheld the rich body while POSTing a connectionId.
  // The lane a card is in is whatever the user is currently pointing at.
  const viaCoworker = !!standalone && (standalone.draft.from?.viaCoworker === true || !fromId);
  const [directions, setDirections] = useState<EmailDirection[]>([]);
  const [variant, setVariant] = useState<string>(EMAIL_BASE_VARIANT);
  const [variantBodies, setVariantBodies] = useState<Record<string, string>>(seededBody ? { [EMAIL_BASE_VARIANT]: seededBody } : {});
  // The cache as background work reads it (no stale closures), and the in-flight preview per tab.
  const variantBodiesRef = useRef<Record<string, string>>(seededBody ? { [EMAIL_BASE_VARIANT]: seededBody } : {});
  const inFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [redrafting, setRedrafting] = useState<string | null>(null);
  const [editingRecipients, setEditingRecipients] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [bccOpen, setBccOpen] = useState(false);
  // THE USER'S OWN VERSION — their words, kept whole, whatever the tabs do next. `null` = they have
  // not changed anything yet (and that is a fact about the CONTENT, never about a click).
  const [userEdit, setUserEdit] = useState<string | null>(null);
  // THE BODY REVISION — bumped only when the MACHINE replaces the body, so the editor is re-seeded
  // exactly when a variant lands and never remounts under the user's caret while they type.
  const [bodyRev, setBodyRev] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(!!coworker?.draft.sent_at || !!standalone?.draft.sentAt);
  const [err, setErr] = useState<string | null>(null);
  const typedRef = useRef(false);
  // What the machine last handed the editor — the ONE thing "did they really edit it?" compares to.
  const servedRef = useRef(coworker?.draft.body ?? standalone?.draft.body ?? seededBody ?? '');
  const dirty = userEdit !== null;
  // ── W9.1 · THE USER'S HAND WINS (docs/laws-registry.md `the-users-hand-wins`). The served words
  // may BE the user's own saved edit (`edited`), and the thread may have moved since they wrote it
  // (`staleUnderEdit`) — the engine never overwrites them, so the card says which it is showing.
  const [handNote, setHandNote] = useState<'edited' | 'stale' | null>(null);
  // ── W12.3 · THE HELD-BACK LINE. When the compose door's generated draft failed the one truth vet
  // twice it serves NO words and says why (`withheld`, lib/prepare/truth `withheldLine`). The card
  // prints that sentence verbatim above the editor — never an empty editor pretending nothing
  // happened, never a second copy of the words — and the editor stays open for the user's own.
  const [withheld, setWithheld] = useState<string | null>(null);
  const readHand = (d: { edited?: boolean; staleUnderEdit?: boolean } | null | undefined) => {
    if (d?.edited) setHandNote(d.staleUnderEdit ? 'stale' : 'edited');
  };

  // ── THE ATTACH SURFACE — the inbox reply's own model: `{filename, content(base64), mimeType}`
  // rides the send body (the door already accepts it), the KB half through the shared picker and
  // /api/kb/attachment. No parallel uploader, and a failed attach never breaks the card.
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  // ── W13 · A CLAIM RENDERS — THE STAGED FILE. A prepared draft can carry the file the staging law
  // proved IS the deliverable; the door serves it (`attachments`), the card shows it as a chip (name ·
  // open in THE ONE viewer · remove), and Send hands the standing chips' ids to a door that loads the
  // bytes itself — the send attaches exactly what the chips show. Seeded ONCE per mount, so a removal
  // sticks; a late answer never re-adds what the user took off.
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const stagedSeededRef = useRef(false);
  const seedStaged = (raw: unknown) => {
    if (stagedSeededRef.current) return;
    const files = stagedFilesOf(raw);
    if (!files.length) return;
    stagedSeededRef.current = true;
    setStaged(files);
  };
  const [stagedOpenAt, setStagedOpenAt] = useState<number | null>(null);
  // THE SOURCE MATERIAL'S OWN FILES — one index into the WHOLE context, so the viewer's ‹ › are
  // honest (T25.9b: every file the thread holds, in thread order).
  const [sourceOpenAt, setSourceOpenAt] = useState<number | null>(null);
  const sourceList = sourceFiles ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addAttachments = useCallback((next: PendingAttachment[]) => {
    setAttachments((prev) => {
      const merged = [...prev, ...next];
      if (merged.reduce((n, a) => n + a.content.length, 0) > ATTACH_MAX_TOTAL_BYTES) {
        setErr('Attachments are too large (max ~4 MB total). Share a link instead.');
        return prev;
      }
      return merged;
    });
  }, []);
  const onLocalFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null);
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const out: PendingAttachment[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      out.push({ filename: file.name, content: btoa(binary), mimeType: file.type || 'application/octet-stream' });
    }
    addAttachments(out);
  }, [addAttachments]);
  const onKbSelect = useCallback(async (selected: { id: string; filename: string }[]) => {
    setKbPickerOpen(false); setErr(null);
    const got = await Promise.all(selected.map(async ({ id, filename }) => {
      try {
        const res = await fetch(`/api/kb/attachment?fileId=${id}`);
        if (!res.ok) { setErr(`Could not load ${filename}.`); return null; }
        return await res.json() as PendingAttachment;
      } catch { setErr(`Could not load ${filename}.`); return null; }
    }));
    addAttachments(got.filter(Boolean) as PendingAttachment[]);
  }, [addAttachments]);

  // ── THE ITEM LANE's fill: the ALREADY-PREPARED draft (the pass wrote it; this only reads it) and
  // the thread's own recipient/subject. A late draft never clobbers words the user already typed.
  // TWO LEGS, NOT ONE WAIT (owner walk, Sep 15: "components take time to load" — the card's slot
  // beside the seat stood as a tall empty pill for seconds).
  //
  // The two fetches were already parallel in flight, but they were joined by a `Promise.all` and
  // the card painted nothing until the SLOWER of them landed. They answer different questions and
  // they cost wildly different amounts: `/thread` is a read (tens of ms), `/draft` can GENERATE
  // (seconds, a real model call). Waiting for the draft to show the recipient — or for the thread
  // to show words that already arrived — is a waterfall the reader pays for and nobody chose.
  //
  //   before:  [draft ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] ┐
  //            [thread ▓▓]               ├─ join ──> first paint (max of the two)
  //   after:   [thread ▓▓] ──> to/subject fill
  //            [draft ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] ──> body + the card goes live
  //
  // Each leg now lands on its own. The card's SHELL is up from the first frame (the skeleton
  // below), the thread fills the to-row as soon as it can, and the draft fills the body when it
  // arrives. `unfilled` — THE HONEST DEAD END — still needs both answers, so it is decided only
  // when the last leg settles; until then the card is loading, never "couldn't load".
  // ── THE COMPOSE LANE's fill: ONE read — recipients (THE ONE ADDRESSEE LADDER), subject, and the
  // prepared words (the pooled nudge; a fresh draft only when nothing is pooled). A late answer
  // never clobbers words the user already typed.
  useEffect(() => {
    if (!composeLane || !compose) return;
    let alive = true;
    setLoading(true);
    fetch('/api/compose/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: compose.kind, entityId: compose.id }),
    })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d: { to?: string[]; cc?: string[]; subject?: string; bodyText?: string; recipientName?: string | null; suggestions?: Array<{ name: string | null; email: string | null }>; withheld?: string; attachments?: unknown } | null) => {
        if (!alive) return;
        const words = String(d?.bodyText ?? '').trim();
        const held = !words && typeof d?.withheld === 'string' && d.withheld.trim() ? d.withheld.trim() : null;
        setWithheld(held);
        if (d) {
          if (d.to?.length) setTo(d.to);
          if (d.cc?.length) setCc(d.cc);
          if (d.subject) setSubject(d.subject);
          setRecipientName(d.recipientName ?? null);
          setSuggestions((d.suggestions ?? []).filter((x) => !!x.email));
        }
        if (words && !typedRef.current) {
          setBody(words); setVariantBodies({ [EMAIL_BASE_VARIANT]: words });
          servedRef.current = words; setBodyRev((n) => n + 1);
          readHand(d as { edited?: boolean; staleUnderEdit?: boolean } | null);
        }
        if (words) seedStaged(d?.attachments);
        // A held-back draft is not an unfillable card: the door answered, and the editor is the way on.
        setUnfilled(!words && !(d?.to?.length) && !held);
        setLoading(false);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose?.id, composeLane]);

  useEffect(() => {
    if (coworker || !item) return;
    let alive = true;
    // W17: a card seeded with the prepared words is already filled — the reads below reconcile quietly.
    if (!seededBody) setLoading(true);
    const needThread = !item.to?.length || !item.subject;
    let preparedOut = '';
    let heldOut = false; // a held-back draft is not an unfillable card: the door answered
    let threadHasFrom = false;
    let left = needThread ? 2 : 1;
    const settle = () => {
      if (!alive || --left > 0) return;
      setUnfilled(!preparedOut && !heldOut && !(item.to?.length || threadHasFrom));
    };
    // THE BODY IS THE CARD: its arrival is what "loaded" means, so it alone clears the skeleton.
    fetch(`/api/inbox/${item.id}/draft`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => {
        if (!alive) return;
        const prepared = d && !d.skipped ? String(d.draft ?? '') : '';
        preparedOut = prepared;
        // W13.2: the inbox door speaks the same honest empty state as the compose door — a draft the
        // one vet held back twice is not served, and the card says why (the editor is the way on).
        if (!prepared && d && !d.skipped && typeof d.withheld === 'string' && d.withheld.trim()) {
          setWithheld(d.withheld.trim()); heldOut = true;
        }
        // A late draft never clobbers words the user already typed — and the same words re-served are
        // not a re-seed (W17: the editor never remounts under a card that already shows them).
        if (prepared && !typedRef.current && prepared !== servedRef.current) {
          setBody(prepared); setVariantBodies({ [EMAIL_BASE_VARIANT]: prepared });
          servedRef.current = prepared; setBodyRev((n) => n + 1);
          readHand(d);
        }
        if (prepared) seedStaged(d?.attachments);
        setLoading(false);
        settle();
      });
    if (needThread) {
      fetch(`/api/inbox/${item.id}/thread`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((t) => {
          if (!alive) return;
          if (t) {
            threadHasFrom = !!t.fromAddress;
            if (!item.to?.length && t.fromAddress) setTo([String(t.fromAddress)]);
            if (!item.subject && t.subject) setSubject(/^re:/i.test(String(t.subject)) ? String(t.subject) : `Re: ${t.subject}`);
          }
          settle();
        });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // The DIRECTION ORGAN — grounded-or-absent by construction: it answers with an empty list when
  // nothing in the message reasons a direction, and the tab row then never renders.
  useEffect(() => {
    if (coworker || !item || !mailboxLane) return;
    let alive = true;
    fetch('/api/items/reply-directions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'email', id: item.id }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && Array.isArray(d?.directions)) setDirections(d.directions); })
      .catch(() => { /* no chips is the honest fallback (the organ's own law) */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, mailboxLane]);

  // ── THE ONE REDRAFT PATH. Every variant, every tone tweak and every typed steer goes through
  // /api/items/steer — the one conversation core the room's own composer uses. There is no second
  // drafter in this file, and no lane may fork one.
  //
  // THE CLICK ANSWERS IN THE SAME FRAME (owner walk, Sep 10: "take long to change between tabs").
  // The wait itself is a real model call and cannot be faked away, but the SILENCE could: the tab
  // used to stay unhighlighted for the whole round-trip because `setVariant` only ran on success,
  // so the only sign of life was a pulse on a body that still showed the OLD tab's words. Now the
  // clicked tab takes the selection immediately (and wears its own `…` while it loads), and a
  // failure hands the selection BACK to where it was — the card never claims a variant it does not
  // hold. A tab already generated stays instant: `variantBodies` is the cache and it never expires
  // within the card's life.
  //
  // ⚠️ TWO LANES, ONE DRAFTER — A PREVIEW IS NOT A DEED (Sep 10). /api/items/steer's item lane
  // versions the prior draft into `item_deliverables` and MOVES THE SERVING POINTER
  // (`inbox_items.source_data.draft`) to whatever it wrote. That is right for an instruction the
  // user AUTHORED (a typed steer, a tone tweak) and wrong for one they have not picked — three
  // background direction tabs would rewrite the room's prepared reply three times and the deck, the
  // brief and the next visit would all speak a draft nobody chose. So:
  //   · `redraft`  → the persisting door. Typed steer · tone tweak. A picked steer IS a deed.
  //   · `preview`  → `{ preview: true }` on the same route, same drafter, same grounding, ZERO
  //                  writes. EVERY direction tab's words come from here — pre-generated, warmed on
  //                  hover, and on a cold click too, so the same tab means the same thing whatever
  //                  the timing (a door whose consequence depends on how fast you clicked is a
  //                  lying door). What the user then SENDS is the deed; the send door is unchanged.
  const redraft = useCallback(async (targetVariant: string, instruction: string) => {
    if (!item || redrafting) return;
    const previous = variant;
    setRedrafting(targetVariant); setVariant(targetVariant); setErr(null);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'email', id: item.id, text: instruction }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.draft) {
        variantBodiesRef.current = { ...variantBodiesRef.current, [targetVariant]: String(d.draft) };
        setVariantBodies((prev) => ({ ...prev, [targetVariant]: String(d.draft) }));
        setBody(String(d.draft));
        servedRef.current = String(d.draft);
        setBodyRev((n) => n + 1);
        setVariant(targetVariant);
      } else {
        setVariant(previous);
        setErr("I couldn't redraft that one — tell me the direction in your own words.");
      }
    } catch {
      setVariant(previous);
      setErr("I couldn't redraft that one — tell me the direction in your own words.");
    } finally { setRedrafting(null); }
  }, [item, redrafting, variant]);

  /** The machine replaces the body: seed the editor again and remember what was served. */
  const serve = (id: string, text: string) => {
    setVariant(id); setBody(text); servedRef.current = text; setBodyRev((n) => n + 1);
  };

  // ── THE PREVIEW LANE (writes nothing) + THE WARM CACHE.
  // `variantBodiesRef` mirrors `variantBodies` so background work reads the cache without stale
  // closures; `inFlightRef` holds the RUNNING promise per tab, so a click that lands mid-warm joins
  // that call instead of starting a second one (one direction is never generated twice).
  const previewBody = useCallback((id: string, instruction: string, signal?: AbortSignal): Promise<string | null> => {
    if (!item) return Promise.resolve(null);
    const cached = variantBodiesRef.current[id];
    if (cached !== undefined) return Promise.resolve(cached);
    const running = inFlightRef.current.get(id);
    if (running) return running;
    const p = (async () => {
      try {
        const res = await fetch('/api/items/steer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ kind: 'email', id: item.id, text: instruction, preview: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d?.draft) return null;
        const text = String(d.draft);
        variantBodiesRef.current = { ...variantBodiesRef.current, [id]: text };
        setVariantBodies((prev) => ({ ...prev, [id]: text }));
        return text;
      } catch { return null; /* an aborted or failed warm is simply a tab that stays cold */ }
    })();
    inFlightRef.current.set(id, p);
    void p.finally(() => { inFlightRef.current.delete(id); });
    return p;
  }, [item]);

  /** The one instruction a direction tab is worth — composed HERE, so warm and click agree. */
  const directionInstruction = (d: EmailDirection) => `Redraft the reply to take this direction: ${d.instruction}`;

  // PRE-GENERATION, LAWFULLY: once the card has settled (a second of idle, so it never competes
  // with the first paint or the directions organ itself), the visible tabs generate through the
  // PREVIEW lane — one at a time, at most PREGEN_MAX of them, abandoned the moment the card
  // unmounts. A tab click then answers from the cache in the same frame.
  useEffect(() => {
    if (coworker || !item || !mailboxLane || !directions.length) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      for (const [i, d] of directions.slice(0, PREGEN_MAX).entries()) {
        if (ctrl.signal.aborted) return;
        await previewBody(directionVariantId(i), directionInstruction(d), ctrl.signal);
      }
    }, PREGEN_IDLE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, mailboxLane, directions, coworker]);

  /** Hover (or keyboard focus) is a question, never a deed — it warms through the same preview. */
  const warmVariant = (id: string) => {
    if (coworker || !item || variantBodiesRef.current[id] !== undefined) return;
    const idx = directions.findIndex((_, i) => directionVariantId(i) === id);
    if (idx < 0) return;
    void previewBody(id, directionInstruction(directions[idx]));
  };

  // LAZY VARIANTS: a tab already generated is instant; a fresh one costs its ONE redraft, once.
  //
  // NOTHING IS EVER LOST (owner, Sep 9): an edited body no longer silences this row. The user's own
  // version lives in its own tab, so switching to a machine variant and back returns their words
  // exactly — no confirm dialog, and no tab that looks clickable and is not.
  const pickVariant = (id: string) => {
    setErr(null);
    if (id === EMAIL_USER_VARIANT) { serve(id, userEdit ?? body); return; }
    if (id === EMAIL_OPEN_VARIANT) { setVariant(id); return; }
    if (variantBodies[id] !== undefined) { serve(id, variantBodies[id]); return; }
    if (id === EMAIL_BASE_VARIANT) { setVariant(id); return; }
    // The id scheme lives in the mapper — never re-derived by hand here.
    const dir = directions.find((_, idx) => directionVariantId(idx) === id);
    if (!dir) return;
    // A COLD CLICK KEEPS THE PULSE: the tab takes the selection in this frame and wears its `…`
    // while the preview lands; a failure hands the selection back where it was.
    const previous = variant;
    setRedrafting(id); setVariant(id);
    void previewBody(id, directionInstruction(dir)).then((text) => {
      if (text) serve(id, text);
      else { setVariant(previous); setErr("I couldn't redraft that one — tell me the direction in your own words."); }
    }).finally(() => setRedrafting((cur) => (cur === id ? null : cur)));
  };

  /**
   * THE EDIT IS THE USER'S — AND IT IS AN EDIT ONLY IF THE WORDS CHANGED.
   *
   * The Sep 9 walk found the tabs dead on a body the owner had not typed in: the donor's textarea
   * fired its edit callback from `onBlur`, so entering and leaving the field — a click — marked the
   * draft "yours" and the host then withheld every tab handler. The flag now reads the CONTENT
   * (`sameBody`, the mapper's own comparison), and the consequence of a real edit is a tab, never
   * an absence of tabs.
   */
  const editBody = (value: string) => {
    typedRef.current = true;
    setBody(value);
    if (userEdit !== null) { setUserEdit(value); return; }
    if (sameBody(value, servedRef.current)) return;   // a click is not an edit
    setUserEdit(value);
    setVariant(EMAIL_USER_VARIANT);
  };

  // ── THE EDIT DOOR (W9.1): a real edit on a PREPARED artifact (the item lane's reply draft, the
  // compose lane's pooled message) is SAVED — stamped as the user's hand, so no sweep, clock or
  // ground move ever replaces it. Debounced; content-compared at the door (a click is not an edit);
  // the coworker and standalone lanes own their own stores and are not engine-prepared.
  useEffect(() => {
    if (userEdit === null || sent || (!itemLane && !composeLane)) return;
    const words = emailBodyText(userEdit).trim();
    if (!words) return;
    const t = setTimeout(() => {
      void fetch('/api/items/prepared', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemLane
          ? { itemKind: 'inbox', itemId: item!.id, kind: 'reply_draft', body: words }
          : { itemKind: 'commitment', itemId: compose!.id, kind: 'nudge_draft', body: words }),
      }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.saved) setHandNote('edited'); }).catch(() => { /* the words stay in the card; the next edit retries */ });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEdit, sent]);

  // ── W13 · THE CARD RE-VETS ITS OWN WORDS against the files that stand on it — the SAME attachment
  // floor THE ONE READER applies (lib/prepare/truth `claimsUnstagedAttachment`): words that say a file
  // is attached with no chip left (the staged one removed, or never there) hold Send and say why.
  const preparedLane = itemLane || composeLane;
  const unattachedClaim = preparedLane && !sent
    && !!claimsUnstagedAttachment(emailBodyText(body), { staged: staged.length + attachments.length > 0 });

  const send = async () => {
    if (sending || sent) return;
    if (unattachedClaim) { setErr(UNATTACHED_CLAIM_NOTE); return; }
    if (!to.length) { setErr('Add a recipient before it can send.'); return; }
    // The words themselves decide whether there is anything to mail — an empty rich editor still
    // carries markup, and markup is not a message.
    if (!emailBodyText(body).trim()) { setErr('The message is empty.'); return; }
    if (composeLane && !subject.trim()) { setErr('Add a subject before it can send.'); return; }
    // ONE SERIALIZATION: a mailbox door takes the editor's own HTML (what the deep stage sends);
    // a Resend door escapes its body and lays out paragraphs itself, so it takes the words. The
    // standalone lane is one or the other depending on where it resolved a sender.
    const text = coworker || viaCoworker ? emailBodyText(body).trim() : body;
    setSending(true); setErr(null);
    try {
      // ONE DEED, THE DOOR THAT OWNS ITS SENDER. The item lane mails AS THE USER through their own
      // mailbox; the coworker lane mails AS THE COWORKER; the standalone lane mails as whichever
      // mailbox the From row names (or the coworker channel when they have none). All three are
      // approve-before-commit, all three are idempotent at the route, and none is reachable
      // without this click.
      const res = composeLane
        // THE COMPOSE DOOR (W7.3): a fresh message as the user (their mailbox, else the assistant's
        // address), behind the commit door; `prepared` carries what WE wrote for the outcome ledger.
        ? await fetch('/api/compose/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to, cc, subject: subject.trim(), bodyHTML: emailBodyHTML(text),
              // W13: the standing staged chips, by id — the door loads and attaches exactly these.
              ...(staged.length ? { stagedFileIds: staged.map((f) => f.fileId) } : {}),
              prepared: servedRef.current.trim()
                ? { itemKind: compose!.kind, itemId: compose!.id, bodyHTML: emailBodyHTML(servedRef.current) }
                : null,
            }),
          })
        : standalone
        // THE STANDALONE DOOR: the card's fields are handed over as EDITS; the route writes them to
        // the stored row and mails what the ROW says, behind the one commit door (exactly-once).
        ? await fetch('/api/emails/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              emailId: standalone.emailId,
              edits: { to, cc, subject: subject.trim(), body: text, ...(fromId ? { connectionId: fromId } : {}) },
            }),
          })
        : coworker
        ? await fetch(`/api/work/threads/${coworker.threadId}/send-coworker-email`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to, cc, subject: subject.trim(), body: text,
              agentId: coworker.agentId, draftId: coworker.draft.id,
            }),
          })
        : await fetch(`/api/inbox/${item!.id}/send-reply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            // `aiDraft` is what WE prepared — the route needs it to log the edit delta and the
            // prepared OUTCOME. The donor stage never passed it, so both ledgers sat dead on the
            // primary send door; the card restores them.
            body: JSON.stringify({
              customMessage: emailBodyHTML(text), aiDraft: variantBodies[EMAIL_BASE_VARIANT] ?? undefined,
              to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}),
              ...(attachments.length ? { attachments } : {}),
              // W13: the standing staged chips, by id — the door loads and attaches exactly these.
              ...(staged.length ? { stagedFileIds: staged.map((f) => f.fileId) } : {}),
            }),
          });
      if (res.ok) {
        setSent(true); onSent?.();
        // A DEED, NOT A PREPARATION (Sep 8): `aug:prepared` says "something was drafted"; a send is
        // a different fact and the room reacts to it differently (it re-authors its opening).
        announceDeed();
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || 'Could not send it.');
      }
    } catch { setErr('Could not send it.'); }
    finally { setSending(false); }
  };

  // ── THE LOADING STATE IS THE CARD'S OWN SHAPE (owner walk, Sep 15) ───────────────────────────
  // It used to be a tall empty pill: one grey block inside a border, the same for every card in the
  // product, telling the reader nothing except that something was missing. A skeleton's whole job
  // is to say WHAT IS COMING — so this one wears the email card's geometry: the direction tab row,
  // the to-row, four lines of body at a body's rhythm, and the commit row. The card that lands
  // fills this shape rather than replacing it, so nothing jumps. (The room's own skeleton grammar,
  // components/room/room-skeleton.tsx — muted neutrals, one pulse, no spinner, no claim.)
  if (loading) {
    return (
      <div className="w-full max-w-[560px] rounded-xl border border-neutral-200/80 bg-white overflow-hidden" aria-busy="true" aria-label="Preparing the reply">
        <div className="animate-pulse">
          {/* the direction tabs */}
          <div className="flex items-center gap-2 border-b border-neutral-100 px-3.5 py-2.5">
            <div className="h-3 w-16 rounded bg-neutral-100" />
            <div className="h-3 w-20 rounded bg-neutral-100" />
            <div className="h-3 w-14 rounded bg-neutral-100" />
          </div>
          {/* the to-row */}
          <div className="flex items-center gap-2 px-4 pt-3">
            <div className="h-2.5 w-6 rounded bg-neutral-100" />
            <div className="h-2.5 w-40 rounded bg-neutral-100" />
          </div>
          {/* the body */}
          <div className="space-y-2 px-4 py-3.5">
            <div className="h-2.5 w-[92%] rounded bg-neutral-100" />
            <div className="h-2.5 w-[86%] rounded bg-neutral-100" />
            <div className="h-2.5 w-[94%] rounded bg-neutral-100" />
            <div className="h-2.5 w-[58%] rounded bg-neutral-100" />
          </div>
          {/* the commit row */}
          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2.5">
            <div className="h-2.5 w-24 rounded bg-neutral-100" />
            <div className="h-6 w-20 rounded-lg bg-neutral-100" />
          </div>
        </div>
      </div>
    );
  }
  // TRUTH BEFORE PRESENTATION: an unfillable card is not a card. One honest line and the one door
  // that still works — never an empty editor with a paperclip on it.
  if (unfilled && !dirty) {
    return (
      <div className="w-full max-w-[560px] rounded-xl border border-neutral-200/80 bg-white px-4 py-3">
        <p className="text-[13px] text-neutral-600">I couldn&apos;t load this draft just now.</p>
        {openThread && (
          <button onClick={openThread} className="mt-1.5 text-[12px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
            Open the thread →
          </button>
        )}
      </div>
    );
  }

  // THE MAPPER — one derivation, shared by every mount. Directions ride only where the organ
  // serves them (the item lane, on a workspace that has a mailbox at all).
  const props = emailCardOf(
    { to, cc, bcc, subject, body, directions: itemLane && mailboxLane ? directions : [], userEdit: dirty },
    { selectedVariantId: variant },
  );
  // W15.2 · NO EMPTY "READY" — the commit row claims readiness (and carries Send) only when there are
  // recipients AND words. An empty body shows the honest empty state (W12.3's held-back line, else the
  // plain empty line) with the editor open; Send appears the moment words exist.
  const readiness = draftReadinessOf({ recipients: to, body, withheld, sent });
  const sendable = props.state === 'ready' && mayClaimReady(readiness);

  // The standalone lane is live wherever its own door can carry it: a connected mailbox, or the
  // feature-null coworker channel on a workspace with none.
  // The compose door falls back to the assistant's address where no mailbox exists — live everywhere.
  const live = !sent && (coworker || standalone || composeLane || mailboxLane);
  const busy = !!redrafting || sending;
  const chips = (list: string[], set: (v: string[]) => void) => (
    <span className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5">
      <AttendeeChips attendees={list} onChange={(next) => { set(next); setErr(null); }} />
    </span>
  );
  // W13 · the staged file's chip: its name opens it in THE ONE viewer; ✕ takes it off the send.
  const stagedChips = staged.map((f, i) => ({
    name: f.filename,
    onOpen: () => setStagedOpenAt(i),
    ...(sent ? {} : { onRemove: () => { setStaged((prev) => prev.filter((x) => x.fileId !== f.fileId)); setStagedOpenAt(null); setErr(null); } }),
  }));
  const card: ThreadCard = {
    kind: 'email',
    id: `email-${coworker?.draft.id ?? standalone?.emailId ?? item?.id ?? (compose ? `${compose.kind}-${compose.id}` : 'card')}`,
    ...props,
    variants: props.variants.map((v) => ({ ...v, loading: redrafting === v.id })),
    bodyRev: `v${bodyRev}`,
    busy,
    // THE DOOR IS NOT A DEED (owner, Sep 9: "I see the thread button on top, not clear — maybe move
    // it to the component as the others"): wherever a host hands the card a way to the raw thread,
    // the card carries it — a sent card still opens its thread, and no surface grows a second
    // top-of-page button for a door the card already owns.
    ...(openThread ? { onOpenThread: openThread } : {}),
    // THE FROM ROW — only the standalone lane has a sender to settle. One mailbox states itself;
    // several offer themselves; none says plainly that the assistant's address will carry it.
    ...(standalone ? {
      from: sendFromLabel({ ...standalone.draft, from: { ...standalone.draft.from, selectedId: fromId } }),
      ...((standalone.draft.from?.options?.length ?? 0) > 1 && !sent ? {
        fromOptions: standalone.draft.from.options.map((o) => ({ id: o.id, label: o.address })),
        selectedFromId: fromId ?? undefined,
        onPickFrom: (id: string) => { setFromId(id); setErr(null); },
      } : {}),
    } : {}),
    // Rich authoring only where the door carries HTML (a mailbox send). A Resend door escapes its
    // body, so those lanes keep plain words rather than a toolbar that lies.
    ...(coworker || viaCoworker ? {} : { richBody: true }),
    ...(live ? {
      // NEVER A DEAD CONTROL: the tab handler is unconditional — an edit adds a tab, never removes
      // every handler (the Sep 9 walk's "tabs not clickable").
      onPickVariant: pickVariant,
      // A HOVER IS A QUESTION: it warms the tab's words through the preview lane, never the deed.
      ...(itemLane ? { onWarmVariant: warmVariant } : {}),
      onEditRecipients: () => setEditingRecipients((v) => !v),
      // Cc rides both doors; BCC ONLY THE MAILBOX ONE — the coworker send route models `to`/`cc`
      // and nothing else, and a field whose door would silently drop it must not render.
      onOpenCc: () => setCcOpen(true),
      ...(ccOpen || cc.length ? { ccEditor: chips(cc, setCc) } : {}),
      // …and Bcc + attachments ONLY the item lane's `send-reply`, the one door that models them.
      // The standalone door carries `to`/`cc`/`subject`/`body` and nothing else, so it shows
      // neither — the card never wears a field its send would silently drop.
      // W13 · THE STAGED CHIPS — on both prepared lanes (the compose door carries them by id too).
      ...(composeLane && staged.length ? { attachments: stagedChips } : {}),
      ...(itemLane ? {
        onOpenBcc: () => setBccOpen(true),
        ...(bccOpen || bcc.length ? { bccEditor: chips(bcc, setBcc) } : {}),
        // Attachments ride the mailbox door too (`send-reply` already takes them); the coworker
        // route carries no attachment field, so that lane shows no paperclip.
        onAttachFile: () => fileInputRef.current?.click(),
        onAttachFromKb: () => setKbPickerOpen(true),
        attachments: [...stagedChips, ...attachments.map((a, i) => ({
          name: a.filename, onRemove: () => setAttachments((prev) => prev.filter((_, j) => j !== i)),
        }))],
        attachNode: (
          <>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onLocalFile} />
            {kbPickerOpen && <KbFilePicker onSelect={onKbSelect} onClose={() => setKbPickerOpen(false)} />}
          </>
        ),
      } : {}),
      // With no recipient the editor LEADS — the missing fact asks plainly, in place, instead of
      // hiding behind an edit mark next to a Send that isn't there.
      ...(editingRecipients || props.state === 'needs_recipient' ? {
        recipientsEditor: (
          <span className="w-full rounded-lg border border-neutral-200 px-2.5 py-1.5">
            <AttendeeChips attendees={to} onChange={(next) => { setTo(next); setErr(null); }}
              // TRUE ADDRESSEES (W7.3): with nobody resolved the field ASKS — and offers the people
              // the ladder saw (a project's contacts), one tap each. Never a placeholder address.
              {...(composeLane && !to.length ? {
                placeholder: recipientName ? `Add ${recipientName}'s email` : 'Who should this go to?',
                suggestions: suggestions.map((x) => ({ email: x.email!, label: x.name ?? x.email! })),
              } : {})} />
          </span>
        ),
      } : {}),
      // A reply's subject belongs to its thread; an email the card itself owns (a coworker's, a
      // standalone one) carries its own and is editable here.
      ...(itemLane ? {} : { onEditSubject: setSubject }),
      onEditBody: editBody,
      // The typed steer lands on the OPEN tab itself, so the field stays open and steerable again.
      // These stay live through an edit for the same reason the tabs do: what a redraft lands never
      // destroys the user's version — it sits in its own tab, one click away.
      ...(itemLane ? { onSteer: (t: string) => void redraft(EMAIL_OPEN_VARIANT, t), steerBusy: !!redrafting } : {}),
      ...(itemLane ? { toneOptions: EMAIL_TONES.map((t) => ({ id: t.id, label: t.label })),
        onPickTone: (id: string) => {
          const tone = EMAIL_TONES.find((t) => t.id === id);
          // A tone tweak re-tunes a MACHINE version; asked from the user's own tab it lands on the
          // prepared one, so their words are never overwritten by a menu.
          if (tone) void redraft(variant === EMAIL_USER_VARIANT ? EMAIL_BASE_VARIANT : variant, tone.instruction);
        } } : {}),
      // TRUTH BEFORE PRESENTATION at the commit row: with no recipient there is nothing to mail,
      // so the card carries NO Send — it asks for the address and waits.
      ...(sendable ? { onSend: send, sendLabel: itemLane ? 'Send reply' : 'Send', sendDisabled: sending || unattachedClaim } : {}),
    } : {}),
    // THE MATERIAL IS PART OF THE EMAIL CONTEXT — counted, never claimed: with nothing attached the
    // lane is absent. Independent of `live`: a sent reply still shows what it was answering.
    ...(sourceList.length ? {
      contextFiles: sourceList.map((f, i) => ({
        name: f.name, size: f.size, onOpen: () => setSourceOpenAt(i),
      })),
      contextFilesLabel: sourceList.length > 1 ? `Came with the email · ${sourceList.length}` : 'Came with the email',
    } : {}),
    ...(withheld && !dirty && !sent ? { bodyNote: withheld }
      : readiness === 'empty' && !redrafting ? { bodyNote: EMPTY_DRAFT_NOTE }
      : unattachedClaim ? { bodyNote: UNATTACHED_CLAIM_NOTE } : {}),
    bodyHint: sent ? undefined
      : redrafting ? 'redrafting…'
      : dirty ? 'your words — kept in “Your edit”, whichever tab you try'
      // THE USER'S HAND: their saved words, marked when the thread moved under them — never replaced.
      : handNote === 'stale' ? 'the thread moved since you edited this — your words are kept; try a tab for a fresh version'
      : handNote === 'edited' ? 'your saved edit — the team never overwrites it'
      : live ? "click anywhere to edit · mirrors the thread's language"
      : undefined,
    error: err ?? undefined,
    receipt: sent ? 'sent' : sending ? 'sending…'
      : sendable ? (itemLane ? 'reply ready' : 'ready to send') : undefined,
  };

  return (
    <>
      <ThreadCardView card={card} />
      {stagedOpenAt !== null && staged.length > 0 && (
        <AttachmentLightbox
          files={staged.map((f) => ({ name: f.filename, ref: { kind: 'kb' as const, id: f.fileId }, note: 'Attached to this message' }))}
          index={Math.min(stagedOpenAt, staged.length - 1)}
          onIndex={setStagedOpenAt} onClose={() => setStagedOpenAt(null)}
        />
      )}
      {sourceOpenAt !== null && sourceList.length > 0 && (
        <AttachmentLightbox
          files={sourceList} index={sourceOpenAt}
          onIndex={setSourceOpenAt} onClose={() => setSourceOpenAt(null)}
        />
      )}
    </>
  );
}
