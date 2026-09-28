'use client';

// Coworker-chat composer with @-mention (Coworkers / Tasks / Documents / Skills). Ported from
// the /work ChatInputBar mention machinery, re-contextualized. Streaming stays in the
// parent — this just emits onSubmit(text, mentions, skills).
//
// SKILLS IN CHAT (W21) — ONE DOOR: the @ menu gains a "Skills" page, and "/" at the start of a word
// opens it directly. The page is components/skills/skill-menu.tsx over the pure model in
// components/skills/skill-menu-model.ts: the addressed actor's assigned skills first and CHECKED
// (unchecking = skip for this message, never an unassign), the rest below (checking = this message
// only). Picks ride as chips and leave with the message as `skills: { add, skip }`, then clear. The
// SAME composer serves the Home chat, every coworker DM and the item/project room.

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  PaperAirplaneIcon, AtSymbolIcon, PaperClipIcon, ChevronRightIcon, ChevronLeftIcon,
  UserCircleIcon, BoltIcon, DocumentTextIcon, AcademicCapIcon,
} from '@heroicons/react/24/outline';
import type { AttachmentChip } from '@/components/work/chat-input-bar';
import { SkillMenu, SkillChips, skillRowDomId } from '@/components/skills/skill-menu';
import { SkillsUsesView } from '@/components/skills/skills-uses-line';
import { useSkillMenu, OPEN_SKILLS_MENU_EVENT } from '@/components/skills/use-skill-menu';
import { useSkillDraft } from '@/components/skills/use-skill-draft';
import { setSkillAssignment } from '@/components/one/chat-actions';
import {
  NO_PICK, chipsOf, dropChip, filterMenu, isEmptyPick, reconcilePick, stripTrigger, toggleSkill, triggerAt,
  type ChatMenuSkill, type SkillPick,
} from '@/components/skills/skill-menu-model';

export interface WorkerMention { id: string; type: 'coworker' | 'task' | 'document'; label: string; subtitle?: string }

