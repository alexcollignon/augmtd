// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LIVE HEADER READ — the one thing the honest unsubscribe subset cannot get from the database.
//
// `has_unsubscribe` is stored as a BOOLEAN and nothing more: the sync strips every raw header before
// the `emails` insert, so the `List-Unsubscribe` URI and RFC 8058's `List-Unsubscribe-Post`
// declaration exist nowhere in our storage. A7's breakdown must be computed BEFORE the user commits
// ("the preview card states it before commit"), so the headers are read AT PREPARE TIME, once per
// item, through the cheapest call each provider offers:
//
//   Gmail   — messages.get format:'metadata' with metadataHeaders — headers only, no body bytes.
//   Outlook — /me/messages/{id}?$select=internetMessageHeaders — the same shape the push webhook uses.
//
// Never throws: an unreadable header means the lane is UNKNOWN, and an unknown lane is reported, not
// guessed at. Silence is the honest degradation here — inventing a one-click URL would fire a POST.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { getGmailClient } from '@/lib/google/gmail';
import { getGraphClient, persistOutlookTokens } from '@/lib/microsoft/outlook';
import type { MailTarget } from './mail-target';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = any;

export type UnsubscribeHeaders = { listUnsubscribe: string | null; listUnsubscribePost: string | null };

const EMPTY: UnsubscribeHeaders = { listUnsubscribe: null, listUnsubscribePost: null };

export async function readUnsubscribeHeaders(
  client: DBClient, target: MailTarget,
): Promise<UnsubscribeHeaders> {
  try {
    if (target.provider === 'gmail') {
      if (!target.gmailMessageId) return EMPTY;
      const gmail = await getGmailClient(target.encryptedTokens);
      const res = await gmail.users.messages.get({
        userId: 'me', id: target.gmailMessageId, format: 'metadata',
        metadataHeaders: ['List-Unsubscribe', 'List-Unsubscribe-Post'],
      });
      const headers = ((res.data as any)?.payload?.headers ?? []) as Array<{ name?: string; value?: string }>;
      const get = (n: string) => headers.find((h) => (h.name ?? '').toLowerCase() === n)?.value ?? null;
      return { listUnsubscribe: get('list-unsubscribe'), listUnsubscribePost: get('list-unsubscribe-post') };
    }
    if (!target.outlookMessageId) return EMPTY;
    const graph = await getGraphClient(target.encryptedTokens, persistOutlookTokens(client, target.connection));
    const msg = await graph.api(`/me/messages/${target.outlookMessageId}`).select('internetMessageHeaders').get();
    const headers = ((msg?.internetMessageHeaders ?? []) as Array<{ name?: string; value?: string }>);
    const get = (n: string) => headers.find((h) => (h.name ?? '').toLowerCase() === n)?.value ?? null;
    return { listUnsubscribe: get('list-unsubscribe'), listUnsubscribePost: get('list-unsubscribe-post') };
  } catch {
    return EMPTY;
  }
}
