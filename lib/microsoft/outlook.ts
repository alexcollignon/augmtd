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
  isRead?: boolean;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
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
  // Subtract a 3-minute overlap buffer from lastSync so emails that arrived during the
  // previous sync's processing window (between API call and last_sync write) are caught.
  // Duplicates are safe — the existingEmail check in sync-emails.ts deduplicates by message_id.
  const dateString = lastSync
    ? (() => { const d = new Date(lastSync); d.setMinutes(d.getMinutes() - 3); return d.toISOString(); })()
    : (() => { const d = new Date(); d.setDate(d.getDate() - syncWindowDays); return d.toISOString(); })();

  const messages = await client
    .api('/me/mailFolders/inbox/messages')
    .filter(`receivedDateTime ge ${dateString}`)
    .top(maxResults)
    .select('id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,hasAttachments,isRead,internetMessageHeaders')
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

  // Extract RFC threading headers from internetMessageHeaders
  const getInternetHeader = (name: string) =>
    (message.internetMessageHeaders || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  const rawReferences = getInternetHeader('References');
  const referencesIds = rawReferences.trim()
    ? rawReferences.trim().split(/\s+/).filter(Boolean)
    : [];

  return {
    message_id: message.internetMessageId || message.id,
    in_reply_to: getInternetHeader('In-Reply-To').trim() || null,
    references_ids: referencesIds.length > 0 ? referencesIds : null,
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
    is_read: message.isRead ?? true,
    outlookInternalId: message.id, // Graph API message ID (needed for attachment calls)
    metadata: {
      provider: 'outlook',
      outlook_id: message.id,
      internet_message_id: message.internetMessageId,
      conversation_id: message.conversationId,
    },
  };
}

/**
 * Fetch all messages in an Outlook conversation by conversationId.
 * Follows nextLink pagination and caps at 200 messages.
 */
export async function fetchOutlookConversation(
  encryptedTokens: string,
  conversationId: string,
  onTokenRefresh?: TokenRefreshCallback,
): Promise<OutlookMessage[]> {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);
  const MAX_MESSAGES = 200;
  const results: OutlookMessage[] = [];

  // Note: combining $filter with $orderby on /me/messages causes InefficientFilter (400).
  // Fetch unordered and sort client-side instead.
  let response = await client
    .api('/me/messages')
    .filter(`conversationId eq '${conversationId}'`)
    .select('id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,hasAttachments,isRead,internetMessageHeaders')
    .top(50)
    .get();

  while (response) {
    const messages: OutlookMessage[] = response.value || [];
    results.push(...messages);
    if (results.length >= MAX_MESSAGES || !response['@odata.nextLink']) break;
    response = await client.api(response['@odata.nextLink']).get();
  }

  results.sort((a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime());
  return results.slice(0, MAX_MESSAGES);
}

