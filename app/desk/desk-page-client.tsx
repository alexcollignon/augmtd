'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowPathIcon, SparklesIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';
import { DESK_COLUMNS } from '@/lib/types/desk';
import KanbanColumn from '@/components/desk/kanban-column';
import DeskChatSidebar from '@/components/desk/desk-chat-sidebar';
import CardDetailPanel from '@/components/desk/card-detail-panel';

export default function DeskPageClient() {
  const router = useRouter();
  const [items, setItems] = useState<DeskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const synthesisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const synthesisStartRef = useRef<Date | null>(null);
  const syncInProgressRef = useRef(false);

  const loadItems = useCallback(async () => {
    const res = await fetch('/api/desk');
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items ?? []);
  }, []);

  useEffect(() => {
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

  const handleConfirm = useCallback((itemId: string) => {
    handleMove(itemId, 'todo');
  }, [handleMove]);

  const handleSelectCard = useCallback((id: string) => {
    setSelectedCardId((prev) => (prev === id ? null : id));
    setChatOpen(false);
  }, []);

  const handleAddTask = useCallback(async (title: string) => {
    setAddingTask(false);
    const tempId = crypto.randomUUID();
    const now = new Date().toISOString();
    const optimistic: DeskItem = {
      id: tempId,
      userId: '',
      sourceType: 'manual',
      sourceId: tempId,
      threadKey: null,
      sourceRefs: [],
      column: 'todo',
      position: 0,
      title,
      description: null,
      sourceUrl: null,
      urgency: null,
      aiContext: null,
      synthesis: null,
      synthesisAt: null,
      emailCount: 1,
      hasPrepared: false,
      createdAt: now,
      updatedAt: now,
    };
    setItems((prev) => [optimistic, ...prev]);
    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, kanban_column: 'todo' }),
      });
      if (res.ok) {
        const { item } = await res.json();
        setItems((prev) => prev.map((i) => (i.id === tempId ? item : i)));
      } else {
        setItems((prev) => prev.filter((i) => i.id !== tempId));
      }
    } catch {
      setItems((prev) => prev.filter((i) => i.id !== tempId));
    }
  }, []);

  const handleTaskCreated = useCallback((item: DeskItem) => {
    setItems((prev) => [item, ...prev]);
  }, []);

  const handleOpenWorkflow = useCallback((itemId: string, skill?: string, prefillTitle?: string) => {
    const params = new URLSearchParams();
    if (skill) params.set('skill', skill);
    if (prefillTitle) params.set('title', prefillTitle);
    if (itemId) params.set('fromItem', itemId);
    router.push(`/work/new?${params.toString()}`);
  }, [router]);

  const handleOpenProcess = useCallback((processId: string) => {
    router.push(`/processes/${processId}`);
  }, [router]);

  const grouped = DESK_COLUMNS.reduce<Record<DeskColumn, DeskItem[]>>(
    (acc, col) => {
      acc[col.id] = items
        .filter((i) => i.column === col.id)
        .sort((a, b) => a.position - b.position);
      return acc;
    },
    { pool: [], todo: [], in_progress: [], waiting: [], done: [] }
  );

  const activeCount = items.filter((i) => i.column !== 'done').length;
  const synthesisPending = items.some((i) => i.sourceType === 'email' && !i.synthesis && !i.synthesisAt);
  const selectedItem = items.find((i) => i.id === selectedCardId) ?? null;

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
            onClick={() => {
              setAddingTask(true);
              setSelectedCardId(null);
              setChatOpen(false);
            }}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold border border-neutral-300 text-neutral-600 hover:bg-neutral-50 transition-colors"
            title="Add task"
          >
            <PlusIcon className="w-3 h-3" />
            Add task
          </button>
          <button
            onClick={() => { setChatOpen((v) => !v); setSelectedCardId(null); }}
            className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
              chatOpen
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'border-indigo-400 text-indigo-500 hover:bg-indigo-50'
            }`}
            title="Ask AI"
          >
            <SparklesIcon className="w-3 h-3" />
            Ask AI
          </button>
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

      {/* Board + sidebars */}
      <div className="flex flex-row flex-1 overflow-hidden">
        <div className="flex-1 overflow-x-auto px-6 py-6">
          {loading ? (
            <div className="grid grid-cols-5 gap-4">
              {DESK_COLUMNS.map((col) => (
                <div key={col.id} className="bg-neutral-50 rounded h-48 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-4 min-w-[950px]">
              {DESK_COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.id}
                  id={col.id}
                  label={col.label}
                  items={grouped[col.id]}
                  onMove={handleMove}
                  onDismiss={handleDismiss}
                  onConfirm={col.id === 'pool' ? handleConfirm : undefined}
                  onSelect={handleSelectCard}
                  addingTask={addingTask && col.id === 'todo'}
                  onAddTask={handleAddTask}
                  onCancelAddTask={() => setAddingTask(false)}
                />
              ))}
            </div>
          )}
        </div>

        {selectedItem && (
          <CardDetailPanel
            item={selectedItem}
            onClose={() => setSelectedCardId(null)}
            onMove={handleMove}
            onDismiss={handleDismiss}
          />
        )}

        <DeskChatSidebar
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          boardItems={items}
          onDeskMove={handleMove}
          onDeskDismiss={handleDismiss}
          onDeskConfirm={handleConfirm}
          onOpenWorkflow={handleOpenWorkflow}
          onOpenProcess={handleOpenProcess}
          onTaskCreated={handleTaskCreated}
        />
      </div>
    </div>
  );
}
