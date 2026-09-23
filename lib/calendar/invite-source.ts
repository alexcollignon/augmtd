// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHERE AN INVITE LIVES, PER PROVIDER (W7.4 — INVITES ARE EVENTS).
//
// Found by reading what the two providers actually hand the sync:
//
//   GMAIL  · a Google-born invite carries TWO copies of the iCalendar: an inline `text/calendar;
//            method=REQUEST` alternative part AND an `invite.ics` attachment (application/ics). An
//            Exchange-born invite arriving in Gmail carries the `text/calendar` part with NO filename
//            (the attachment walker never listed it — such invites were not even detected).
//            → the parser keeps the filename-less part as `metadata.calendar_part` {data | attachmentId};
//              a named .ics rides the normal attachment list.
//   OUTLOOK· Graph converts every meeting message into an `eventMessage` (`@odata.type`
//            #microsoft.graph.eventMessageRequest / …Response / …Cancellation) and usually strips the
//            .ics: `hasAttachments` is false. The invite is the message's EXPANDED EVENT —
//            `$expand=microsoft.graph.eventMessage/event` — which names the user's own calendar event
//            id AND its iCalUId. A foreign .ics attachment, when one survives, is read like Gmail's.
//
// One reader, one output shape (`InviteFacts`). Every failure is "no invite" — the email stays an
// email, which is honest; never a half-read invite. Read-only against the provider.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { parseIcs, inviteFromGraphEventMessage, type InviteFacts } from '@/lib/calendar/ics';

/** Is this attachment an iCalendar file? ONE predicate (the sync used three inline copies). */
export const isCalendarAttachment = (a: { mimeType?: string | null; filename?: string | null }): boolean =>
  !!a.mimeType?.toLowerCase().includes('calendar') || a.mimeType === 'application/ics'
  || !!a.filename?.toLowerCase().endsWith('.ics');

const b64url = (data: string): Buffer => Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Parse a downloaded .ics buffer. */
export function inviteFromBuffer(buf: Buffer | null | undefined, fallbackTz?: string | null): InviteFacts | null {
  if (!buf || !buf.length) return null;
  try { return parseIcs(buf.toString('utf8'), { fallbackTz }); } catch { return null; }
}

/**
 * Read the invite a message carries, if any. `calendarAttachmentIds` = the ids of the message's
 * named .ics attachments (the attachment walker already listed them).
 */
export async function readInviteForEmail(p: {
  provider: 'gmail' | 'outlook';
  encryptedTokens: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed: any;
  calendarAttachmentIds?: string[];
  fallbackTz?: string | null;
}): Promise<InviteFacts | null> {
  const meta = (p.parsed?.metadata ?? {}) as Record<string, unknown>;
  try {
    if (p.provider === 'gmail') {
      const gmailId = String(meta.gmail_id ?? '');
      const part = meta.calendar_part as { data?: string | null; attachmentId?: string | null } | undefined;
      if (part?.data) {
        const inv = inviteFromBuffer(b64url(part.data), p.fallbackTz);
        if (inv) return inv;
      }
      const ids = [...(part?.attachmentId ? [part.attachmentId] : []), ...(p.calendarAttachmentIds ?? [])];
      if (gmailId && ids.length) {
        const { fetchGmailAttachment } = await import('@/lib/google/gmail');
        for (const id of ids.slice(0, 2)) {
          const inv = inviteFromBuffer(await fetchGmailAttachment(p.encryptedTokens, gmailId, id).catch(() => null), p.fallbackTz);
          if (inv) return inv;
        }
      }
      return null;
    }
    // OUTLOOK
    const outlookId = String(meta.outlook_id ?? p.parsed?.outlookInternalId ?? '');
    if (!outlookId) return null;
    if (String(meta.odata_type ?? '').toLowerCase().includes('eventmessage')) {
      const inv = await readGraphEventMessage(p.encryptedTokens, outlookId);
      if (inv) return inv;
    }
    if (p.calendarAttachmentIds?.length) {
      const { fetchOutlookAttachmentContent } = await import('@/lib/microsoft/outlook');
      for (const id of p.calendarAttachmentIds.slice(0, 2)) {
        const inv = inviteFromBuffer(await fetchOutlookAttachmentContent(p.encryptedTokens, outlookId, id).catch(() => null), p.fallbackTz);
        if (inv) return inv;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The Graph read: the eventMessage with its event expanded (identity + facts in one call). */
export async function readGraphEventMessage(encryptedTokens: string, outlookMessageId: string): Promise<InviteFacts | null> {
  try {
    const { getGraphClient } = await import('@/lib/microsoft/outlook');
    const client = await getGraphClient(encryptedTokens);
    // No $select: `meetingMessageType` is a DERIVED-type property; the default projection of an
    // eventMessage instance carries it, a base-typed $select would not.
    const msg = await client.api(`/me/messages/${outlookMessageId}`)
      .expand('microsoft.graph.eventMessage/event($select=id,iCalUId,subject,start,end,isAllDay,location,organizer,attendees,isCancelled,type,seriesMasterId)')
      .get();
    return inviteFromGraphEventMessage(msg);
  } catch {
    return null;
  }
}
