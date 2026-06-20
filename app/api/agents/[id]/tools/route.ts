import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { INTEGRATIONS, isKnownProvider } from '@/lib/integrations/registry';
import { integrationsAdmin, listConnectedProviders, getAgentToolSettings } from '@/lib/integrations/connection';

type Params = { params: Promise<{ id: string }> };

async function ownAgent(supabase: Awaited<ReturnType<typeof createClient>>, agentId: string, userId: string) {
  const { data } = await supabase.from('custom_agents').select('id').eq('id', agentId).eq('user_id', userId).single();
  return Boolean(data);
}

// GET /api/agents/[id]/tools — each integration with connected + per-worker enabled + config.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id: agentId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await ownAgent(supabase, agentId, user.id))) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const admin = integrationsAdmin();
    const [connected, settings] = await Promise.all([
      listConnectedProviders(admin, user.id),
      getAgentToolSettings(admin, agentId),
    ]);

    const tools = INTEGRATIONS.map(def => ({
      provider: def.provider,
      name: def.name,
      description: def.description,
      scope: def.scope,
      connected: connected.includes(def.provider),
      enabled: settings[def.provider]?.enabled ?? true,   // default on
      config: settings[def.provider]?.config ?? {},
    }));

    return NextResponse.json({ tools });
  } catch (err) {
    console.error('[agents/tools] GET error:', err);
    return NextResponse.json({ error: 'Failed to load worker tools' }, { status: 500 });
  }
}

// PUT /api/agents/[id]/tools — upsert per-worker settings.
// Body: { settings: [{ provider, enabled?, config? }] }
export async function PUT(request: NextRequest, { params }: Params) {
  const { id: agentId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await ownAgent(supabase, agentId, user.id))) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const incoming: Array<{ provider?: unknown; enabled?: unknown; config?: unknown }> = Array.isArray(body.settings) ? body.settings : [];

    const rows = incoming
      .filter(s => typeof s.provider === 'string' && isKnownProvider(s.provider as string))
      .map(s => ({
        user_id: user.id,
        agent_id: agentId,
        provider: s.provider as string,
        enabled: s.enabled !== false,
        config: (s.config && typeof s.config === 'object') ? s.config : {},
        updated_at: new Date().toISOString(),
      }));

    if (rows.length > 0) {
      // (agent_id, provider) has a full unique constraint → onConflict is safe here.
      const { error: upErr } = await supabase
        .from('agent_tool_settings')
        .upsert(rows, { onConflict: 'agent_id,provider' });
      if (upErr) throw upErr;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[agents/tools] PUT error:', err);
    return NextResponse.json({ error: 'Failed to save worker tools' }, { status: 500 });
  }
}
