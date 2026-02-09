import { Client } from '@microsoft/microsoft-graph-client';
import { acquireTokenSilent } from './oauth';

interface OutlookMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    content: string;
    contentType: string;
  };
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  receivedDateTime: string;
  internetMessageId: string;
}

export async function getGraphClient(encryptedTokens: string) {
  // Decrypt tokens (simple base64 for now)
  const tokensString = Buffer.from(encryptedTokens, 'base64').toString();
  const tokens = JSON.parse(tokensString);

  let accessToken = tokens.accessToken;

  // Try to refresh token if account info is available and token might be expired
  if (tokens.account && tokens.expiresOn) {
    const expiresOn = new Date(tokens.expiresOn);
    const now = new Date();
    const timeUntilExpiry = expiresOn.getTime() - now.getTime();

    // Refresh if token expires in less than 5 minutes
    if (timeUntilExpiry < 5 * 60 * 1000) {
      try {
        const refreshedTokens = await acquireTokenSilent(tokens.account);
        accessToken = refreshedTokens.accessToken;
      } catch (error) {
        console.error('Error refreshing Outlook token:', error);
        // Fall back to existing access token
      }
    }
  }

  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

export async function fetchUnreadEmails(
  encryptedTokens: string,
  maxResults: number = 10,
  syncWindowDays: number = 7
) {
  const client = await getGraphClient(encryptedTokens);

  // Calculate date filter (7 days ago)
  const dateFilter = new Date();
  dateFilter.setDate(dateFilter.getDate() - syncWindowDays);
  const dateString = dateFilter.toISOString();

  const messages = await client
    .api('/me/messages')
    .filter(`receivedDateTime ge ${dateString}`)
    .top(maxResults)
    .select('id,subject,bodyPreview,body,from,receivedDateTime,internetMessageId')
    .orderby('receivedDateTime desc')
    .get();

  return messages.value as OutlookMessage[];
}

export function parseOutlookMessage(message: OutlookMessage) {
  // Extract plain text from HTML body if needed
  let bodyText = message.body.content;
  if (message.body.contentType === 'html') {
    // Simple HTML strip (in production, use a proper HTML parser)
    bodyText = bodyText.replace(/<[^>]*>/g, '').trim();
  }

  return {
    message_id: message.internetMessageId || message.id,
    from_address: message.from.emailAddress.address,
    from_name: message.from.emailAddress.name || message.from.emailAddress.address,
    subject: message.subject || '(No subject)',
    body: bodyText || message.bodyPreview || '',
    received_at: new Date(message.receivedDateTime).toISOString(),
    thread_id: message.id, // Outlook message ID for replies
    metadata: {
      provider: 'outlook',
      outlook_id: message.id,
      internet_message_id: message.internetMessageId,
    },
  };
}
