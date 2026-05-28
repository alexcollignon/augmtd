'use client';

import { useState, useRef } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon, PencilIcon, CheckIcon, Bars2Icon, LockClosedIcon } from '@heroicons/react/24/outline';
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

const ALL_DEFAULT_SECTIONS: Array<{ key: string; name: string; description: string; dim?: boolean }> = [
  { key: 'reply',    name: 'Reply Needed', description: 'Emails where a reply is expected from you' },
  { key: 'decision', name: 'Decision',     description: 'Emails requiring a choice or approval' },
  { key: 'meeting',  name: 'Meeting',      description: 'Meeting invites or scheduling requests' },
  { key: 'review',   name: 'Review',       description: 'Documents or content sent for your review' },
  { key: 'fyi',      name: 'Noted',        description: 'FYI emails — no action required', dim: true },
];

export default function ManageCategoriesModal({ categories, onClose, onCreate, onUpdate, onDelete, defaultOrder, onReorderDefaults }: Props) {
  const orderedDefaults = defaultOrder
    ? [...ALL_DEFAULT_SECTIONS].sort((a, b) => {
        const ai = defaultOrder.indexOf(a.key);
        const bi = defaultOrder.indexOf(b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
    : ALL_DEFAULT_SECTIONS;

  const [localOrder, setLocalOrder] = useState(orderedDefaults);
  const dragKeyRef = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const handleDragStart = (key: string) => { dragKeyRef.current = key; };
  const handleDragOver = (e: React.DragEvent, key: string) => { e.preventDefault(); setDragOverKey(key); };
  const handleDrop = (targetKey: string) => {
    const from = dragKeyRef.current;
    if (!from || from === targetKey) { setDragOverKey(null); return; }
    const next = [...localOrder];
    const fromIdx = next.findIndex(s => s.key === from);
    const toIdx = next.findIndex(s => s.key === targetKey);
    next.splice(toIdx, 0, next.splice(fromIdx, 1)[0]);
    setLocalOrder(next);
    setDragOverKey(null);
    dragKeyRef.current = null;
    onReorderDefaults?.(next.map(s => s.key));
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (cat: UserInboxCategory) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDesc(cat.description);
    setEditEmoji(cat.emoji ?? '');
  };

  const submitEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    await onUpdate(editingId, { name: editName.trim(), description: editDesc.trim(), emoji: editEmoji.trim() || undefined });
    setSaving(false);
    setEditingId(null);
  };

  const submitCreate = async () => {
    if (!newName.trim() || !newDesc.trim()) return;
    setSaving(true);
    await onCreate({ name: newName.trim(), description: newDesc.trim(), emoji: newEmoji.trim() || undefined });
    setSaving(false);
    setNewName('');
    setNewDesc('');
    setNewEmoji('');
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-800">Smart Categories</h2>
            <p className="text-[12px] text-neutral-400 mt-0.5">AI will auto-assign emails to your custom categories</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        {/* Built-in (read-only) categories */}
        <div className="px-5 pt-3 pb-1">
          <div className="flex items-center gap-1.5 mb-2">
            <LockClosedIcon className="w-3 h-3 text-neutral-300" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-300">Built-in</span>
          </div>
          <div className="space-y-0.5">
            {localOrder.map(cat => (
              <div
                key={cat.key}
                draggable
                onDragStart={() => handleDragStart(cat.key)}
                onDragOver={(e) => handleDragOver(e, cat.key)}
                onDrop={() => handleDrop(cat.key)}
                onDragLeave={() => setDragOverKey(null)}
                className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-colors ${dragOverKey === cat.key ? 'bg-indigo-50 border border-indigo-200' : 'bg-neutral-50'}`}
              >
                <Bars2Icon className="w-3.5 h-3.5 text-neutral-300 cursor-grab flex-shrink-0" />
                <span className={`text-[11px] font-semibold uppercase tracking-wide flex-shrink-0 w-24 ${cat.dim ? 'text-neutral-400' : 'text-neutral-600'}`}>{cat.name}</span>
                <span className="text-[11px] text-neutral-400">{cat.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider + custom section label */}
        <div className="flex items-center gap-2 px-5 pt-3 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Your categories</span>
          <div className="flex-1 h-px bg-neutral-100" />
        </div>

        {/* Custom category list */}
        <div className="max-h-[200px] overflow-y-auto divide-y divide-neutral-50">
          {categories.length === 0 && !creating && (
            <p className="px-5 py-4 text-[12px] text-neutral-400 text-center">No custom categories yet. Create one below.</p>
          )}
          {categories.map(cat => (
            <div key={cat.id} className="px-5 py-3">
              {editingId === cat.id ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={editEmoji}
                      onChange={e => setEditEmoji(e.target.value)}
                      placeholder="😀"
                      className="w-10 text-center border border-neutral-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-indigo-400"
                    />
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Category name"
                      className="flex-1 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-indigo-400"
                    />
                  </div>
                  <textarea
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    placeholder="Describe when the AI should assign this category…"
                    rows={2}
                    className="w-full border border-neutral-200 rounded-lg px-2.5 py-1.5 text-[12px] resize-none focus:outline-none focus:border-indigo-400 text-neutral-700"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-[12px] text-neutral-500 hover:text-neutral-700">Cancel</button>
                    <button onClick={submitEdit} disabled={saving} className="px-3 py-1.5 text-[12px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  {cat.emoji && <span className="text-[18px] flex-shrink-0 mt-0.5">{cat.emoji}</span>}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-neutral-800">{cat.name}</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5 line-clamp-2">{cat.description}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(cat)} className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"><PencilIcon className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onDelete(cat.id)} className="p-1 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500"><TrashIcon className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Create form */}
          {creating && (
            <div className="px-5 py-3 space-y-2">
              <div className="flex gap-2">
                <input
                  value={newEmoji}
                  onChange={e => setNewEmoji(e.target.value)}
                  placeholder="😀"
                  className="w-10 text-center border border-neutral-200 rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-indigo-400"
                  autoFocus
                />
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Category name (e.g. VIP Partners)"
                  className="flex-1 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-indigo-400"
                />
              </div>
              <textarea
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Describe when the AI should assign this — e.g. 'Emails from key clients or partners needing personal attention'"
                rows={2}
                className="w-full border border-neutral-200 rounded-lg px-2.5 py-1.5 text-[12px] resize-none focus:outline-none focus:border-indigo-400 text-neutral-700"
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
