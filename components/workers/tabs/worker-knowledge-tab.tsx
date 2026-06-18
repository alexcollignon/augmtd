'use client';

import { useState, useEffect, useCallback } from 'react';
import { DocumentTextIcon, SparklesIcon, CheckIcon, AcademicCapIcon } from '@heroicons/react/24/outline';
import { Button, Textarea } from '@/components/ui';

interface KBFile {
  id: string;
  name: string;
  knowledge_file_id: string;
}

interface LibrarySkill {
  id: string;
  name: string;
  when_to_use: string | null;
}

interface WorkerKnowledgeTabProps {
  workerId: string;
  workerName: string;
}

export function WorkerKnowledgeTab({ workerId, workerName }: WorkerKnowledgeTabProps) {
  const [userPreferences, setUserPreferences] = useState('');
  const [memoryText, setMemoryText] = useState<string | null>(null);
  const [kbFiles, setKbFiles] = useState<KBFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isResettingMemory, setIsResettingMemory] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Skills: the user's whole library + which ids are assigned to this worker.
  const [librarySkills, setLibrarySkills] = useState<LibrarySkill[]>([]);
  const [assignedSkillIds, setAssignedSkillIds] = useState<Set<string>>(new Set());
  const [savingSkills, setSavingSkills] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setIsDirty(false);
    setSavedAt(null);
    Promise.all([
      fetch(`/api/agents/${workerId}`).then(r => r.json()),
      fetch(`/api/agents/${workerId}/knowledge`).then(r => r.json()),
      fetch('/api/skills').then(r => r.json()),
      fetch(`/api/agents/${workerId}/skills`).then(r => r.json()),
    ]).then(([{ agent }, { sources }, lib, assigned]) => {
      setUserPreferences(agent?.user_preferences ?? '');
      setMemoryText(agent?.memory_text ?? null);
      setKbFiles(sources ?? []);
      setLibrarySkills((lib?.skills ?? []).map((s: { id: string; name: string; when_to_use: string | null }) => ({ id: s.id, name: s.name, when_to_use: s.when_to_use })));
      setAssignedSkillIds(new Set((assigned?.skills ?? []).map((s: { id: string }) => s.id)));
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, [workerId]);

  const toggleSkill = useCallback(async (skillId: string) => {
    const next = new Set(assignedSkillIds);
    if (next.has(skillId)) next.delete(skillId); else next.add(skillId);
    setAssignedSkillIds(next); // optimistic
    setSavingSkills(true);
    try {
      await fetch(`/api/agents/${workerId}/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_ids: [...next] }),
      });
    } finally {
      setSavingSkills(false);
    }
  }, [assignedSkillIds, workerId]);

  async function handleSave() {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    try {
      await fetch(`/api/agents/${workerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_preferences: userPreferences }),
      });
      setSavedAt(new Date());
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResetMemory() {
    setIsResettingMemory(true);
    setConfirmReset(false);
    try {
      await fetch(`/api/agents/${workerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_text: null }),
      });
      setMemoryText(null);
    } finally {
      setIsResettingMemory(false);
    }
  }

  function handlePreferencesChange(val: string) {
    setUserPreferences(val);
    setIsDirty(true);
    setSavedAt(null);
  }

  if (isLoading) {
    return (
      <div className="flex-1 px-8 py-8 space-y-6 animate-pulse">
        <div className="h-5 bg-neutral-100 rounded w-32" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-3 bg-neutral-100 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-8 space-y-10">

        {/* Your preferences */}
        <section>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-[13px] font-semibold text-neutral-800">Your preferences</h2>
              <p className="text-[11.5px] text-neutral-400 mt-0.5">
                Your style, priorities, and working hours — only {workerName} sees this.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
              {savedAt && !isDirty && (
                <span className="text-[11px] text-neutral-400">Saved</span>
              )}
              <Button size="sm" onClick={handleSave} disabled={!isDirty || isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
          <Textarea
            value={userPreferences}
            onChange={e => handlePreferencesChange(e.target.value)}
            rows={10}
            placeholder={`e.g. I prefer concise emails, no bullet points. Flag anything from clients as urgent. I work 9–6 CET. Don't bother me with newsletters or automated notifications…`}
          />
          <p className="mt-2 text-[11px] text-neutral-400">
            Changes apply to future conversations — {workerName}&apos;s core behaviour is managed by the product.
          </p>
        </section>

        {/* Memory */}
        <section>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-1.5">
                <SparklesIcon className="w-3.5 h-3.5 text-neutral-400" />
                <h2 className="text-[13px] font-semibold text-neutral-800">Memory</h2>
              </div>
              <p className="text-[11.5px] text-neutral-400 mt-0.5">
                What {workerName} has learned about you automatically from your interactions
              </p>
            </div>
            {memoryText && (
              <div className="flex-shrink-0 ml-4 flex items-center gap-2">
                {confirmReset ? (
                  <>
                    <span className="text-[12px] text-neutral-500">Clear memory?</span>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
                    <Button variant="danger" size="sm" onClick={handleResetMemory} disabled={isResettingMemory}>
                      {isResettingMemory ? 'Clearing…' : 'Clear'}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)}>Reset</Button>
                )}
              </div>
            )}
          </div>
          {memoryText ? (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
              <p className="text-[13px] text-neutral-600 leading-relaxed whitespace-pre-wrap">
                {memoryText}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-5 text-center">
              <p className="text-[12.5px] text-neutral-400">
                Memory builds automatically as you interact with {workerName}
              </p>
            </div>
          )}
        </section>

        {/* Skills */}
        <section>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-1.5">
                <AcademicCapIcon className="w-3.5 h-3.5 text-neutral-400" />
                <h2 className="text-[13px] font-semibold text-neutral-800">Skills</h2>
              </div>
              <p className="text-[11.5px] text-neutral-400 mt-0.5">
                Reusable ways of working {workerName} applies when relevant.
              </p>
            </div>
            {savingSkills && <span className="text-[11px] text-neutral-400 flex-shrink-0 ml-4">Saving…</span>}
          </div>
          {librarySkills.length > 0 ? (
            <div className="rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
              {librarySkills.map(skill => {
                const on = assignedSkillIds.has(skill.id);
                return (
                  <button
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-neutral-50 transition-colors"
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                      on ? 'bg-indigo-600' : 'border border-neutral-300'
                    }`}>
                      {on && <CheckIcon className="w-3 h-3 text-white" strokeWidth={3} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] truncate ${on ? 'text-neutral-800 font-medium' : 'text-neutral-600'}`}>{skill.name}</p>
                      {skill.when_to_use && (
                        <p className="text-[11px] text-neutral-400 truncate mt-0.5">{skill.when_to_use}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-5 text-center">
              <p className="text-[12.5px] text-neutral-400">
                No skills in your library yet — create one from the Skills tab, then assign it here.
              </p>
            </div>
          )}
        </section>

        {/* Files */}
        <section>
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <DocumentTextIcon className="w-3.5 h-3.5 text-neutral-400" />
              <h2 className="text-[13px] font-semibold text-neutral-800">Files</h2>
            </div>
            <p className="text-[11.5px] text-neutral-400 mt-0.5">
              Documents {workerName} can reference
            </p>
          </div>
          {kbFiles.length > 0 ? (
            <div className="rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
              {kbFiles.map(file => (
                <div key={file.id} className="flex items-center gap-3 px-4 py-2.5">
                  <DocumentTextIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                  <span className="text-[13px] text-neutral-600 truncate flex-1">{file.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-5 text-center">
              <p className="text-[12.5px] text-neutral-400">No files attached yet</p>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
