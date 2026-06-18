'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  AcademicCapIcon, PlusIcon, PencilSquareIcon, TrashIcon, XMarkIcon,
  ArrowUpTrayIcon, ArrowDownTrayIcon, CheckIcon,
} from '@heroicons/react/24/outline';
import { parseSkillMarkdown, skillToMarkdown, skillFilename } from '@/lib/skills/markdown';
import { Button, IconButton, Input, Textarea, Card, EmptyState } from '@/components/ui';

const ROLE_AVATARS: Record<string, string> = {
  personal_assistant: '/workers/clara.png',
  content_manager:    '/workers/sofia.png',
  linkedin_drafter:   '/workers/luca.png',
  research_analyst:   '/workers/max.png',
};

interface SkillWorker { id: string; name: string; worker_role: string | null }
interface Skill {
  id: string;
  name: string;
  when_to_use: string | null;
  content: string;
  source: string;
  workers: SkillWorker[];
}

interface RosterWorker { id: string; name: string; worker_role: string | null }

interface SkillsLibraryViewProps {
  workers: RosterWorker[];
}

type Draft = { id: string | null; name: string; when_to_use: string; content: string; source?: string };

const EMPTY_DRAFT: Draft = { id: null, name: '', when_to_use: '', content: '' };

function WorkerDot({ w }: { w: SkillWorker }) {
  const src = w.worker_role ? ROLE_AVATARS[w.worker_role] : null;
  if (src) return <img src={src} alt={w.name} title={w.name} className="w-6 h-6 rounded-md object-cover object-top ring-2 ring-white" />;
  return (
    <div title={w.name} className="w-6 h-6 rounded-md bg-neutral-200 flex items-center justify-center ring-2 ring-white">
      <span className="text-[9px] font-semibold text-neutral-500">{w.name[0]}</span>
    </div>
  );
}

