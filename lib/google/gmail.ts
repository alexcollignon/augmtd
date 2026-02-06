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
  maxResults: number = 10
): Promise<GmailMessage[]> {
  try {
    const gmail = await getGmailClient(encryptedTokens);

    // Search for unread emails, excluding spam/promotions
    const query = 'is:unread -category:promotions -category:social -category:forums -is:spam';

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

  return {
    message_id: getHeader('Message-ID'),
    from_address: getHeader('From'),
    from_name: getHeader('From').split('<')[0].trim().replace(/"/g, ''),
    to_addresses: [getHeader('To')],
    cc_addresses: getHeader('Cc') ? [getHeader('Cc')] : [],
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
