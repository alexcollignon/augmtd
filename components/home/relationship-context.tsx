'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderIcon, CheckCircleIcon, CalendarDaysIcon, EnvelopeIcon, ChevronDownIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

type EntityContext = {
  initiative: { label: string | null; variants: string[] };
  relationship: { name: string | null; frequency: string | null } | null;
  openCommitments: { id: string; description: string; direction: string; dueDate: string | null }[];
  recentMeetings: { id: string; title: string; date: string | null }[];
  upcomingMeetings: { id: string; title: string; startTime: string | null }[];
  recentThreads: { itemId: string; subject: string; lastAt: string | null }[];
};

// The Person Brain state (S1c) — "who is this + where you stand", from the durable person_state.
type PersonState = {
  summary: string; relationship: string;
  momentum: 'active' | 'waiting_on_them' | 'you_owe' | 'gone_quiet';
  cadence: string | null; whoOwes: { you: string[]; them: string[] }; style: string | null;
};
type Person = { key: string; name: string | null; org: string | null; isInternal: boolean; state: PersonState; nextTouch: { kind: string; title: string; reason: string; entityRef: string | null } | null; quietDays: number | null };
// The item's INITIATIVE verdict (lib/brains/verdict.ts) — where the DEAL stands + the ONE next move (the SAME
// string the deck bundle + project header show — the through-line).
type Deal = { label: string; momentum: string; summary: string | null; nextMove: { title: string; entityRef: string | null } | null };
const DEAL_MOM: Record<string, { label: string; cls: string }> = {
  needs_you:  { label: 'Needs you',  cls: 'text-rose-600' },
  gone_quiet: { label: 'Gone quiet', cls: 'text-amber-600' },
  stalled:    { label: 'Stalled',    cls: 'text-rose-600' },
  waiting:    { label: 'Waiting',    cls: 'text-blue-600' },
  active:     { label: 'Active',     cls: 'text-emerald-600' },
};
const MOM: Record<PersonState['momentum'], { label: string; cls: string }> = {
  active:          { label: 'Active',          cls: 'text-emerald-600' },
  waiting_on_them: { label: 'Waiting on them', cls: 'text-blue-600' },
  you_owe:         { label: 'You owe',         cls: 'text-rose-600' },
  gone_quiet:      { label: 'Gone quiet',      cls: 'text-amber-600' },
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : '');

