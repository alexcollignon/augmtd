import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await request.json();
  if (!code?.trim()) return NextResponse.json({ error: 'Code required' }, { status: 400 });

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Case-insensitive lookup via ilike
  const { data: company } = await adminClient
    .from('companies')
    .select('id, name, slug, plan, type, status, features')
    .ilike('join_code', code.trim())
    .maybeSingle();

  if (!company) return NextResponse.json({ error: 'Invalid code' }, { status: 404 });
  if (company.status !== 'active') {
    return NextResponse.json({ error: 'This workspace is not accepting new members' }, { status: 403 });
  }

  // Check if user is already a member of this specific workspace
  const { data: existingMembership } = await adminClient
    .from('company_members')
    .select('id, company_id, companies(type)')
    .eq('user_id', user.id)
    .eq('company_id', company.id)
    .eq('status', 'active')
    .maybeSingle() as { data: { id: string; company_id: string; companies: { type: string } | { type: string }[] | null } | null };

  if (existingMembership) {
    return NextResponse.json({ error: 'You are already a member of this workspace' }, { status: 409 });
  }

  // Add member
  const { error: memberErr } = await adminClient
    .from('company_members')
    .insert({ company_id: company.id, user_id: user.id, role: 'member', status: 'active' });

  if (memberErr) {
    if (memberErr.code === '23505') return NextResponse.json({ error: 'Already a member' }, { status: 409 });
    console.error('[join] member insert error:', memberErr);
    return NextResponse.json({ error: 'Failed to join' }, { status: 500 });
  }

  // Upsert profile — creates one if the signup trigger hasn't fired yet.
  await adminClient
    .from('profiles')
    .upsert(
      { id: user.id, email: user.email, needs_join: false },
      { onConflict: 'id' }
    );

  // Enable meeting assistant by default if the workspace has meetings turned on.
  // Uses neq(true) so it activates for both null and false defaults without
  // overriding a user who has already explicitly enabled it elsewhere.
  const meetingsEnabled = (company.features as any)?.meetings !== false;
  if (meetingsEnabled) {
    await adminClient
      .from('profiles')
      .update({ attendee_enabled: true })
      .eq('id', user.id)
      .neq('attendee_enabled', true);
  }

  // Adopt any un-scoped connections (workspace_id = null) into this workspace.
  // This covers connections created during signup before the user had a workspace.
  await adminClient
    .from('connections')
    .update({ workspace_id: company.id })
    .eq('user_id', user.id)
    .is('workspace_id', null);

  await logAudit({
    adminClient,
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.MEMBER_JOIN_VIA_CODE,
    targetType: 'member',
    targetId: user.id,
    workspaceId: company.id,
    metadata: { workspaceName: company.name, workspaceType: company.type },
  });

  // THE TEAM ARRIVES WITH THE MEMBERSHIP (Aug 11, found live: a sovereign joiner had zero
  // coworkers — seeding was coupled to the email bootstrap they never trigger). Joining IS
  // "set up your agents": seed idempotently, off the response path.
  after(async () => {
    try {
      const { ensureWorkers } = await import('@/lib/workers/seed');
      await ensureWorkers(adminClient, user.id);
    } catch (e) { console.error('[company/join] worker seeding failed:', e); }

    // THE COMPANY SEED KIT: the workspace's curated documents land in the new member's own
    // knowledge base, folders and all. A no-op (one settings read) when no kit is configured.
    try {
      const { seedKnowledgeForUser } = await import('@/lib/workspace/seed-kb');
      await seedKnowledgeForUser(adminClient, company.id, user.id);
    } catch (e) { console.error('[company/join] seed kit failed:', e); }
  });

  return NextResponse.json({ company });
}
