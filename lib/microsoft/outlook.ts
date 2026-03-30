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
  toRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  ccRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  receivedDateTime: string;
  internetMessageId: string;
  hasAttachments?: boolean;
}

export interface OutlookAttachmentMeta {
  id: string;
  name: string;
  contentType: string;
  size: number;
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
  onTokenRefresh?: TokenRefreshCallback,
  lastSync?: string,
) {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);

  // Use last sync timestamp when available; fall back to syncWindowDays on first sync.
  const dateString = lastSync
    ? new Date(lastSync).toISOString()
    : (() => { const d = new Date(); d.setDate(d.getDate() - syncWindowDays); return d.toISOString(); })();

  const messages = await client
    .api('/me/mailFolders/inbox/messages')
    .filter(`receivedDateTime ge ${dateString}`)
    .top(maxResults)
    .select('id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,hasAttachments')
    .orderby('receivedDateTime desc')
    .get();

  return messages.value as OutlookMessage[];
}

export function parseOutlookMessage(message: OutlookMessage) {
  // Preserve the original HTML body for rendering; also produce a plain-text version for AI
  const htmlBody = message.body.contentType === 'html' ? message.body.content : null;
  let bodyText = message.body.content;
  if (message.body.contentType === 'html') {
    // Convert to plain text preserving line breaks for AI processing
    bodyText = bodyText
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Extract recipient addresses
  const to_addresses = (message.toRecipients || []).map(r => r.emailAddress.address);
  const cc_addresses = (message.ccRecipients || []).map(r => r.emailAddress.address);

  return {
    message_id: message.internetMessageId || message.id,
    from_address: message.from.emailAddress.address,
    from_name: message.from.emailAddress.name || message.from.emailAddress.address,
    to_addresses,
    cc_addresses,
    subject: message.subject || '(No subject)',
    body: bodyText || message.bodyPreview || '',
    html_body: htmlBody,
    received_at: new Date(message.receivedDateTime).toISOString(),
    thread_id: message.conversationId, // Outlook conversation ID for threading
    hasAttachments: message.hasAttachments || false,
    outlookInternalId: message.id, // Graph API message ID (needed for attachment calls)
    metadata: {
      provider: 'outlook',
      outlook_id: message.id,
      internet_message_id: message.internetMessageId,
      conversation_id: message.conversationId,
    },
  };
}

export async function fetchOutlookAttachments(
  encryptedTokens: string,
  outlookMessageId: string
): Promise<OutlookAttachmentMeta[]> {
  const client = await getGraphClient(encryptedTokens);
  const response = await client
    .api(`/me/messages/${outlookMessageId}/attachments`)
    .select('id,name,contentType,size,isInline')
    .get();
  // Filter out inline embedded images (signature logos, CID embeds)
  return ((response.value || []) as Array<OutlookAttachmentMeta & { isInline?: boolean }>)
    .filter(a => !a.isInline);
}

export async function fetchOutlookAttachmentContent(
  encryptedTokens: string,
  outlookMessageId: string,
  attachmentId: string
): Promise<Buffer> {
  const client = await getGraphClient(encryptedTokens);
  const attachment = await client
    .api(`/me/messages/${outlookMessageId}/attachments/${attachmentId}`)
    .get();
  return Buffer.from(attachment.contentBytes, 'base64');
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

export async function sendOutlookEmail(params: {
  encryptedTokens: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}): Promise<void> {
  const { encryptedTokens, to, cc, subject, body, attachments = [] } = params;

  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
  let accessToken = tokens.accessToken;
  if (tokens.refreshToken && tokens.expiresOn) {
    const timeUntilExpiry = new Date(tokens.expiresOn).getTime() - Date.now();
    if (timeUntilExpiry < 5 * 60 * 1000) {
      try {
        const refreshed = await refreshAccessToken(tokens.refreshToken);
        accessToken = refreshed.accessToken;
      } catch {
        // Fall back to existing token
      }
    }
  }

  const toRecipients = to.split(',').map((addr) => ({
    emailAddress: { address: addr.trim() },
  }));
  const ccRecipients = cc
    ? cc.split(',').map((addr) => ({ emailAddress: { address: addr.trim() } }))
    : [];

  const messageBody = {
    subject,
    body: {
      contentType: 'HTML',
      content: plainTextToHtml(body),
    },
    toRecipients,
    ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
    ...(attachments.length > 0
      ? {
          attachments: attachments.map((att) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: att.filename,
            contentType: att.mimeType,
            contentBytes: att.content.toString('base64'),
          })),
        }
      : {}),
  };

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: messageBody }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send Outlook email: ${error}`);
  }
}

interface SendOutlookReplyParams {
  encryptedTokens: string;
  messageId: string;
  body: string;
  attachments?: import('@/lib/google/gmail').EmailAttachment[];
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

// Resolve system folder IDs by fetching via well-known path names (Graph v1.0 doesn't expose
// wellKnownName as a property, but does support well-known names as URL path segments).
const WELL_KNOWN_FOLDER_NAMES = ['inbox', 'sentitems', 'deleteditems', 'drafts', 'junkemail', 'archive'];

async function getSystemFolderIds(client: Client): Promise<Set<string>> {
  const ids = new Set<string>();
  await Promise.allSettled(
    WELL_KNOWN_FOLDER_NAMES.map(async name => {
      try {
        const f = await client.api(`/me/mailFolders/${name}`).select('id').get();
        if (f?.id) ids.add(f.id);
      } catch {
        // folder might not exist for this account
      }
    })
  );
  return ids;
}

export async function createOutlookFolder(
  encryptedTokens: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const client = await getGraphClient(encryptedTokens);
  const res = await client.api('/me/mailFolders').post({ displayName: name });
  return { id: res.id, name: res.displayName };
}

export async function listOutlookFolders(
  encryptedTokens: string,
): Promise<{ id: string; name: string }[]> {
  const client = await getGraphClient(encryptedTokens);
  const systemIds = await getSystemFolderIds(client);
  const res = await client.api('/me/mailFolders').select('id,displayName').top(50).get();
  return (res.value ?? [])
    .filter((f: any) => !systemIds.has(f.id))
    .map((f: any) => ({ id: f.id, name: f.displayName }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}

export async function listOutlookAllFolders(
  encryptedTokens: string,
  onTokenRefresh?: TokenRefreshCallback,
): Promise<{ id: string; name: string; isSystem: boolean }[]> {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);
  const [res, systemIds] = await Promise.all([
    client.api('/me/mailFolders').select('id,displayName').top(50).get(),
    getSystemFolderIds(client),
  ]);
  const all = (res.value ?? []) as Array<{ id: string; displayName: string }>;
  const system = all
    .filter(f => systemIds.has(f.id))
    .map(f => ({ id: f.id, name: f.displayName, isSystem: true }));
  const user = all
    .filter(f => !systemIds.has(f.id))
    .map(f => ({ id: f.id, name: f.displayName, isSystem: false }))
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

export async function listOutlookFolderEmails(
  encryptedTokens: string,
  folderId: string,
  maxResults = 25,
): Promise<FolderEmailSummary[]> {
  const client = await getGraphClient(encryptedTokens);
  const res = await client
    .api(`/me/mailFolders/${folderId}/messages`)
    .select('id,subject,from,receivedDateTime,bodyPreview')
    .top(maxResults)
    .orderby('receivedDateTime desc')
    .get();
  return (res.value ?? []).map((m: any) => ({
    id: m.id,
    subject: m.subject || '(no subject)',
    from: m.from?.emailAddress?.address ?? '',
    fromName: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? '',
    date: m.receivedDateTime,
    snippet: m.bodyPreview ?? '',
  }));
}

export async function moveOutlookMessageToFolder(
  encryptedTokens: string,
  outlookMessageId: string,
  folderId: string,
): Promise<void> {
  const client = await getGraphClient(encryptedTokens);
  await client.api(`/me/messages/${outlookMessageId}/move`).post({ destinationId: folderId });
}

export async function archiveOutlookMessage(
  encryptedTokens: string,
  outlookMessageId: string,
): Promise<void> {
  const client = await getGraphClient(encryptedTokens);
  await client
    .api(`/me/messages/${outlookMessageId}/move`)
    .post({ destinationId: 'archive' });
}

export async function trashOutlookMessage(
  encryptedTokens: string,
  outlookMessageId: string,
): Promise<void> {
  const client = await getGraphClient(encryptedTokens);
  await client
    .api(`/me/messages/${outlookMessageId}/move`)
    .post({ destinationId: 'deleteditems' });
}

export async function sendOutlookReply(params: SendOutlookReplyParams): Promise<string> {
  const { encryptedTokens, messageId, body, attachments = [] } = params;

  // Decode tokens and refresh if needed (mirrors getGraphClient logic)
  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
  let accessToken = tokens.accessToken;
  if (tokens.refreshToken && tokens.expiresOn) {
    const timeUntilExpiry = new Date(tokens.expiresOn).getTime() - Date.now();
    if (timeUntilExpiry < 5 * 60 * 1000) {
      try {
        const refreshed = await refreshAccessToken(tokens.refreshToken);
        accessToken = refreshed.accessToken;
      } catch {
        // Fall back to existing token
      }
    }
  }

  // Reply to the message using Microsoft Graph API
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/reply`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          body: {
            contentType: 'HTML',
            content: plainTextToHtml(body),
          },
          ...(attachments.length > 0 ? {
            attachments: attachments.map(att => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: att.filename,
              contentType: att.mimeType,
              contentBytes: att.content.toString('base64'),
            })),
          } : {}),
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send Outlook reply: ${error}`);
  }

  // The reply endpoint doesn't return the sent message ID directly
  // Return the original message ID for reference
  return messageId;
}
