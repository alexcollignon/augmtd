import { Client } from '@microsoft/microsoft-graph-client';
import { refreshAccessToken } from './oauth';

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

  // Refresh token if needed
  let accessToken = tokens.accessToken;

  if (tokens.refreshToken) {
    try {
      const refreshedTokens = await refreshAccessToken(tokens.refreshToken);
      accessToken = refreshedTokens.accessToken;
    } catch (error) {
      console.error('Error refreshing Outlook token:', error);
      // Fall back to existing access token
    }
  }

  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

export async function fetchUnreadEmails(encryptedTokens: string, maxResults: number = 10) {
  const client = await getGraphClient(encryptedTokens);

  const messages = await client
    .api('/me/messages')
    .filter('isRead eq false')
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
  };
}
