// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ATTACHMENT KEEP RULE (W18.B — owner walk, Sep 25).
//
// Found live: an invoice mail's PDF was never stored. The Gmail parser skipped ANY part carrying a
// Content-ID or an inline disposition, whatever its type — a rule written for signature logos and
// tracking pixels. Some mailers give EVERY part a Content-ID, so the document itself was dropped as
// if it were a logo. Outlook's `isInline` filter had the same shape.
//
// The rule: only an IMAGE can be a decoration. An inline / Content-ID / sequentially-named
// (image001.png) part is skipped only when its MIME type (or, absent one, its extension) says image.
// A document — PDF, office, text, archive, anything else — is kept regardless of how it is embedded.
// Pure, zero IO; both providers' parsers call it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?|heic)$/i;

/** Whether a part is an image (MIME type first; the filename's extension when the type is generic). */
export function isImagePart(mimeType: string | null | undefined, filename: string | null | undefined): boolean {
  const mt = String(mimeType ?? '').toLowerCase().trim();
  if (mt.startsWith('image/')) return true;
  if (mt && mt !== 'application/octet-stream') return false;
  return IMAGE_EXT.test(String(filename ?? ''));
}

/**
 * Whether an attachment part is a decoration to skip: an IMAGE that is embedded (Content-ID, inline
 * disposition) or named like an embedded signature image (image001.png). Never a document.
 */
export function skipEmbeddedPart(p: {
  mimeType?: string | null; filename?: string | null; hasContentId?: boolean; inline?: boolean;
}): boolean {
  if (!isImagePart(p.mimeType, p.filename)) return false;
  const sequential = /^image\d{1,3}\.(png|jpe?g|gif|webp)$/i.test(String(p.filename ?? ''));
  return !!p.hasContentId || !!p.inline || sequential;
}
