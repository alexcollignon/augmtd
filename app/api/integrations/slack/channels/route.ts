import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { integrationsAdmin, resolveConnection } from '@/lib/integrations/connection';
import { nangoProxy } from '@/lib/integrations/nango';
import { SLACK_APP_KEYS, SLACK_DEFAULT_APP_KEY } from '@/lib/integrations/registry';

// GET /api/integrations/slack/channels — public + private channels the app can see,
// for the builder/modal channel pickers.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = integrationsAdmin();
    // Channels are workspace-wide for public; use any connected coworker app (prefer Clara).
    let providerKey = SLACK_DEFAULT_APP_KEY;
    let conn = await resolveConnection(admin, user.id, providerKey);
    if (!conn) {
      for (const k of SLACK_APP_KEYS) {
        const c = await resolveConnection(admin, user.id, k);
        if (c) { conn = c; providerKey = k; break; }
      }
    }
    if (!conn) return NextResponse.json({ connected: false, channels: [] });

    const res = await nangoProxy({
      method: 'GET',
      endpoint: '/conversations.list',
      providerConfigKey: providerKey,
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
