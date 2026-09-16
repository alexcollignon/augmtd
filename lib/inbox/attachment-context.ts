// ════════════════════════════════════════════════════════════════════════════════════════════════
// AN ITEM'S OWN DOCUMENT IS THE ITEM'S OWN CONTEXT (owner walk, Sep 10 — the fabricated denial).
//
// An inbound email carried a debt notice (amounts, IBAN, due dates). The file was fetched at sync,
// stored in `email-attachments`, its text extracted onto the item, and rendered in the UI's Files
// tab. Yet the drafted reply — one click from being MAILED to a real counterparty — said "I'm afraid
// I did not receive the attachment, could you resend it?", and the pinned brief said the user had to
// "send it back to them to finalize billing". Nothing hallucinated: no reasoner in the item's lane
// was ever HANDED the document. The drafter saw a subject and a body; the judge saw a subject and a
// body; the room's board saw a title. The document existed everywhere except in the mind that spoke.
//
// The law: a document that arrived ON an item is part of that item's context, at every door that
// reasons about the item. This module is the one place that resolves it:
//   • `readItemAttachments` — the records, with their text, LAZILY extracted fill-if-empty and
//     cached back onto the item (sync extracts ≤1.5MB inline; anything bigger, anything the
//     recovery path stored as bare metadata, and anything predating extraction arrives text-less).
//   • `renderAttachedDocumentsBlock` — the drafter's full-text block + the never-claim-missing rule.
//   • `attachmentFactLines` — names + a one-line gist for the token-tight readers (judge, board).
//
// Every clip rides the EXCERPT-HONESTY LAW: our own length cuts declare themselves, and the
// consuming prompt carries EXCERPT_RULE so a marker never reads as a truncated source.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

export type ItemAttachment = {
  filename: string;
  mimeType: string | null;
  size: number | null;
  storagePath: string | null;
  /** The document's own text. null = genuinely not extractable (an image, a locked PDF, a type we
   *  cannot read) — an honest absence the prompt states rather than hides. */
  text: string | null;
};

/** Budget: the item's own documents, not a corpus. Three files, 6k of text each. */
const MAX_ATTACHMENTS = 3;
const MAX_LAZY_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 6000;
/** Per-document text in the drafter's block, and the one-line gist for the tight readers. */
const DRAFT_CLIP = 2600;
const GIST_CLIP = 180;

/** THE DRAFTER LAW VERSION — bump when the drafter's grounding law changes so drafts written under
 *  the old law are re-generated instead of being served forever. v2 = the attachment block. */
export const DRAFT_LAW_VERSION = 2;

/** A stored draft written before the current drafting law — serve gates treat it as superseded.
 *  (Unstamped legacy drafts ARE stale: they predate every version, v1 included.) */
export function draftLawStale(draft: { law_version?: number } | null | undefined): boolean {
  if (!draft) return false;
  return Number(draft.law_version ?? 0) < DRAFT_LAW_VERSION;
}

type RawAtt = {
  filename?: string; mimeType?: string; size?: number;
  storagePath?: string; extractedText?: string | null;
};

const normalize = (a: RawAtt): ItemAttachment => ({
  filename: String(a.filename ?? 'attachment'),
  mimeType: a.mimeType ? String(a.mimeType) : null,
  size: typeof a.size === 'number' ? a.size : null,
  storagePath: a.storagePath ? String(a.storagePath) : null,
  text: (a.extractedText ?? null) && String(a.extractedText).trim() ? String(a.extractedText).trim() : null,
});

/** Calendar invites are not documents the reply reasons about (their fact is the meeting itself). */
const isCalendar = (a: ItemAttachment): boolean =>
  !!a.mimeType?.includes('calendar') || a.mimeType === 'application/ics' || /\.ics$/i.test(a.filename);

/**
 * The item's attachments WITH their text.
 *
 * `sd` is the item's stored source_data (the read never needs a round-trip when the text is already
 * there — the common case). When a record has bytes but no text, this extracts it ONCE and caches
 * it back onto the item (fill-if-empty, never re-extracting, never overwriting): the same document
 * is never read from storage twice, and every later door inherits the text for free.
 *
 * Non-fatal by construction — a failed extraction yields `text: null`, which the prompts state
 * honestly. `itemId` omitted → resolved from the source_data's own email id, so a caller holding
 * only the sd (every drafting door) still gets the cache.
 */
