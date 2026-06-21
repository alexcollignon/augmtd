// ─── Slack tools ──────────────────────────────────────────────────────────────
// Company-scoped, ONE SLACK APP PER COWORKER (distinct bot identities → separate
// DM threads, real @mentions). A worker's role maps to its own Nango provider key
// (slack-clara / slack-sofia / …); each posts/DMs as itself (no persona override).
// The bot must be invited to a channel to post/read it.

import { nangoProxy } from '@/lib/integrations/nango';
import { resolveConnection, isToolEnabledForAgent } from '@/lib/integrations/connection';
import { slackKeyForRole } from '@/lib/integrations/registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const NOT_CONNECTED = "This coworker isn't connected to Slack yet. An owner or admin can connect the team in Settings → Connections.";
const DISABLED = "Slack is turned off for this coworker. Enable it in this worker's Tools tab.";

// Resolve which Slack app (per-coworker) + connection this worker posts through.
async function slackConn(admin: Admin, userId: string, agentId?: string): Promise<{ connectionId: string; providerKey: string } | null> {
  let role: string | null = null;
  if (agentId) {
    const { data } = await admin.from('custom_agents').select('worker_role').eq('id', agentId).maybeSingle();
    role = (data?.worker_role as string) ?? null;
  }
  const providerKey = slackKeyForRole(role);
  const conn = await resolveConnection(admin, userId, providerKey);
  return conn ? { connectionId: conn.connectionId, providerKey } : null;
}

// "DM the user" sentinels — a channel value the worker/UI uses to mean a direct message.
const DM_SENTINELS = new Set(['@me', 'dm', 'dm:me', 'me', '__dm__']);
export function isDmTarget(ch: string): boolean { return DM_SENTINELS.has(ch.trim().toLowerCase()); }

// Resolve the user's Slack DM channel id (email → slack user → open DM) for a given
// coworker app. null if not resolvable.
async function resolveDmChannelId(admin: Admin, userId: string, connectionId: string, providerKey: string): Promise<string | null> {
  let email: string | undefined;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    email = (data?.user?.email as string | undefined) ?? undefined;
  } catch { /* no email */ }
  if (!email) return null;

  const lookup = await nangoProxy({
    method: 'GET', endpoint: '/users.lookupByEmail', providerConfigKey: providerKey,
    connectionId, params: { email },
  });
  const slackUserId = (lookup.body as { user?: { id?: string } } | null)?.user?.id;
  if (!slackUserId) return null;

  const open = await nangoProxy({
    method: 'POST', endpoint: '/conversations.open', providerConfigKey: providerKey,
    connectionId, data: { users: slackUserId },
  });
  return (open.body as { channel?: { id?: string } } | null)?.channel?.id ?? null;
}

interface SlackMember { id: string; name?: string; deleted?: boolean; is_bot?: boolean; profile?: { real_name?: string; display_name?: string } }

// Fetch workspace members (one page) for name → id resolution. Best-effort.
async function fetchMembers(connectionId: string, providerKey: string): Promise<SlackMember[]> {
  const res = await nangoProxy({ method: 'GET', endpoint: '/users.list', providerConfigKey: providerKey, connectionId, params: { limit: '500' } });
  return ((res.body as { members?: SlackMember[] } | null)?.members ?? []).filter(m => !m.deleted && !m.is_bot && m.id);
}

function matchMemberByName(members: SlackMember[], name: string): string | undefined {
  const n = name.trim().toLowerCase();
  const cands = (m: SlackMember) => [m.profile?.display_name, m.profile?.real_name, m.name].filter(Boolean).map(s => (s as string).toLowerCase());
  // exact display/real/handle, then first-name
  let u = members.find(m => cands(m).includes(n));
  if (!u) u = members.find(m => (m.profile?.real_name ?? '').toLowerCase().split(' ')[0] === n);
  return u?.id;
}

