'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface MeetingDocumentProps {
  document: string;
  eventId: string | null;
  editable?: boolean;
}

export default function MeetingDocument({ document: initialDoc, eventId, editable = true }: MeetingDocumentProps) {
  const [content, setContent] = useState(initialDoc);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync if parent provides updated content (e.g. after re-analysis)
  useEffect(() => { setContent(initialDoc); }, [initialDoc]);

  const adjustHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  const save = useCallback(async (value: string) => {
    if (!eventId) return;
    setSaveState('saving');
    try {
      await fetch(`/api/meetings/${eventId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: value }),
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch { setSaveState('idle'); }
  }, [eventId]);

  const handleChange = (value: string) => {
    setContent(value);
    adjustHeight();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(value), 1500);
  };

  const handleClick = () => {
    if (!editable || editing) return;
    setEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      adjustHeight();
    }, 0);
  };

  const handleBlur = async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    await save(content);
    setEditing(false);
  };

  return (
    <div className="relative">
      {/* Rendered view — hidden while editing */}
      <div
        onClick={handleClick}
        className={`${editing ? 'hidden' : 'block'} ${editable ? 'cursor-text' : ''}`}
      >
        <RenderedDocument content={content} />
      </div>

      {/* Textarea — visible while editing, styled to match rendered output */}
      <div className={editing ? 'block relative' : 'hidden'}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="Meeting notes…"
          className="w-full text-[13px] text-neutral-700 leading-relaxed outline-none resize-none bg-transparent overflow-hidden"
        />
        {saveState !== 'idle' && (
          <span className="absolute bottom-1 right-0 text-[10px] text-neutral-400 pointer-events-none">
            {saveState === 'saving' ? 'Saving…' : 'Saved'}
          </span>
        )}
      </div>
    </div>
  );
}

function RenderedDocument({ content }: { content: string }) {
  if (!content?.trim()) {
    return <p className="text-[13px] text-neutral-400 italic">No notes yet. Click to add.</p>;
  }

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // ## or # Section header
    if (line.startsWith('## ') || line.startsWith('# ')) {
      const text = line.startsWith('## ') ? line.slice(3) : line.slice(2);
      elements.push(
        <p key={i} className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mt-5 mb-2 first:mt-0">
          {text}
        </p>
      );
      i++;
      continue;
    }

    // Bullet list with optional indented sub-bullets
    if (line.startsWith('- ') || line.startsWith('* ')) {
      type BulletItem = { text: string; subs: string[] };
      const bullets: BulletItem[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const isIndented = l.startsWith('  - ') || l.startsWith('  * ') || l.startsWith('\t- ') || l.startsWith('\t* ');
        const isTop = !isIndented && (l.startsWith('- ') || l.startsWith('* '));
        if (isTop) {
          bullets.push({ text: l.slice(2), subs: [] });
          i++;
        } else if (isIndented && bullets.length > 0) {
          bullets[bullets.length - 1].subs.push(l.trimStart().slice(2));
          i++;
        } else {
          break;
        }
      }
      elements.push(
        <ul key={i} className="space-y-2 mb-3">
          {bullets.map((b, bi) => (
            <li key={bi}>
              <div className="flex items-start gap-2 text-[13px] text-neutral-700 leading-relaxed">
                <span className="w-1 h-1 rounded-full bg-neutral-400 flex-shrink-0 mt-[7px]" />
                <span dangerouslySetInnerHTML={{ __html: renderInline(b.text) }} />
              </div>
              {b.subs.length > 0 && (
                <ul className="ml-5 mt-1 space-y-0.5">
                  {b.subs.map((s, si) => (
                    <li key={si} className="flex items-start gap-2 text-[12px] text-neutral-500 leading-relaxed">
                      <span className="w-1 h-1 rounded-full bg-neutral-300 flex-shrink-0 mt-[6px]" />
                      <span dangerouslySetInnerHTML={{ __html: renderInline(s) }} />
                    </li>
                  ))}
                </ul>
              )}
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

function renderInline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-neutral-900">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="text-[12px] bg-neutral-100 px-1 py-0.5 rounded font-mono">$1</code>');
}
