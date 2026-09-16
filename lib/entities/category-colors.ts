// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE COLOR PER FACT, ONE SHAPE PER FACT (Sep 14 — owner-found: "some mismatching label colors").
//
// A project's CATEGORY (client · internal · personal · admin) and its MOMENTUM (active · needs you ·
// gone quiet · no signal — `momentumOf` in lib/work-items/states.ts) are DIFFERENT DIMENSIONS. They
// were rendering as the same 6px circle two inches apart, so a green category dot and a green
// momentum dot read as one signal.
//
// THE LAW: momentum is a CIRCLE (the state vocabulary owns round), category is a SQUARE
// (`rounded-[2px]`). The shape says which question the color is answering; the color says which
// answer. This module is the ONE producer of the category half — a render site importing it can
// never fork the palette the way two inline ternaries did.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const ENTITY_CATEGORIES = ['client', 'internal', 'personal', 'admin'] as const;
export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

/** dot = the swatch fill; text = the same fact in words. Shape is NOT a choice: see swatchClass. */
export const CATEGORY_COLORS: Record<EntityCategory, { dot: string; text: string; label: string }> = {
  client:   { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Client' },
  internal: { dot: 'bg-indigo-500',  text: 'text-indigo-600',  label: 'Internal' },
  personal: { dot: 'bg-violet-500',  text: 'text-violet-600',  label: 'Personal' },
  admin:    { dot: 'bg-neutral-400', text: 'text-neutral-500', label: 'Admin' },
};

/** An unknown/absent category reads NEUTRAL — never borrows a category's color (the unknown-momentum
 *  precedent: a default must not look like a verdict). */
const UNCATEGORIZED = { dot: 'bg-neutral-300', text: 'text-neutral-400', label: 'Uncategorized' };

export function categoryOf(category: string | null | undefined) {
  return CATEGORY_COLORS[category as EntityCategory] ?? UNCATEGORIZED;
}

/** THE SWATCH: the full class string for a category mark — square, by law, at every site. */
export function categorySwatchClass(category: string | null | undefined, size = 'w-1.5 h-1.5'): string {
  return `${size} rounded-[2px] ${categoryOf(category).dot}`;
}
