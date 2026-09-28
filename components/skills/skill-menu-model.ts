// ════════════════════════════════════════════════════════════════════════════════════════════════
// SKILLS IN CHAT — THE MODEL (W21). Pure, client-safe, no React, no fetch: every decision the Skills
// menu, its chips, the send body, the header's "uses" line and the answer's receipt make lives here,
// so the three chat surfaces (Home chat, coworker DM, item/project room) cannot drift apart — they
// mount ONE menu (components/skills/skill-menu.tsx) inside ONE composer and read this one model.
//
// THE MENU STATES ITS OWN TRUTH (owner, Sep 28 — "wouldn't make sense to select something that is
// assigned already"): an assigned skill is ALREADY ON for the addressed actor, so it arrives checked.
//   · unchecking an assigned skill  = SKIP it for this message  (never an unassign)
//   · checking an unassigned skill  = ADD it for this message   (never an assign)
// The only in-chat assignment change is the row's explicit secondary action (Always use / Remove),
// which goes through `setSkillAssignment` in components/one/chat-actions.ts.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// THE CONTRACT (server, W21) — lib/skills/chat-contract.ts is client-safe (types + pure readers);
// this file only takes its TYPES (the client graph never drags a server module).
import type { ChatMenuSkill, ChatMenuResponse, SkillPick, SkillFollowed, SkillOffer } from '@/lib/skills/chat-contract';
export type { ChatMenuSkill, ChatMenuResponse, SkillPick, SkillFollowed, SkillOffer };

/** The per-message pick, empty. One stable object — a reset never mints a fresh one. */
export const NO_PICK: SkillPick = Object.freeze({ add: [], skip: [] }) as unknown as SkillPick;

const has = (xs: readonly string[] | undefined, id: string) => !!xs && xs.includes(id);

/** ORDER: the addressed actor's assigned skills first (they are on), then the rest of the library.
 *  Stable inside each group (the server's own order is kept). */
export function orderMenu(skills: readonly ChatMenuSkill[]): ChatMenuSkill[] {
  return [...skills.filter((s) => s.assigned), ...skills.filter((s) => !s.assigned)];
}

/** Filter by the typed query (name or when-to-use), keeping the menu's order. */
export function filterMenu(skills: readonly ChatMenuSkill[], q: string): ChatMenuSkill[] {
  const n = q.trim().toLowerCase();
  const ordered = orderMenu(skills);
  if (!n) return ordered;
  return ordered.filter((s) => s.name.toLowerCase().includes(n) || (s.whenToUse ?? '').toLowerCase().includes(n));
}

/** CHECKED = will this skill be followed for the next message? */
export function isChecked(skill: ChatMenuSkill, pick: SkillPick): boolean {
  return skill.assigned ? !has(pick.skip, skill.id) : has(pick.add, skill.id);
}

/** The row's state word — what a check means HERE, said plainly. */
export function rowHint(skill: ChatMenuSkill, pick: SkillPick, actorName: string): string {
  const first = firstName(actorName);
  if (skill.assigned) return has(pick.skip, skill.id) ? 'skipped for this message' : `always on for ${first}`;
  return has(pick.add, skill.id) ? 'this message only' : '';
}

/** The row's quiet secondary action label (the one in-chat assignment change). */
export function assignLabel(skill: ChatMenuSkill, actorName: string): string {
  const first = firstName(actorName);
  return skill.assigned ? `Remove from ${first}` : `Always use for ${first}`;
}

/** TOGGLE A ROW — pure. An assigned skill toggles in `skip`; an unassigned one toggles in `add`.
 *  It NEVER changes an assignment (that is the explicit secondary action's job alone). */
export function toggleSkill(pick: SkillPick, skill: ChatMenuSkill): SkillPick {
  const flip = (xs: readonly string[] | undefined) => (has(xs, skill.id) ? (xs ?? []).filter((x) => x !== skill.id) : [...(xs ?? []), skill.id]);
  return skill.assigned
    ? { add: (pick.add ?? []).filter((x) => x !== skill.id), skip: flip(pick.skip) }
    : { add: flip(pick.add), skip: (pick.skip ?? []).filter((x) => x !== skill.id) };
}

/** RECONCILE the pick with the menu as it stands NOW (an assignment changed under it, a skill was
 *  deleted): an `add` of a now-assigned skill is redundant, a `skip` of a now-unassigned one is moot. */
