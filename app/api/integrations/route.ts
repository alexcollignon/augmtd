import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { INTEGRATIONS, SLACK_APP_KEYS } from '@/lib/integrations/registry';
import { isNangoConfigured } from '@/lib/integrations/nango';
import { integrationsAdmin, getCompanyForUser, canManageIntegrations } from '@/lib/integrations/connection';

// GET /api/integrations — the catalogue annotated with this user's / company's
// connection state and whether the user may manage each (admin for company scope).
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = integrationsAdmin();
    const company = await getCompanyForUser(admin, user.id);

    // Pull every connection visible to this user (own + company) in one query.
    const { data: rows } = await admin
      .from('integration_connections')
      .select('provider, scope, status, metadata, company_id, user_id')
      .or(`user_id.eq.${user.id}${company ? `,company_id.eq.${company.companyId}` : ''}`);

    const isActive = (provider: string) => (rows ?? []).some(
      (r: { provider: string; status: string }) => r.provider === provider && r.status === 'active',
    );

    const integrations = INTEGRATIONS.map(i => {
      const canManage = i.scope === 'company'
        ? Boolean(company && canManageIntegrations(company.role))
        : true;

      // Slack = one card backed by one app per coworker; report progress across the set.
      if (i.provider === 'slack') {
        const count = SLACK_APP_KEYS.filter(isActive).length;
        return {
          ...i,
          connected: count === SLACK_APP_KEYS.length,
          connectedCount: count,
          connectedTotal: SLACK_APP_KEYS.length,
          status: count > 0 ? 'active' : null,
          metadata: null,
          canManage,
        };
      }

      const row = (rows ?? []).find((r: { provider: string; scope: string }) =>
        r.provider === i.provider && r.scope === i.scope,
      );
      return {
        ...i,
        connected: Boolean(row && row.status === 'active'),
        status: row?.status ?? null,
        metadata: row?.metadata ?? null,
        canManage,
      };
    });

    return NextResponse.json({ integrations, configured: isNangoConfigured() });
  } catch (err) {
    console.error('[integrations] GET error:', err);
    return NextResponse.json({ error: 'Failed to load integrations' }, { status: 500 });
  }
}
