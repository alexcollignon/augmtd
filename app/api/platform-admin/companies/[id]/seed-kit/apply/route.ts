import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { seedKnowledgeForUser } from '@/lib/workspace/seed-kb';

export const maxDuration = 300;

// POST /api/platform-admin/companies/[id]/seed-kit/apply — plant the kit in EVERY active
// member's knowledge base. New members get it on join; this is the door for the people who
// joined before the kit existed (or before a folder was added).
//
// AN HONEST BUDGET (the sweep law): indexing is real AI work, so this runs sequentially under a
// wall-clock guard and REPORTS who it did not reach (`leftBehind`) rather than dying mid-list —
// re-running is free for anyone already seeded (content-hash idempotency).

const BUDGET_MS = 250_000; // under the 300s function budget, with room to answer

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: company } = await admin.from('companies').select('id, name, settings').eq('id', id).maybeSingle();
    if (!company) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const { data: members } = await admin
      .from('company_members')
      .select('user_id')
      .eq('company_id', id)
      .eq('status', 'active');

    const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);

    const started = Date.now();
    let seeded = 0, skipped = 0, failed = 0;
    const leftBehind: string[] = [];

    for (let i = 0; i < userIds.length; i++) {
      if (Date.now() - started > BUDGET_MS) { leftBehind.push(...userIds.slice(i)); break; }
      const r = await seedKnowledgeForUser(admin, id, userIds[i]);
      seeded += r.files; skipped += r.skipped; failed += r.failed;
    }

    await logAudit({
      adminClient: admin,
      actorUserId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.SEED_KIT_APPLY,
      targetType: 'workspace',
      targetId: id,
      workspaceId: id,
      metadata: { members: userIds.length, seeded, skipped, failed, leftBehind: leftBehind.length },
    });

    return NextResponse.json({ ok: true, seeded, skipped, failed, leftBehind });
  } catch (e) {
    console.error('[platform-admin/seed-kit/apply] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
