'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SparklesIcon, ArrowUpTrayIcon, XMarkIcon, DocumentTextIcon, FolderOpenIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { SharingModeSelector } from '@/components/work/sharing-mode-selector';
import type { SharingMode } from '@/lib/workflows/types';
import { AgentKnowledgeFile } from './agent-knowledge-section';
import { AGENT_ICONS, AgentIcon, DEFAULT_ICON } from './agent-icons';
import { DriveFilePicker } from './drive-file-picker';

const COLORS = [
  { key: 'indigo',  bg: 'bg-indigo-500',  ring: 'ring-indigo-500'  },
  { key: 'violet',  bg: 'bg-violet-500',  ring: 'ring-violet-500'  },
  { key: 'blue',    bg: 'bg-blue-500',    ring: 'ring-blue-500'    },
  { key: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { key: 'amber',   bg: 'bg-amber-500',   ring: 'ring-amber-500'   },
  { key: 'rose',    bg: 'bg-rose-500',    ring: 'ring-rose-500'    },
  { key: 'neutral', bg: 'bg-neutral-500', ring: 'ring-neutral-500' },
];

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
]);

export interface AgentFormData {
  name: string;
  description: string;
  instructions: string;
  color: string;
  icon: string;
  conversation_starters?: string[] | null;
  web_enabled?: boolean;
}

interface Props {
  initial?: AgentFormData & { id?: string; memory_text?: string; sources?: AgentKnowledgeFile[]; conversation_starters?: string[] | null; web_enabled?: boolean; shared_with_company?: boolean; sharing_mode?: SharingMode | null };
  mode: 'create' | 'edit';
}

