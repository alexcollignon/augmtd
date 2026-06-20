import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { integrationsAdmin, resolveConnection } from '@/lib/integrations/connection';
import { nangoProxy } from '@/lib/integrations/nango';

// GET /api/integrations/slack/channels — public + private channels the app can see,
// for the builder/modal channel pickers.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = integrationsAdmin();
    const conn = await resolveConnection(admin, user.id, 'slack');
    if (!conn) return NextResponse.json({ connected: false, channels: [] });

    const res = await nangoProxy({
      method: 'GET',
      endpoint: '/conversations.list',
      providerConfigKey: 'slack',
      connectionId: conn.connectionId,
      params: { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200' },
    });
    const body = res.body as { ok?: boolean; channels?: Array<{ id: string; name: string; is_private?: boolean }> } | null;
    if (!res.ok || !body?.ok) return NextResponse.json({ connected: true, channels: [] });

    const channels = (body.channels ?? [])
      .map(c => ({ id: c.id, name: c.name, is_private: Boolean(c.is_private) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ connected: true, channels });
  } catch (err) {
    console.error('[integrations/slack/channels] error:', err);
    return NextResponse.json({ connected: false, channels: [] }, { status: 200 });
  }
}
