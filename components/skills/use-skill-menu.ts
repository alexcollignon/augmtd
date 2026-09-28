'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SKILLS MENU'S ONE READ (W21) — GET /api/skills/chat-menu?actor=<chief|agentId>, shared by the
// composer's Skills list and the header's "uses" line, so the two can never disagree about what is
// always on. One module cache per actor (a reopen paints at once), one flight per actor, and every
// assignment change (`aug:skills-changed`, fired by chat-actions' setSkillAssignment) re-reads.
// The effect depends on the ACTOR only — never on anything that changes per keystroke.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { SKILLS_CHANGED_EVENT } from '@/components/one/chat-actions';
import type { ChatMenuResponse } from './skill-menu-model';

const cache = new Map<string, ChatMenuResponse>();
const inflight = new Map<string, Promise<ChatMenuResponse | null>>();

function readMenu(actor: string, fresh = false): Promise<ChatMenuResponse | null> {
  if (!fresh && inflight.has(actor)) return inflight.get(actor)!;
  const p = fetch(`/api/skills/chat-menu?actor=${encodeURIComponent(actor)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: ChatMenuResponse | null) => {
      if (d && d.actor && Array.isArray(d.skills)) { cache.set(actor, d); return d; }
      return null;
    })
    .catch(() => null)
    .finally(() => { inflight.delete(actor); });
  inflight.set(actor, p);
  return p;
}

export function peekSkillMenu(actor: string | null | undefined): ChatMenuResponse | null {
  return actor ? cache.get(actor) ?? null : null;
}

/** The addressed actor's Skills menu (`null` actor → the feature is off on this surface). */
export function useSkillMenu(actor: string | null | undefined): ChatMenuResponse | null {
  const [menu, setMenu] = useState<{ actor: string; data: ChatMenuResponse } | null>(() => {
    const c = peekSkillMenu(actor);
    return actor && c ? { actor, data: c } : null;
  });
  useEffect(() => {
    if (!actor) return;
    let live = true;
    const land = (d: ChatMenuResponse | null) => { if (live && d) setMenu((prev) => (prev?.data === d ? prev : { actor, data: d })); };
    void readMenu(actor).then(land);
    const onChanged = () => { void readMenu(actor, true).then(land); };
    window.addEventListener(SKILLS_CHANGED_EVENT, onChanged);
    return () => { live = false; window.removeEventListener(SKILLS_CHANGED_EVENT, onChanged); };
  }, [actor]);
  // A menu read for a different actor is never shown for this one (the DM re-aimed).
  if (!actor) return null;
  if (menu && menu.actor === actor) return menu.data;
  return peekSkillMenu(actor);
}

/** The header's skill-name click opens the composer's Skills list AT that skill. */
export const OPEN_SKILLS_MENU_EVENT = 'aug:skills-menu-open';
export function openSkillsMenuAt(skillId?: string) {
  try { window.dispatchEvent(new CustomEvent(OPEN_SKILLS_MENU_EVENT, { detail: { skillId } })); } catch { /* SSR */ }
}