export function AgentForm({ initial, mode }: Props) {
  const router = useRouter();
  const [name, setName]               = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [color, setColor]             = useState(initial?.color ?? 'indigo');
  const [icon, setIcon]               = useState(initial?.icon ?? DEFAULT_ICON);
  const [sources, setSources]         = useState<AgentKnowledgeFile[]>(initial?.sources ?? []);
  const [saving, setSaving]           = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  // true while we're waiting for the first token to arrive
  const [enhancePending, setEnhancePending] = useState(false);
  const [memoryText, setMemoryText] = useState(initial?.memory_text ?? '');
  const [confirmingResetMemory, setConfirmingResetMemory] = useState(false);
  const [resettingMemory, setResettingMemory] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [starters, setStarters] = useState<string[]>(
    initial?.conversation_starters?.filter(Boolean) ?? []
  );
  const [isGeneratingStarters, setIsGeneratingStarters] = useState(false);
  const [webEnabled, setWebEnabled] = useState(initial?.web_enabled ?? false);
  const [sharingMode, setSharingMode] = useState<SharingMode | null>(initial?.sharing_mode ?? null);

  const enhanceAbortRef = useRef<AbortController | null>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  // capture instructions before clearing, for error rollback
  const prevInstructionsRef = useRef('');

  const colorDef = COLORS.find((c) => c.key === color) ?? COLORS[0];

  // ── Enhance ───────────────────────────────────────────────────────────────

  async function handleEnhance() {
    if (isEnhancing || instructions.trim().length < 5) return;
    enhanceAbortRef.current?.abort();
    const abort = new AbortController();
    enhanceAbortRef.current = abort;

    prevInstructionsRef.current = instructions;
    setIsEnhancing(true);
    setEnhancePending(true);
    setInstructions('');

    try {
      const res = await fetch('/api/agents/enhance-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, instructions: prevInstructionsRef.current }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error('Enhance failed');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const { delta } = JSON.parse(payload) as { delta: string };
            if (delta) {
              setEnhancePending(false);
              setInstructions((prev) => prev + delta);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        setInstructions(prevInstructionsRef.current);
      }
    } finally {
      setIsEnhancing(false);
      setEnhancePending(false);
    }
  }

  // ── Generate starters ─────────────────────────────────────────────────────

  async function handleGenerateStarters() {
    if (isGeneratingStarters || !name.trim()) return;
    setIsGeneratingStarters(true);
    try {
      const res = await fetch('/api/agents/generate-starters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, instructions }),
      });
      if (!res.ok) throw new Error('Generate failed');
      const { starters: generated } = await res.json();
      if (Array.isArray(generated)) setStarters(generated.slice(0, 4));
    } catch {
      // silently ignore — user keeps current starters
    } finally {
      setIsGeneratingStarters(false);
    }
  }

  // ── File upload (inline, no separate component) ───────────────────────────

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!ALLOWED_MIME.has(file.type) || file.size > 25 * 1024 * 1024) continue;

        const presignRes = await fetch('/api/drive/upload/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ filename: file.name, mimeType: file.type, size: file.size }] }),
        });
        if (!presignRes.ok) continue;
        const { uploads } = await presignRes.json();
        const { signedUrl, storagePath } = uploads[0];

        await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

        const confirmRes = await fetch('/api/drive/upload/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: storagePath, filename: file.name, mimeType: file.type, sizeBytes: file.size }),
        });
        if (!confirmRes.ok) continue;
        const kbFile = await confirmRes.json();

        if (initial?.id) {
          const attachRes = await fetch(`/api/agents/${initial.id}/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ knowledge_file_id: kbFile.id, name: file.name }),
          });
          if (attachRes.ok) {
            const { source } = await attachRes.json();
            setSources((prev) => [...prev, source]);
          }
        } else {
          setSources((prev) => [...prev, { id: `pending-${kbFile.id}`, name: file.name, knowledge_file_id: kbFile.id }]);
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDrivePickerConfirm(files: Array<{ knowledge_file_id: string; name: string }>) {
    setShowDrivePicker(false);
    for (const file of files) {
      if (initial?.id) {
        const res = await fetch(`/api/agents/${initial.id}/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(file),
        });
        if (res.ok) {
          const { source } = await res.json();
          setSources((prev) => [...prev, source]);
        }
      } else {
        setSources((prev) => [
          ...prev,
          { id: `pending-${file.knowledge_file_id}`, name: file.name, knowledge_file_id: file.knowledge_file_id },
        ]);
      }
    }
  }

  async function handleRemoveSource(sourceId: string) {
    if (initial?.id && !sourceId.startsWith('pending-')) {
      await fetch(`/api/agents/${initial.id}/knowledge/${sourceId}`, { method: 'DELETE' });
    }
    setSources((prev) => prev.filter((s) => s.id !== sourceId));
  }

  // ── Save / Delete ─────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return; }
    setError(null);
    setSaving(true);
    try {
      let agentId = initial?.id;
      const startersPayload = starters.filter(s => s.trim()).slice(0, 4);
      const startersToSend = startersPayload.length > 0 ? startersPayload : null;

      if (mode === 'create') {
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, instructions, color, icon, conversation_starters: startersToSend, web_enabled: webEnabled, sharing_mode: sharingMode, shared_with_company: sharingMode !== null }),
        });
        if (!res.ok) throw new Error('Failed to create agent');
        const { agent } = await res.json();
        agentId = agent.id;
        for (const src of sources.filter((s) => s.id.startsWith('pending-'))) {
          await fetch(`/api/agents/${agentId}/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ knowledge_file_id: src.knowledge_file_id, name: src.name }),
          });
        }
        router.push(`/work?agent=${agentId}`);
        return;
      } else {
        await fetch(`/api/agents/${agentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, instructions, color, icon, conversation_starters: startersToSend, web_enabled: webEnabled, sharing_mode: sharingMode, shared_with_company: sharingMode !== null }),
        });
      }
      router.push('/home');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetMemory() {
    if (!initial?.id) return;
    setResettingMemory(true);
    await fetch(`/api/agents/${initial.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory_text: null }),
    });
    setMemoryText('');
    setConfirmingResetMemory(false);
    setResettingMemory(false);
  }

  async function handleDelete() {
    if (!initial?.id) return;
    setDeleting(true);
    try {
      await fetch(`/api/agents/${initial.id}`, { method: 'DELETE' });
      router.push('/home');
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── Header with actions ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100 bg-white flex-shrink-0">
        <h1 className="text-[13.5px] font-semibold text-neutral-900">
          {mode === 'create' ? 'New agent' : `Edit · ${initial?.name}`}
        </h1>
        <div className="flex items-center gap-2">
          {error && <span className="text-[11.5px] text-red-500 mr-1">{error}</span>}
          {mode === 'edit' && !confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="px-3 py-1.5 rounded-lg text-[12px] text-red-500 hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          )}
          {confirmingDelete && (
            <div className="flex items-center gap-2 pl-1">
              <span className="text-[12px] text-neutral-500">Delete agent and all its chats?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="px-3 py-1.5 rounded-lg text-[12px] text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          {!confirmingDelete && (
            <button
              type="button"
              onClick={() => router.push('/home')}
              className="px-3 py-1.5 rounded-lg text-[12px] text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create agent' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 gap-4 p-4 overflow-hidden">

        {/* Left — Preview */}
        <div className="w-[180px] flex-shrink-0 flex flex-col gap-3">
          <div className={`rounded-2xl p-4 flex flex-col items-center gap-3 border border-neutral-100 bg-white shadow-sm`}>
            <div className={`w-14 h-14 rounded-2xl ${colorDef.bg} flex items-center justify-center shadow-sm`}>
              <AgentIcon iconKey={icon} className="w-7 h-7 text-white" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-neutral-900 text-[12.5px] leading-snug">{name || 'Untitled agent'}</p>
              {description && (
                <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed line-clamp-3">{description}</p>
              )}
            </div>
          </div>

          {memoryText && (
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide">Memory</p>
                {confirmingResetMemory ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleResetMemory}
                      disabled={resettingMemory}
                      className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => setConfirmingResetMemory(false)}
                      className="px-1.5 py-0.5 text-neutral-500 hover:text-neutral-700 text-[10px] font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingResetMemory(true)}
                    className="text-[10px] text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
              <p className="text-[11.5px] text-neutral-600 leading-relaxed whitespace-pre-wrap">{memoryText}</p>
            </div>
          )}
        </div>

        {/* Right — Config card */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">

          {/* Identity row */}
          <div className="rounded-2xl bg-white border border-neutral-100 shadow-sm p-4 flex-shrink-0">
            <div className="flex gap-4">
              {/* Icons */}
              <div className="flex-shrink-0">
                <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide mb-2">Icon</p>
                <div className="flex gap-1 flex-wrap" style={{ maxWidth: 196 }}>
                  {AGENT_ICONS.map(({ key, Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setIcon(key)}
                      className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
                        icon === key
                          ? 'bg-neutral-200 ring-2 ring-neutral-400'
                          : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="w-px bg-neutral-100 flex-shrink-0" />

              {/* Color + Name + Description */}
              <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                <div>
                  <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide mb-1.5">Color</p>
                  <div className="flex gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setColor(c.key)}
                        className={`w-5 h-5 rounded-full ${c.bg} transition-all flex-shrink-0 ${
                          color === c.key ? `ring-2 ring-offset-1 ${c.ring}` : 'opacity-60 hover:opacity-100'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide mb-1">Name</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Proposal Writer"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 text-[12.5px] text-neutral-900 placeholder-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide mb-1">
                      Description <span className="normal-case font-normal text-neutral-300">(optional)</span>
                    </label>
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Shown in the sidebar"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 text-[12.5px] text-neutral-900 placeholder-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Instructions — flex-1 fills remaining space, min-h ensures usable size on small screens */}
          <div className="flex-1 min-h-[180px] rounded-2xl bg-white border border-neutral-100 shadow-sm p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide">Instructions</p>
                <p className="text-[11px] text-neutral-400 mt-0.5">How this agent should behave, what to focus on, constraints.</p>
              </div>
              <button
                type="button"
                onClick={handleEnhance}
                disabled={isEnhancing || instructions.trim().length < 5}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                <SparklesIcon className={`w-3.5 h-3.5 ${isEnhancing ? 'animate-spin' : ''}`} />
                {isEnhancing ? 'Enhancing…' : 'Enhance'}
              </button>
            </div>

            {/* Textarea / Skeleton */}
            <div className="flex-1 min-h-0 relative">
              {/* Shimmer skeleton — shown while waiting for first token */}
              {enhancePending && (
                <div className="absolute inset-0 rounded-lg border border-indigo-200 bg-indigo-50/30 p-3 flex flex-col gap-2.5 overflow-hidden">
                  {[82, 96, 74, 91, 68, 88, 60].map((w, i) => (
                    <div
                      key={i}
                      className="h-3 rounded-full bg-indigo-200/70"
                      style={{
                        width: `${w}%`,
                        animation: 'pulse 1.4s ease-in-out infinite',
                        animationDelay: `${i * 0.1}s`,
                      }}
                    />
                  ))}
                </div>
              )}
              <textarea
                value={instructions}
                onChange={(e) => { if (!isEnhancing) setInstructions(e.target.value); }}
                placeholder="e.g. You are a proposal writer for consulting engagements. Always start with an executive summary. Our standard pricing is €1,500/day. Avoid passive voice."
                className={`w-full h-full px-3 py-2.5 rounded-lg border text-[12.5px] text-neutral-900 placeholder-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-none leading-relaxed transition-all duration-300 ${
                  isEnhancing
                    ? 'border-indigo-200 bg-indigo-50/20 focus:border-indigo-300'
                    : 'border-neutral-200 bg-white focus:border-indigo-300'
                } ${enhancePending ? 'opacity-0' : 'opacity-100'}`}
              />
            </div>
          </div>

          {/* Knowledge — compact inline row */}
          <div className="rounded-2xl bg-white border border-neutral-100 shadow-sm px-4 py-3 flex-shrink-0 flex items-center gap-3">
            <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide flex-shrink-0">Knowledge</p>

            {/* Attached file chips */}
            <div className="flex-1 flex items-center gap-2 flex-wrap min-w-0">
              {sources.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-neutral-100 text-[11.5px] text-neutral-600 max-w-[200px]">
                  <DocumentTextIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
                  <span className="truncate">{s.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(s.id)}
                    className="ml-0.5 text-neutral-400 hover:text-neutral-600 flex-shrink-0"
                  >
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {sources.length === 0 && (
                <span className="text-[11.5px] text-neutral-300">No files attached</span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 transition-colors"
                title="Upload a new file"
              >
                <ArrowUpTrayIcon className="w-3.5 h-3.5" />
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
              <button
                type="button"
                onClick={() => setShowDrivePicker(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] text-neutral-500 hover:bg-neutral-100 transition-colors"
                title="Choose from Drive"
              >
                <FolderOpenIcon className="w-3.5 h-3.5" />
                From Drive
              </button>
            </div>
          </div>

          {/* Web search */}
          <div className="rounded-2xl bg-white border border-neutral-100 shadow-sm px-4 py-3 flex-shrink-0 flex items-center justify-between">
            <div>
              <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide">Web Search</p>
              <p className="text-[11px] text-neutral-400 mt-0.5">Enable web search and URL fetching by default for this agent.</p>
            </div>
            <button
              type="button"
              onClick={() => setWebEnabled(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                webEnabled
                  ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                  : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
              }`}
            >
              <GlobeAltIcon className="w-3.5 h-3.5" />
              {webEnabled ? 'On' : 'Off'}
            </button>
          </div>

          {/* Share with team */}
          <div className="rounded-2xl bg-white border border-neutral-100 shadow-sm px-4 py-3 flex-shrink-0 space-y-2">
            <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide">Team Sharing</p>
            <SharingModeSelector value={sharingMode} onChange={setSharingMode} />
          </div>

          {/* Conversation starters */}
          <div className="rounded-2xl bg-white border border-neutral-100 shadow-sm px-4 py-3 flex-shrink-0 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10.5px] font-semibold text-neutral-600 uppercase tracking-wide">
                  Conversation Starters <span className="normal-case font-normal text-neutral-300">(optional)</span>
                </p>
                <p className="text-[11px] text-neutral-400 mt-0.5">Shown as quick-start prompts on the agent home screen.</p>
              </div>
              <button
                type="button"
                onClick={handleGenerateStarters}
                disabled={isGeneratingStarters || !name.trim()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                <SparklesIcon className={`w-3.5 h-3.5 ${isGeneratingStarters ? 'animate-spin' : ''}`} />
                {isGeneratingStarters ? 'Generating…' : 'Generate'}
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              {starters.map((starter, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={starter}
                    onChange={e => setStarters(prev => prev.map((s, j) => j === i ? e.target.value : s))}
                    placeholder="e.g. Draft a proposal for a new client"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-neutral-200 text-[12.5px] text-neutral-900 placeholder-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
                  />
                  <button
                    type="button"
                    onClick={() => setStarters(prev => prev.filter((_, j) => j !== i))}
                    className="text-neutral-300 hover:text-neutral-500 transition-colors flex-shrink-0"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {starters.length === 0 && !isGeneratingStarters && (
                <p className="text-[11.5px] text-neutral-300 px-0.5">No starters — auto-generated on save, or click Generate to preview.</p>
              )}
              {isGeneratingStarters && (
                <div className="flex flex-col gap-1.5">
                  {[72, 88, 65, 80].map((w, i) => (
                    <div
                      key={i}
                      className="h-8 rounded-lg bg-indigo-100/60"
                      style={{ width: `${w}%`, animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.1}s` }}
                    />
                  ))}
                </div>
              )}
            </div>

            {starters.length < 4 && !isGeneratingStarters && (
              <button
                type="button"
                onClick={() => setStarters(prev => [...prev, ''])}
                className="self-start text-[11.5px] text-indigo-500 hover:text-indigo-700 transition-colors"
              >
                + Add starter
              </button>
            )}
          </div>

          {/* Drive picker modal */}
          {showDrivePicker && (
            <DriveFilePicker
              alreadyAttached={sources.map((s) => s.knowledge_file_id)}
              onConfirm={handleDrivePickerConfirm}
              onClose={() => setShowDrivePicker(false)}
            />
          )}

        </div>
      </div>
    </div>
  );
}
