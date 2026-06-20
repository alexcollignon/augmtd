import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getIntegration } from '@/lib/integrations/registry';
import { createConnectSession, isNangoConfigured } from '@/lib/integrations/nango';
import { integrationsAdmin, getCompanyForUser, canManageIntegrations } from '@/lib/integrations/connection';

// POST /api/integrations/connect-session  { provider }
// Returns a short-lived Nango Connect session token for the OAuth popup.
// Company-scoped providers (e.g. Slack) install once for the whole workspace and
// require an owner/admin; the Nango connection is keyed by company_id.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!isNangoConfigured()) {
      return NextResponse.json({ error: 'Integrations are not configured yet.' }, { status: 503 });
    }

    const { provider } = await request.json();
    const def = getIntegration(provider);
    if (!def) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });

    let connectionKey = user.id;
    if (def.scope === 'company') {
      const company = await getCompanyForUser(integrationsAdmin(), user.id);
      if (!company) return NextResponse.json({ error: 'You need a company to connect a team integration.' }, { status: 400 });
      if (!canManageIntegrations(company.role)) {
        return NextResponse.json({ error: 'Only an owner or admin can connect team integrations.' }, { status: 403 });
      }
      connectionKey = company.companyId;
    }

    const token = await createConnectSession(connectionKey, [provider]);
    return NextResponse.json({ token });
  } catch (err) {
    console.error('[integrations/connect-session] error:', err);
    return NextResponse.json({ error: 'Could not start the connection.' }, { status: 500 });
  }
}
