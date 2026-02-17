import { google } from 'googleapis';
import { getOAuth2Client } from './oauth';

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

    // Search for recent emails (read and unread), only from Primary inbox
    const query = `newer_than:${syncWindowDays}d -category:promotions -category:social -category:forums -category:updates -is:spam`;

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

  // Extract body
  let body = '';
  let htmlBody = '';

  const extractBody = (part: any) => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
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
    metadata: {
      provider: 'gmail',
      gmail_id: message.id,
    },
  };
}

interface SendGmailReplyParams {
  accessToken: string;
  threadId: string;
  messageId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

export async function sendGmailReply(params: SendGmailReplyParams): Promise<string> {
  const { accessToken, threadId, to, subject, body, inReplyTo, references } = params;

  // Create OAuth2 client
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

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
  messageParts.push(body);

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
