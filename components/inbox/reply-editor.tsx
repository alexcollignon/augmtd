'use client';

import { forwardRef, useCallback, useEffect, useRef } from 'react';
import FormatToolbar from './format-toolbar';
import { sanitizeDraftHtml } from '@/lib/utils/sanitize-html';

// ── The shared rich-text reply editor: a `contentEditable` surface + the inbox `<FormatToolbar/>`
// (bold / italic / underline / font size / bullet + numbered lists / link). ONE source of truth so
// the inbox reply box and the Home item-detail composer can't drift.
//
// Usage patterns:
//  - Ref-based (inbox `work-detail-inline`): forward a ref to the underlying contentEditable div so
//    the host can imperatively read `.innerHTML` and seed content (signature injection, AI-draft
//    sync). Pair with `onInput` to mirror the HTML into host state. The host supplies its own
//    surrounding controls (attach / Sig / Send) via `toolbarLeading` + `toolbarTrailing`.
//  - Uncontrolled seed (Home item-detail): pass `initialHTML` to seed once + `onInput` to read HTML.
//
// The placeholder + list/paragraph styling live in global CSS (`[data-placeholder]`,
// `[contenteditable] ul/ol/p`) so both hosts get identical rendering for free.

interface ReplyEditorProps {
  /** Called on every edit / formatting command with the editor's current innerHTML. */
  onInput?: (html: string) => void;
  /** Seeds the editor's innerHTML on mount (uncontrolled — host manages further updates). */
  initialHTML?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** Min/max height for the editable surface (px). */
  minHeight?: number;
  maxHeight?: number;
  /** Controls rendered on the left of the toolbar row, before the FormatToolbar (e.g. attach). */
  toolbarLeading?: React.ReactNode;
  /** Controls rendered on the right of the toolbar row (e.g. Sig + Send/Discard). */
  toolbarTrailing?: React.ReactNode;
  /** Content rendered between the editor surface and the toolbar row (e.g. attachment chips). */
  children?: React.ReactNode;
}

const ReplyEditor = forwardRef<HTMLDivElement, ReplyEditorProps>(function ReplyEditor(
  {
    onInput,
    initialHTML,
    placeholder = 'Write your reply…',
    autoFocus,
    className = '',
    minHeight = 120,
    maxHeight = 400,
    toolbarLeading,
    toolbarTrailing,
    children,
  },
  ref,
) {
  // Internal ref is the single source the FormatToolbar reads; we also mirror it to the forwarded
  // ref so the host can imperatively read/seed the contentEditable div.
  const editorRef = useRef<HTMLDivElement>(null);

  const emit = useCallback(
    (el: HTMLDivElement | null) => {
      onInput?.(el?.innerHTML ?? '');
    },
    [onInput],
  );

  // Attach the internal + forwarded refs AND seed initial HTML on first mount.
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      editorRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      if (el && initialHTML != null && !el.innerHTML) {
        // RENDER SAFETY (Sep 22): a seed is model-authored — sanitized before it mounts (no
        // handlers, no remote fetch before the user approved anything).
        el.innerHTML = sanitizeDraftHtml(initialHTML);
        onInput?.(el.innerHTML);
      }
    },
    [ref, initialHTML, onInput],
  );

  // AUTOFOCUS, FOR REAL (UI walk, Oct 1): React's `autoFocus` only focuses form controls — on a
  // contentEditable div it is a no-op. "Click anywhere to edit" mounted this editor UNFOCUSED, so the
  // first words typed after the click went nowhere. Focus once on mount, caret at the end.
  useEffect(() => {
    if (!autoFocus) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch { /* focus alone is enough */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: never steal the caret mid-edit
  }, []);

  return (
    <div className={className}>
      <div
        ref={setRef}
        contentEditable
        suppressContentEditableWarning
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        onInput={(e) => emit(e.currentTarget)}
        data-placeholder={placeholder}
        className="w-full text-[13px] text-neutral-800 border-0 outline-none leading-relaxed overflow-y-auto"
        style={{ minHeight, maxHeight }}
      />
      {children}
      {/* THE ROW WRAPS, IT NEVER OVERLAPS (UI walk, Oct 1): in a narrow pane (the inbox reading
          column beside the assistant) the format buttons ran UNDER the trailing "Sig · Discard ·
          Send" — the leading group shrank to zero and overflowed. It keeps its own width now and
          the trailing controls drop to the next line, right-aligned, when both cannot fit. */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-1 flex-1 min-w-fit">
          {toolbarLeading}
          {toolbarLeading && <div className="w-px h-4 bg-neutral-200 flex-shrink-0" />}
          <FormatToolbar editorRef={editorRef} onSync={() => emit(editorRef.current)} />
        </div>
        {toolbarTrailing && <div className="ml-auto flex-shrink-0">{toolbarTrailing}</div>}
      </div>
    </div>
  );
});

export default ReplyEditor;
