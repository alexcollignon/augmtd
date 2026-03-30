'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/lib/types/meetings';

type Connection = { id: string; provider: string; email?: string };

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

interface NewMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialDate?: Date;
  initialTitle?: string;
  /** When provided — edit mode: pre-fills form, calls PATCH */
  event?: CalendarEvent;
}

function toLocalDateStr(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function toLocalTimeStr(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function calcDurationMins(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

function snapDuration(mins: number) {
  const snap = DURATION_OPTIONS.reduce((prev, cur) =>
    Math.abs(cur - mins) < Math.abs(prev - mins) ? cur : prev
  );
  return snap;
}

export default function NewMeetingModal({ isOpen, onClose, onSuccess, initialDate, initialTitle, event }: NewMeetingModalProps) {
  const isEdit = !!event;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState({
    title: '',
    date: '',
    time: '',
    duration: 30,
    attendees: '',
    notes: '',
    connectionId: '',
    includeMeetLink: true,
  });
  const [formState, setFormState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch connections once
  useEffect(() => {
    if (!isOpen || connections.length > 0) return;
    fetch('/api/connections')
      .then(r => r.json())
      .then(d => {
        const conns: Connection[] = d.connections ?? [];
        setConnections(conns);
        if (conns.length > 0 && !isEdit) setForm(f => ({ ...f, connectionId: conns[0].id }));
      })
      .catch(() => {});
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset / pre-fill form on open
  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && event) {
      const durMins = calcDurationMins(event.start_time, event.end_time);
      setForm(f => ({
        ...f,
        title: event.title,
        date: toLocalDateStr(event.start_time),
        time: toLocalTimeStr(event.start_time),
        duration: snapDuration(durMins),
        attendees: event.attendees.map(a => a.email).filter(Boolean).join(', '),
        notes: event.description ?? '',
        includeMeetLink: !!event.meeting_link,
      }));
    } else {
      const d = initialDate ?? new Date();
      const hasTime = !!(initialDate && (initialDate.getHours() !== 0 || initialDate.getMinutes() !== 0));
      const timeStr = hasTime
        ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : '';
      setForm(f => ({
        ...f,
        title: initialTitle ?? '',
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        time: timeStr,
        attendees: '',
        notes: '',
        includeMeetLink: true,
      }));
    }
    setFormState('idle');
    setFormError(null);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleSubmit = async () => {
    const { title, date, time, duration, attendees, notes, connectionId, includeMeetLink } = form;
    if (!title.trim() || !date || !time) { setFormError('Title, date, and time are required.'); return; }
    const parsed = attendees.split(',').map(s => s.trim()).filter(Boolean);
    if (parsed.length === 0) { setFormError('Add at least one attendee.'); return; }

    setFormState('sending');
    setFormError(null);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const startTime = new Date(`${date}T${time}`).toISOString();
      const endTime = new Date(new Date(`${date}T${time}`).getTime() + duration * 60000).toISOString();

      let res: Response;
      if (isEdit && event) {
        res = await fetch(`/api/meetings/${event.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), startTime, endTime, timezone, attendees: parsed, notes: notes.trim() || undefined }),
        });
      } else {
        res = await fetch('/api/meetings/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), startTime, endTime, timezone, attendees: parsed, notes: notes.trim() || undefined, connectionId: connectionId || undefined, includeMeetLink }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        if (data?.error === 'calendar_scope_required') {
          setFormError(`Calendar write access needed. Reconnect ${data.provider === 'gmail' ? 'Google' : 'Outlook'} in Settings.`);
          setFormState('error');
          return;
        }
        throw new Error(data?.error ?? 'Unknown error');
      }
      setFormState('sent');
      toast.success(isEdit ? 'Meeting updated' : 'Invitation sent');
      setTimeout(() => { onClose(); onSuccess(); }, 1200);
    } catch (err: any) {
      setFormError(err?.message ?? 'Failed to save');
      setFormState('error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 bg-white shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="text-[15px] font-semibold text-neutral-900">{isEdit ? 'Edit meeting' : 'New meeting'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-neutral-100 rounded transition-colors">
            <XMarkIcon className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          <input
            type="text"
            placeholder="Title"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            autoFocus
            className="w-full text-[13px] border border-neutral-200 px-3 py-2 outline-none focus:border-indigo-400 placeholder:text-neutral-400"
          />

          <div className="flex gap-2">
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="flex-1 text-[13px] border border-neutral-200 px-3 py-2 outline-none focus:border-indigo-400"
            />
            <input
              type="time"
              value={form.time}
              onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
              className="w-[100px] text-[13px] border border-neutral-200 px-3 py-2 outline-none focus:border-indigo-400"
            />
          </div>

          <select
            value={form.duration}
            onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
            className="w-full text-[13px] border border-neutral-200 px-3 py-2 outline-none focus:border-indigo-400 bg-white"
          >
            {DURATION_OPTIONS.map(d => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Attendees (comma-separated emails)"
            value={form.attendees}
            onChange={e => setForm(f => ({ ...f, attendees: e.target.value }))}
            className="w-full text-[13px] border border-neutral-200 px-3 py-2 outline-none focus:border-indigo-400 placeholder:text-neutral-400"
          />

          <textarea
            rows={2}
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full text-[13px] border border-neutral-200 px-3 py-2 outline-none focus:border-indigo-400 placeholder:text-neutral-400 resize-none"
          />

          {/* Account picker — only when > 1 connection and not editing */}
          {!isEdit && connections.length > 1 && (
            <div>
              <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Send from</p>
              <div className="space-y-1.5">
                {connections.map(c => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="connectionId"
                      value={c.id}
                      checked={form.connectionId === c.id}
                      onChange={() => setForm(f => ({ ...f, connectionId: c.id }))}
                      className="accent-indigo-600"
                    />
                    <span className="text-[13px] text-neutral-700">
                      {c.email || c.id}
                      <span className="ml-1 text-neutral-400 text-[11px]">({c.provider === 'gmail' ? 'Google' : 'Outlook'})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Meet link toggle — create only */}
          {!isEdit && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.includeMeetLink}
                onChange={e => setForm(f => ({ ...f, includeMeetLink: e.target.checked }))}
                className="accent-indigo-600"
              />
              <VideoCameraIcon className="w-4 h-4 text-neutral-400" />
              <span className="text-[13px] text-neutral-600">
                {connections.find(c => c.id === form.connectionId)?.provider === 'outlook'
                  ? 'Include Teams link'
                  : 'Include Google Meet link'}
              </span>
            </label>
          )}

          {formError && <p className="text-[12px] text-red-500">{formError}</p>}

          {formState === 'sent' ? (
            <p className="text-[13px] text-green-600 font-medium">{isEdit ? 'Meeting updated ✓' : 'Invitation sent ✓'}</p>
          ) : (
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={formState === 'sending'}
                className="flex-1 py-2 text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {formState === 'sending' ? 'Saving…' : isEdit ? 'Save changes' : 'Send invitation'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-[13px] text-neutral-500 hover:text-neutral-700 border border-neutral-200 hover:border-neutral-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
