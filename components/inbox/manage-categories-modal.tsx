'use client';

import { useState, useRef, useEffect } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon, PencilIcon, Bars2Icon } from '@heroicons/react/24/outline';
import type { UserInboxCategory } from '@/lib/types/inbox';

interface Props {
  categories: UserInboxCategory[];
  onClose: () => void;
  onCreate: (cat: Omit<UserInboxCategory, 'id'>) => Promise<void>;
  onUpdate: (id: string, fields: Partial<Omit<UserInboxCategory, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  defaultOrder?: string[];
  onReorderDefaults?: (order: string[]) => Promise<void>;
}

const BUILTIN_SECTIONS: Array<{ key: string; name: string; description: string; dim?: boolean }> = [
  { key: 'reply',    name: 'Reply Needed', description: 'Emails where a reply is expected from you' },
  { key: 'decision', name: 'Decision',     description: 'Emails requiring a choice or approval' },
  { key: 'meeting',  name: 'Meeting',      description: 'Meeting invites or scheduling requests' },
  { key: 'review',   name: 'Review',       description: 'Documents or content sent for your review' },
  { key: 'fyi',      name: 'Noted',        description: 'FYI emails — no action required', dim: true },
];

type ListEntry =
  | { type: 'builtin'; key: string; name: string; description: string; dim?: boolean }
  | { type: 'custom'; key: string; cat: UserInboxCategory };

function buildDisplayList(orderedKeys: string[], categories: UserInboxCategory[]): ListEntry[] {
  const builtinMap = Object.fromEntries(BUILTIN_SECTIONS.map(s => [s.key, s]));
  const customMap = Object.fromEntries(categories.map(c => [c.name, c]));
  return orderedKeys
    .map(key => {
      if (key in builtinMap) return { type: 'builtin' as const, ...builtinMap[key] };
      if (key in customMap) return { type: 'custom' as const, key, cat: customMap[key] };
      return null;
    })
    .filter(Boolean) as ListEntry[];
}

export default function ManageCategoriesModal({ categories, onClose, onCreate, onUpdate, onDelete, defaultOrder, onReorderDefaults }: Props) {
  // Unified ordered keys: both built-in keys and custom category names in one array
  const [localOrder, setLocalOrder] = useState<string[]>(() => {
    const all = [...BUILTIN_SECTIONS.map(s => s.key), ...categories.map(c => c.name)];
    if (!defaultOrder) return all;
    return [...defaultOrder.filter(k => all.includes(k)), ...all.filter(k => !defaultOrder.includes(k))];
  });

  // Sync when categories change (new ones added or deleted while modal is open)
  useEffect(() => {
    const validKeys = new Set([
      ...BUILTIN_SECTIONS.map(s => s.key),
      ...categories.map(c => c.name),
    ]);
    setLocalOrder(prev => {
      const filtered = prev.filter(k => validKeys.has(k));
      const newKeys = categories.map(c => c.name).filter(k => !prev.includes(k));
      if (filtered.length === prev.length && newKeys.length === 0) return prev;
      return [...filtered, ...newKeys];
    });
  }, [categories]);

  const dragKeyRef = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const handleDragStart = (key: string) => { dragKeyRef.current = key; };
  const handleDragOver = (e: React.DragEvent, key: string) => { e.preventDefault(); setDragOverKey(key); };
  const handleDrop = (targetKey: string) => {
    const from = dragKeyRef.current;
    if (!from || from === targetKey) { setDragOverKey(null); return; }
    const next = [...localOrder];
    const fromIdx = next.indexOf(from);
    const toIdx = next.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) { setDragOverKey(null); return; }
    next.splice(toIdx, 0, next.splice(fromIdx, 1)[0]);
    setLocalOrder(next);
    setDragOverKey(null);
    dragKeyRef.current = null;
    onReorderDefaults?.(next);
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (cat: UserInboxCategory) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDesc(cat.description);
  };

