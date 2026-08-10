// ─── POST /api/workflows/runs/reviewed — THE SEEN SIGNAL, migrated (coherence slice #1) ──────
// reviewed_at used to be stamped in exactly ONE place: opening the task's thread in the old
// /workers chat. The new surface (the ledger's Runs lens, "see the latest", the run audit)
// stamped nothing — so auto-pause (3 consecutive unreviewed scheduled runs) would wrongly pause
// workflows for a user who reviews everything through the Workflows page. This route is the new
// surface's stamp: opening the Runs lens marks everything reviewed (the Claude "open the brief →
// the 9-new clears" behavior); opening one workflow's deliverable marks that workflow's runs.
// Also clears the sidebar's unread badge (same fact, one mechanic).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let workflowId: string | null = null;
  try {
    const body = await request.json();
    workflowId = typeof body?.workflowId === 'string' ? body.workflowId : null;
  } catch { /* empty body = mark all */ }

  // workflow_runs has NO user UPDATE policy (updates are service-role only, by design) — the
  // admin client writes; the eq(user_id, auth user) filter keeps it strictly the user's own rows.
  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let q = admin.from('workflow_runs')
    .update({ reviewed_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('status', 'succeeded')
    .is('reviewed_at', null);
  if (workflowId) q = q.eq('workflow_id', workflowId);
  const { error } = await q;
  if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
