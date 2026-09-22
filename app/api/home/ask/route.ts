import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { converse, type ConverseHistoryTurn, type ConverseAttachment } from '@/lib/converse';
import { tagOf } from '@/lib/home/ask-refs';

// 180: a production hand-off (delegation runs synchronously, the artifact comes home) must
// never be killed by the route budget — the 30s cap predates chat-borne production.
export const maxDuration = 180;

// POST /api/home/ask — the Home chat, a THIN wrapper over THE ONE conversation core (lib/converse).
// Questions answer from the brain snapshot (answerHomeQuestion, unchanged); commands ("find the deck"),
// delegation ("have Max research X"), and composite turns come free from the core — no surface-owned
// logic. { question, history? } → { answer, refs, applied?, files?, delegated? }.
// STREAMING (Aug 6): { stream: true } switches the response to SSE — `progress` events narrate what
// the core is DOING (tool labels from the ONE progress channel), then one `done` event carries the
// same payload the JSON path returns. The JSON path stays for every non-panel caller.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { question?: string; history?: ConverseHistoryTurn[]; stream?: boolean; entityId?: string; attachments?: ConverseAttachment[]; roomKey?: string };
    // THE PASTE CEILING DIED (Aug 10, found live): a pilot pasted a full questionnaire and the
    // old slice(0, 500) silently discarded everything past character 500 — the brain answered a
    // request it never saw. Long input is the NORM for production asks; 20k chars ≈ a long doc.
    const q = String(body.question ?? '').trim().slice(0, 20000);
    if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 });
    // THE ANSWER SURVIVES THE TAB (Aug 26, found live): the client used to persist the system
    // turn AFTER consuming the whole SSE stream — a mid-stream reload/navigation left an orphan
    // room (the ask with no reply). When the panel passes its chat room key, the SERVER persists
    // the answer the moment it's composed; the client skips its own write. Strictly `chat:<uuid>`
    // — this door must not be able to write into entity/run rooms.
    const roomKey = typeof body.roomKey === 'string'
      && /^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.roomKey)
      ? body.roomKey : null;
    const persistAnswer = async (turn: Awaited<ReturnType<typeof converse>>): Promise<void> => {
      if (!roomKey || !turn.say?.trim()) return;
      try {
        const { writeRoomTurn } = await import('@/lib/room/turns');
        await writeRoomTurn(supabase, user.id, roomKey, {
          role: 'system', text: turn.say,
          // THE REF IS ITS TAG (Sep 21): the grounding id rides into the store beside the label, so
          // a REHYDRATED turn resolves its chips exactly as the live one did. Dropping it was half
          // of the wrong-object-door incident — a stored turn could not be resolved at all, only
          // guessed at by position, which is the bug (lib/home/ask-refs.ts).
          refs: turn.refs?.length
            ? turn.refs.map((r) => ({ label: r.label, href: r.href ?? null, ...(tagOf(r) ? { tag: tagOf(r) } : {}) }))
            : undefined,
          // A CARD IS A TURN (threads plan — THE CARD CONTRACT): a prepared invite is DURABLE
          // state, so it rides the turn as a component and survives the reload that used to eat
          // it. The payload here is for RENDERING; the send door reads the stored row by id.
          ...(turn.invite ? { component: { key: 'invite_card', refId: turn.invite.id, state: { invite: turn.invite.invite } } } : {}),
          // …and a BULK DEED rides as a POINTER only (attention-plan A7): the deed row carries its
          // own committed state, so a reloaded card reads the truth rather than a frozen preview
          // that could offer a commit door on a deed that already ran.
          ...(!turn.invite && turn.bulkDeed ? { component: { key: 'bulk_deed_card', refId: turn.bulkDeed.id } } : {}),
          // …and so does THE EMAIL CARD. A matched item rides as a POINTER (the card re-reads that
          // item's own prepared reply, so a reload never paints a draft the room has since moved);
          // a STANDALONE draft carries its payload for the first paint, and its Send door still
          // reads the stored row by id.
          // …and THE COLLECTION CARD (Wave 1, Sep 22) rides as a POINTER and nothing else: the
          // KIND, its re-read params, and the framing sentence the code composed. The ROWS are
          // deliberately NOT stored — a reloaded collection re-derives them through
          // `GET /api/collections`, so a card can never paint a set that stopped being true (the
          // bulk-deed precedent, applied to a read).
          ...(!turn.invite && !turn.bulkDeed && turn.collection
            ? { component: { key: 'collection_card', refId: turn.collection.id,
                state: { kind: turn.collection.spec.kind, framing: turn.collection.spec.framing,
                  ...(turn.collection.spec.params ? { params: turn.collection.spec.params } : {}) } } }
            : {}),
          // …and THE EVENT CARD (Wave 2, Sep 22) rides as a POINTER for the sharpest version of the
          // same reason: an event's VERBS are computed from its live state (accepted elsewhere,
          // moved by its organizer, already passed), so a stored spec would offer buttons that have
          // stopped being true. What persists is the calendar_events id plus the ARMED proposal;
          // `GET /api/events/[id]/card` re-derives the rest.
          ...(!turn.invite && !turn.bulkDeed && !turn.collection && turn.event
            // `refId` IS the calendar_events id — the card's re-read address (`GET /api/events/
            // <refId>/card`) and the address its verbs act through. `state.eventId` repeats it so a
            // reader that keys on state alone resolves too.
            ? { component: { key: 'event_card', refId: turn.event.spec.id,
                state: { eventId: turn.event.spec.id,
                  ...(turn.event.spec.proposal ? { proposal: turn.event.spec.proposal } : {}) } } }
            : {}),
          ...(!turn.invite && !turn.bulkDeed && !turn.collection && !turn.event && turn.emailDraft
            ? { component: { key: 'email_draft_card', refId: turn.emailDraft.id,
                state: { ...(turn.emailDraft.itemId ? { itemId: turn.emailDraft.itemId } : {}),
                  ...(turn.emailDraft.draft ? { draft: turn.emailDraft.draft } : {}) } } }
            : {}),
        });
      } catch { /* durability is best-effort — the answer itself still returns */ }
    };
    // REVISION-IN-PLACE (DH7): assistant turns may carry their document card's ref — sanitized
    // to bare ids/titles (ownership is verified server-side at the revise door, never trusted).
    const history = (Array.isArray(body.history) ? body.history : []).map((h) => ({
      role: h?.role === 'user' ? 'user' as const : 'assistant' as const,
      text: String(h?.text ?? '').slice(0, 8000),
      ...(h?.artifact && typeof h.artifact.id === 'string' && typeof h.artifact.threadId === 'string'
        ? { artifact: { id: h.artifact.id.slice(0, 40), threadId: h.artifact.threadId.slice(0, 40), title: String(h.artifact.title ?? '').slice(0, 140) } } : {}),
    }));
    // THE ATTACHED MATERIAL (the production hand-off): synchronously-extracted attachment text
    // rides the ask itself — never a race against the KB's background indexing.
    const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .slice(0, 5)
      .map((a) => ({
        name: String(a?.name ?? '').slice(0, 200),
        text: typeof a?.text === 'string' ? a.text.slice(0, 20000) : null,
        // THE MOMENT THEME: an attached image's bytes ride along (≤~1.4MB base64) so "brand
        // this with the attached logo" can build the theme on the spot.
        ...(a?.image && typeof a.image.dataB64 === 'string' && a.image.dataB64.length <= 1_500_000
          ? { image: { dataB64: a.image.dataB64, mime: String(a.image.mime ?? 'image/png').slice(0, 40) } } : {}),
        // TEMPLATE-BY-EXAMPLE (DH5b): an office file's bytes ride so "follow this template"
        // mounts the real file into the compile job.
        ...(a?.file && typeof a.file.dataB64 === 'string' && a.file.dataB64.length <= 1_500_000 && /^(docx|pptx|xlsx)$/.test(String(a.file.ext))
          ? { file: { dataB64: a.file.dataB64, ext: String(a.file.ext) } } : {}),
      }))
      .filter((a) => a.name);
    // THE SCOPE CHIP (Aug 6): a scoped Home conversation converses IN the project's room scope —
    // full room grounding, the room's verbs — through the same one core. RLS scopes the read.
    const scope = body.entityId
      ? ({ kind: 'entity', entityId: String(body.entityId) } as const)
      : ({ kind: 'global' } as const);
    // THE USER-CONTEXT LANE (Aug 14): things the user states about themself in the general chat
    // land in user-level memory (context_profiles identity → ABOUT YOU everywhere). The module
    // self-gates on context-poverty (sovereign / unconnected accounts) — a warm mailbox account
    // costs nothing here. Off the response path; failure never touches the conversation.
    if (scope.kind === 'global') {
      after(async () => {
        try {
          const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
          const { extractUserContext } = await import('@/lib/context/intake-memory');
          await extractUserContext(admin, user.id, [q]);
        } catch { /* the lane never breaks the ask */ }
      });
    }
    // THE RECOGNITION NUDGE (Aug 7 — "will it suggest opening the project room?"): when an
    // UNSCOPED question NAMES a registered project (the same deterministic focus match the
    // grounding uses), the response carries the match so the panel can OFFER filing the
    // conversation there — a suggestion, never an auto-file (chat is cheap, objects are
    // deliberate). Zero AI: one entity read + token matching.
    const focusOf = async (): Promise<{ id: string; name: string } | undefined> => {
      if (scope.kind !== 'global') return undefined;
      try {
        // THE FILING CLAIM (Sep 21): the chip's producer is `suggestFilingFocus` — the strict read
        // (the user's own words, tracked projects only), so `tracked` must ride the select.
        const { suggestFilingFocus } = await import('@/lib/home/ask');
        const { data: ents } = await supabase.from('work_entities').select('id, name, aliases, tracked')
          .eq('user_id', user.id).eq('kind', 'initiative').eq('status', 'active')
          .order('last_event_at', { ascending: false }).limit(200);
        return suggestFilingFocus(q, (ents ?? []) as import('@/lib/home/ask').FocusCandidate[]) ?? undefined;
      } catch { return undefined; }
    };
    const payloadOf = (turn: Awaited<ReturnType<typeof converse>>, focus?: { id: string; name: string }) => ({
      answer: turn.say, refs: turn.refs,
      ...(turn.applied?.length ? { applied: turn.applied } : {}),
      ...(turn.files?.length ? { files: turn.files } : {}),
      ...(turn.delegated ? { delegated: turn.delegated } : {}),
      ...(turn.options?.length ? { options: turn.options } : {}),
      // ARTIFACTS-INTO-ORIGIN (Aug 9): the dispatched deliverable's card rides the answer.
      ...(turn.artifact ? { artifact: turn.artifact } : {}),
      ...(turn.artifacts?.length ? { artifacts: turn.artifacts } : {}),
      // THE ONE CREATION CARD (Aug 10): the drafted standing task reviews inline.
      ...(turn.workflowDraft ? { workflowDraft: turn.workflowDraft } : {}),
      // THE INVITE CARD: the prepared invite rides the answer and mounts inline (nothing sent).
      ...(turn.invite ? { invite: turn.invite } : {}),
      // THE BULK DEED CARD: the previewed deed rides the answer and mounts inline (nothing acted).
      ...(turn.bulkDeed ? { bulkDeed: turn.bulkDeed } : {}),
      // THE EMAIL CARD: the drafted reply rides the answer and mounts inline (nothing sent).
      ...(turn.emailDraft ? { emailDraft: turn.emailDraft } : {}),
      // THE COLLECTION CARD (Wave 1): the user's own objects ride the answer as typed rows. On a
      // listing ask `answer` IS the spec's code-written framing; on an analytical one the prose
      // leads and the card sits beneath it.
      ...(turn.collection ? { collection: turn.collection } : {}),
      // THE EVENT CARD (Wave 2): one meeting rides the answer with the verbs code computed for it.
      // Nothing has fired — the card's own click is the deed.
      ...(turn.event ? { event: turn.event } : {}),
      // The filing nudge never decorates a failed/empty answer (found live: a wrong "File it"
      // chip beside a dead reply compounds the miss).
      ...(focus && turn.say?.trim() ? { focus } : {}),
    });
    if (body.stream === true) {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (d: Record<string, unknown>) => {
            try { controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch { /* client gone */ }
          };
          // Keep-alive: a synchronous production hand-off can run 60-90s with no events — an
          // idle SSE gets buffered/closed by proxies. Pings are ignored by the client.
          const ping = setInterval(() => send({ type: 'ping' }), 15000);
          Promise.all([
            converse(supabase, user.id, scope, q, {
              history, attachments,
              onProgress: (label) => send({ type: 'progress', label }),
              // TOKEN STREAMING: the answer materializes live; `done` still carries the final
              // authoritative payload (the honesty floor may amend the preview). The NUL
              // sentinel clears the preview (pre-tool-call preamble text).
              onToken: (t) => send(t === '\u0000' ? { type: 'token_reset' } : { type: 'token', t }),
            }),
            focusOf(),
          ]).then(async ([turn, focus]) => {
            // Persist BEFORE the done frame: the write must not depend on the client still
            // listening (the whole point of the server owning it).
            await persistAnswer(turn);
            send({ type: 'done', ...payloadOf(turn, focus) });
          })
            .catch((e) => { console.error('[home/ask] stream error:', e); send({ type: 'error' }); })
            .finally(() => { clearInterval(ping); try { controller.close(); } catch { /* already closed */ } });
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
      });
    }
    const [turn, focus] = await Promise.all([converse(supabase, user.id, scope, q, { history, attachments }), focusOf()]);
    await persistAnswer(turn);
    return NextResponse.json(payloadOf(turn, focus));
  } catch (e) {
    console.error('[home/ask] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