export function reconcilePick(pick: SkillPick, skills: readonly ChatMenuSkill[] | null | undefined): SkillPick {
  if (!skills) return pick;
  const byId = new Map(skills.map((s) => [s.id, s]));
  const add = (pick.add ?? []).filter((id) => byId.has(id) && !byId.get(id)!.assigned);
  const skip = (pick.skip ?? []).filter((id) => byId.has(id) && byId.get(id)!.assigned);
  if (add.length === (pick.add ?? []).length && skip.length === (pick.skip ?? []).length) return pick;
  return { add, skip };
}

export type SkillChip = { id: string; kind: 'add' | 'skip'; label: string };

/** THE CHIPS — what rides with the next message, removable. A skip reads "skip <skill>". */
export function chipsOf(pick: SkillPick, skills: readonly ChatMenuSkill[] | null | undefined): SkillChip[] {
  const nameOf = (id: string) => skills?.find((s) => s.id === id)?.name ?? 'skill';
  return [
    ...(pick.add ?? []).map((id) => ({ id, kind: 'add' as const, label: nameOf(id) })),
    ...(pick.skip ?? []).map((id) => ({ id, kind: 'skip' as const, label: `skip ${nameOf(id)}` })),
  ];
}

/** Remove one chip = undo that one choice. */
export function dropChip(pick: SkillPick, chip: Pick<SkillChip, 'id' | 'kind'>): SkillPick {
  return chip.kind === 'add'
    ? { add: (pick.add ?? []).filter((x) => x !== chip.id), skip: pick.skip ?? [] }
    : { add: pick.add ?? [], skip: (pick.skip ?? []).filter((x) => x !== chip.id) };
}

export const isEmptyPick = (pick: SkillPick | null | undefined) => !pick || (!(pick.add ?? []).length && !(pick.skip ?? []).length);

/** THE SEND BODY'S FIELD — `{ skills: { add?, skip? } }`, or nothing at all when nothing was picked
 *  (a send that picked nothing is byte-identical to one sent before W21). */
export function skillsBody(pick: SkillPick | null | undefined): { skills?: SkillPick } {
  if (isEmptyPick(pick)) return {};
  const add = pick!.add ?? []; const skip = pick!.skip ?? [];
  return { skills: { ...(add.length ? { add: [...add] } : {}), ...(skip.length ? { skip: [...skip] } : {}) } };
}

/** THE HEADER'S QUIET LINE — the actor's always-on skills: "uses: A, B +N". `all` feeds the hover. */
export function usesLine(skills: readonly ChatMenuSkill[] | null | undefined, max = 2): { shown: ChatMenuSkill[]; more: number; all: string } | null {
  const on = (skills ?? []).filter((s) => s.assigned);
  if (!on.length) return null;
  return { shown: on.slice(0, max), more: Math.max(0, on.length - max), all: on.map((s) => s.name).join(', ') };
}

// ── THE RECEIPT + THE OFFER, read off ANY turn shape ─────────────────────────────────────────────
// A live answer carries `skillsFollowed` / `skillOffer` on its payload; a reloaded turn carries them
// wherever its store keeps them (the room turn's row, its component state, a DM message's metadata).
// ONE reader for every shape, so the live turn and the reloaded one render the same line.
const isFollowed = (x: unknown): x is SkillFollowed =>
  !!x && typeof x === 'object' && typeof (x as SkillFollowed).id === 'string' && typeof (x as SkillFollowed).name === 'string' && !!(x as SkillFollowed).name;

export function skillsFollowedOf(t: unknown): SkillFollowed[] | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const o = t as Record<string, unknown>;
  const meta = (o.metadata && typeof o.metadata === 'object' ? o.metadata : null) as Record<string, unknown> | null;
  const comp = (o.component && typeof o.component === 'object' ? o.component : null) as { state?: Record<string, unknown> | null } | null;
  const raw = o.skillsFollowed ?? o.skills_followed ?? meta?.skillsFollowed ?? meta?.skills_followed
    ?? comp?.state?.skillsFollowed ?? comp?.state?.skills_followed;
  if (!Array.isArray(raw)) return undefined;
  const list = raw.filter(isFollowed).map((s) => ({ id: s.id, name: s.name }));
  return list.length ? list : undefined;
}