// Turn `<@me>`, `<@someone@email.com>`, and `<@Name>` tokens into real Slack mentions
// (`<@U…>`). Leaves existing `<@U…>` ids and `<!channel>`/`<!here>` alone. Names are
// resolved against the workspace's actual members so the worker never invents one.
async function resolveMentions(text: string, admin: Admin, userId: string, connectionId: string, providerKey: string): Promise<string> {
  const matches = [...text.matchAll(/<@([^>]+)>/g)];
  if (matches.length === 0) return text;
  let runnerEmail: string | null | undefined;
  let members: SlackMember[] | undefined;
  let out = text;
  for (const m of matches) {
    const inner = m[1].trim();
    if (/^[UW][A-Z0-9]{6,}$/.test(inner)) continue; // already a Slack id
    let id: string | undefined;
    if (inner.toLowerCase() === 'me') {
      if (runnerEmail === undefined) {
        try { const { data } = await admin.auth.admin.getUserById(userId); runnerEmail = (data?.user?.email as string) ?? null; } catch { runnerEmail = null; }
      }
      if (runnerEmail) {
        const look = await nangoProxy({ method: 'GET', endpoint: '/users.lookupByEmail', providerConfigKey: providerKey, connectionId, params: { email: runnerEmail } });
        id = (look.body as { user?: { id?: string } } | null)?.user?.id;
      }
    } else if (inner.includes('@') && inner.includes('.')) {
      const look = await nangoProxy({ method: 'GET', endpoint: '/users.lookupByEmail', providerConfigKey: providerKey, connectionId, params: { email: inner } });
      id = (look.body as { user?: { id?: string } } | null)?.user?.id;
    } else {
      // a name → match against real members
      if (!members) members = await fetchMembers(connectionId, providerKey);
      id = matchMemberByName(members, inner);
    }
    if (id) out = out.replace(m[0], `<@${id}>`);
  }
  return out;
}

// Send a direct message to the user, from this coworker's own Slack app. Used by the report-back.
export async function sendSlackDM(admin: Admin, userId: string, agentId: string | undefined, text: string): Promise<boolean> {
  if (!text.trim()) return false;
  if (!(await isToolEnabledForAgent(admin, agentId, 'slack'))) return false;
  const conn = await slackConn(admin, userId, agentId);
  if (!conn) return false;
  const dm = await resolveDmChannelId(admin, userId, conn.connectionId, conn.providerKey);
  if (!dm) return false;
  const res = await nangoProxy({
    method: 'POST', endpoint: '/chat.postMessage', providerConfigKey: conn.providerKey, connectionId: conn.connectionId,
    data: { channel: dm, text },
  });
  const body = res.body as { ok?: boolean } | null;
  return Boolean(res.ok && body?.ok);
}

// ── Definitions ───────────────────────────────────────────────────────────────

export const slackListChannelsDefinition = {
  name: 'slack_list_channels',
  description: "List the Slack channels the team's app can see (public + private it's in), to resolve a channel name to an id. Call before posting or reading if you only have a name.",
  input_schema: { type: 'object', properties: {} as Record<string, unknown>, required: [] as string[] },
};

export const slackReadMessagesDefinition = {
  name: 'slack_read_messages',
  description: "Read recent messages from a Slack channel or DM the app is a member of (to catch up, summarize, or answer about a conversation). Pass a channel/DM id (C…, G…, D…) — use slack_list_channels to resolve a name first. The app must be in the conversation.",
  input_schema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel or DM id (C0123ABCD, G…, D…). Ids only — resolve names via slack_list_channels.' },
      limit: { type: 'number', description: 'How many recent messages to fetch (default 20, max 100).' },
      days: { type: 'number', description: 'Optional time window — only messages from the last N days (e.g. 7 for the past week). Omit or 0 for no time limit.' },
    },
    required: ['channel'],
  },
};

export const slackListMembersDefinition = {
  name: 'slack_list_members',
  description: "List the people in a Slack channel (their names + ids) — use this to find the right person to @-mention before posting, instead of guessing. Returns names you can then mention with <@Name>.",
  input_schema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel id (C0123ABCD, G…) or name. Resolve a name via slack_list_channels first.' },
    },
    required: ['channel'],
  },
};