export async function fetchSentEmails(
  encryptedTokens: string,
  maxResults: number = 25,
  syncWindowDays: number = 7,
  onTokenRefresh?: TokenRefreshCallback,
  lastSync?: string,
) {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);
  const dateString = lastSync
    ? new Date(lastSync).toISOString()
    : (() => { const d = new Date(); d.setDate(d.getDate() - syncWindowDays); return d.toISOString(); })();

  const messages = await client
    .api('/me/mailFolders/sentItems/messages')
    .filter(`receivedDateTime ge ${dateString}`)
    .top(maxResults)
    .select('id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,hasAttachments,isRead,internetMessageHeaders')
    .orderby('receivedDateTime desc')
    .get();

  return messages.value as OutlookMessage[];
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
  bcc?: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}): Promise<void> {
  const { encryptedTokens, to, cc, bcc, subject, body, attachments = [] } = params;

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
  const bccRecipients = bcc
    ? bcc.split(',').map((addr) => ({ emailAddress: { address: addr.trim() } }))
    : [];

  const messageBody = {
    subject,
    body: {
      contentType: 'HTML',
      content: plainTextToHtml(body),
    },
    toRecipients,
    ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
    ...(bccRecipients.length > 0 ? { bccRecipients } : {}),
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
  to?: string;
  cc?: string;
  bcc?: string;
}

/**
 * Convert plain text (with \n newlines) to HTML for email sending.
 * Double newlines become paragraph breaks; single newlines become <br>.
 */
const EMAIL_FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.6;color:#262626`;

function wrapEmailHtml(body: string): string {
  // Inject inline styles on bare block elements so Outlook renders them correctly
  const styled = body
    .replace(/<p(?![^>]*style=)([^>]*)>/gi, '<p style="margin:0 0 0.75em"$1>')
    .replace(/<ul(?![^>]*style=)([^>]*)>/gi, '<ul style="margin:0 0 0.75em;padding-left:1.5em"$1>')
    .replace(/<ol(?![^>]*style=)([^>]*)>/gi, '<ol style="margin:0 0 0.75em;padding-left:1.5em"$1>');
  return `<div style="${EMAIL_FONT}">${styled}</div>`;
}

function plainTextToHtml(text: string): string {
  // Already HTML (from contenteditable) — wrap in font container and pass through
  if (/<[a-z][\s\S]*>/i.test(text.substring(0, 300))) return wrapEmailHtml(text);
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const formatted = escaped
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');
  // List blocks
  const blocks = formatted.split(/\n{2,}/);
  const html = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    const lines = trimmed.split('\n');
    if (lines.every(l => /^[-*]\s/.test(l.trim()))) {
      const items = lines.map(l => `<li>${l.trim().replace(/^[-*]\s+/, '')}</li>`).join('');
      return `<ul style="margin:0 0 0.75em;padding-left:1.5em">${items}</ul>`;
    }
    if (lines.every(l => /^\d+\.\s/.test(l.trim()))) {
      const items = lines.map(l => `<li>${l.trim().replace(/^\d+\.\s+/, '')}</li>`).join('');
      return `<ol style="margin:0 0 0.75em;padding-left:1.5em">${items}</ol>`;
    }
    return `<p style="margin:0 0 0.75em">${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('');
  return wrapEmailHtml(html);
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

type OutlookRawFolder = { id: string; displayName: string; childFolders?: OutlookRawFolder[] };

function flattenOutlookFolders(
  folders: OutlookRawFolder[],
  parentId: string | null,
  systemIds: Set<string>,
): Array<{ id: string; name: string; isSystem: boolean; parentId: string | null }> {
  const result: Array<{ id: string; name: string; isSystem: boolean; parentId: string | null }> = [];
  for (const f of folders) {
    result.push({ id: f.id, name: f.displayName, isSystem: systemIds.has(f.id), parentId });
    if (f.childFolders?.length) {
      result.push(...flattenOutlookFolders(f.childFolders, f.id, systemIds));
    }
  }
  return result;
}

export async function listOutlookAllFolders(
  encryptedTokens: string,
  onTokenRefresh?: TokenRefreshCallback,
): Promise<{ id: string; name: string; isSystem: boolean; parentId?: string | null }[]> {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);
  const [res, systemIds] = await Promise.all([
    client.api('/me/mailFolders')
      .select('id,displayName')
      .expand('childFolders($select=id,displayName;$expand=childFolders($select=id,displayName))')
      .top(50)
      .get(),
    getSystemFolderIds(client),
  ]);
  const all = flattenOutlookFolders(res.value ?? [], null, systemIds);
  const system = all.filter(f => f.isSystem && f.parentId === null);
  const userAll = all.filter(f => !f.isSystem);
  const userRoots = userAll.filter(f => f.parentId === null).sort((a, b) => a.name.localeCompare(b.name));
  const userChildren = userAll.filter(f => f.parentId !== null);
  return [...system, ...userRoots, ...userChildren];
}

export async function renameOutlookFolder(encryptedTokens: string, folderId: string, newName: string, onTokenRefresh?: TokenRefreshCallback): Promise<void> {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);
  await client.api(`/me/mailFolders/${folderId}`).patch({ displayName: newName });
}

export async function deleteOutlookFolder(encryptedTokens: string, folderId: string, onTokenRefresh?: TokenRefreshCallback): Promise<void> {
  const client = await getGraphClient(encryptedTokens, onTokenRefresh);
  await client.api(`/me/mailFolders/${folderId}`).delete();
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

export async function getOutlookMessageDetail(
  encryptedTokens: string,
  messageId: string,
): Promise<import('@/lib/google/gmail').MessageDetail> {
  const client = await getGraphClient(encryptedTokens);
  const m = await client
    .api(`/me/messages/${messageId}`)
    .select('id,subject,from,toRecipients,receivedDateTime,body,bodyPreview')
    .get();
  const htmlBody = m.body?.contentType === 'html' ? m.body.content : null;
  const bodyText = htmlBody
    ? htmlBody.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
    : m.body?.content ?? m.bodyPreview ?? '';
  return {
    id: m.id,
    subject: m.subject || '(no subject)',
    from: m.from?.emailAddress?.address ?? '',
    fromName: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? '',
    to: (m.toRecipients ?? []).map((r: any) => r.emailAddress.address).join(', '),
    date: m.receivedDateTime,
    body: bodyText,
    htmlBody,
  };
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
  const { encryptedTokens, messageId, body, attachments = [], to, cc, bcc } = params;

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
          ...(to ? { toRecipients: to.split(',').map(a => ({ emailAddress: { address: a.trim() } })) } : {}),
          ...(cc ? { ccRecipients: cc.split(',').map(a => ({ emailAddress: { address: a.trim() } })) } : {}),
          ...(bcc ? { bccRecipients: bcc.split(',').map(a => ({ emailAddress: { address: a.trim() } })) } : {}),
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
