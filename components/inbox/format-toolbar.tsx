'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { LinkIcon, XMarkIcon, ListBulletIcon, PencilIcon, TrashIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

interface FormatToolbarProps {
  editorRef: React.RefObject<HTMLDivElement>;
  onSync: () => void;
}

interface LinkPopover {
  href: string;
  top: number;
  left: number;
  anchor: HTMLAnchorElement;
}

export default function FormatToolbar({ editorRef, onSync }: FormatToolbarProps) {
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkPopover, setLinkPopover] = useState<LinkPopover | null>(null);
  const savedRange = useRef<Range | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const LINK_MARK = 'data-link-sel';

  const [active, setActive] = useState({ bold: false, italic: false, underline: false, ul: false, ol: false, link: false });

  // Track active formatting states
  useEffect(() => {
    const update = () => {
      const el = editorRef.current;
      if (!el) return;
      const focused = el === document.activeElement || el.contains(document.activeElement);
      if (!focused) return;
      try {
        const sel = window.getSelection();
        let insideLink = false;
        if (sel && sel.rangeCount > 0) {
          let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
          while (node && node !== el) {
            if ((node as Element).tagName === 'A') { insideLink = true; break; }
            node = node.parentNode;
          }
        }
        setActive({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          ul: document.queryCommandState('insertUnorderedList'),
          ol: document.queryCommandState('insertOrderedList'),
          link: insideLink,
        });
      } catch { /* ignore */ }
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [editorRef]);

  // Click on <a> inside editor → show floating link popover below the link
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as Element).closest('a');
      if (target && el.contains(target)) {
        e.preventDefault();
        const rect = target.getBoundingClientRect();
        setLinkPopover({
          href: (target as HTMLAnchorElement).href,
          top: rect.bottom + 6,
          left: rect.left,
          anchor: target as HTMLAnchorElement,
        });
      }
    };
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [editorRef]);

  // Close link popover on outside click
  useEffect(() => {
    if (!linkPopover) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setLinkPopover(null);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [linkPopover]);

  const exec = useCallback((cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value ?? undefined);
    onSync();
  }, [editorRef, onSync]);

  const markSelection = useCallback(() => {
    const range = savedRange.current;
    if (!range || range.collapsed) return;
    const mark = document.createElement('mark');
    mark.setAttribute(LINK_MARK, '1');
    mark.style.cssText = 'background:#e0e7ff;border-radius:2px;color:inherit';
    try {
      range.surroundContents(mark);
      const r = document.createRange();
      r.selectNodeContents(mark);
      savedRange.current = r;
      onSync();
    } catch {
      // Selection crosses element boundaries — skip visual highlight, range still valid
    }
  }, [LINK_MARK, onSync]);

  const unmarkSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const mark = el.querySelector(`[${LINK_MARK}]`);
    if (!mark) return;
    const parent = mark.parentNode!;
    const children = Array.from(mark.childNodes);
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    if (children.length > 0) {
      const r = document.createRange();
      r.setStartBefore(children[0]);
      r.setEndAfter(children[children.length - 1]);
      savedRange.current = r;
    }
    onSync();
  }, [LINK_MARK, editorRef, onSync]);

  const handleLinkMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (showLink) {
      unmarkSelection();
      setShowLink(false);
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
    markSelection();
    setShowLink(true);
    setLinkUrl('');
    setTimeout(() => linkInputRef.current?.focus(), 0);
  }, [showLink, markSelection, unmarkSelection]);

  // Edit from the link popover — select the whole <a> and open URL input pre-filled
  const handleEditFromPopover = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!linkPopover) return;
    const anchor = linkPopover.anchor;
    const r = document.createRange();
    r.selectNodeContents(anchor);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(r); }
    savedRange.current = r.cloneRange();
    setLinkPopover(null);
    markSelection();
    setLinkUrl(linkPopover.href);
    setShowLink(true);
    setTimeout(() => linkInputRef.current?.focus(), 0);
  }, [linkPopover, markSelection]);

  // Unlink from the link popover
  const handleUnlinkFromPopover = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!linkPopover) return;
    // Select the anchor so execCommand('unlink') targets it
    const r = document.createRange();
    r.selectNodeContents(linkPopover.anchor);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(r); }
    editorRef.current?.focus();
    document.execCommand('unlink', false);
    onSync();
    setLinkPopover(null);
  }, [linkPopover, editorRef, onSync]);

  const applyLink = useCallback(() => {
    unmarkSelection();
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    const url = linkUrl.trim();
    if (url) {
      document.execCommand('createLink', false, url.startsWith('http') ? url : `https://${url}`);
    } else {
      document.execCommand('unlink', false);
    }
    onSync();
    setShowLink(false);
    setLinkUrl('');
  }, [editorRef, linkUrl, unmarkSelection, onSync]);

  const btn = (on = false) =>
    `p-1.5 rounded transition-colors flex items-center justify-center ${
      on
        ? 'text-neutral-800 bg-neutral-150 ring-1 ring-neutral-300'
        : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
    }`;
  const sep = <div className="w-px h-3.5 bg-neutral-200 mx-0.5 flex-shrink-0" />;

  const displayHref = linkPopover?.href.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';

  return (
    <>
      {/* Floating link popover — positioned below the clicked <a> tag */}
      {linkPopover && (
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: linkPopover.top, left: linkPopover.left, zIndex: 9999 }}
          className="flex items-center gap-1.5 bg-white border border-neutral-200 rounded-lg shadow-lg px-2.5 py-1.5 max-w-[300px]"
        >
          <LinkIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
          <a
            href={linkPopover.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-[12px] text-indigo-600 underline truncate min-w-0"
            title={linkPopover.href}
          >
            {displayHref}
          </a>
          <a
            href={linkPopover.href}
            target="_blank"
            rel="noopener noreferrer"
            title="Open link"
            className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors flex-shrink-0"
          >
            <ArrowTopRightOnSquareIcon className="w-3 h-3" />
          </a>
          <div className="w-px h-3 bg-neutral-200 flex-shrink-0" />
          <button
            type="button"
            title="Edit link"
            onMouseDown={handleEditFromPopover}
            className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors flex-shrink-0"
          >
            <PencilIcon className="w-3 h-3" />
          </button>
          <button
            type="button"
            title="Remove link"
            onMouseDown={handleUnlinkFromPopover}
            className="p-0.5 text-neutral-400 hover:text-red-500 transition-colors flex-shrink-0"
          >
            <TrashIcon className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-0.5 relative">
        {/* Bold */}
        <button
          type="button"
          title="Bold"
          onMouseDown={e => { e.preventDefault(); exec('bold'); }}
          className={btn(active.bold)}
        >
          <span className="font-bold text-[13px] leading-none w-4 text-center">B</span>
        </button>

        {/* Italic */}
        <button
          type="button"
          title="Italic"
          onMouseDown={e => { e.preventDefault(); exec('italic'); }}
          className={btn(active.italic)}
        >
          <span className="italic text-[13px] leading-none w-4 text-center">I</span>
        </button>

        {/* Underline */}
        <button
          type="button"
          title="Underline"
          onMouseDown={e => { e.preventDefault(); exec('underline'); }}
          className={btn(active.underline)}
        >
          <span className="underline text-[13px] leading-none w-4 text-center">U</span>
        </button>

        {sep}

        {/* Link */}
        <div className="relative">
          <button
            type="button"
            title="Insert link"
            onMouseDown={handleLinkMouseDown}
            className={`${btn(showLink || active.link)} ${(showLink || active.link) ? '!text-indigo-600 !bg-indigo-50 !ring-indigo-200' : ''}`}
          >
            <LinkIcon className="w-3.5 h-3.5" />
          </button>

          {/* URL input — shown when adding or editing a link */}
          {showLink && (
            <div className="absolute bottom-8 left-0 z-30 flex items-center gap-1.5 bg-white border border-neutral-200 rounded-lg shadow-md px-2.5 py-1.5 min-w-[220px]">
              <input
                ref={linkInputRef}
                type="text"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                  if (e.key === 'Escape') { unmarkSelection(); setShowLink(false); }
                }}
                placeholder="https://..."
                className="flex-1 text-[12px] text-neutral-800 outline-none placeholder-neutral-400 bg-transparent min-w-0"
              />
              <button
                type="button"
                onClick={applyLink}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex-shrink-0"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => { unmarkSelection(); setShowLink(false); }}
                className="text-neutral-400 hover:text-neutral-600 flex-shrink-0"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {sep}

        {/* Bullet list */}
        <button
          type="button"
          title="Bullet list"
          onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }}
          className={btn(active.ul)}
        >
          <ListBulletIcon className="w-3.5 h-3.5" />
        </button>

        {/* Numbered list */}
        <button
          type="button"
          title="Numbered list"
          onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }}
          className={btn(active.ol)}
        >
          <span className="text-[11px] font-medium leading-none w-4 text-center">1.</span>
        </button>
      </div>
    </>
  );
}
