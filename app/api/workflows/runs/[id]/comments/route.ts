// ─── GET/POST /api/workflows/runs/[id]/comments — THE HANDOFF THREAD (mockup-fidelity wave) ────
//
// NO SECOND ROOM (the orchestrator's locked decision): a comment on a run is a turn in the
// `run:<runId>` room — the SAME room the decision narrations already speak into — stored under the
// workflow CREATOR's user_id so one run has exactly one thread whoever is talking. This route is
// THE ONE writer and THE ONE reader of that thread's user comments; a surface that stored them
// anywhere else would be a second truth about the same conversation.
//
// AUTHORIZATION (both verbs, one predicate — `canReadRunRecord`): the creator, the accountability
// owner, or anyone who currently holds OR has ever held a gate on this run. Everyone else gets
// 404 — never 403: a refusal must not confirm that the run exists.
//
// THE TURNS ARE ATTRIBUTED AND DEDUPE-FREE: role 'user' + author {name} (two identical comments
// are two comments — a dedupe key would silently eat the second one). Engine narrations in the
// same room are role 'system' and are NOT comments; the reader filters to user turns only.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

export const maxDuration = 30;

const MAX_COMMENT = 600;

type ServedComment = { author: string | null; text: string; at: string | null };

async function firstNameOf(
  admin: Awaited<ReturnType<typeof adminClient>>, userId: string,
): Promise<string | null> {
  try {
    const { data } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    const full = String((data as { full_name?: string } | null)?.full_name ?? '').trim();
    return full.split(/\s+/)[0] || null;
  } catch { return null; }
}

async function adminClient() {
  const { createClient: createAdmin } = await import('@supabase/supabase-js');
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Auth once, the same way, for both verbs. Returns the creator's id (the room's owner). */
async function authorize(runId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  try { await requireFeature('studio', supabase, user.id); }
  catch (err) { return { error: handleWorkspaceError(err) } as const; }

  const admin = await adminClient();
  const { canReadRunRecord } = await import('@/lib/workflows/run-record');
  const access = await canReadRunRecord(admin, runId, user.id);
  if (!access.ok || !access.creatorUserId) {
    return { error: NextResponse.json({ error: 'run not found' }, { status: 404 }) } as const;
  }
  return { admin, userId: user.id, creatorUserId: access.creatorUserId } as const;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const auth = await authorize(runId);
    if ('error' in auth) return auth.error;

    const { readRoomTurns } = await import('@/lib/room/turns');
    const turns = await readRoomTurns(auth.admin, auth.creatorUserId, `run:${runId}`, 200);
    const comments: ServedComment[] = turns
      .filter((t) => t.role === 'user')
      .map((t) => ({ author: t.author?.name ?? null, text: t.text, at: t.createdAt ?? null }));
    return NextResponse.json({ comments });
  } catch (e) {
    console.error('[runs/comments GET]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const auth = await authorize(runId);
    if ('error' in auth) return auth.error;

    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const text = String(body.text ?? '').trim().slice(0, MAX_COMMENT);
    if (!text) return NextResponse.json({ error: 'nothing to say' }, { status: 400 });

    const name = await firstNameOf(auth.admin, auth.userId);
    const { writeRoomTurn } = await import('@/lib/room/turns');
    await writeRoomTurn(auth.admin, auth.creatorUserId, `run:${runId}`, {
      role: 'user',
      text,
      // The room's author slot carries WHO SPOKE (the run room is a record, not a rendered rail
      // room — this is the only attribution channel a turn has).
      author: { kind: 'coworker', id: auth.userId, name: name ?? 'A teammate' },
    });

    const comment: ServedComment = { author: name, text, at: new Date().toISOString() };
    return NextResponse.json({ comment });
  } catch (e) {
    console.error('[runs/comments POST]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
