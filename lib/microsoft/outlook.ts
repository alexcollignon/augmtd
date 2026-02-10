import { Client } from '@microsoft/microsoft-graph-client';
import { refreshAccessToken } from './oauth';

interface OutlookMessage {
  id: string;
  conversationId: string;
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

interface TokenRefreshCallback {
  (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }): Promise<void>;
}

export async function getGraphClient(
  encryptedTokens: string,
  onTokenRefresh?: TokenRefreshCallback
) {
  // Decrypt tokens (simple base64 for now)
  const tokensString = Buffer.from(encryptedTokens, 'base64').toString();
  const tokens = JSON.parse(tokensString);

  let accessToken = tokens.accessToken;

  // Try to refresh token if refresh token is available and access token might be expired
  if (tokens.refreshToken && tokens.expiresOn) {
    const expiresOn = new Date(tokens.expiresOn);
    const now = new Date();
    const timeUntilExpiry = expiresOn.getTime() - now.getTime();

    // Refresh if token expires in less than 5 minutes
    if (timeUntilExpiry < 5 * 60 * 1000) {
      try {
        console.log('Refreshing Outlook access token (expires soon)');
        const refreshedTokens = await refreshAccessToken(tokens.refreshToken);
        accessToken = refreshedTokens.accessToken;

        // Notify caller of new tokens so they can update the database
        if (onTokenRefresh) {
          await onTokenRefresh({
            accessToken: refreshedTokens.accessToken,
            refreshToken: refreshedTokens.refreshToken,
            expiresOn: refreshedTokens.expiresOn,
          });
        }

        console.log('✓ Outlook token refreshed successfully');
      } catch (error) {
        console.error('Error refreshing Outlook token:', error);
        // Fall back to existing access token (might be expired, will fail API call)
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
  syncWindowDays: number = 7,
  onTokenRefresh?: TokenRefreshCallback
) {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);

  // Calculate date filter (7 days ago)
  const dateFilter = new Date();
  dateFilter.setDate(dateFilter.getDate() - syncWindowDays);
  const dateString = dateFilter.toISOString();

  const messages = await client
    .api('/me/messages')
    .filter(`receivedDateTime ge ${dateString}`)
    .top(maxResults)
    .select('id,conversationId,subject,bodyPreview,body,from,receivedDateTime,internetMessageId')
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
    thread_id: message.conversationId, // Outlook conversation ID for threading
    metadata: {
      provider: 'outlook',
      outlook_id: message.id,
      internet_message_id: message.internetMessageId,
      conversation_id: message.conversationId,
    },
  };
}