export function SkillsLibraryView({ workers }: SkillsLibraryViewProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    fetch('/api/skills')
      .then(r => r.json())
      .then(({ skills }) => setSkills(skills ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!draft || isSaving) return;
    const name = draft.name.trim();
    const content = draft.content.trim();
    if (!name || !content) return;
    setIsSaving(true);
    try {
      const payload = { name, when_to_use: draft.when_to_use.trim() || null, content, source: draft.source ?? 'manual' };
      if (draft.id) {
        await fetch(`/api/skills/${draft.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/skills', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      }
      setDraft(null);
      load();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setConfirmDelete(null);
    setSkills(prev => prev.filter(s => s.id !== id)); // optimistic
    await fetch(`/api/skills/${id}`, { method: 'DELETE' });
  }

  // Import a .md file (Claude SKILL.md style) → parse → open the editor so the
  // user reviews/edits before it's saved. Source tagged 'extracted'.
  async function handleImportFile(file: File) {
    const text = await file.text();
    const fallback = file.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ');
    const parsed = parseSkillMarkdown(text, fallback);
    setDraft({ id: null, name: parsed.name, when_to_use: parsed.when_to_use, content: parsed.content, source: 'imported' });
  }

  // Toggle a single worker's assignment of a skill, straight from the card.
  async function toggleAssign(skill: Skill, worker: RosterWorker) {
    const isOn = skill.workers.some(w => w.id === worker.id);
    setSkills(prev => prev.map(s => s.id !== skill.id ? s : {
      ...s,
      workers: isOn
        ? s.workers.filter(w => w.id !== worker.id)
        : [...s.workers, { id: worker.id, name: worker.name, worker_role: worker.worker_role }],
    })); // optimistic
    await fetch(`/api/skills/${skill.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: worker.id, assigned: !isOn }),
    });
  }

  function handleExport(skill: Skill) {
    const md = skillToMarkdown(skill);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = skillFilename(skill.name);
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="h-full rounded-2xl bg-white shadow-sm overflow-y-auto">
      <div className="mx-auto max-w-[1120px] px-10 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <AcademicCapIcon className="w-5 h-5 text-indigo-500" />
            <h1 className="text-[18px] font-semibold text-neutral-800">Skills</h1>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = ''; // allow re-importing the same file
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} title="Import a .md skill file">
              <ArrowUpTrayIcon className="w-4 h-4" /> Import
            </Button>
            <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              <PlusIcon className="w-4 h-4" /> New skill
            </Button>
          </div>
        </div>
        <p className="text-[13px] text-neutral-500 mb-7">
          Reusable instructions for <span className="font-medium text-neutral-700">how</span> your team produces work — assign one to a worker and they apply it automatically.
        </p>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-36 rounded-2xl bg-neutral-100 animate-pulse" />)}
          </div>
        ) : skills.length === 0 ? (
          <EmptyState
            bordered
            icon={AcademicCapIcon}
            title="No skills yet"
            description="Capture how you want a kind of work done once — a writing style, a report format, a research method, a review checklist — and any worker can apply it."
            action={
              <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
                <PlusIcon className="w-4 h-4" /> Create your first skill
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {skills.map(skill => (
              <Card key={skill.id} interactive className="group relative p-4 flex flex-col">
                <div className="flex items-start gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <AcademicCapIcon className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13.5px] font-semibold text-neutral-800 truncate">{skill.name}</h3>
                    {skill.when_to_use && (
                      <p className="text-[11px] text-neutral-400 truncate mt-0.5">{skill.when_to_use}</p>
                    )}
                  </div>
                </div>

                <p className="text-[12px] text-neutral-500 leading-relaxed line-clamp-3 flex-1">
                  {skill.content}
                </p>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-100">
                  {/* Assign control — avatars of assigned workers, click to manage */}
                  <div className="relative">
                    <button
                      onClick={() => setAssignOpen(open => open === skill.id ? null : skill.id)}
                      className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 -ml-1 hover:bg-neutral-50 transition-colors"
                    >
                      {skill.workers.length > 0 ? (
                        <>
                          <div className="flex -space-x-1.5">
                            {skill.workers.slice(0, 4).map(w => <WorkerDot key={w.id} w={w} />)}
                          </div>
                          {skill.workers.length > 4 && (
                            <span className="text-[10.5px] text-neutral-400 ml-0.5">+{skill.workers.length - 4}</span>
                          )}
                        </>
                      ) : (
                        <span className="flex items-center gap-1 text-[11.5px] text-indigo-600 font-medium">
                          <PlusIcon className="w-3.5 h-3.5" /> Assign
                        </span>
                      )}
                    </button>

                    {assignOpen === skill.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setAssignOpen(null)} />
                        <div className="absolute bottom-full left-0 mb-2 z-20 w-56 rounded-xl border border-neutral-200 bg-white shadow-lg p-1.5">
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Assign to</p>
                          {workers.length === 0 ? (
                            <p className="px-2 py-2 text-[12px] text-neutral-400">No workers yet</p>
                          ) : workers.map(w => {
                            const on = skill.workers.some(x => x.id === w.id);
                            return (
                              <button
                                key={w.id}
                                onClick={() => toggleAssign(skill, w)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-neutral-50 transition-colors"
                              >
                                <WorkerDot w={{ id: w.id, name: w.name, worker_role: w.worker_role }} />
                                <span className="text-[12.5px] text-neutral-700 flex-1 text-left truncate">{w.name}</span>
                                {on && <CheckIcon className="w-4 h-4 text-indigo-600 flex-shrink-0" strokeWidth={2.5} />}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconButton size="sm" onClick={() => handleExport(skill)} title="Export .md">
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      onClick={() => setDraft({ id: skill.id, name: skill.name, when_to_use: skill.when_to_use ?? '', content: skill.content })}
                      title="Edit"
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                    </IconButton>
                    {confirmDelete === skill.id ? (
                      <Button variant="danger" size="sm" onClick={() => handleDelete(skill.id)}>Delete</Button>
                    ) : (
                      <IconButton
                        size="sm"
                        tone="danger"
                        onClick={() => setConfirmDelete(skill.id)}
                        onMouseLeave={() => setConfirmDelete(c => c === skill.id ? null : c)}
                        title="Delete"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </IconButton>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Editor modal */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !isSaving && setDraft(null)}>
          <div
            className="w-full max-w-[560px] rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
              <h2 className="text-[14px] font-semibold text-neutral-800">{draft.id ? 'Edit skill' : 'New skill'}</h2>
              <IconButton onClick={() => setDraft(null)}>
                <XMarkIcon className="w-5 h-5" />
              </IconButton>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">Name</label>
                <Input
                  value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Client report format"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">
                  Use when <span className="text-neutral-400 font-normal">— optional, helps the worker pick the right skill</span>
                </label>
                <Input
                  value={draft.when_to_use}
                  onChange={e => setDraft({ ...draft, when_to_use: e.target.value })}
                  placeholder="e.g. When writing a client report"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">Instructions</label>
                <Textarea
                  value={draft.content}
                  onChange={e => setDraft({ ...draft, content: e.target.value })}
                  rows={9}
                  placeholder={`The rules the worker should follow when this applies. e.g.\n\n- Lead with the recommendation, then the rationale\n- One page max; cite every figure\n- UK English, metric units\n- No jargon or filler`}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-neutral-100 bg-neutral-50">
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !draft.name.trim() || !draft.content.trim()}
              >
                {isSaving ? 'Saving…' : draft.id ? 'Save changes' : 'Create skill'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