function formatBytes(b: number): string {
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// One window drop is claimed by exactly ONE mounted composer (module-level — two visible
// composers must never double-attach the same drop).
const DROP_CLAIMED = new WeakSet<Event>();

const ICONS: Record<WorkerMention['type'], React.ElementType> = { coworker: UserCircleIcon, task: BoltIcon, document: DocumentTextIcon };
const CHIP: Record<WorkerMention['type'], string> = {
  coworker: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  task: 'bg-amber-50 text-amber-700 border-amber-200',
  document: 'bg-violet-50 text-violet-700 border-violet-200',
};
const ICON_BG: Record<WorkerMention['type'], string> = {
  coworker: 'bg-indigo-50 text-indigo-500', task: 'bg-amber-50 text-amber-500', document: 'bg-violet-50 text-violet-500',
};
// One stable empty list — an effect resetting the results must not mint a new array (a fresh [] is never
// Object.is-equal, so React could never bail the update out).
const NO_RESULTS: WorkerMention[] = [];
/** A page of the @ menu: a mention type, or the Skills list (W21). */
type MenuCat = WorkerMention['type'] | 'skill';
const CATEGORIES: { type: MenuCat; label: string }[] = [
  { type: 'coworker', label: 'Coworkers' },
  { type: 'task', label: 'Tasks' },
  { type: 'document', label: 'Documents' },
];
/** The Skills page joins the categories only where the host addressed an actor (`skills` prop). */
const WITH_SKILLS: { type: MenuCat; label: string }[] = [...CATEGORIES, { type: 'skill', label: 'Skills' }];
const CAT_ICONS: Record<MenuCat, React.ElementType> = { ...ICONS, skill: AcademicCapIcon };
const CAT_BG: Record<MenuCat, string> = { ...ICON_BG, skill: 'bg-emerald-50 text-emerald-600' };

/** What the host tells the composer about SKILLS IN CHAT (W21). */
export interface ComposerSkills {
  /** The addressed actor — 'chief' (the Home chat / a room's seat) or a coworker's agent id. */
  actor: string;
  /** The conversation's address — present → "Save this chat as a skill" is offered in the menu. */
  roomKey?: string | null;
  /** Render the actor's "uses: A, B" line in the action row (surfaces with no header band). */
  usesInRow?: boolean;
}

interface Props {
  /** `skills` = the per-message pick ({ add, skip }) — absent when nothing was picked. */
  onSubmit: (text: string, mentions: WorkerMention[], skills?: SkillPick) => void;
  disabled?: boolean;
  placeholder?: string;
  prefill?: string | null;
  onPrefillConsumed?: () => void;
  onAttach?: (files: File[]) => void;
  attachments?: AttachmentChip[];
  onRemoveAttachment?: (id: string) => void;
  /** The HOST owns the frame (border/bg/focus ring) — the component renders only its innards.
      One frame, never a pill inside a pill (the Home floor wraps this in its own chrome). */
  frameless?: boolean;
  /** Host-supplied control rendered in the action row after Attach (e.g. the Home's scope
      chip) — context controls live WITH the composer, not above the conversation. */
  accessory?: React.ReactNode;
  /** SKILLS IN CHAT (W21) — present → the @ menu gains Skills, "/" opens it, picks ride the send. */
  skills?: ComposerSkills;
  /** STOP (W23.A) — present while the host's turn is in flight: the send button becomes Stop (a
      square) and clicking it calls this. The host owns the abort; the composer only offers the door. */
  onStop?: () => void;
}

export function WorkerMentionInput({ onSubmit, disabled, placeholder, prefill, onPrefillConsumed, onAttach, attachments = [], onRemoveAttachment, frameless, accessory, skills, onStop }: Props) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<WorkerMention[]>([]);
  const [mq, setMq] = useState<string | null>(null);
  const [cat, setCat] = useState<MenuCat | null>(null);
  // THE "/" DOOR (W21): the open trigger was a slash at the start of a word — the Skills page, directly.
  // Set by the keystroke HANDLER alongside `mq` (never by an effect).
  const [slash, setSlash] = useState(false);
  // The menu's page is DERIVED, never state an effect keeps in step (it used to be a mode state set to 'items'
  // on every keystroke of an @-query — a passive-effect setState per key; see THE DROPDOWN'S ANCHOR).
  const mode: 'categories' | 'items' = mq === null || (mq === '' && cat === null && !slash) ? 'categories' : 'items';
  // ── SKILLS IN CHAT (W21) ── the actor's menu (one shared read), the per-message pick, the draft door.
  const hasSkills = !!skills?.actor;
  const skillMenu = useSkillMenu(skills?.actor ?? null);
  const [skillPick, setSkillPick] = useState<SkillPick>(NO_PICK);
  const skillDraft = useSkillDraft();
  const skillPage = hasSkills && mq !== null && (slash || cat === 'skill');
  const skillRows: ChatMenuSkill[] = skillPage ? filterMenu(skillMenu?.skills ?? [], mq ?? '') : [];
  const cats = hasSkills ? WITH_SKILLS : CATEGORIES;
  const livePick = reconcilePick(skillPick, skillMenu?.skills);
  const skillChips = hasSkills ? chipsOf(livePick, skillMenu?.skills) : [];
  const [results, setResults] = useState<WorkerMention[]>([]);
  const [idx, setIdx] = useState(0);
  const [loadingItems, setLoadingItems] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rect, setRect] = useState<{ left: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (prefill) { setValue(prefill); onPrefillConsumed?.(); taRef.current?.focus(); }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // auto-resize
    const el = taRef.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => { // close on outside click — strip the dangling @ since nothing was chosen
    if (mq === null) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        const ch = slashRef.current ? '/' : '@';
        setValue(v => stripTrigger(v, ch));
        setMq(null); setCat(null); setSlash(false);
      }
    };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [mq]);

  // The trigger in force, for handlers that outlive a render (the outside click, the header's open).
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const valueRef = useRef(value);
  valueRef.current = value;

  const cacheRef = useRef<Record<string, WorkerMention[]>>({});
  const prefetchedRef = useRef(false);

  const fetchItems = useCallback(async (q: string, type?: WorkerMention['type'], silent = false) => {
    if (!silent) setLoadingItems(true);
    try {
      const p = new URLSearchParams({ q }); if (type) p.set('types', type);
      const res = await fetch(`/api/workers/mentions?${p}`);
      if (res.ok) {
        const items: WorkerMention[] = (await res.json()).results || [];
        setResults(items); setIdx(0);
        if (type && q === '') cacheRef.current[type] = items; // cache each category's default list
      }
    } catch { /* ignore */ } finally { if (!silent) setLoadingItems(false); }
  }, []);

  // Warm the cache the moment the menu opens (one request, split by type) so drilling is instant.
  useEffect(() => {
    if (mq === null || prefetchedRef.current) return;
    prefetchedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/workers/mentions?q=`);
        if (!res.ok) return;
        const all: WorkerMention[] = (await res.json()).results || [];
        cacheRef.current.coworker = all.filter(r => r.type === 'coworker');
        cacheRef.current.task = all.filter(r => r.type === 'task');
        cacheRef.current.document = all.filter(r => r.type === 'document');
      } catch { /* ignore */ }
    })();
  }, [mq]);

  useEffect(() => {
    if (mq === null) { setResults(NO_RESULTS); setCat(null); return; }
    // The Skills page reads the actor's skill menu, never the mention search.
    if (slash || cat === 'skill') return;
    if (mq === '' && cat === null) { setResults(NO_RESULTS); return; }
    // Cache hit for a category's default list → render instantly, refresh silently.
    const cached = cat && mq === '' ? cacheRef.current[cat as WorkerMention['type']] : undefined;
    if (cached) { setResults(cached); setIdx(0); }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchItems(mq, (cat as WorkerMention['type'] | null) ?? undefined, !!cached), cat ? 0 : 180);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [mq, cat, slash, fetchItems]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value; setValue(v);
    const trig = triggerAt(v, e.target.selectionStart ?? v.length);
    // "/" is a trigger only where skills are on; elsewhere the composer reads exactly as before.
    const isSlash = hasSkills && trig?.char === '/';
    const q = trig && (trig.char === '@' || isSlash) ? trig.q : null;
    // The Skills page keeps its seat while its query is typed (it filters the list in place).
    if (q !== mq && cat !== 'skill') setCat(null);
    if (isSlash && !slash) setIdx(0);
    setMq(q); setSlash(isSlash);
  }

  // ── SKILLS IN CHAT (W21) — the handlers (events only; nothing here runs from an effect) ────────
  const closeSkillMenu = () => {
    const ch = slash ? '/' : '@';
    setValue(v => stripTrigger(v, ch));
    setMq(null); setCat(null); setSlash(false);
  };
  const toggleSkillRow = (s: ChatMenuSkill) => setSkillPick(p => toggleSkill(reconcilePick(p, skillMenu?.skills), s));
  const assignSkillRow = (s: ChatMenuSkill) => {
    if (!skillMenu) return;
    void setSkillAssignment({ id: s.id, name: s.name }, skillMenu.actor, !s.assigned);
  };
  const saveAsSkill = skills?.roomKey ? () => { closeSkillMenu(); void skillDraft.open(skills.roomKey as string); } : undefined;
  /** OPEN THE SKILLS LIST (AT a skill) — the header's "uses" names and the in-row line call this: a "/"
   *  lands at the caret's word start, exactly as the Mention button lands an "@". */
  const openSkillsAt = (skillId?: string) => {
    const el = taRef.current; if (!el || !hasSkills) return;
    const v = valueRef.current;
    const pos = el.selectionStart ?? v.length;
    const lead = pos > 0 && !/\s/.test(v[pos - 1]) ? ' ' : '';
    setValue(v.slice(0, pos) + lead + '/' + v.slice(pos));
    const at = skillId ? filterMenu(skillMenu?.skills ?? [], '').findIndex(x => x.id === skillId) : 0;
    setMq(''); setCat(null); setSlash(true); setIdx(Math.max(0, at));
    const caret = pos + lead.length + 1;
    setTimeout(() => {
      el.focus(); el.setSelectionRange(caret, caret);
      if (skillId) document.getElementById(skillRowDomId(skillId))?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };
  const openSkillsAtRef = useRef(openSkillsAt);
  openSkillsAtRef.current = openSkillsAt;
  // The header's click is a window event (the header lives outside this box): the VISIBLE composer
  // claims it — a hidden one (a lens behind the page) never opens a menu nobody sees.
  useEffect(() => {
    if (!hasSkills) return;
    const onOpen = (e: Event) => {
      if (!wrapRef.current || wrapRef.current.offsetParent === null) return;
      if (DROP_CLAIMED.has(e)) return;
      DROP_CLAIMED.add(e);
      openSkillsAtRef.current((e as CustomEvent<{ skillId?: string }>).detail?.skillId);
    };
    window.addEventListener(OPEN_SKILLS_MENU_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SKILLS_MENU_EVENT, onOpen);
  }, [hasSkills]);

  function pick(m: WorkerMention) {
    const cursor = taRef.current?.selectionStart ?? value.length;
    setValue(value.slice(0, cursor).replace(/@\w*$/, '') + value.slice(cursor));
    setMq(null); setResults([]); setCat(null);
    setMentions(prev => prev.find(x => x.id === m.id && x.type === m.type) ? prev : [...prev, m]);
    taRef.current?.focus();
  }
  const removeMention = (id: string, type: string) => setMentions(prev => prev.filter(m => !(m.id === id && m.type === type)));

  function submit() {
    const t = value.trim();
    if (!t || disabled) return;
    // The picks leave WITH the message and clear after it (a pick is per message, never sticky).
    onSubmit(t, mentions, hasSkills && !isEmptyPick(livePick) ? livePick : undefined);
    setValue(''); setMentions([]); setMq(null); setCat(null); setSlash(false); setSkillPick(NO_PICK);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mq !== null) {
      const list: readonly unknown[] = mode === 'categories' ? cats : skillPage ? skillRows : results;
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, list.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (slash) closeSkillMenu();
        else if (cat) { setCat(null); setIdx(0); } else setMq(null);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (mode === 'categories') { setCat(cats[idx].type); setIdx(0); }
        // Enter on a skill toggles it and closes the list (the typed "/query" goes with it).
        else if (skillPage) { if (skillRows[idx]) { toggleSkillRow(skillRows[idx]); closeSkillMenu(); } }
        else if (results.length) pick(results[idx]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  // THE DROPDOWN'S ANCHOR — measured only while the menu is open, and set only when it MOVED.
  // NO SETSTATE PER KEYSTROKE IN AN EFFECT (the fast-typing crash, Sep 28): this effect used to
  // run `setRect(null)` on every keystroke with the menu closed. A passive-effect setState after a
  // discrete (keystroke) commit lands in the DEFAULT lane; during a fast burst the browser runs input
  // tasks ahead of React's scheduler task, so that Default update stays pending across every
  // keystroke commit — and React counts each such commit as a nested update. ~50 keys later the next
  // `setValue` threw "Maximum update depth exceeded" and that character was lost. The dropdown is
  // gated on `mq !== null`, so a stale rect with the menu closed is never read; the open re-measures.
  const rectRef = useRef(rect);
  rectRef.current = rect;
  useEffect(() => {
    if (mq === null || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const prev = rectRef.current;
    if (prev && prev.left === r.left && prev.right === r.right && prev.bottom === r.top) return;
    setRect({ left: r.left, right: r.right, bottom: r.top });
  }, [mq, value]);

  const dropdown = mq !== null && rect && typeof document !== 'undefined' ? createPortal(
    <div
      style={{ position: 'fixed', left: rect.left, width: rect.right - rect.left, bottom: window.innerHeight - rect.bottom + 8, maxHeight: rect.bottom - 16, zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
      className="bg-white rounded-xl shadow-lg border border-neutral-200 overflow-y-auto"
    >
      {mode === 'categories' ? (
        <div>
          <div className="px-3 py-2 border-b border-neutral-100"><p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Mention</p></div>
          {cats.map((c, i) => {
            const Icon = CAT_ICONS[c.type];
            return (
              <button key={c.type} onMouseDown={e => { e.preventDefault(); setCat(c.type); setIdx(0); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${i === idx ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${CAT_BG[c.type]}`}><Icon className="w-3.5 h-3.5" /></div>
                <span className="flex-1 text-[13px] font-medium text-neutral-700">{c.label}</span>
                <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300" />
              </button>
            );
          })}
        </div>
      ) : skillPage ? (
        <SkillMenu
          actorName={skillMenu?.actor.name ?? 'them'}
          skills={skillRows}
          pick={livePick}
          activeIdx={idx}
          loading={!skillMenu}
          onToggle={toggleSkillRow}
          onAssign={assignSkillRow}
          {...(!slash ? { onBack: () => { setCat(null); setIdx(0); } } : {})}
          {...(saveAsSkill ? { onSaveAsSkill: saveAsSkill } : {})}
        />
      ) : (
        <div>
          {cat && (
            <button onMouseDown={e => { e.preventDefault(); setCat(null); setResults([]); setIdx(0); }}
              className="w-full flex items-center gap-2 px-3 py-2 border-b border-neutral-100 hover:bg-neutral-50 text-left">
              <ChevronLeftIcon className="w-3.5 h-3.5 text-neutral-400" />
              <span className="text-[12px] font-medium text-neutral-500">{cats.find(c => c.type === cat)?.label}</span>
            </button>
          )}
          <div className="max-h-[240px] overflow-y-auto">
            {loadingItems && results.length === 0 && <div className="px-3 py-3 text-[12px] text-neutral-400">Searching…</div>}
            {!loadingItems && results.length === 0 && <div className="px-3 py-3 text-[12px] text-neutral-400">No results</div>}
            {results.map((r, i) => {
              const Icon = ICONS[r.type];
              return (
                <button key={`${r.type}:${r.id}`} onMouseDown={e => { e.preventDefault(); pick(r); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${i === idx ? 'bg-indigo-50' : 'hover:bg-neutral-50'}`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${ICON_BG[r.type]}`}><Icon className="w-3.5 h-3.5" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium text-neutral-800 truncate">{r.label}</p>
                    {r.subtitle && <p className="text-[11px] text-neutral-400 truncate">{r.subtitle}</p>}
                  </div>
                  {!cat && <span className="text-[10.5px] text-neutral-300 capitalize">{r.type}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>, document.body) : null;

  function toggleMention() {
    // Clicking Mention again (dropdown open) closes it and strips the dangling @.
    if (mq !== null) {
      const ch = slash ? '/' : '@';
      setValue(v => stripTrigger(v, ch));
      setMq(null); setCat(null); setSlash(false);
      return;
    }
    const el = taRef.current; if (!el) return;
    const pos = el.selectionStart ?? value.length;
    setValue(value.slice(0, pos) + '@' + value.slice(pos));
    setMq(''); setCat(null); setSlash(false); setIdx(0);
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); }, 0);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) onAttach?.(files);
  }

  // DRAG-AND-DROP ATTACH (Aug 10, hardened same day — "docx, pptx don't work"): the WHOLE
  // WINDOW is the drop zone while this composer is mounted — a drop that misses the composer
  // box must attach, never browser-navigate away and lose the conversation. Accepted types =
  // everything the text-extractor reads (Office, CSV included); a rejected file says so out
  // loud instead of vanishing silently. One composer, so every chat box gets all of it at once.
  const [dragOver, setDragOver] = useState(false);
  const ACCEPT_RE = /\.(pdf|docx?|xlsx|pptx|csv|txt|jpe?g|png|webp|zip)$/i;
  useEffect(() => {
    if (!onAttach || disabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const visible = () => !!wrapRef.current && wrapRef.current.offsetParent !== null;
    const enter = (e: DragEvent) => { if (!hasFiles(e) || !visible()) return; e.preventDefault(); depth += 1; setDragOver(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDragOver(false);
      if (!visible() || DROP_CLAIMED.has(e)) return;
      DROP_CLAIMED.add(e);
      const all = Array.from(e.dataTransfer?.files ?? []);
      const files = all.filter((f) => ACCEPT_RE.test(f.name));
      const skipped = all.filter((f) => !ACCEPT_RE.test(f.name));
      if (skipped.length) {
        void import('sonner').then(({ toast }) =>
          toast.error(`Not supported: ${skipped.map((f) => f.name).join(', ')} — PDF, Word, Excel, PowerPoint, CSV, text, images, or ZIP.`));
      }
      if (files.length) onAttach(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAttach, disabled]);

  const hasChips = mentions.length > 0 || attachments.length > 0 || skillChips.length > 0;

  return (
    <div className="relative" ref={wrapRef}>
      {dropdown}
      {skillDraft.node}
      {dragOver && onAttach && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/90 pointer-events-none">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-indigo-600">
            <PaperClipIcon className="w-4 h-4" /> Drop files to attach
          </span>
        </div>
      )}
      <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.xlsx,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp,.zip" className="hidden" onChange={handleFileChange} />
      <div className={frameless ? '' : 'rounded-2xl bg-neutral-50 border border-neutral-200 overflow-hidden focus-within:border-neutral-300 focus-within:bg-white focus-within:shadow-sm transition-all duration-150'}>
        {hasChips && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {mentions.map(m => {
              const Icon = ICONS[m.type];
              return (
                <div key={`${m.type}:${m.id}`} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[12px] ${CHIP[m.type]}`}>
                  <Icon className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">{m.label}</span>
                  <button onClick={() => removeMention(m.id, m.type)} className="opacity-60 hover:opacity-100 ml-0.5">×</button>
                </div>
              );
            })}
            <SkillChips chips={skillChips} onRemove={(c) => setSkillPick(p => dropChip(reconcilePick(p, skillMenu?.skills), c))} />
            {attachments.map(att => (
              <div key={att.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 rounded-lg text-[12px] text-neutral-700">
                {att.isUploading ? (
                  <svg className="w-3 h-3 text-neutral-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : <PaperClipIcon className="w-3 h-3 text-neutral-400" />}
                <span className="max-w-[120px] truncate">{att.name}</span>
                {!att.isUploading && <span className="text-neutral-400">{formatBytes(att.size)}</span>}
                {onRemoveAttachment && <button onClick={() => onRemoveAttachment(att.id)} className="text-neutral-400 hover:text-neutral-600 ml-0.5">×</button>}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef} value={value} onChange={onChange} onKeyDown={onKeyDown}
          placeholder={placeholder} rows={1} disabled={disabled}
          className="w-full resize-none px-4 pt-3 pb-2 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 bg-transparent outline-none leading-relaxed disabled:opacity-50"
          style={{ minHeight: '44px', maxHeight: '180px' }}
        />
        <div className="flex items-center px-3 pb-2.5">
          <button onClick={toggleMention} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors">
            <AtSymbolIcon className="w-3.5 h-3.5" /> Mention
          </button>
          {onAttach && (
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors">
              <PaperClipIcon className="w-3.5 h-3.5" /> Attach
            </button>
          )}
          {accessory}
          {/* The actor's always-on skills, quietly — on surfaces with no header band to carry them. */}
          {skills?.usesInRow && (
            <>
              <span className="flex-1" />
              <SkillsUsesView skills={skillMenu?.skills} onOpen={(id) => openSkillsAt(id)} className="mr-2 max-w-[45%]" />
            </>
          )}
          {onStop ? (
            <button type="button" onClick={onStop} aria-label="Stop" title="Stop"
              className="ml-auto flex items-center justify-center w-7 h-7 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors">
              <span aria-hidden className="block h-2.5 w-2.5 rounded-[2px] bg-current" />
            </button>
          ) : (
            <button onClick={submit} disabled={disabled || !value.trim()}
              className="ml-auto flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors">
              <PaperAirplaneIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