// The human context rail — "About this": read a mail the way a person does, inside its web of relationships.
// The deal (+ the Add-to-project control already in the header), open commitments with them, last/next
// meeting, related threads. Same assembly the classifier uses (lib/context/entity-context), served read-only.
export default function RelationshipContext({ kind, id }: { kind: string; id: string }) {
  const cacheKey = `aug-item-context-${kind}-${id}`;
  const personKeyLS = `aug-item-person-${kind}-${id}`;
  const dealKeyLS = `aug-item-deal-${kind}-${id}`;
  const [ctx, setCtx] = useState<EntityContext | null>(() => loadLS<EntityContext>(cacheKey));
  const [person, setPerson] = useState<Person | null>(() => loadLS<Person>(personKeyLS));
  const [deal, setDeal] = useState<Deal | null>(() => loadLS<Deal>(dealKeyLS));
  const [loaded, setLoaded] = useState<boolean>(() => !!loadLS<EntityContext>(cacheKey));
  const [open, setOpen] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch(`/api/items/${id}/context?kind=${encodeURIComponent(kind)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setCtx(d.context ?? null); setPerson(d.person ?? null); setDeal(d.deal ?? null); setLoaded(true);
        if (d.context) saveLS(cacheKey, d.context);
        if (d.person) saveLS(personKeyLS, d.person);
        if (d.deal) saveLS(dealKeyLS, d.deal);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [id, kind, cacheKey, personKeyLS, dealKeyLS]);

  if (!loaded && !ctx && !person && !deal) return null;
  const hasCtx = !!ctx && (ctx.initiative.label || ctx.openCommitments.length || ctx.recentMeetings.length || ctx.upcomingMeetings.length || ctx.recentThreads.length);
  if (!hasCtx && !person && !deal) return null;
  const mom = person ? (MOM[person.state.momentum] ?? MOM.active) : null;
  const dmom = deal ? (DEAL_MOM[deal.momentum] ?? DEAL_MOM.active) : null;
  const dealHref = (ref: string | null) => { if (!ref) return null; const [k, i] = ref.split(':'); return k === 'inbox' ? `/item/${i}?kind=email` : k === 'commit' ? `/item/${i}?kind=commitment` : k === 'meeting' ? `/item/${i}?kind=meeting` : null; };

  const Row = ({ icon: Icon, tone, children }: { icon: typeof FolderIcon; tone: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-2 py-1">
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${tone}`} />
      <div className="min-w-0 flex-1 text-[12.5px] text-neutral-700 leading-snug">{children}</div>
    </div>
  );

  return (
    <div className="rounded-xl border border-neutral-200/70 bg-white">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">About this</span>
        {ctx?.initiative.label && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-medium text-indigo-600">
            <FolderIcon className="w-2.5 h-2.5" /><span className="max-w-[160px] truncate">{ctx.initiative.label}</span>
          </span>
        )}
        <ChevronDownIcon className={`w-3.5 h-3.5 ml-auto text-neutral-300 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3 pt-0.5 space-y-0.5 border-t border-neutral-100">
          {/* WHO IS THIS — the Person Brain state (S1c): who they are + where you stand + who owes whom. */}
          {person && mom && (
            <div className="flex items-start gap-2 py-1.5">
              <UserCircleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-indigo-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12.5px] font-semibold text-neutral-800 truncate">{person.name || person.key}</span>
                  {person.state.relationship !== 'unknown' && <span className="text-[10.5px] text-neutral-400 capitalize">{person.state.relationship}</span>}
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${mom.cls}`}>{mom.label}{person.state.momentum === 'gone_quiet' && person.quietDays ? ` ${person.quietDays}d` : ''}</span>
                </div>
                <p className="text-[12px] text-neutral-600 leading-snug mt-0.5">{person.state.summary}</p>
                {person.state.whoOwes.you.length > 0 && <p className="text-[11.5px] text-neutral-500 mt-0.5 leading-snug"><span className="text-rose-500">You owe · </span>{person.state.whoOwes.you.join(' · ')}</p>}
                {person.state.whoOwes.them.length > 0 && <p className="text-[11.5px] text-neutral-500 leading-snug"><span className="text-blue-500">They owe · </span>{person.state.whoOwes.them.join(' · ')}</p>}
                {person.nextTouch && <p className="text-[11.5px] font-medium text-indigo-600 mt-0.5 leading-snug">→ {person.nextTouch.title}</p>}
                {person.state.cadence && <p className="text-[11px] text-neutral-400 mt-0.5">{person.state.cadence}</p>}
              </div>
            </div>
          )}
          {/* THE DEAL — the initiative brain's verdict: where it stands + THE one next move (same string as
              the deck bundle + project header — the through-line). */}
          {deal && dmom && (
            <div className="flex items-start gap-2 py-1.5">
              <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-indigo-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12.5px] font-semibold text-neutral-800 truncate">{deal.label}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${dmom.cls}`}>{dmom.label}</span>
                </div>
                {deal.summary && <p className="text-[12px] text-neutral-600 leading-snug mt-0.5">{deal.summary}</p>}
                {deal.nextMove && (
                  <button
                    onClick={() => { const h = dealHref(deal.nextMove!.entityRef); if (h) router.push(h); }}
                    className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors text-left"
                  >→ {deal.nextMove.title}</button>
                )}
              </div>
            </div>
          )}
          {ctx && ctx.openCommitments.length > 0 && (
            <Row icon={CheckCircleIcon} tone="text-amber-500">
              <p className="text-[11px] font-medium text-neutral-400 mb-0.5">Open commitments</p>
              {ctx.openCommitments.slice(0, 4).map((c) => (
                <p key={c.id} className="truncate">
                  <span className="text-neutral-400">{c.direction === 'awaiting' ? 'they owe · ' : 'you owe · '}</span>
                  {c.description}{c.dueDate ? <span className="text-neutral-400"> (due {fmtDate(c.dueDate)})</span> : null}
                </p>
              ))}
            </Row>
          )}
          {ctx && (ctx.recentMeetings.length > 0 || ctx.upcomingMeetings.length > 0) && (
            <Row icon={CalendarDaysIcon} tone="text-violet-500">
              {ctx.upcomingMeetings.slice(0, 2).map((m) => (
                <button key={m.id} onClick={() => router.push(`/item/${m.id}?kind=meeting`)} className="block truncate hover:text-indigo-600 text-left">
                  <span className="text-neutral-400">next · </span>{m.title}{m.startTime ? <span className="text-neutral-400"> ({fmtDate(m.startTime)})</span> : null}
                </button>
              ))}
              {ctx.recentMeetings.slice(0, 2).map((m) => (
                <button key={m.id} onClick={() => router.push(`/item/${m.id}?kind=meeting`)} className="block truncate hover:text-indigo-600 text-left">
                  <span className="text-neutral-400">met · </span>{m.title}{m.date ? <span className="text-neutral-400"> ({fmtDate(m.date)})</span> : null}
                </button>
              ))}
            </Row>
          )}
          {ctx && ctx.recentThreads.length > 0 && (
            <Row icon={EnvelopeIcon} tone="text-blue-500">
              <p className="text-[11px] font-medium text-neutral-400 mb-0.5">Related threads</p>
              {ctx.recentThreads.slice(0, 4).map((t) => (
                <button key={t.itemId} onClick={() => router.push(`/item/${t.itemId}?kind=email`)} className="block truncate hover:text-indigo-600 text-left w-full">
                  {t.subject}
                </button>
              ))}
            </Row>
          )}
        </div>
      )}
    </div>
  );
}