export async function readItemAttachments(
  client: SupabaseClient,
  userId: string,
  sd: Record<string, unknown>,
  itemId?: string | null,
): Promise<ItemAttachment[]> {
  const raw = Array.isArray(sd.attachments) ? (sd.attachments as RawAtt[]) : [];
  const atts = raw.map(normalize).filter((a) => !isCalendar(a)).slice(0, MAX_ATTACHMENTS);
  if (!atts.length) return [];

  const needText = atts.filter((a) => !a.text && a.storagePath);
  if (!needText.length) return atts;

  let filled = false;
  for (const a of needText) {
    try {
      const { data: blob, error } = await client.storage.from('email-attachments').download(a.storagePath!);
      if (error || !blob) continue;
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (buffer.length > MAX_LAZY_BYTES) continue;
      const { extractTextFromAttachment } = await import('@/lib/attachments/text-extractor');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = await extractTextFromAttachment(buffer, (a.mimeType ?? '') as any, a.filename);
      if (text && text.trim()) { a.text = text.trim().slice(0, MAX_TEXT_CHARS); filled = true; }
    } catch { /* an unreadable document stays honestly text-less */ }
  }

  // FILL-IF-EMPTY: write the newly-read text back onto the item's own records, and ONLY where the
  // stored record still has none (a concurrent writer's text always wins over ours).
  if (filled) {
    try {
      if (!itemId) {
        const emailId = String((sd.email_id as string) ?? '');
        if (!emailId) return atts;
        const { data: row } = await client.from('inbox_items').select('id')
          .eq('user_id', userId).eq('source_id', emailId).limit(1).maybeSingle();
        itemId = (row?.id as string) ?? null;
        if (!itemId) return atts;
      }
      const { data: fresh } = await client.from('inbox_items').select('source_data')
        .eq('id', itemId).eq('user_id', userId).maybeSingle();
      const freshSd = (fresh?.source_data ?? null) as Record<string, unknown> | null;
      const freshAtts = freshSd && Array.isArray(freshSd.attachments) ? (freshSd.attachments as RawAtt[]) : null;
      if (freshAtts) {
        let changed = false;
        for (const rec of freshAtts) {
          if (String(rec.extractedText ?? '').trim()) continue;
          const got = atts.find((a) => a.filename === String(rec.filename ?? '') && !!a.text);
          if (got?.text) { rec.extractedText = got.text; changed = true; }
        }
        if (changed) {
          await client.from('inbox_items')
            .update({ source_data: { ...freshSd, attachments: freshAtts } })
            .eq('id', itemId).eq('user_id', userId);
        }
      }
    } catch { /* the cache is an optimization; the text is already in hand for this call */ }
  }
  return atts;
}

/**
 * THE ATTACHED DOCUMENTS BLOCK — the drafter's grounding. Carries each document's own text and the
 * one rule the fabricated denial violated: a document in this block is IN OUR HANDS.
 */
export function renderAttachedDocumentsBlock(atts: ItemAttachment[]): string {
  if (!atts.length) return '';
  const bodies = atts.map((a) => {
    const head = `--- ATTACHED DOCUMENT: ${a.filename}${a.mimeType ? ` (${a.mimeType})` : ''} ---`;
    return a.text
      ? `${head}\n${clipForPrompt(a.text, DRAFT_CLIP)}`
      : `${head}\n(This file arrived with the email and IS in our possession; its text could not be ` +
        `read by the extractor — do not describe it, and never say it was not received.)`;
  }).join('\n\n');
  return (
    `ATTACHED DOCUMENTS — these files came WITH the email you are replying to. They are received, ` +
    `stored, and their contents are printed below.\n` +
    `RULES ABOUT THEM (absolute):\n` +
    `- NEVER say a document was not received, is missing, did not arrive, is unreadable, or ask the ` +
    `sender to resend it. Every file named here IS in our hands.\n` +
    `- NEVER ask the sender to send us something they already attached, and never offer to send ` +
    `THEIR OWN document back to them.\n` +
    `- Any amount, date, reference, account or deadline you state about these documents must be ` +
    `taken from the text below — never estimated, never invented. If the figure you need is not in ` +
    `the text, say nothing about it rather than guessing.\n` +
    `${EXCERPT_RULE}\n\n${bodies}`
  );
}

/**
 * The token-tight form for readers that must KNOW the document exists and roughly what it is, but
 * cannot carry its full text (the judge; the room's board). Names + a one-line gist, plus the
 * DIRECTION — the counterparty sent these to the user, so "send it back to them" is never a move
 * a reader can invent.
 */
export function attachmentFactLines(atts: ItemAttachment[]): string[] {
  return atts.map((a) => {
    const gist = a.text ? clipForPrompt(a.text.replace(/\s+/g, ' '), GIST_CLIP) : null;
    return `${a.filename}${gist ? ` — ${gist}` : ' (received; text not extractable)'}`;
  });
}

/** The one sentence that carries those facts into a prompt. Empty when there are no attachments. */
export function attachmentFactBlock(atts: ItemAttachment[], senderLabel?: string | null): string {
  const lines = attachmentFactLines(atts);
  if (!lines.length) return '';
  return (
    `DOCUMENTS ATTACHED TO THIS ITEM (${senderLabel ? `${senderLabel} sent these TO the user` : 'sent TO the user'}; ` +
    `they are received and stored — never treat one as missing, and never propose sending the ` +
    `sender their own document back):\n` +
    lines.map((l) => `- ${l}`).join('\n') + '\n'
  );
}
