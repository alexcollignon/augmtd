'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';
import { DESK_COLUMNS } from '@/lib/types/desk';
import KanbanColumn from '@/components/desk/kanban-column';

export default function DeskPageClient() {
  const [items, setItems] = useState<DeskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const synthesisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const synthesisStartRef = useRef<Date | null>(null);
  const syncInProgressRef = useRef(false);

  const loadItems = useCallback(async () => {
    const res = await fetch('/api/desk');
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items ?? []);
  }, []);

  // Synthesis polling — only while items have synthesis_at=null (actively being synthesized)
  // synthesis_at gets set even on failure, so polling stops regardless of outcome
  useEffect(() => {
    // Only poll for items where synthesis hasn't been attempted yet (synthesis_at is null)
    const hasPending = items.some(
      (i) => i.sourceType === 'email' && !i.synthesis && !i.synthesisAt
    );

    if (hasPending) {
      if (!synthesisTimerRef.current) {
        synthesisStartRef.current = new Date();
        synthesisTimerRef.current = setInterval(() => {
          const elapsed = Date.now() - (synthesisStartRef.current?.getTime() ?? 0);
          if (elapsed > 120_000) {
            clearInterval(synthesisTimerRef.current!);
            synthesisTimerRef.current = null;
            return;
          }
          loadItems();
        }, 4000);
      }
    } else {
      if (synthesisTimerRef.current) {
        clearInterval(synthesisTimerRef.current);
        synthesisTimerRef.current = null;
      }
    }

    return () => {
      if (synthesisTimerRef.current) {
        clearInterval(synthesisTimerRef.current);
        synthesisTimerRef.current = null;
      }
    };
  }, [items, loadItems]);

  const triggerSync = useCallback(async () => {
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    setSyncing(true);
    try {
      await fetch('/api/desk/sync', { method: 'POST' });
      await loadItems();
      setLastSynced(new Date());
    } finally {
      setSyncing(false);
      syncInProgressRef.current = false;
    }
  }, [loadItems]);

  useEffect(() => {
    loadItems().finally(() => setLoading(false));
    triggerSync();
  }, [loadItems, triggerSync]);

  const handleMove = useCallback(async (itemId: string, column: DeskColumn) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, column } : i)));
    await fetch(`/api/desk/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column }),
    });
  }, []);

  const handleDismiss = useCallback(async (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    await fetch(`/api/desk/${itemId}`, { method: 'DELETE' });
  }, []);

  const grouped = DESK_COLUMNS.reduce<Record<DeskColumn, DeskItem[]>>(
    (acc, col) => {
      acc[col.id] = items
        .filter((i) => i.column === col.id)
        .sort((a, b) => a.position - b.position);
      return acc;
    },
    { todo: [], in_progress: [], waiting: [], done: [] }
  );

  const activeCount = items.filter((i) => i.column !== 'done').length;
  const synthesisPending = items.some((i) => i.sourceType === 'email' && !i.synthesis && !i.synthesisAt);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 bg-white flex-shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-neutral-900">On Your Desk</h1>
          <p className="text-[12px] text-neutral-500 mt-0.5">
            {loading ? 'Loading…' : activeCount === 0
              ? "You're all caught up."
              : `${activeCount} item${activeCount === 1 ? '' : 's'} need your attention`}
            {synthesisPending && !loading && (
              <span className="ml-2 text-indigo-400">· preparing briefs…</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSynced && !syncing && (
            <span className="text-[11px] text-neutral-400">
              Synced {lastSynced.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-neutral-600 border border-neutral-200 hover:bg-neutral-50 transition-colors disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-4 gap-4">
            {DESK_COLUMNS.map((col) => (
              <div key={col.id} className="bg-neutral-50 rounded h-48 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4 min-w-[760px]">
            {DESK_COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                items={grouped[col.id]}
                onMove={handleMove}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