export const slackPostMessageDefinition = {
  name: 'slack_post_message',
  description: "Post a message to a Slack channel as yourself (your own Slack app). The app must already be in the channel. Use slack_list_channels to resolve a channel id from a name, or \"@me\" to DM the user. You can @-mention people and reply in threads.",
  input_schema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel id (e.g. C0123ABCD) or name (e.g. #general). Use "@me" to send the user a direct message instead of posting to a channel.' },
      text: { type: 'string', description: 'Message text (Slack mrkdwn: *bold*, _italic_, <url|label>). To @-mention someone, write <@Their Name> (e.g. <@Rene>) — it resolves to the real person; <@me> tags the user. Never invent an email. If unsure who is in the channel, call slack_list_members first. <!channel> / <!here> also work.' },
      thread_ts: { type: 'string', description: 'Optional. Reply inside a thread by passing the parent message ts (from slack_read_messages, shown as [ts:…]).' },
    },
    required: ['channel', 'text'],
  },
};

// ── Executors ─────────────────────────────────────────────────────────────────

export async function executeSlackListChannels(userId: string, admin: Admin, agentId?: string): Promise<string> {
  if (!(await isToolEnabledForAgent(admin, agentId, 'slack'))) return DISABLED;
  const conn = await slackConn(admin, userId, agentId);
  if (!conn) return NOT_CONNECTED;
  const res = await nangoProxy({
    method: 'GET',
    endpoint: '/conversations.list',
    providerConfigKey: conn.providerKey,
    connectionId: conn.connectionId,
    params: { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200' },
  });
  const body = res.body as { ok?: boolean; channels?: Array<{ id: string; name: string; is_private?: boolean }>; error?: string } | null;
  if (!res.ok || !body?.ok) return `Couldn't list Slack channels: ${body?.error ?? res.status}.`;
  const chans = (body.channels ?? []).map(c => `${c.is_private ? '🔒 ' : '#'}${c.name} (${c.id})`);
  if (chans.length === 0) return 'No channels visible yet — invite the app to a channel first.';
  return `Slack channels (${chans.length}):\n${chans.join('\n')}`;
}

export async function executeSlackReadMessages(
  config: Record<string, unknown>,
  userId: string,
  admin: Admin,
  agentId?: string,
): Promise<string> {
  if (!(await isToolEnabledForAgent(admin, agentId, 'slack'))) return DISABLED;

  const channel = String(config.channel ?? '').trim();
  if (!channel) return 'Provide a channel or DM id (resolve a name via slack_list_channels first).';

  const conn = await slackConn(admin, userId, agentId);
  if (!conn) return NOT_CONNECTED;

  const limit = Math.min(Math.max(Number(config.limit) || 20, 1), 100);
  const days = Math.max(Number(config.days) || 0, 0);  // 0 = no time limit
  const params: Record<string, string> = { channel, limit: String(limit) };
  if (days > 0) params.oldest = String(Math.floor(Date.now() / 1000) - days * 86400);

  const res = await nangoProxy({
    method: 'GET',
    endpoint: '/conversations.history',
    providerConfigKey: conn.providerKey,
    connectionId: conn.connectionId,
    params,
  });
  const body = res.body as { ok?: boolean; messages?: Array<{ user?: string; text?: string; bot_id?: string; ts?: string }>; error?: string } | null;
  if (!res.ok || !body?.ok) {
    return `Couldn't read Slack messages (${body?.error ?? res.status}). The app must be a member of ${channel}.`;
  }
  // Slack returns newest-first; reverse to chronological. ts lets you reply in-thread.
  const msgs = (body.messages ?? [])
    .filter(m => m.text)
    .reverse()
    .map(m => `- [ts:${m.ts}] ${m.user ? `<@${m.user}>` : 'bot'}: ${m.text}`);
  if (msgs.length === 0) return `No recent messages in ${channel}.`;
  return `Recent messages in ${channel} (${msgs.length}, oldest first; pass a ts as thread_ts to reply in its thread):\n${msgs.join('\n')}`;
}

export async function executeSlackListMembers(
  config: Record<string, unknown>,
  userId: string,
  admin: Admin,
  agentId?: string,
): Promise<string> {
  if (!(await isToolEnabledForAgent(admin, agentId, 'slack'))) return DISABLED;
  const channel = String(config.channel ?? '').trim();
  if (!channel) return 'Provide a channel id (resolve a name via slack_list_channels first).';

  const conn = await slackConn(admin, userId, agentId);
  if (!conn) return NOT_CONNECTED;

  const res = await nangoProxy({
    method: 'GET', endpoint: '/conversations.members', providerConfigKey: conn.providerKey,
    connectionId: conn.connectionId, params: { channel, limit: '200' },
  });
  const body = res.body as { ok?: boolean; members?: string[]; error?: string } | null;
  if (!res.ok || !body?.ok) return `Couldn't list members (${body?.error ?? res.status}). The app must be in ${channel}.`;

  const ids = new Set(body.members ?? []);
  const all = await fetchMembers(conn.connectionId, conn.providerKey);
  const people = all
    .filter(m => ids.has(m.id))
    .map(m => `${m.profile?.real_name || m.profile?.display_name || m.name || m.id} (${m.id})`);
  if (people.length === 0) return `No human members found in ${channel}.`;
  return `Members of ${channel} (${people.length}):\n${people.join('\n')}\n\nTo tag someone, write <@Their Name> in your message.`;
}

// One Slack bot per coworker role is shared across all users in a company, so a
// channel post from "Clara" can't be traced to a person on its own. We append a
// context label ("Alex's Personal Assistant") to channel posts so it's attributable.
// DMs need none — they're already per-user threads.
const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Personal Assistant',
  content_manager: 'Content Strategist',
  linkedin_drafter: 'LinkedIn Wizard',
  research_analyst: 'Research Analyst',
};

