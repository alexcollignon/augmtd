import { google } from 'googleapis';
import { getOAuth2Client } from './oauth';

export interface GmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: any;
  internalDate: string;
}

export type GmailTokenRefreshCallback = (newEncryptedTokens: string) => Promise<void>;

export async function getGmailClient(
  encryptedTokens: string,
  onTokenRefresh?: GmailTokenRefreshCallback,
) {
  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Refresh proactively within 5 minutes of expiry (not just when already expired)
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      if (onTokenRefresh) {
        const newEncryptedTokens = Buffer.from(JSON.stringify(credentials)).toString('base64');
        await onTokenRefresh(newEncryptedTokens);
      }
    } catch (err) {
      console.error('[Gmail] Token refresh failed:', err);
      throw err;
    }
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export async function fetchUnreadEmails(
  encryptedTokens: string,
  maxResults: number = 10,
  syncWindowDays: number = 7,
  accountEmail?: string,
  onTokenRefresh?: GmailTokenRefreshCallback,
  lastSync?: string,
): Promise<GmailMessage[]> {
  try {
    const gmail = await getGmailClient(encryptedTokens, onTokenRefresh);

    const isPersonalGmail = !accountEmail ||
      accountEmail.endsWith('@gmail.com') ||
      accountEmail.endsWith('@googlemail.com');
    const inboxFilter = isPersonalGmail ? 'category:primary' : 'in:inbox';

    // Use last sync timestamp when available so we only fetch emails received
    // since the previous sync, not a fixed window from now.
    // Fall back to newer_than:Xd on first sync (no last_sync recorded yet).
    const timeFilter = lastSync
      ? `after:${Math.floor(new Date(lastSync).getTime() / 1000)}`
      : `newer_than:${syncWindowDays}d`;

    const query = `${timeFilter} ${inboxFilter} -is:spam`;

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = response.data.messages || [];

    // Fetch full message details for each
    const fullMessages = await Promise.all(
      messages.map(async (msg) => {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });
        return fullMsg.data as GmailMessage;
      })
    );

    return fullMessages;
  } catch (error) {
    console.error('Error fetching Gmail messages:', error);
    throw error;
  }
}

export function parseGmailMessage(message: GmailMessage) {
  const headers = message.payload?.headers || [];

  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  // Extract body and attachment metadata
  let body = '';
  let htmlBody = '';
  const attachments: GmailAttachmentMeta[] = [];

  const extractBody = (part: any) => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.body?.attachmentId && part.filename) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
      });
    }

    if (part.parts) {
      part.parts.forEach(extractBody);
    }
  };

  if (message.payload) {
    extractBody(message.payload);
  }

  // Extract email address from "Name <email@domain.com>" format
  const fromHeader = getHeader('From');
  const emailMatch = fromHeader.match(/<(.+?)>/);
  const from_address = emailMatch ? emailMatch[1] : fromHeader;
  const from_name = fromHeader.split('<')[0].trim().replace(/"/g, '') || from_address;

  // Helper to parse comma-separated email addresses from header
  const parseEmailAddresses = (header: string): string[] => {
    if (!header) return [];

    // Split by comma and extract email addresses
    return header
      .split(',')
      .map(addr => {
        const match = addr.match(/<(.+?)>/);
        return match ? match[1] : addr.trim();
      })
      .filter(addr => addr && addr.includes('@')); // Only valid email addresses
  };

  return {
    message_id: getHeader('Message-ID'),
    from_address,
    from_name,
    to_addresses: parseEmailAddresses(getHeader('To')),
    cc_addresses: parseEmailAddresses(getHeader('Cc')),
    subject: getHeader('Subject') || '(no subject)',
    body: body || message.snippet || '',
    html_body: htmlBody || null,
    received_at: new Date(parseInt(message.internalDate)).toISOString(),
    thread_id: message.threadId,
    labels: message.labelIds || [],
    attachments,
    metadata: {
      provider: 'gmail',
      gmail_id: message.id,
    },
  };
}

export async function fetchGmailAttachment(
  encryptedTokens: string,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const gmail = await getGmailClient(encryptedTokens);
  const response = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  const data = response.data.data || '';
  // Gmail uses base64url encoding
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

interface SendGmailReplyParams {
  encryptedTokens: string;
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: EmailAttachment[];
}

/**
 * Convert plain text (with \n newlines) to HTML for email sending.
 * Double newlines become paragraph breaks; single newlines become <br>.
 */
function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped.split(/\n{2,}/);
  return paragraphs
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

export async function sendGmailEmail(params: {
  encryptedTokens: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
  gmailThreadId?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<string> {
  const { encryptedTokens, to, cc, subject, body, attachments = [], gmailThreadId, inReplyTo, references } = params;

  const gmail = await getGmailClient(encryptedTokens);
  const htmlBody = plainTextToHtml(body);

  let rawMessage: string;

  if (attachments.length > 0) {
    const boundary = `boundary_${randomId()}`;
    const lines: string[] = [
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
      ...(references ? [`References: ${references}`] : []),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(htmlBody).toString('base64'),
    ];

    for (const att of attachments) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      lines.push('');
      lines.push(att.content.toString('base64'));
    }

    lines.push(`--${boundary}--`);
    rawMessage = lines.join('\r\n');
  } else {
    const lines: string[] = [
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
      ...(references ? [`References: ${references}`] : []),
      '',
      htmlBody,
    ];
    rawMessage = lines.join('\r\n');
  }

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
    },
  });

  return response.data.id || '';
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

