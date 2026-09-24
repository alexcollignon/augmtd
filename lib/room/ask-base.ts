// ════════════════════════════════════════════════════════════════════════════════════════════════
// W13.6 · THE BASE IS OFFERED (staging law — docs/laws-registry.md `staging-law`).
//
// A new-work requirement whose matching file predates the request stages that file as the BASE
// (`base:<label>` pool row — lib/prepare/requirements.ts `unstageRequirement`). The room must OFFER it:
// "Current version (to update): <file>" — on the pool row's title AND on the engine ask's card (its
// meta line, read off the ask turn's `component.state.base`). One wording, one home; PURE and
// client-safe (the rail and the ask card read it; the server writer titles the row with it).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The offer's fixed prefix — the gate and the readers key on it. */
export const BASE_OFFER_PREFIX = 'Current version (to update)';

/** "Current version (to update): a.pptx" (two at most). Empty input → ''. Pure. */
export function baseOfferLine(filenames: Array<string | null | undefined>): string {
  const f = filenames.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 2);
  return f.length ? `${BASE_OFFER_PREFIX}: ${f.join(' · ')}` : '';
}

/** The base filenames an ask turn's component state carries (`state.base`), or []. Pure. */
export function askBaseOf(state: unknown): string[] {
  const b = ((state ?? {}) as { base?: unknown }).base;
  return Array.isArray(b) ? b.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 2) : [];
}
