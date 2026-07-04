'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeftIcon, ChevronRightIcon, XMarkIcon, VideoCameraIcon, MapPinIcon,
  CalendarIcon, CheckCircleIcon, BellAlertIcon, ArrowRightIcon, UsersIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui';
import type { CalendarItem, CalendarItemType } from '@/app/api/calendar/route';

const HOUR_HEIGHT = 56;
const START_HOUR = 7;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const GUTTER_WIDTH = 48;

// ── Color language per item type ─────────────────────────────────────────────
// indigo/violet = meetings · amber = commitments due (red when overdue) · soft blue = follow-up nudge.
const TYPE_STYLE: Record<CalendarItemType, { dot: string; bg: string; border: string; text: string; label: string }> = {
  meeting:    { dot: 'bg-indigo-500', bg: 'bg-indigo-50',  border: 'border-indigo-200',  text: 'text-indigo-900',  label: 'Meeting' },
  commitment: { dot: 'bg-amber-500',  bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-900',   label: 'Due' },
  followup:   { dot: 'bg-sky-500',    bg: 'bg-sky-50',     border: 'border-sky-200',     text: 'text-sky-900',     label: 'Follow-up' },
};
const OVERDUE_STYLE = { dot: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-900', label: 'Overdue' };

function styleFor(item: CalendarItem) {
  if (item.type === 'commitment' && item.meta.overdue) return OVERDUE_STYLE;
  return TYPE_STYLE[item.type];
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-first
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// ── Overlap layout for timed (meeting) blocks within a day ───────────────────
interface Laid { item: CalendarItem; col: number; numCols: number }
function layoutTimed(items: CalendarItem[]): Laid[] {
  if (items.length === 0) return [];
  const withTimes = items.map((item) => ({
    item,
    start: new Date(item.time!).getTime(),
    end: item.endTime ? new Date(item.endTime).getTime() : new Date(item.time!).getTime() + 30 * 60000,
  })).sort((a, b) => a.start - b.start);
  const colEnds: number[] = [];
  const assigned: { item: CalendarItem; start: number; end: number; col: number }[] = [];
  for (const e of withTimes) {
    let col = colEnds.findIndex((end) => end <= e.start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = e.end;
    assigned.push({ ...e, col });
  }
  return assigned.map((a) => {
    const overlapping = assigned.filter((o) => o.start < a.end && o.end > a.start);
    const numCols = Math.max(...overlapping.map((o) => o.col)) + 1;
    return { item: a.item, col: a.col, numCols };
  });
}

// ── Detail popover — action per item type ────────────────────────────────────
function ItemPopover({ item, style, onClose, onResolved }: {
  item: CalendarItem;
  style: { left: number; top: number };
  onClose: () => void;
  onResolved: (id: string) => void; // remove the item from the grid after a done/dismiss/nudge-send
}) {
  const ref = useRef<HTMLDivElement>(null);
  const s = styleFor(item);
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState<{ open: boolean; loading: boolean; body: string; sending: boolean; err: string | null }>(
    { open: false, loading: false, body: '', sending: false, err: null }
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [onClose]);

  // Commitment: mark done / dismiss.
  const setCommitment = async (status: 'done' | 'dismissed') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/commitments/${item.entityId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (res.ok) { toast.success(status === 'done' ? 'Marked done' : 'Dismissed'); onResolved(item.id); }
      else { toast.error('Could not update'); setBusy(false); }
    } catch { toast.error('Could not update'); setBusy(false); }
  };

  // Follow-up: draft a nudge, then send it (which also closes the commitment).
  const draftNudge = async () => {
    setNudge((n) => ({ ...n, open: true, loading: true, err: null }));
    try {
      const res = await fetch(`/api/commitments/${item.entityId}/nudge`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      setNudge((n) => ({ ...n, loading: false, body: d.draft || 'Could not draft a nudge.' }));
    } catch { setNudge((n) => ({ ...n, loading: false, body: 'Could not draft a nudge.' })); }
  };
  const sendNudge = async () => {
    setNudge((n) => ({ ...n, sending: true, err: null }));
    try {
      const res = await fetch(`/api/commitments/${item.entityId}/nudge`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: nudge.body }),
      });
      if (res.ok) { toast.success('Nudge sent'); onResolved(item.id); }
      else { const d = await res.json().catch(() => ({})); setNudge((n) => ({ ...n, sending: false, err: d.error || 'Could not send.' })); }
    } catch { setNudge((n) => ({ ...n, sending: false, err: 'Could not send.' })); }
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-neutral-200 shadow-2xl rounded-2xl flex flex-col"
      style={{ left: style.left, top: style.top, width: 320 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div className="flex items-start gap-2 flex-1 pr-2 min-w-0">
          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{s.label}</p>
            <h3 className="text-[15px] font-bold text-neutral-900 leading-snug break-words">{item.title}</h3>
          </div>
        </div>
        <IconButton onClick={onClose}><XMarkIcon className="w-4 h-4" /></IconButton>
      </div>

      <div className="px-4 pb-4 space-y-2.5">
        {/* When */}
        {item.type === 'meeting' && item.time && (
          <div className="flex items-start gap-2 text-[13px] text-neutral-600">
            <CalendarIcon className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
            <div>
              <div>{new Date(item.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
              <div className="text-neutral-400 mt-0.5">{timeOf(item.time)}{item.endTime ? ` – ${timeOf(item.endTime)}` : ''}</div>
            </div>
          </div>
        )}
        {item.type === 'commitment' && (
          <div className="flex items-center gap-2 text-[13px] text-neutral-600">
            <CalendarIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
            <span className={item.meta.overdue ? 'text-red-600 font-medium' : ''}>
              {item.meta.overdue ? 'Overdue' : 'Due'}{item.meta.dueDate ? ` · ${new Date(item.meta.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
            </span>
          </div>
        )}
        {item.type === 'followup' && (
          <div className="flex items-center gap-2 text-[13px] text-neutral-600">
            <BellAlertIcon className="w-4 h-4 text-sky-500 flex-shrink-0" />
            <span>Gone quiet{typeof item.meta.ageDays === 'number' ? ` · ${item.meta.ageDays}d` : ''}</span>
          </div>
        )}

        {/* Meeting extras */}
        {item.type === 'meeting' && item.meta.meetingLink && (
          <a href={item.meta.meetingLink} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 text-[13px] text-blue-600 hover:underline font-medium">
            <VideoCameraIcon className="w-4 h-4 flex-shrink-0" />
            Join {item.meta.meetingLink.includes('teams.microsoft') ? 'Teams' : 'Google Meet'}
          </a>
        )}
        {item.type === 'meeting' && item.meta.location && (
          <div className="flex items-center gap-2 text-[13px] text-neutral-500">
            <MapPinIcon className="w-4 h-4 flex-shrink-0 text-neutral-400" />{item.meta.location}
          </div>
        )}
        {item.type === 'meeting' && !!item.meta.attendees && (
          <div className="flex items-center gap-2 text-[13px] text-neutral-500">
            <UsersIcon className="w-4 h-4 flex-shrink-0 text-neutral-400" />
            {item.meta.attendees} {item.meta.attendees === 1 ? 'other attendee' : 'others'}
          </div>
        )}

        {/* Counterparty for commitments / follow-ups */}
        {(item.type === 'commitment' || item.type === 'followup') && item.meta.counterparty && (
          <p className="text-[12.5px] text-neutral-500">
            {item.type === 'followup' ? 'Waiting on ' : 'With '}{item.meta.counterparty}
          </p>
        )}

        {/* Actions */}
        {item.type === 'meeting' && (
          <Link href={`/meetings/${item.entityId}`}
            className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 hover:text-indigo-700">
            Open meeting <ArrowRightIcon className="w-3.5 h-3.5" />
          </Link>
        )}

        {item.type === 'commitment' && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => setCommitment('done')} disabled={busy} className="flex-1">
              {busy ? '…' : 'Mark done'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCommitment('dismissed')} disabled={busy}>
              Dismiss
            </Button>
          </div>
        )}

        {item.type === 'followup' && (
          <div className="pt-1">
            {!nudge.open ? (
              <Button size="sm" onClick={draftNudge} className="w-full">Draft nudge</Button>
            ) : nudge.loading ? (
              <p className="text-[12px] text-neutral-400">Drafting…</p>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={nudge.body}
                  onChange={(e) => setNudge((n) => ({ ...n, body: e.target.value }))}
                  rows={5}
                  className="w-full text-[12.5px] text-neutral-700 border border-neutral-200 rounded-lg p-2 outline-none focus:border-indigo-300 resize-none leading-relaxed"
                />
                {nudge.err && <p className="text-[11px] text-red-500">{nudge.err}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={sendNudge} disabled={nudge.sending} className="flex-1">
                    {nudge.sending ? 'Sending…' : 'Send nudge'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setNudge((n) => ({ ...n, open: false }))}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  const rows: { dot: string; label: string }[] = [
    { dot: TYPE_STYLE.meeting.dot, label: 'Meeting' },
    { dot: TYPE_STYLE.commitment.dot, label: 'Due' },
    { dot: OVERDUE_STYLE.dot, label: 'Overdue' },
    { dot: TYPE_STYLE.followup.dot, label: 'Follow-up' },
  ];
  return (
    <div className="flex items-center gap-3.5">
      {rows.map((r) => (
        <span key={r.label} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <span className={`w-2 h-2 rounded-full ${r.dot}`} />{r.label}
        </span>
      ))}
    </div>
  );
}

// ── All-day chip (commitments / follow-ups sit in the header band above the grid) ──
function AllDayChip({ item, onOpen }: { item: CalendarItem; onOpen: (item: CalendarItem, x: number, y: number) => void }) {
  const s = styleFor(item);
  const Icon = item.type === 'followup' ? BellAlertIcon : CheckCircleIcon;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(item, e.clientX, e.clientY); }}
      className={`w-full flex items-center gap-1 rounded-md border px-1.5 py-1 text-left transition-colors hover:brightness-95 ${s.bg} ${s.border} ${s.text}`}
      title={item.title}
    >
      <Icon className="w-3 h-3 flex-shrink-0 opacity-80" />
      <span className="text-[10.5px] font-medium leading-tight truncate">{item.title}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
export default function UnifiedCalendar() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ item: CalendarItem; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const baseWeekStart = getWeekStart(now);
  const weekStart = new Date(baseWeekStart);
  weekStart.setDate(baseWeekStart.getDate() + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const from = localDay(days[0]);
  const to = localDay(days[6]);
  const isCurrentWeek = weekOffset === 0;

  // ── LIVE fetch — reads the source tables per visible week, no cache. Refetches on week change. ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar?from=${from}&to=${to}`, { cache: 'no-store' });
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // Scroll the grid to roughly "now" on the current week.
  useEffect(() => {
    if (!scrollRef.current || !isCurrentWeek) return;
    const nowMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
    scrollRef.current.scrollTop = Math.max(0, (nowMinutes / 60) * HOUR_HEIGHT - 120);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = items.filter((i) => !resolved.has(i.id));
  const onResolved = (id: string) => { setResolved((s) => new Set(s).add(id)); setSelected(null); };
  const openItem = (item: CalendarItem, x: number, y: number) => setSelected({ item, x, y });

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);
  const nowMinutesFromStart = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const nowTop = (nowMinutesFromStart / 60) * HOUR_HEIGHT;
  const showNowLine = isCurrentWeek && nowMinutesFromStart >= 0 && nowMinutesFromStart <= TOTAL_HOURS * 60;

  const weekLabel = `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  // Popover placement.
  const popStyle = selected ? (() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const pw = 320;
    const left = selected.x + 16 + pw > vw ? selected.x - pw - 16 : selected.x + 16;
    const top = Math.min(Math.max(8, selected.y - 40), vh - 380);
    return { left: Math.max(8, left), top };
  })() : { left: 0, top: 0 };

  return (
    <div className="flex flex-col h-full">
      {/* Header — week nav + legend */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-neutral-100 bg-white">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <IconButton onClick={() => setWeekOffset((o) => o - 1)} size="sm"><ChevronLeftIcon className="w-4 h-4" /></IconButton>
            <span className="text-[13px] font-semibold text-neutral-700 min-w-[172px] text-center">{weekLabel}</span>
            <IconButton onClick={() => setWeekOffset((o) => o + 1)} size="sm"><ChevronRightIcon className="w-4 h-4" /></IconButton>
          </div>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="text-[12px] font-medium text-indigo-600 hover:underline">Today</button>
          )}
          {loading && <span className="text-[11px] text-neutral-300">Loading…</span>}
        </div>
        <Legend />
      </div>

      {/* Day headers + all-day band */}
      <div className="flex-shrink-0 border-b border-neutral-100 bg-white">
        <div className="flex" style={{ paddingLeft: GUTTER_WIDTH }}>
          {days.map((day) => {
            const isToday = day.toDateString() === now.toDateString();
            return (
              <div key={day.toISOString()} className="flex-1 py-2 text-center border-l border-neutral-50 first:border-l-0">
                <p className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-indigo-500' : 'text-neutral-400'}`}>
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </p>
                <p className={`text-[15px] font-semibold leading-tight mt-0.5 ${isToday ? 'text-white bg-indigo-600 w-7 h-7 rounded-full flex items-center justify-center mx-auto' : 'text-neutral-800'}`}>
                  {day.getDate()}
                </p>
              </div>
            );
          })}
        </div>
        {/* All-day markers (commitments due + follow-up nudges) — stacked chips per day */}
        <div className="flex" style={{ paddingLeft: GUTTER_WIDTH }}>
          {days.map((day) => {
            const dayStr = localDay(day);
            const allDay = visible.filter((i) => i.date === dayStr && i.type !== 'meeting');
            return (
              <div key={dayStr} className="flex-1 min-h-[26px] px-1 py-1 space-y-1 border-l border-neutral-50 first:border-l-0">
                {allDay.map((i) => <AllDayChip key={i.id} item={i} onOpen={openItem} />)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable time grid (meetings) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white">
        <div className="relative flex" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
          {/* Gutter */}
          <div className="flex-shrink-0 relative" style={{ width: GUTTER_WIDTH }}>
            {hours.map((hour) => (
              <div key={hour} className="absolute w-full flex items-start justify-end pr-2" style={{ top: (hour - START_HOUR) * HOUR_HEIGHT - 6 }}>
                <span className="text-[10px] text-neutral-300 font-medium leading-none">
                  {hour === 12 ? '12pm' : hour > 12 ? `${hour - 12}pm` : `${hour}am`}
                </span>
              </div>
            ))}
          </div>

          {/* Columns */}
          <div className="flex flex-1 relative">
            {hours.map((hour) => (
              <div key={hour} className="absolute left-0 right-0 border-t border-neutral-100" style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }} />
            ))}

            {showNowLine && (
              <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                <div className="relative flex items-center">
                  <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -ml-1" />
                  <div className="flex-1 h-px bg-red-400" />
                </div>
              </div>
            )}

            {days.map((day) => {
              const dayStr = localDay(day);
              const isToday = day.toDateString() === now.toDateString();
              const timed = visible.filter((i) => i.date === dayStr && i.type === 'meeting' && i.time);
              const laid = layoutTimed(timed);
              return (
                <div key={dayStr} className={`relative flex-1 border-l border-neutral-100 ${isToday ? 'bg-indigo-50/20' : ''}`}>
                  {hours.map((hour) => (
                    <div key={hour} className="absolute left-0 right-0 border-t border-neutral-50" style={{ top: (hour - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
                  ))}
                  {laid.map(({ item, col, numCols }) => {
                    const start = new Date(item.time!);
                    const end = item.endTime ? new Date(item.endTime) : new Date(start.getTime() + 30 * 60000);
                    const startMins = (start.getHours() - START_HOUR) * 60 + start.getMinutes();
                    const durMins = Math.max(20, (end.getTime() - start.getTime()) / 60000);
                    const top = (startMins / 60) * HOUR_HEIGHT;
                    const height = Math.max(18, (durMins / 60) * HOUR_HEIGHT - 2);
                    const s = styleFor(item);
                    return (
                      <div
                        key={item.id}
                        onClick={(e) => { e.stopPropagation(); openItem(item, e.clientX, e.clientY); }}
                        className={`absolute overflow-hidden border rounded-md cursor-pointer hover:brightness-95 transition-all ${s.bg} ${s.border} ${s.text}`}
                        style={{
                          top: `${top}px`, height: `${height}px`,
                          left: `calc(${(col / numCols) * 100}% + 2px)`,
                          width: `calc(${(1 / numCols) * 100}% - 4px)`,
                        }}
                      >
                        <div className="px-1.5 py-1 h-full flex flex-col overflow-hidden">
                          <p className="text-[11px] font-semibold leading-tight truncate">{item.title}</p>
                          {height > 30 && <p className="text-[10px] leading-tight opacity-70 truncate mt-0.5">{timeOf(item.time!)}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <ItemPopover item={selected.item} style={popStyle} onClose={() => setSelected(null)} onResolved={onResolved} />
      )}
    </div>
  );
}