  const submitEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    await onUpdate(editingId, { name: editName.trim(), description: editDesc.trim() });
    setSaving(false);
    setEditingId(null);
  };

  const submitCreate = async () => {
    if (!newName.trim() || !newDesc.trim()) return;
    setSaving(true);
    await onCreate({ name: newName.trim(), description: newDesc.trim() });
    setSaving(false);
    setNewName('');
    setNewDesc('');
    setCreating(false);
  };

  const displayList = buildDisplayList(localOrder, categories);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-800">Smart Categories</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5">Drag to reorder · AI will auto-assign emails to your custom categories</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        {/* Unified drag list */}
        <div className="max-h-[360px] overflow-y-auto px-4 py-3 space-y-0.5">
          {displayList.map(entry => {
            const isCustom = entry.type === 'custom';
            const key = entry.key;
            const isEditing = isCustom && editingId === entry.cat.id;

            return (
              <div
                key={key}
                draggable={!isEditing}
                onDragStart={() => !isEditing && handleDragStart(key)}
                onDragOver={(e) => handleDragOver(e, key)}
                onDrop={() => handleDrop(key)}
                onDragLeave={() => setDragOverKey(null)}
                className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-colors ${
                  dragOverKey === key ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-neutral-50 hover:bg-neutral-100'
                }`}
              >
                <Bars2Icon className="w-3.5 h-3.5 text-neutral-300 cursor-grab flex-shrink-0" />

                {isEditing ? (
                  <div className="flex-1 space-y-1.5">
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Category name"
                      autoFocus
                      className="w-full border border-neutral-200 rounded-lg px-2.5 py-1 text-[13px] focus:outline-none focus:border-indigo-400"
                    />
                    <textarea
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      placeholder="Describe when the AI should assign this category…"
                      rows={2}
                      className="w-full border border-neutral-200 rounded-lg px-2.5 py-1 text-[12px] resize-none focus:outline-none focus:border-indigo-400 text-neutral-700"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="px-2.5 py-1 text-[11px] text-neutral-500 hover:text-neutral-700">Cancel</button>
                      <button onClick={submitEdit} disabled={saving} className="px-2.5 py-1 text-[11px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className={`text-[11px] font-semibold uppercase tracking-wide flex-shrink-0 w-[100px] ${
                      isCustom ? 'text-indigo-600' : entry.dim ? 'text-neutral-400' : 'text-neutral-600'
                    }`}>
                      {entry.type === 'builtin' ? entry.name : entry.cat.name}
                    </span>
                    <span className="text-[11px] text-neutral-400 flex-1 min-w-0 truncate">
                      {entry.type === 'builtin' ? entry.description : entry.cat.description}
                    </span>
                    {isCustom && (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => startEdit(entry.cat)} className="p-1 rounded hover:bg-white text-neutral-400 hover:text-neutral-600"><PencilIcon className="w-3.5 h-3.5" /></button>
                        <button onClick={() => onDelete(entry.cat.id)} className="p-1 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500"><TrashIcon className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Create form */}
          {creating && (
            <div className="mt-1 border border-dashed border-indigo-200 rounded-lg px-3 py-2.5 space-y-1.5 bg-indigo-50/30">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Category name (e.g. VIP Partners)"
                autoFocus
                className="w-full border border-neutral-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-indigo-400 bg-white"
              />
              <textarea
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Describe when the AI should assign this — e.g. 'Emails from key clients needing personal attention'"
                rows={2}
                className="w-full border border-neutral-200 rounded-lg px-2.5 py-1.5 text-[12px] resize-none focus:outline-none focus:border-indigo-400 text-neutral-700 bg-white"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-[12px] text-neutral-500 hover:text-neutral-700">Cancel</button>
                <button onClick={submitCreate} disabled={saving || !newName.trim() || !newDesc.trim()} className="px-3 py-1.5 text-[12px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                  {saving ? 'Creating…' : <><PlusIcon className="w-3.5 h-3.5" />Create</>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!creating && (
          <div className="px-5 py-3 border-t border-neutral-100">
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-neutral-200 text-[12px] text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Add category
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
