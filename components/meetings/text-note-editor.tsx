'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  DocumentTextIcon,
  SparklesIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import { Button, IconButton } from '@/components/ui';

interface TextNoteEditorProps {
  transcriptId?: string;
  calendarEventId?: string;
  onCreated?: (id: string) => void;
  onClose?: () => void;
}

export default function TextNoteEditor({
  transcriptId: initialId,
  calendarEventId,
  onCreated,
  onClose,
}: TextNoteEditorProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [transcriptId, setTranscriptId] = useState<string | null>(initialId ?? null);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Auto-focus title on mount
    const t = setTimeout(() => titleRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Auto-save with debounce
  const debouncedSave = useCallback((currentTitle: string, currentBody: string, currentId: string | null) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!currentTitle.trim() && !currentBody.trim()) return;

      setSaving(true);
      try {
        if (!currentId) {
          // Create new note
          const res = await fetch('/api/meetings/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: currentTitle || 'Untitled note', body: currentBody, calendarEventId }),
          });
          if (res.ok) {
            const data = await res.json();
            setTranscriptId(data.id);
          }
        } else {
          // Update existing
          await fetch(`/api/meetings/notes/${currentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: currentTitle, body: currentBody }),
          });
        }
      } catch {
        // Silent — will retry on next save
      } finally {
        setSaving(false);
      }
    }, 2000);
  }, []);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    debouncedSave(val, body, transcriptId);
  };

  const handleBodyChange = (val: string) => {
    setBody(val);
    debouncedSave(title, val, transcriptId);
  };

  const handleProcess = async () => {
    setError(null);

    // Ensure the note is saved first
    let noteId = transcriptId;
    if (!noteId) {
      if (!title.trim() && !body.trim()) {
        setError('Write some text before processing');
        return;
      }
      setSaving(true);
      try {
        const res = await fetch('/api/meetings/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title || 'Untitled note', body, calendarEventId }),
        });
        if (!res.ok) throw new Error('Failed to save');
        const data = await res.json();
        noteId = data.id;
        setTranscriptId(noteId);
      } catch {
        setError('Failed to save note');
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }
    } else {
      // Save latest content before processing
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      await fetch(`/api/meetings/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
    }

    if (!body.trim()) {
      setError('Write some text before processing');
      return;
    }

    setProcessing(true);
    try {
      const res = await fetch(`/api/meetings/notes/${noteId}/process`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Processing failed');
      }
      setProcessed(true);
      // Notify parent to switch to inline note view
      if (noteId) onCreated?.(noteId);
    } catch (err: any) {
      setError(err.message ?? 'Processing failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-2">
        {onClose && (
          <IconButton size="sm" onClick={onClose}>
            <ArrowLeftIcon className="w-4 h-4" />
          </IconButton>
        )}
        <DocumentTextIcon className="w-5 h-5 text-blue-500" />
        <span className="text-[12px] text-neutral-400">
          {saving ? 'Saving…' : transcriptId ? 'Saved' : 'New note'}
        </span>
      </div>

      {/* Title */}
      <div className="px-6 pt-2 pb-1">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Meeting title"
          className="w-full text-xl font-semibold text-neutral-900 outline-none placeholder:text-neutral-300 bg-transparent"
        />
      </div>

      {/* Body */}
      <div className="flex-1 px-6 py-2">
        <textarea
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder="Write your meeting notes here…&#10;&#10;Type what was discussed, decided, or any action items. When you're done, click 'Process with AI' to extract insights automatically."
          className="w-full h-full text-[14px] text-neutral-700 leading-relaxed outline-none placeholder:text-neutral-400 bg-transparent resize-none"
        />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 pb-6 pt-2">
        {error && (
          <p className="text-[12px] text-red-600 mb-2">{error}</p>
        )}
        {processed ? (
          <p className="text-[13px] text-emerald-600 font-medium">
            ✓ AI processing complete — loading your note…
          </p>
        ) : (
          <Button
            onClick={handleProcess}
            disabled={processing || (!body.trim() && !title.trim())}
          >
            <SparklesIcon className="w-4 h-4" />
            {processing ? 'Processing…' : 'Process with AI'}
          </Button>
        )}
      </div>
    </div>
  );
}
