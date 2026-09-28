// ════════════════════════════════════════════════════════════════════════════════════════════════
// A LONG PASTE IS MATERIAL, NOT A MESSAGE (stabilization W22.B — THE CHAT FEELS LIKE A REAL AI CHAT).
//
// Before W22 a pasted document went inline into the question: the bubble became a wall, the route cut
// it at 20,000 characters with a raw slice nobody saw (NO SILENT CAPS), and the brain could not tell
// the user's words from the text they wanted worked on. Now a paste over PASTE_CHIP_MIN becomes a
// visible "Pasted text" chip riding the message; it is SENT AS MATERIAL (marked as data — never
// instructions, UNTRUSTED INPUT IS DATA), and a paste over PASTE_LIMIT is refused at the composer
// with its size and the limit stated — the composer never cuts anything quietly.
//
// THE WIRE (for the core's request shape): the ask body carries `pasted: { text, name }[]`. Until the
// core reads that field, the same pieces ALSO ride the existing `attachments` lane ({ name, text }),
// which every production lane already receives as material — `pastedWire` builds both, and the report
// names the bridge so the core can drop it once `pasted` is read.
//
// Pure, zero IO, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A paste at or above this many characters becomes a chip instead of inline text. */
export const PASTE_CHIP_MIN = 2000;
/** The most a single paste may carry — today's per-attachment ceiling at the ask door (a paste over
 *  it is refused out loud, never trimmed). */
export const PASTE_LIMIT = 20_000;
/** At most this many pasted pieces ride one message (the ask door takes five attachments in all). */
export const PASTE_MAX_PIECES = 3;

export type PastedPiece = { text: string; name: string };

export type PasteVerdict =
  | { kind: 'inline' }
  | { kind: 'chip'; piece: PastedPiece }
  | { kind: 'refused'; reason: string };

const fmt = (n: number) => n.toLocaleString('en-US');

/** The one decision about a paste. `held` = the pieces already riding this message. */
export function classifyPaste(text: string, held: number): PasteVerdict {
  const t = String(text ?? '');
  if (t.length < PASTE_CHIP_MIN) return { kind: 'inline' };
  if (t.length > PASTE_LIMIT) {
    return { kind: 'refused', reason: `That paste is ${fmt(t.length)} characters — the limit is ${fmt(PASTE_LIMIT)} per paste. Nothing was cut: trim it, or attach it as a file.` };
  }
  if (held >= PASTE_MAX_PIECES) {
    return { kind: 'refused', reason: `A message carries at most ${PASTE_MAX_PIECES} pasted texts — send this one, then paste the next.` };
  }
  return { kind: 'chip', piece: { text: t, name: pasteName(t, held) } };
}

/** A pasted piece's name: its first words, so two chips can be told apart. */
export function pasteName(text: string, index: number): string {
  const first = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const words = first.replace(/\s+/g, ' ').slice(0, 40).trim();
  return words ? `Pasted: ${words}${first.length > 40 ? '…' : ''}` : `Pasted text ${index + 1}`;
}

/** The chip's size word ("4,312 characters"). */
export const pasteSize = (p: PastedPiece): string => `${fmt(p.text.length)} characters`;

/** The note the brain's history reads for a message that carried pastes (the words it was told). */
export function pastedNote(pieces: PastedPiece[]): string {
  if (!pieces.length) return '';
  return `\n[Pasted text attached as material: ${pieces.map((p) => `${p.name} (${pasteSize(p)})`).join('; ')}]`;
}

/** The ask body's fields for the pieces: the `pasted` field, and the bridge through `attachments`. */
export function pastedWire(pieces: PastedPiece[]): { pasted?: PastedPiece[]; attachments: Array<{ name: string; text: string }> } {
  if (!pieces.length) return { attachments: [] };
  return {
    pasted: pieces.map((p) => ({ text: p.text, name: p.name })),
    attachments: pieces.map((p) => ({ name: p.name, text: p.text })),
  };
}

/** A paste bound for a coworker DM rides that thread's own attach door, as a text file. */
export function pastedAsFileName(p: PastedPiece, index: number): string {
  const slug = p.name.replace(/^Pasted:\s*/, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return `${slug || `pasted-text-${index + 1}`}.txt`;
}
