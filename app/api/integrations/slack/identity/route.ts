import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { randomInt } from 'crypto';
import { nangoProxy } from '@/lib/integrations/nango';
import { resolveConnection } from '@/lib/integrations/connection';
import { SLACK_APP_KEYS, SLACK_DEFAULT_APP_KEY } from '@/lib/integrations/registry';

// Verify-by-code Slack identity: prove control of a Slack account via a code the bot DMs,
// so DM-to-me / @me work when the user's Slack email ≠ login email. Unspoofable, no OAuth app.

const CODE_TTL_MIN = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findSlackConn(admin: any, userId: string) {
  for (const key of [SLACK_DEFAULT_APP_KEY, ...SLACK_APP_KEYS]) {
    const conn = await resolveConnection(admin, userId, key);
    if (conn) return { connectionId: conn.connectionId, providerKey: key };
  }
  return null;
}

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ac = admin();
  const { data: row } = await ac.from('slack_identities').select('slack_user_id, verify').eq('user_id', user.id).maybeSingle();
  const verify = row?.verify as { target_name?: string; expires_at?: string } | null;
  const pending = !!verify && !!verify.expires_at && new Date(verify.expires_at) > new Date();
  return NextResponse.json({ slackUserId: row?.slack_user_id ?? null, pending, pendingName: pending ? verify?.target_name ?? null : null });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');
  const ac = admin();

  if (action === 'clear') {
    await ac.from('slack_identities').delete().eq('user_id', user.id);
    return NextResponse.json({ ok: true });
  }

  if (action === 'start') {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });

    const conn = await findSlackConn(ac, user.id);
    if (!conn) return NextResponse.json({ error: "Slack isn't connected for your team yet." }, { status: 400 });

    const look = await nangoProxy({ method: 'GET', endpoint: '/users.lookupByEmail', providerConfigKey: conn.providerKey, connectionId: conn.connectionId, params: { email } });
    const member = (look.body as { user?: { id?: string; real_name?: string; name?: string } } | null)?.user;
    if (!member?.id) return NextResponse.json({ error: "No Slack member found with that email in your workspace." }, { status: 400 });

    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
    await ac.from('slack_identities').upsert({
      user_id: user.id,
      verify: { code, target_id: member.id, target_name: member.real_name || member.name || email, expires_at: expiresAt },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    // DM the code from the bot (Clara by default). Open a DM channel first.
    const open = await nangoProxy({ method: 'POST', endpoint: '/conversations.open', providerConfigKey: conn.providerKey, connectionId: conn.connectionId, data: { users: member.id } });
    const channel = (open.body as { channel?: { id?: string } } | null)?.channel?.id;
    if (!channel) return NextResponse.json({ error: "Couldn't open a Slack DM to that account." }, { status: 400 });
    await nangoProxy({ method: 'POST', endpoint: '/chat.postMessage', providerConfigKey: conn.providerKey, connectionId: conn.connectionId, data: { channel, text: `Your AUGMTD verification code is *${code}*. Enter it in Settings → Connections to link your Slack. It expires in ${CODE_TTL_MIN} minutes.` } });

    return NextResponse.json({ ok: true, sentTo: member.real_name || member.name || email });
  }

  if (action === 'confirm') {
    const code = String(body.code ?? '').trim();
    const { data: row } = await ac.from('slack_identities').select('verify').eq('user_id', user.id).maybeSingle();
    const v = row?.verify as { code?: string; target_id?: string; expires_at?: string } | null;
    if (!v || !v.expires_at || new Date(v.expires_at) < new Date()) return NextResponse.json({ error: 'The code expired — send a new one.' }, { status: 400 });
    if (code !== v.code) return NextResponse.json({ error: 'Incorrect code.' }, { status: 400 });
    await ac.from('slack_identities').upsert({ user_id: user.id, slack_user_id: v.target_id, verify: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
