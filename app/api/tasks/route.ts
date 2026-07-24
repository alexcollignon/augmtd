// POST /api/tasks — create a MANUAL task (projecthood Phase 4 R3a). Thin wrapper over THE ONE write
// (lib/commitments/manual.ts) — shared with the create_task_item chat capability.
// Body: { description, dueDate?, entityId? } → { ok, id }.
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createManualTask } from '@/lib/commitments/manual';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { description?: string; dueDate?: string | null; entityId?: string | null };
    const r = await createManualTask(supabase, user.id, { description: String(body.description ?? ''), dueDate: body.dueDate ?? null, entityId: body.entityId ?? null });
    if (!r.ok) return NextResponse.json({ error: r.error ?? 'failed' }, { status: 400 });
    if (r.runTails) after(r.runTails); // both-sides reconcile + log, backgrounded — creation stays instant
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) {
    console.error('[tasks] POST error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
