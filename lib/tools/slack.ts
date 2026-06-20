// ─── Slack tools ──────────────────────────────────────────────────────────────
// Company-scoped: one workspace install (Nango connection keyed by company_id),
// shared by the whole team. Coworkers post as PERSONAS of the one bot — each
// message carries the coworker's name + avatar (chat:write.customize) so a
// coworker appears once in a channel, never once-per-user. The bot must be
// invited to a channel to post/read it.

import { nangoProxy } from '@/lib/integrations/nango';
import { resolveConnection } from '@/lib/integrations/connection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const NOT_CONNECTED = "Slack isn't connected for your team. An owner or admin can connect it in Settings → Connections.";

const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://app.augmtd.ai';

// Worker role → avatar file in public/workers (for the persona icon).
const ROLE_AVATAR: Record<string, string> = {
  personal_assistant: 'clara',
  content_manager: 'sofia',
  linkedin_drafter: 'luca',
  research_analyst: 'max',
};

async function getPersona(admin: Admin, agentId?: string): Promise<{ username?: string; icon_url?: string }> {
  if (!agentId) return {};
  const { data } = await admin.from('custom_agents').select('name, worker_role').eq('id', agentId).maybeSingle();
  if (!data?.name) return {};
  const file = data.worker_role ? ROLE_AVATAR[data.worker_role as string] : undefined;
  return { username: data.name as string, icon_url: file ? `${BASE_URL}/workers/${file}.png` : undefined };
}

// ── Definitions ───────────────────────────────────────────────────────────────

export const slackListChannelsDefinition = {
  name: 'slack_list_channels',
  description: "List the Slack channels the team's app can see (to resolve a channel name to post to). Call before slack_post_message if you only have a channel name.",
  input_schema: { type: 'object', properties: {} as Record<string, unknown>, required: [] as string[] },
};

export const slackPostMessageDefinition = {
  name: 'slack_post_message',
  description: "Post a message to a Slack channel, as this coworker (their name + avatar). The app must already be in the channel. Use slack_list_channels to resolve a channel id from a name.",
  input_schema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel id (preferred, e.g. C0123ABCD) or name (e.g. #general).' },
      text: { type: 'string', description: 'Message text. Slack mrkdwn: *bold*, _italic_, <url|label>.' },
    },
    required: ['channel', 'text'],
  },
};

// ── Executors ─────────────────────────────────────────────────────────────────

export async function executeSlackListChannels(userId: string, admin: Admin): Promise<string> {
  const conn = await resolveConnection(admin, userId, 'slack');
  if (!conn) return NOT_CONNECTED;
  const res = await nangoProxy({
    method: 'GET',
    endpoint: '/conversations.list',
    providerConfigKey: 'slack',
    connectionId: conn.connectionId,
    params: { types: 'public_channel', exclude_archived: 'true', limit: '200' },
  });
  const body = res.body as { ok?: boolean; channels?: Array<{ id: string; name: string }>; error?: string } | null;
  if (!res.ok || !body?.ok) return `Couldn't list Slack channels: ${body?.error ?? res.status}.`;
  const chans = (body.channels ?? []).map(c => `#${c.name} (${c.id})`);
  if (chans.length === 0) return 'No channels visible yet — invite the app to a channel first.';
  return `Slack channels (${chans.length}):\n${chans.join('\n')}`;
}

export async function executeSlackPostMessage(
  config: Record<string, unknown>,
  userId: string,
  agentId: string | undefined,
  admin: Admin,
): Promise<string> {
  const channel = String(config.channel ?? '').trim();
  const text = String(config.text ?? '').trim();
  if (!channel || !text) return 'Provide both a channel and message text.';

  const conn = await resolveConnection(admin, userId, 'slack');
  if (!conn) return NOT_CONNECTED;

  const persona = await getPersona(admin, agentId);
  const res = await nangoProxy({
    method: 'POST',
    endpoint: '/chat.postMessage',
    providerConfigKey: 'slack',
    connectionId: conn.connectionId,
    data: {
      channel,
      text,
      ...(persona.username ? { username: persona.username } : {}),
      ...(persona.icon_url ? { icon_url: persona.icon_url } : {}),
    },
  });
  const body = res.body as { ok?: boolean; error?: string } | null;
  if (!res.ok || !body?.ok) {
    const who = persona.username ?? 'the app';
    return `Couldn't post to Slack (${body?.error ?? res.status}). Make sure ${who} is invited to ${channel}.`;
  }
  return `Posted to Slack ${channel}${persona.username ? ` as ${persona.username}` : ''}.`;
}
