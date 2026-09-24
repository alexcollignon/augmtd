import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readRoomTurns, writeRoomTurn, archiveRoomTurns, archiveRoomChat, listRoomSessions, readRoomSession, restoreRoomSession } from '@/lib/room/turns';
import { readRoomMarker, stampRoomMarker } from '@/lib/room/read-marker';

export const maxDuration = 15;

// THE ONE ROOM — R1 (docs/one-room-plan.md). The room conversation's client API.
//   GET  ?key=<roomKey>            → { turns } (oldest→newest, last 50)
//   POST { roomKey, role, text, refs?, dedupeKey? } → persist a turn
// RLS scopes everything to the caller. The CLIENT never sets `author` — coworker attribution is
// written only by server-side engine paths (delegation report-backs, the prepare pass).

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const key = request.nextUrl.searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
    // History (Claude-style): ?sessions=1 lists archived sessions; ?session=<iso> reads one.
    if (request.nextUrl.searchParams.get('sessions')) {
      return NextResponse.json({ sessions: await listRoomSessions(supabase, user.id, key) });
    }
    const session = request.nextUrl.searchParams.get('session');
    if (session) {
      return NextResponse.json({ turns: await readRoomSession(supabase, user.id, key, session) });
    }
    // THE READ MARKER — THE ONE WRITER (lib/room/read-marker.ts). This GET is the seam BOTH room
    // doors share (the rail hydrates every project/loose room from it; the Home chat panel reads
    // its own chat rooms through it), so the fact is stamped exactly once, here, and nowhere else.
    // The marker served back is the PRE-stamp value — the reader's last visit, which is what the
    // reopen delta ("Since you were here — …") is measured against. Only the room's OWNER writes:
    // the client is the caller's own RLS-scoped session. Fire-and-forget in after() — serving a
    // conversation never waits on bookkeeping, and a missed stamp costs one repeated line.
    const [turns, readAt] = await Promise.all([
      readRoomTurns(supabase, user.id, key),
      readRoomMarker(supabase, user.id, key),
    ]);
    // A HOVER IS NOT A VISIT (Sep 8): `?peek=1` serves the same turns and stamps NOTHING. The room
    // warm pre-fills the conversation envelope on hover, and without this the warm would consume
    // the reader's "Since you were here" line for a room they never opened — a delta silently eaten
    // by a prefetch is exactly the kind of quiet lie the marker exists to prevent. The peek also
    // never returns a marker the client could mistake for a served pair (see the warm's comment).
    const peek = request.nextUrl.searchParams.get('peek') === '1';
    if (!peek) after(async () => { await stampRoomMarker(supabase, user.id, key); });
    // SPEECH IS COMPOSED, NEVER TEMPLATED — INCLUDING SPEECH ALREADY WRITTEN (owner walk, Sep 8).
    // `composeAskSpeech` replaced the canned ask preamble, but an ask's text is DURABLE: turns
    // authored before that change still stand in live rooms, speaking the template the law
    // outlawed under a composed brief. This is where they are re-spoken — AFTER the paint (the
    // reader never waits on it), bounded, non-fatal, and only when a legacy rendering is actually
    // found. The composed words serve on the next read of this same door.
    after(async () => {
      const { recomposeLegacyAsks } = await import('@/lib/room/legacy-ask-speech');
      await recomposeLegacyAsks(supabase, user.id, turns);
    });
    // W13.6 · THE ASK SPEAKS TRUE ON THIS PAINT: a stored ask claiming readiness is served with the
    // deterministic floor while the repair above re-speaks it (zero AI, never blocks on a model).
    const { truthfulAskTurns } = await import('@/lib/room/legacy-ask-speech');
    return NextResponse.json({ turns: await truthfulAskTurns(turns as never[]), readAt });
  } catch (e) {
    console.error('[room/turns GET]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

// DELETE ?key=<roomKey> — "Clear conversation": ARCHIVES the live turns (a session boundary
// History can reopen — never a deletion; pre-migration degrades to the old delete). The brain's
// memory (entity state, links, ledger) is untouched — turns are narration, not memory.
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const key = request.nextUrl.searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
    // ?scope=chat — THE PROJECT ROOM'S "New chat" (owner, Sep 14): archive the AD-HOC EXCHANGE and
    // leave the room's standing record (engine narrations, cards, attributed speech) untouched.
    // The structural boundary lives in ONE place, lib/room/turns.ts — never re-decided here.
    if (request.nextUrl.searchParams.get('scope') === 'chat') {
      const archived = await archiveRoomChat(supabase, user.id, key);
      return NextResponse.json({ ok: true, archived });
    }
    await archiveRoomTurns(supabase, user.id, key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[room/turns DELETE]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

// PATCH ?key=<roomKey>&session=<iso> — RESUME a saved chat (owner, Sep 14: "shouldn't clicking on
// saved chats open the actual chat? and allow to resume from there?"). The current exchange is saved
// and the named session comes back to live, in that order, inside the ONE module that owns the
// session boundary — this door decides nothing about what a chat turn is.
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const key = request.nextUrl.searchParams.get('key');
    const session = request.nextUrl.searchParams.get('session');
    if (!key || !session) return NextResponse.json({ error: 'key and session required' }, { status: 400 });
    const { restored, saved } = await restoreRoomSession(supabase, user.id, key, session);
    return NextResponse.json({ ok: true, restored, saved });
  } catch (e) {
    console.error('[room/turns PATCH]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json() as {
      roomKey?: string; role?: string; text?: string;
      // `tag` = the grounding id the prose placed — THE REF IS ITS TAG (lib/home/ask-refs.ts).
      refs?: Array<{ label: string; href: string | null; tag?: string }>; dedupeKey?: string;
      component?: { key?: string; refId?: string; state?: Record<string, unknown> };
      authorAgentId?: string;
    };
    if (!body.roomKey || (body.role !== 'user' && body.role !== 'system') || !body.text?.trim()) {
      return NextResponse.json({ error: 'roomKey, role (user|system), text required' }, { status: 400 });
    }
    // A CARD IS A TURN (docs/threads-plan.md — THE CARD CONTRACT): every card a Home-addressed
    // coworker produced must survive the reload, so this door takes ONE allowlisted component —
    // `worker_cards`, a bounded list of POINTERS at what that exchange made. Never payloads: each
    // card's truth (an email draft's `sent_at`, a document's current version, a workflow draft's
    // confirm token, an invite's row) lives where its own door writes it, so the two surfaces
    // cannot disagree. Every OTHER key, and every malformed item, is dropped — this route can
    // never mint an arbitrary component, and there is no generic passthrough: each card KIND has
    // its own validator, naming exactly the fields that kind points with.
    const id = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() && v.length <= 64 ? v : null;
    const CARD_POINTERS: Record<string, (raw: Record<string, unknown>) => Record<string, string> | null> = {
      // the coworker email draft → its DM message metadata (the send door stamps `sent_at` there)
      email_draft: (r) => {
        const tid = id(r.tid), agentId = id(r.agentId), draftId = id(r.draftId);
        return tid && agentId && draftId ? { kind: 'email_draft', tid, agentId, draftId } : null;
      },
      // a produced document/frame → the thread's artifact row (revision-in-place moves it)
      document: (r) => {
        const tid = id(r.tid), artifactId = id(r.artifactId);
        return tid && artifactId ? { kind: 'document', tid, artifactId } : null;
      },
      // a drafted standing task → the draft on its DM message; `token` is the confirm idempotence
      workflow_draft: (r) => {
        const tid = id(r.tid), token = id(r.token);
        return tid && token ? { kind: 'workflow_draft', tid, token } : null;
      },
      // a prepared invite → the invite row its own send door reads by id
      invite: (r) => {
        const tid = id(r.tid), inviteId = id(r.inviteId);
        return tid && inviteId ? { kind: 'invite', tid, inviteId } : null;
      },
      // a previewed bulk deed → the `bulk_deed` row its own commit door reads by id (attention A7)
      bulk_deed: (r) => {
        const tid = id(r.tid), deedId = id(r.deedId);
        return tid && deedId ? { kind: 'bulk_deed', tid, deedId } : null;
      },
    };
    const items = body.component?.key === 'worker_cards' && Array.isArray(body.component.state?.items)
      ? (body.component.state.items as unknown[]).slice(0, 8)
        .map((raw) => {
          if (!raw || typeof raw !== 'object') return null;
          const r = raw as Record<string, unknown>;
          const validate = typeof r.kind === 'string' ? CARD_POINTERS[r.kind] : undefined;
          return validate ? validate(r) : null;
        })
        .filter((p): p is Record<string, string> => !!p)
      : [];
    const component = items.length
      ? { key: 'worker_cards', refId: body.component?.refId && id(body.component.refId) ? String(body.component.refId) : undefined, state: { items } }
      : undefined;
    // THE ONE-NARRATOR LAW: the client still never sets an author STRING. It may only name one of
    // the user's own coworkers by id; the name is resolved here, server-side, from that row (RLS
    // scopes the read to this user's agents) — an unknown id simply speaks unattributed.
    let author: { kind: 'coworker'; id: string; name: string } | undefined;
    if (body.role === 'system' && typeof body.authorAgentId === 'string' && body.authorAgentId) {
      const { data: agent } = await supabase.from('custom_agents')
        .select('id, name').eq('id', body.authorAgentId).maybeSingle();
      if (agent?.name) author = { kind: 'coworker', id: String(agent.id), name: String(agent.name) };
    }
    await writeRoomTurn(supabase, user.id, body.roomKey, {
      role: body.role, text: body.text,
      refs: Array.isArray(body.refs) ? body.refs : undefined,
      dedupeKey: body.dedupeKey ?? null,
      ...(component ? { component } : {}),
      ...(author ? { author } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[room/turns POST]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
