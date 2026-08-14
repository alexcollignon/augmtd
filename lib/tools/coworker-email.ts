// ─── Coworker email (Resend, OAuth-free) ──────────────────────────────────────
// Each coworker sends real email from its own address on team.augmtd.ai, Reply-To
// the user, to any recipient. Gated per-coworker (default OFF) + a daily send cap.
// Used by the user-confirmed chat send endpoint AND the task email output.

import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { coworkerEmailForRole, EMAIL_LOCAL_BY_ROLE } from '@/lib/integrations/registry';
import { isToolEnabledForAgent } from '@/lib/integrations/connection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const ROLE_LABELS: Record<string, string> = {
  personal_assistant: 'Personal Assistant',
  content_manager: 'Content Strategist', // retired Aug 14 — legacy rows only
  branding_expert: 'Branding Expert',
  linkedin_drafter: 'Branding Expert', // legacy role key — persisted rows only
  research_analyst: 'Research Analyst',
};
const DAILY_CAP = Number(process.env.COWORKER_EMAIL_DAILY_CAP || 50);
const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CoworkerEmailInput { to: string[]; cc?: string[]; subject: string; body: string; attachments?: { filename: string; content: Buffer }[] }

// A draft surfaced in chat for the user to review/edit/send (NOT sent by the model).
export interface EmailDraft { id: string; to: string[]; cc: string[]; subject: string; body: string; from: string; fromName: string; sent_at?: string }

export const composeEmailDefinition = {
  name: 'compose_email',
  description: "Draft an email for the user to review and send — you do NOT send it; the user edits the draft and clicks Send. Use whenever the user asks you to email someone. Recipients can be anyone; for 'me'/'us' use the user's own address from the [YOUR EMAIL ADDRESSES] context block. Never claim the email was sent.",
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' }, description: 'Recipient email address(es).' },
      cc: { type: 'array', items: { type: 'string' }, description: 'Cc address(es) — optional.' },
      subject: { type: 'string', description: 'Email subject.' },
      body: { type: 'string', description: 'Email body — plain prose, blank line between paragraphs; **bold** allowed.' },
    },
    required: ['to', 'subject', 'body'] as string[],
  },
};

export async function executeComposeEmail(config: Record<string, unknown>, userId: string, agentId: string | undefined, admin: Admin): Promise<{ result: string; draft: EmailDraft | null }> {
  if (!(await isEmailEnabledForAgent(admin, agentId))) {
    return { result: 'Email is turned off for this coworker — ask the user to enable it in your Tools tab, then try again.', draft: null };
  }
  const to = clean(config.to as string[] | undefined);
  const cc = clean(config.cc as string[] | undefined);
  const subject = String(config.subject ?? '').trim();
  const body = String(config.body ?? '').trim();
  const { data: agent } = agentId
    ? await admin.from('custom_agents').select('name, worker_role').eq('id', agentId).maybeSingle()
    : { data: null };
  const draft: EmailDraft = {
    id: randomUUID(),
    to, cc, subject, body,
    from: coworkerEmailForRole((agent?.worker_role as string) ?? null),
    fromName: (agent?.name as string) || 'Your assistant',
  };
  const result = to.length
    ? `Drafted an email to ${to.join(', ')} — it's shown to the user to review, edit, and send. Do NOT claim it's sent.`
    : `Drafted an email (no recipient yet) — shown to the user to fill in the recipient and send.`;
  return { result, draft };
}

/** The user's own known addresses — login (auth) email + any connected mailboxes.
 *  Used as "you" defaults/quick-picks and as identity context for the model. */
export async function getUserEmailIdentities(admin: Admin, userId: string): Promise<{ login: string | null; connected: string[] }> {
  let login: string | null = null;
  try { const { data } = await admin.auth.admin.getUserById(userId); login = (data?.user?.email as string) ?? null; } catch { /* ignore */ }
  const { data: conns } = await admin.from('connections').select('metadata').eq('user_id', userId).eq('status', 'active');
  const connected = [...new Set(((conns ?? []) as Array<{ metadata: { email?: string } | null }>).map(c => c.metadata?.email).filter(Boolean) as string[])]
    .filter(e => e.toLowerCase() !== (login ?? '').toLowerCase());
  return { login, connected };
}

export async function isEmailEnabledForAgent(admin: Admin, agentId: string | undefined): Promise<boolean> {
  return isToolEnabledForAgent(admin, agentId, 'email', true); // on by default; can be turned off in the Tools tab
}

function clean(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map(s => String(s).trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))].slice(0, MAX_RECIPIENTS);
}