export async function listGmailLabels(
  encryptedTokens: string,
): Promise<{ id: string; name: string }[]> {
  const gmail = await getGmailClient(encryptedTokens);
  const res = await gmail.users.labels.list({ userId: 'me' });
  const SKIP = new Set(['INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT', 'UNREAD', 'STARRED', 'IMPORTANT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']);
  return (res.data.labels ?? [])
    .filter(l => l.type === 'user' && l.id && l.name && !SKIP.has(l.id))
    .map(l => ({ id: l.id!, name: l.name! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Returns all folders including system ones (for folder browser)
const GMAIL_SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: 'Inbox', SENT: 'Sent', TRASH: 'Trash', SPAM: 'Spam', DRAFT: 'Drafts',
  STARRED: 'Starred', IMPORTANT: 'Important',
};

export async function listGmailAllFolders(
  encryptedTokens: string,
): Promise<{ id: string; name: string; isSystem: boolean }[]> {
  const gmail = await getGmailClient(encryptedTokens);
  const res = await gmail.users.labels.list({ userId: 'me' });
  const HIDE = new Set(['UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']);
  const labels = res.data.labels ?? [];
  const system = labels
    .filter(l => l.id && GMAIL_SYSTEM_LABEL_NAMES[l.id!] && !HIDE.has(l.id!))
    .map(l => ({ id: l.id!, name: GMAIL_SYSTEM_LABEL_NAMES[l.id!], isSystem: true }));
  const user = labels
    .filter(l => l.type === 'user' && l.id && l.name && !HIDE.has(l.id!))
    .map(l => ({ id: l.id!, name: l.name!, isSystem: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...system, ...user];
}

export interface FolderEmailSummary {
  id: string;
  subject: string;
  from: string;
  fromName: string;
  date: string;
  snippet: string;
}

export async function listGmailFolderEmails(
  encryptedTokens: string,
  labelId: string,
  maxResults = 25,
): Promise<FolderEmailSummary[]> {
  const gmail = await getGmailClient(encryptedTokens);
  const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: [labelId], maxResults });
  const messages = listRes.data.messages ?? [];
  if (!messages.length) return [];

  const details = await Promise.all(
    messages.map(m =>
      gmail.users.messages.get({
        userId: 'me',
        id: m.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      })
    )
  );

  return details.map(res => {
    const headers = res.data.payload?.headers ?? [];
    const get = (name: string) => headers.find((h: any) => h.name === name)?.value ?? '';
    const fromRaw = get('From');
    const nameMatch = fromRaw.match(/^"?([^"<]+)"?\s*</);
    return {
      id: res.data.id!,
      subject: get('Subject') || '(no subject)',
      from: fromRaw.replace(/.*<(.+)>.*/, '$1').trim() || fromRaw,
      fromName: nameMatch ? nameMatch[1].trim() : fromRaw,
      date: get('Date'),
      snippet: res.data.snippet ?? '',
    };
  });
}

export async function moveGmailThreadToLabel(
  encryptedTokens: string,
  threadId: string,
  labelId: string,
): Promise<void> {
  const gmail = await getGmailClient(encryptedTokens);
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { addLabelIds: [labelId], removeLabelIds: ['INBOX'] },
  });
}

export async function archiveGmailThread(
  encryptedTokens: string,
  threadId: string,
  onTokenRefresh?: GmailTokenRefreshCallback,
): Promise<void> {
  const gmail = await getGmailClient(encryptedTokens, onTokenRefresh);
  await gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { removeLabelIds: ['INBOX'] },
  });
}

export async function sendGmailReply(params: SendGmailReplyParams): Promise<string> {
  const { encryptedTokens, threadId, to, subject, body, inReplyTo, references, attachments = [] } = params;

  const gmail = await getGmailClient(encryptedTokens);

  const htmlBody = plainTextToHtml(body);
  const subjectLine = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

  let rawMessage: string;

  if (attachments.length > 0) {
    const boundary = `boundary_${randomId()}`;
    const lines: string[] = [
      `To: ${to}`,
      `Subject: ${subjectLine}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
      ...(references ? [`References: ${references}`] : []),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(htmlBody).toString('base64'),
    ];
    for (const att of attachments) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
      lines.push('');
      lines.push(att.content.toString('base64'));
    }
    lines.push(`--${boundary}--`);
    rawMessage = lines.join('\r\n');
  } else {
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subjectLine}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
      ...(references ? [`References: ${references}`] : []),
      '',
      htmlBody,
    ];
    rawMessage = messageParts.join('\r\n');
  }

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage, threadId },
  });

  return response.data.id || '';
}
