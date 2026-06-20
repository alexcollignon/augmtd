import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getIntegration } from '@/lib/integrations/registry';
import { getConnection, deleteConnection } from '@/lib/integrations/nango';
import { integrationsAdmin, getCompanyForUser, canManageIntegrations } from '@/lib/integrations/connection';

type Params = { params: Promise<{ provider: string }> };

// Pull a friendly workspace/team name out of a Nango connection payload (best-effort).
function extractMetadata(provider: string, conn: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const cfg = (conn.connection_config ?? {}) as Record<string, unknown>;
  const raw = ((conn.credentials as Record<string, unknown>)?.raw ?? {}) as Record<string, unknown>;
  if (provider === 'slack') {
    const team = raw.team as Record<string, unknown> | undefined;
    meta.workspace_name = team?.name ?? cfg['team.name'] ?? raw.team_name ?? null;
  }
  return meta;
}

/** Resolve scope key (company_id or user_id) + guard admin for company scope. */
async function resolveWritable(provider: string, userId: string): Promise<
  | { ok: true; scope: 'company' | 'user'; key: string; companyId: string | null }
  | { ok: false; status: number; error: string }
> {
  const def = getIntegration(provider);
  if (!def) return { ok: false, status: 400, error: 'Unknown provider' };
  if (def.scope === 'company') {
    const company = await getCompanyForUser(integrationsAdmin(), userId);
    if (!company) return { ok: false, status: 400, error: 'You need a company to manage a team integration.' };
    if (!canManageIntegrations(company.role)) return { ok: false, status: 403, error: 'Only an owner or admin can manage team integrations.' };
    return { ok: true, scope: 'company', key: company.companyId, companyId: company.companyId };
  }
  return { ok: true, scope: 'user', key: userId, companyId: null };
}

// POST /api/integrations/[provider] — confirm + record a connection after the popup.
export async function POST(_req: NextRequest, { params }: Params) {
  const { provider } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const w = await resolveWritable(provider, user.id);
    if (!w.ok) return NextResponse.json({ error: w.error }, { status: w.status });

    const conn = await getConnection(provider, w.key);
    if (!conn) return NextResponse.json({ error: 'No connection found — please try connecting again.' }, { status: 400 });

    const metadata = extractMetadata(provider, conn);
    const admin = integrationsAdmin();
    const { error: upsertErr } = await admin
      .from('integration_connections')
      .upsert(
        {
          user_id: user.id,
          company_id: w.companyId,
          scope: w.scope,
          provider,
          nango_connection_id: w.key,
          status: 'active',
          metadata,
          updated_at: new Date().toISOString(),
        },
        { onConflict: w.scope === 'company' ? 'company_id,provider' : 'user_id,provider' },
      );
    if (upsertErr) throw upsertErr;

    return NextResponse.json({ ok: true, metadata });
  } catch (err) {
    console.error('[integrations/provider] POST error:', err);
    return NextResponse.json({ error: 'Could not save the connection.' }, { status: 500 });
  }
}

// DELETE /api/integrations/[provider] — disconnect (revoke in Nango + drop the row).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { provider } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const w = await resolveWritable(provider, user.id);
    if (!w.ok) return NextResponse.json({ error: w.error }, { status: w.status });

    await deleteConnection(provider, w.key);
    const admin = integrationsAdmin();
    let q = admin.from('integration_connections').delete().eq('provider', provider).eq('scope', w.scope);
    q = w.scope === 'company' ? q.eq('company_id', w.key) : q.eq('user_id', w.key);
    await q;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[integrations/provider] DELETE error:', err);
    return NextResponse.json({ error: 'Could not disconnect.' }, { status: 500 });
  }
}
