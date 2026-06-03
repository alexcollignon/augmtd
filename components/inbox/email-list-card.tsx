'use client';

import { useState, useRef, useEffect } from 'react';
import { PaperClipIcon, CheckIcon, TrashIcon, XMarkIcon, ArchiveBoxArrowDownIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { FlagIcon } from '@heroicons/react/24/solid';
import type { InboxItem } from '@/lib/types/inbox';


interface EmailListCardProps {
  item: InboxItem;
  isSelected: boolean;
  onSelect: (item: InboxItem) => void;
  compact?: boolean;
  isChecked?: boolean;
  onToggleCheck?: (id: string) => void;
  hasAnySelected?: boolean;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
  onFlag?: (id: string) => void;
  selectedIds?: Set<string>;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function EmailListCard({ item, isSelected, onSelect, compact = false, isChecked = false, onToggleCheck, hasAnySelected = false, onDelete, onArchive, onFlag, selectedIds }: EmailListCardProps) {
  const [pendingAction, setPendingAction] = useState<'delete' | 'archive' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sourceData = item.source_data;
  const isFlagged = item.is_flagged === true;

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [menuOpen]);

  const fromDisplay = sourceData?.from_name || sourceData?.from || '';
  const subjectDisplay = sourceData?.subject || '';

  const snippetDisplay = ((typeof sourceData?.snippet === 'string' ? sourceData.snippet : null)
    || (typeof sourceData?.body === 'string' ? [...sourceData.body].slice(0, 120).join('') : null)
    || '').normalize('NFC').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const timeDisplay = sourceData?.received_at ? formatTime(sourceData.received_at as string) : '';

  if (!fromDisplay && !subjectDisplay) return null;

  const isUnread = item.is_read === false;
  const checkboxVisible = isChecked || hasAnySelected;

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pendingAction === 'delete') onDelete?.(item.id);
    else if (pendingAction === 'archive') onArchive?.(item.id);
  };

  // pointer-events-none when hidden so the invisible zone doesn't intercept card clicks
  const Checkbox = (
    <div
      onClick={(e) => { e.stopPropagation(); onToggleCheck?.(item.id); }}
      className={`absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center z-10 transition-opacity cursor-pointer ${
        checkboxVisible
          ? 'opacity-100'
          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
      }`}
    >
      <div className={`w-3.5 h-3.5 border rounded-[3px] flex items-center justify-center flex-shrink-0 ${
        isChecked ? 'border-indigo-500 bg-indigo-500' : 'border-neutral-300 bg-white'
      }`}>
        {isChecked && <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
      </div>
    </div>
  );

  const handleDragStart = (e: React.DragEvent) => {
    const ids = selectedIds?.has(item.id) && (selectedIds.size > 1) ? [...selectedIds] : [item.id];
    e.dataTransfer.setData('application/x-inbox-items', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';

    // Semi-transparent drag ghost so the drop target is visible underneath
    const el = e.currentTarget as HTMLElement;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${el.offsetWidth}px;opacity:0.45;pointer-events:none;`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, el.offsetWidth / 2, el.offsetHeight / 2);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  };

  if (compact) {
    return (
      <div
        draggable
        onDragStart={handleDragStart}
        onClick={() => { if (!pendingAction) onSelect(item); }}
        className={`w-full text-left relative rounded-md transition-colors cursor-pointer group ${
          isChecked ? 'bg-indigo-50/60' : isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
        }`}
      >
        {Checkbox}
        <div className="pl-8 pr-2 py-1.5">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
              <span className={`text-[12px] truncate ${isUnread ? 'font-bold' : 'font-semibold'} ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
                {fromDisplay}
              </span>
            </div>
            {/* Right slot: time + 3-dot menu */}
            <div className="relative flex items-center flex-shrink-0 gap-0.5" ref={menuRef}>
              {pendingAction ? (
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] text-neutral-500 mr-0.5">
                    {pendingAction === 'delete' ? 'Delete?' : 'Archive?'}
                  </span>
                  <button onClick={handleConfirm} className={`p-0.5 rounded ${pendingAction === 'delete' ? 'text-red-500' : 'text-neutral-500'}`} title="Confirm">
                    <CheckIcon className="w-3 h-3" strokeWidth={2.5} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setPendingAction(null); }} className="p-0.5 rounded text-neutral-400" title="Cancel">
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <>
                  {onFlag && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onFlag(item.id); }}
                      title={isFlagged ? 'Unflag' : 'Flag'}
                      className={`p-0.5 rounded transition-colors ${isFlagged ? 'text-amber-400 hover:text-amber-500' : 'text-neutral-300 hover:text-amber-400 opacity-0 group-hover:opacity-100'}`}
                    >
                      <FlagIcon className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {timeDisplay && (
                    <span className={`text-[10px] ${isUnread ? 'text-indigo-500 font-medium' : 'text-neutral-400'} ${menuOpen ? 'invisible' : 'group-hover:invisible'}`}>{timeDisplay}</span>
                  )}
                  <div className={`absolute right-0 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
                      className="p-0.5 rounded text-neutral-400 hover:text-neutral-600"
                      title="More actions"
                    >
                      <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
                    </button>
                    {menuOpen && (
                      <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-neutral-100 py-1 z-50 text-[12px]" onClick={e => e.stopPropagation()}>
                        {onFlag && (
                          <button onClick={() => { onFlag(item.id); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center gap-2 text-neutral-700">
                            <FlagIcon className={`w-3.5 h-3.5 ${isFlagged ? 'text-amber-400' : 'text-neutral-400'}`} />
                            <span>{isFlagged ? 'Unflag' : 'Flag'}</span>
                          </button>
                        )}
                        {onFlag && (onArchive || onDelete) && <div className="border-t border-neutral-100 my-1" />}
                        {onArchive && (
                          <button onClick={() => { setPendingAction('archive'); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center gap-2 text-neutral-700">
                            <ArchiveBoxArrowDownIcon className="w-3.5 h-3.5 text-neutral-400" />
                            <span>Archive</span>
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => { setPendingAction('delete'); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center gap-2 text-red-500">
                            <TrashIcon className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className={`text-[11px] truncate flex-1 ${isSelected ? 'text-indigo-700 font-medium' : 'text-neutral-500'}`}>
              {subjectDisplay}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={() => { if (!pendingAction) onSelect(item); }}
      className={`w-full text-left relative rounded-md transition-colors cursor-pointer group ${
        isChecked ? 'bg-indigo-50/60' : isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
      }`}
    >
      {Checkbox}
      <div className="pl-8 pr-3 py-3">
        {/* Row 1: From + time/actions */}
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {isUnread && <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />}
            <span className={`text-[13px] truncate ${isUnread ? 'font-bold' : 'font-semibold'} ${isSelected ? 'text-indigo-900' : 'text-neutral-900'}`}>
              {fromDisplay}
            </span>
          </div>

          {/* Right slot */}
          <div className="relative flex items-center flex-shrink-0 gap-0.5" ref={menuRef}>
            {pendingAction ? (
              <div className="flex items-center gap-0.5">
                <span className="text-[10px] text-neutral-500 mr-0.5">
                  {pendingAction === 'delete' ? 'Delete?' : 'Archive?'}
                </span>
                <button
                  onClick={handleConfirm}
                  className={`p-0.5 rounded transition-colors ${pendingAction === 'delete' ? 'text-red-500 hover:text-red-600' : 'text-neutral-500 hover:text-neutral-700'}`}
                  title="Confirm"
                >
                  <CheckIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingAction(null); }}
                  className="p-0.5 rounded text-neutral-400 hover:text-neutral-600 transition-colors"
                  title="Cancel"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                {/* Flag — always visible when flagged, hover-only otherwise */}
                {onFlag && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onFlag(item.id); }}
                    title={isFlagged ? 'Unflag' : 'Flag'}
                    className={`p-0.5 rounded transition-colors ${isFlagged ? 'text-amber-400 hover:text-amber-500' : 'text-neutral-300 hover:text-amber-400 opacity-0 group-hover:opacity-100'}`}
                  >
                    <FlagIcon className="w-3 h-3" />
                  </button>
                )}
                {timeDisplay && (
                  <span className={`text-[10px] ${isUnread ? 'text-indigo-500 font-medium' : 'text-neutral-400'} ${menuOpen ? 'invisible' : 'group-hover:invisible'}`}>{timeDisplay}</span>
                )}
                {/* 3-dot menu button */}
                <div className={`absolute right-0 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
                    className="p-0.5 rounded text-neutral-400 hover:text-neutral-600"
                    title="More actions"
                  >
                    <EllipsisHorizontalIcon className="w-3.5 h-3.5" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-neutral-100 py-1 z-50 text-[12px]" onClick={e => e.stopPropagation()}>
                      {onFlag && (
                        <button
                          onClick={() => { onFlag(item.id); setMenuOpen(false); }}
                          className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center gap-2 text-neutral-700"
                        >
                          <FlagIcon className={`w-3.5 h-3.5 ${isFlagged ? 'text-amber-400' : 'text-neutral-400'}`} />
                          <span>{isFlagged ? 'Unflag' : 'Flag'}</span>
                        </button>
                      )}
                      {onFlag && (onArchive || onDelete) && <div className="border-t border-neutral-100 my-1" />}
                      {onArchive && (
                        <button
                          onClick={() => { setPendingAction('archive'); setMenuOpen(false); }}
                          className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center gap-2 text-neutral-700"
                        >
                          <ArchiveBoxArrowDownIcon className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Archive</span>
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => { setPendingAction('delete'); setMenuOpen(false); }}
                          className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center gap-2 text-red-500"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 2: Subject */}
        <p className={`text-[12px] truncate mb-0.5 ${isSelected ? 'text-indigo-700 font-medium' : isUnread ? 'text-neutral-800 font-medium' : 'text-neutral-700'}`}>
          {subjectDisplay}
        </p>

        {/* Row 3: Snippet */}
        {snippetDisplay && (
          <p className="text-[11px] text-neutral-400 line-clamp-1 leading-relaxed" suppressHydrationWarning>
            {snippetDisplay}
          </p>
        )}

        {/* Badges */}
        {sourceData?.attachments?.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="inline-flex items-center gap-0.5 text-neutral-400">
              <PaperClipIcon className="w-2.5 h-2.5" />
              <span className="text-[10px]">{sourceData.attachments.length}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
