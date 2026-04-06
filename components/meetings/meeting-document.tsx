'use client';

import { useState, useRef, useCallback } from 'react';
import { PencilIcon, CheckIcon } from '@heroicons/react/24/outline';

interface MeetingDocumentProps {
  document: string;
  eventId: string | null;
  editable?: boolean;
}

/**
 * Renders a meeting note document (markdown) with Granola-style aesthetics.
 *
 * ## Heading lines → small uppercase label
 * - Bullet lines → clean bullet items
 * Regular paragraphs → readable prose
 *
 * Edit mode swaps to a textarea that auto-saves on blur.
 */
export default function MeetingDocument({ document: initialDoc, eventId, editable = true }: MeetingDocumentProps) {
  const [content, setContent] = useState(initialDoc);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async (value: string) => {
    if (!eventId) return;
    setSaving(true);
    try {
      await fetch(`/api/meetings/${eventId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: value }),
      });
    } catch {} finally { setSaving(false); }
  }, [eventId]);

  const handleChange = (value: string) => {
    setContent(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(value), 1500);
  };

  const handleDone = async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    await save(content);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="relative">
        <textarea
          autoFocus
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full min-h-[320px] text-[13px] text-neutral-700 leading-relaxed outline-none resize-none bg-transparent font-mono"
          placeholder="Meeting notes…"
        />
        <button
          onClick={handleDone}
          disabled={saving}
          className="flex items-center gap-1 mt-2 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
        >
          <CheckIcon className="w-3 h-3" />
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>
    );
  }

  return (
    <div className="group/doc relative">
      {editable && (
        <button
          onClick={() => setEditing(true)}
          className="absolute -right-1 -top-1 opacity-0 group-hover/doc:opacity-100 transition-opacity p-1 text-neutral-300 hover:text-neutral-500"
          title="Edit note"
        >
          <PencilIcon className="w-3.5 h-3.5" />
        </button>
      )}
      <RenderedDocument content={content} />
    </div>
  );
}

function RenderedDocument({ content }: { content: string }) {
  if (!content?.trim()) {
    return <p className="text-[13px] text-neutral-400 italic">No notes yet.</p>;
  }

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines between blocks
    if (!line.trim()) {
      i++;
      continue;
    }

    // ## Section header
    if (line.startsWith('## ')) {
      elements.push(
        <p key={i} className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mt-5 mb-2 first:mt-0">
          {line.slice(3)}
        </p>
      );
      i++;
      continue;
    }

    // # Top-level header (treat same as ##)
    if (line.startsWith('# ')) {
      elements.push(
        <p key={i} className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mt-5 mb-2 first:mt-0">
          {line.slice(2)}
        </p>
      );
      i++;
      continue;
    }

    // Bullet list — collect consecutive bullets into one block
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const bullets: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        bullets.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={i} className="space-y-1.5 mb-3">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex items-start gap-2 text-[13px] text-neutral-700 leading-relaxed">
              <span className="w-1 h-1 rounded-full bg-neutral-400 flex-shrink-0 mt-[7px]" />
              <span dangerouslySetInnerHTML={{ __html: renderInline(b) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="text-[13px] text-neutral-700 leading-relaxed mb-3">
        <span dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
      </p>
    );
    i++;
  }

  return <div>{elements}</div>;
}

/** Renders inline markdown: **bold**, *italic*, `code` */
function renderInline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-neutral-900">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="text-[12px] bg-neutral-100 px-1 py-0.5 rounded font-mono">$1</code>');
}