function escHtml(s: string): string { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Coworker signature: avatar + name + "{role} to {user}" + the coworker's address.
function signatureHtml(opts: { role: string | null; coworkerName: string; fromEmail: string; userName: string }): string {
  const local = EMAIL_LOCAL_BY_ROLE[opts.role ?? ''] || '';
  // ?v bumped when avatars change — busts Gmail's image-proxy cache (it keys on URL).
  const avatar = local ? `https://app.augmtd.ai/workers/${local}.png?v=2` : '';
  const roleLabel = ROLE_LABELS[opts.role ?? ''] || 'Assistant';
  const sub = opts.userName ? `${roleLabel} to ${escHtml(opts.userName)}` : roleLabel;
  return `<table cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #ededed;padding-top:14px;"><tr>`
    + (avatar ? `<td style="padding-right:12px;vertical-align:middle;"><img src="${avatar}" width="44" height="44" alt="${escHtml(opts.coworkerName)}" style="display:block;border-radius:10px;" /></td>` : '')
    + `<td style="vertical-align:middle;">`
    + `<div style="font-size:13px;font-weight:600;color:#111827;">${escHtml(opts.coworkerName)}</div>`
    + `<div style="font-size:12px;color:#6b7280;">${sub}</div>`
    + `<div style="font-size:12px;"><a href="mailto:${opts.fromEmail}" style="color:#4f46e5;text-decoration:none;">${opts.fromEmail}</a></div>`
    + `</td></tr></table>`;
}

// Light, personal-style HTML (markdown-ish → paragraphs) + the coworker signature.
function personalEmailHtml(body: string, sig: string): string {
  const blocks = body.split(/\n{2,}/).map(b => {
    const line = b.trim();
    if (!line) return '';
    const inner = escHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');
    return `<p style="margin:0 0 14px;color:#1f2937;font-size:14px;line-height:1.6;">${inner}</p>`;
  }).join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${blocks}${sig}<p style="margin:18px 0 0;color:#9ca3af;font-size:11px;">Sent via AUGMTD</p></div>`;
}

export async function sendCoworkerEmail(admin: Admin, userId: string, agentId: string | undefined, input: CoworkerEmailInput): Promise<{ ok: boolean; error?: string }> {
  if (!(await isEmailEnabledForAgent(admin, agentId))) return { ok: false, error: 'Email is off for this coworker — enable it in the Tools tab.' };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'Email is not configured.' };

  const to = clean(input.to);
  const cc = clean(input.cc);
  const subject = String(input.subject ?? '').trim();
  const body = String(input.body ?? '').trim();
  if (to.length === 0) return { ok: false, error: 'No valid recipient address.' };
  if (!subject) return { ok: false, error: 'A subject is required.' };
  if (!body) return { ok: false, error: 'The email body is empty.' };

  // Daily send cap (shared-domain abuse guard).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from('email_sends').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
  if ((count ?? 0) >= DAILY_CAP) return { ok: false, error: `Daily email limit reached (${DAILY_CAP}).` };

  // From identity: coworker address + "{Name} · {FirstName}'s assistant"; Reply-To = user.
  const { data: agent } = agentId
    ? await admin.from('custom_agents').select('name, worker_role').eq('id', agentId).maybeSingle()
    : { data: null };
  const role = (agent?.worker_role as string) ?? null;
  const fromEmail = coworkerEmailForRole(role);
  const coworkerName = (agent?.name as string) || ROLE_LABELS[role ?? ''] || 'Your assistant';
  const { data: prof } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const fullName = (((prof as { full_name?: string } | null)?.full_name) ?? '').trim();
  const first = fullName.split(/\s+/)[0];
  const fromName = first ? `${coworkerName} · ${first}'s assistant` : coworkerName;
  const { login: replyTo } = await getUserEmailIdentities(admin, userId);
  const sig = signatureHtml({ role, coworkerName, fromEmail, userName: fullName });

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to,
    ...(cc.length ? { cc } : {}),
    ...(replyTo ? { replyTo } : {}),
    subject,
    html: personalEmailHtml(body, sig),
    text: body,
    ...(input.attachments?.length ? { attachments: input.attachments.map(a => ({ filename: a.filename, content: a.content })) } : {}),
  });

  await admin.from('email_sends').insert({
    user_id: userId, agent_id: agentId ?? null, to_count: to.length + cc.length,
    subject: subject.slice(0, 200), status: error ? 'failed' : 'sent',
  }).then(() => {}).catch(() => {});

  if (error) { console.error('[coworker-email] send failed:', error); return { ok: false, error: 'The email failed to send.' }; }
  return { ok: true };
}