async function attributionLabel(admin: Admin, userId: string, agentId?: string): Promise<string | null> {
  let role: string | null = null;
  if (agentId) {
    const { data: agent } = await admin.from('custom_agents').select('worker_role').eq('id', agentId).maybeSingle();
    role = ROLE_LABELS[(agent?.worker_role as string) ?? ''] ?? null;
  }
  const { data: prof } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const first = (((prof as { full_name?: string } | null)?.full_name) ?? '').trim().split(/\s+/)[0] ?? '';
  if (first && role) return `${first}'s ${role}`;
  if (first) return `for ${first}`;
  return role;
}

export async function executeSlackPostMessage(
  config: Record<string, unknown>,
  userId: string,
  agentId: string | undefined,
  admin: Admin,
): Promise<string> {
  if (!(await isToolEnabledForAgent(admin, agentId, 'slack'))) return DISABLED;

  const text = String(config.text ?? '').trim();
  const channel = String(config.channel ?? '').trim();
  if (!channel || !text) return 'Provide both a channel and message text.';

  const conn = await slackConn(admin, userId, agentId);
  if (!conn) return NOT_CONNECTED;

  // "@me"/"dm" → resolve the user's direct-message channel (with this coworker's app).
  const dm = isDmTarget(channel);
  let target = channel;
  if (dm) {
    const dmId = await resolveDmChannelId(admin, userId, conn.connectionId, conn.providerKey);
    if (!dmId) return "Couldn't open a Slack DM — your AUGMTD email must match your Slack account (needs the im:write + users:read.email scopes).";
    target = dmId;
  }

  const finalText = await resolveMentions(text, admin, userId, conn.connectionId, conn.providerKey);
  const threadTs = typeof config.thread_ts === 'string' && config.thread_ts ? config.thread_ts : undefined;

  const data: Record<string, unknown> = { channel: target, text: finalText, ...(threadTs ? { thread_ts: threadTs } : {}) };
  // Channel posts get an attribution label (whose coworker this is); DMs don't need it.
  if (!dm) {
    const label = await attributionLabel(admin, userId, agentId);
    if (label) {
      data.blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: finalText } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `👤 ${label}` }] },
      ];
    }
  }

  const res = await nangoProxy({
    method: 'POST',
    endpoint: '/chat.postMessage',
    providerConfigKey: conn.providerKey,
    connectionId: conn.connectionId,
    data,
  });
  const body = res.body as { ok?: boolean; error?: string } | null;
  if (!res.ok || !body?.ok) {
    return dm
      ? `Couldn't send the Slack DM (${body?.error ?? res.status}).`
      : `Couldn't post to Slack (${body?.error ?? res.status}). Make sure this coworker's app is invited to ${channel}.`;
  }
  return dm ? 'Sent you a Slack DM.' : `${threadTs ? 'Replied in thread on' : 'Posted to'} Slack ${channel}.`;
}
