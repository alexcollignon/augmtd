'use client';

import { useState, useRef, useCallback } from 'react';
import { XMarkIcon, PaperAirplaneIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import KbFilePicker from './kb-file-picker';

interface PendingAttachment {
  filename: string;
  content: string; // base64
  mimeType: string;
}

interface ComposeDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

interface ComposePanelProps {
  draft: ComposeDraft;
  onChange: (fields: Partial<ComposeDraft>) => void;
  onDiscard: () => void;
  onSent: () => void;
}

export default function ComposePanel({ draft, onChange, onDiscard, onSent }: ComposePanelProps) {
  const [showCc, setShowCc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const attachFileInputRef = useRef<HTMLInputElement>(null);

  const handleLocalFileAttach = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const results = await Promise.all(files.map(async (file) => {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const content = btoa(binary);
      return { filename: file.name, content, mimeType: file.type || 'application/octet-stream' };
    }));
    setAttachments(prev => [...prev, ...results]);
    e.target.value = '';
  }, []);

  const handleKbAttach = useCallback(async (selected: { id: string; filename: string }[]) => {
    setKbPickerOpen(false);
    const results = await Promise.all(selected.map(async ({ id, filename }) => {
      try {
        const res = await fetch(`/api/kb/attachment?fileId=${id}`);
        if (!res.ok) { toast.error(`Failed to load ${filename}`); return null; }
        return await res.json() as PendingAttachment;
      } catch {
        toast.error(`Failed to load ${filename}`);
        return null;
      }
    }));
    setAttachments(prev => [...prev, ...(results.filter(Boolean) as PendingAttachment[])]);
  }, []);

  const handleSend = async () => {
    if (!draft.to.trim()) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/inbox/compose/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: draft.to,
          cc: draft.cc || undefined,
          subject: draft.subject,
          body: draft.body,
          attachments,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send');
      }
      toast.success('Email sent');
      setAttachments([]);
      onSent();
    } catch (err: any) {
      toast.error(err.message || 'Could not send email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-neutral-200">
        <span className="text-[13px] font-semibold text-neutral-900">New email</span>
        <button
          onClick={onDiscard}
          className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors"
          title="Discard"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* To */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
        <span className="text-[11px] font-semibold text-neutral-400 w-10 flex-shrink-0">To</span>
        <input
          type="text"
          value={draft.to}
          onChange={e => onChange({ to: e.target.value })}
          placeholder="recipient@example.com"
          className="flex-1 text-[13px] text-neutral-800 placeholder-neutral-400 bg-transparent outline-none"
        />
        {!showCc && (
          <button
            onClick={() => setShowCc(true)}
            className="text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors flex-shrink-0"
          >
            CC
          </button>
        )}
      </div>

      {/* CC */}
      {showCc && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
          <span className="text-[11px] font-semibold text-neutral-400 w-10 flex-shrink-0">CC</span>
          <input
            type="text"
            value={draft.cc}
            onChange={e => onChange({ cc: e.target.value })}
            placeholder="cc@example.com"
            className="flex-1 text-[13px] text-neutral-800 placeholder-neutral-400 bg-transparent outline-none"
          />
        </div>
      )}

      {/* Subject */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
        <span className="text-[11px] font-semibold text-neutral-400 w-10 flex-shrink-0">Subject</span>
        <input
          type="text"
          value={draft.subject}
          onChange={e => onChange({ subject: e.target.value })}
          placeholder="Subject"
          className="flex-1 text-[13px] text-neutral-800 placeholder-neutral-400 bg-transparent outline-none"
        />
      </div>

      {/* Body */}
      <textarea
        value={draft.body}
        onChange={e => onChange({ body: e.target.value })}
        placeholder="Write your message..."
        className="flex-1 min-h-0 px-4 py-3 text-[13px] text-neutral-800 placeholder-neutral-400 bg-transparent outline-none resize-none"
      />

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex-shrink-0 flex flex-wrap gap-1.5 px-4 py-2 border-t border-neutral-100">
          {attachments.map((att, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-neutral-100 rounded text-[11px] text-neutral-700">
              <PaperClipIcon className="w-3 h-3 flex-shrink-0" />
              <span className="max-w-[140px] truncate">{att.filename}</span>
              <button
                onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                className="hover:text-red-500 transition-colors ml-0.5"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={attachFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleLocalFileAttach}
      />

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-t border-neutral-200">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSend}
            disabled={!draft.to.trim() || isSending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <PaperAirplaneIcon className="w-3.5 h-3.5" />
            )}
            Send
          </button>

          {/* Attach button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAttachMenu(v => !v)}
              className="p-1.5 rounded text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
              title="Attach file"
            >
              <PaperClipIcon className="w-4 h-4" />
            </button>
            {showAttachMenu && (
              <div className="absolute bottom-9 left-0 w-52 bg-white border border-neutral-200 rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => { attachFileInputRef.current?.click(); setShowAttachMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                >
                  Upload a file
                </button>
                <button
                  onClick={() => { setKbPickerOpen(true); setShowAttachMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[12px] text-neutral-700 hover:bg-neutral-50"
                >
                  From knowledge base
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onDiscard}
          className="text-[12px] text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          Discard
        </button>
      </div>

      {kbPickerOpen && (
        <KbFilePicker
          onSelect={handleKbAttach}
          onClose={() => setKbPickerOpen(false)}
        />
      )}
    </div>
  );
}
