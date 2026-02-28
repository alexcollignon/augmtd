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

export async function getGmailClient(encryptedTokens: string) {
  // Decrypt tokens (simple base64 for now)
  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Refresh token if needed
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    // TODO: Update tokens in database
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export async function fetchUnreadEmails(
  encryptedTokens: string,
  maxResults: number = 10,
  syncWindowDays: number = 7
): Promise<GmailMessage[]> {
  try {
    const gmail = await getGmailClient(encryptedTokens);

    // Search for recent emails (read and unread), only from Primary inbox.
    // Fetch a larger candidate pool (5x) because Gmail's messages.list returns
    // results by relevance, not by date — without this, today's emails can be
    // pushed out of the result set by older high-relevance emails.
    const query = `newer_than:${syncWindowDays}d -category:promotions -category:social -category:forums -category:updates -is:spam`;

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(maxResults * 5, 100),
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

    // Sort by internalDate DESC (newest first) and return only the requested count.
    // This guarantees today's emails are always prioritised regardless of Gmail's ranking.
    fullMessages.sort((a, b) => parseInt(b.internalDate) - parseInt(a.internalDate));
    return fullMessages.slice(0, maxResults);
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

export async function sendGmailReply(params: SendGmailReplyParams): Promise<string> {
  const { encryptedTokens, threadId, to, subject, body, inReplyTo, references } = params;

  const gmail = await getGmailClient(encryptedTokens);

  const htmlBody = plainTextToHtml(body);

  // Build email message in RFC 2822 format
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
  ];

  // Add threading headers
  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    messageParts.push(`References: ${references}`);
  }

  messageParts.push('');
  messageParts.push(htmlBody);

  const message = messageParts.join('\r\n');

  // Encode in base64url format
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Send the email
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      threadId: threadId,
    },
  });

  return response.data.id || '';
}