export function skillOfferOf(t: unknown): SkillOffer | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const o = t as Record<string, unknown>;
  const meta = (o.metadata && typeof o.metadata === 'object' ? o.metadata : null) as Record<string, unknown> | null;
  const raw = (o.skillOffer ?? o.skill_offer ?? meta?.skillOffer ?? meta?.skill_offer) as SkillOffer | undefined;
  return raw && typeof raw === 'object' && typeof raw.patternKey === 'string' && raw.patternKey
    ? { patternKey: raw.patternKey, label: typeof raw.label === 'string' ? raw.label : '' }
    : undefined;
}

/** Both fields at once, spread-ready onto any turn: `{ skillsFollowed?, skillOffer? }`. */
export function skillTurnFields(t: unknown): { skillsFollowed?: SkillFollowed[]; skillOffer?: SkillOffer } {
  const followed = skillsFollowedOf(t);
  const offer = skillOfferOf(t);
  return { ...(followed ? { skillsFollowed: followed } : {}), ...(offer ? { skillOffer: offer } : {}) };
}

/** THE RECEIPT OF A TURN, live or reloaded: its own field first (a live answer · a DM message's
 *  metadata), else the room's companion record by the turn's row id (GET /api/skills/followed). */
export function followedFor(
  t: { skillsFollowed?: SkillFollowed[]; rowId?: string },
  byTurnId: Record<string, SkillFollowed[]> | null | undefined,
): SkillFollowed[] | undefined {
  if (t.skillsFollowed?.length) return t.skillsFollowed;
  const hit = t.rowId && byTurnId ? byTurnId[t.rowId] : undefined;
  return Array.isArray(hit) && hit.length ? hit : undefined;
}

/** The receipt's words — "followed: A, B". Empty → no line at all. */
export function receiptText(followed: readonly SkillFollowed[] | null | undefined): string | null {
  const names = (followed ?? []).map((s) => s.name).filter(Boolean);
  return names.length ? `followed: ${names.join(', ')}` : null;
}

export const OFFER_LINE = 'Save this as a skill?';
export const OFFER_SAVE = 'Save';
export const OFFER_DECLINE = 'Not now';

/** THE RECEIPT AS A TIMELINE ITEM — the kit's ONE muted line (event_line), the same on every surface. */
export function skillsReceiptItem(key: string, followed: readonly SkillFollowed[] | null | undefined): { type: 'event_line'; id: string; text: string } | null {
  const text = receiptText(followed);
  return text ? { type: 'event_line', id: `${key}-skills`, text } : null;
}

/** THE OFFER AS A TIMELINE ITEM — one quiet line, two inline word-doors (Save · Not now). */
export function skillOfferItem(key: string, offer: SkillOffer | null | undefined, on: { save: () => void; decline: () => void }):
  { type: 'event_line'; id: string; text: string; refs: Array<{ label: string; onClick: () => void }> } | null {
  if (!offer) return null;
  return { type: 'event_line', id: `${key}-skill-offer`, text: OFFER_LINE,
    refs: [{ label: OFFER_SAVE, onClick: on.save }, { label: OFFER_DECLINE, onClick: on.decline }] };
}

// ── THE "/" DOOR ─────────────────────────────────────────────────────────────────────────────────
/** The open trigger at the caret: `@query` (the mention menu) or `/query` at the START of a word (the
 *  Skills list, directly). A slash inside a word ("and/or", a URL) is never a trigger. */
export function triggerAt(value: string, cursor: number): { char: '@' | '/'; q: string } | null {
  const before = value.slice(0, cursor);
  const at = before.match(/@(\w*)$/);
  if (at) return { char: '@', q: at[1] };
  const sl = before.match(/(?:^|\s)\/([\w-]*)$/);
  return sl ? { char: '/', q: sl[1] } : null;
}

/** Strip the dangling trigger (nothing was chosen, or a skill was toggled from the `/` list). */
export function stripTrigger(value: string, char: '@' | '/'): string {
  return char === '@' ? value.replace(/@[^@\s]*$/, '') : value.replace(/(^|\s)\/[\w-]*$/, '$1');
}

export function firstName(name: string): string {
  return (name || '').split(' ')[0] || name;
}

export const MANAGE_SKILLS_HREF = '/settings?tab=team';
