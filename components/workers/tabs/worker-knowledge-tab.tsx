'use client';

import { useState, useEffect } from 'react';
import { DocumentTextIcon, SparklesIcon } from '@heroicons/react/24/outline';

interface KBFile {
  id: string;
  name: string;
  knowledge_file_id: string;
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

  useEffect(() => {
    setIsLoading(true);
    setIsDirty(false);
    setSavedAt(null);
    Promise.all([
      fetch(`/api/agents/${workerId}`).then(r => r.json()),
      fetch(`/api/agents/${workerId}/knowledge`).then(r => r.json()),
    ]).then(([{ agent }, { sources }]) => {
      setUserPreferences(agent?.user_preferences ?? '');
      setMemoryText(agent?.memory_text ?? null);
      setKbFiles(sources ?? []);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, [workerId]);

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
              <p className="text-[11.5px] text-neutral-400 mt-0.5 max-w-[420px]">
                Tell {workerName} what matters to you — communication style, priorities, what to ignore, working hours. This is your personal context, only visible to your worker.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
              {savedAt && !isDirty && (
                <span className="text-[11px] text-neutral-400">Saved</span>
              )}
              <button
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-medium disabled:opacity-40 hover:bg-indigo-700 transition-colors"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <textarea
            value={userPreferences}
            onChange={e => handlePreferencesChange(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700 leading-relaxed resize-none outline-none focus:border-neutral-300 focus:bg-white transition-colors placeholder:text-neutral-400"
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
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="px-2.5 py-1 rounded-lg border border-neutral-200 text-[12px] text-neutral-500 hover:bg-neutral-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleResetMemory}
                      disabled={isResettingMemory}
                      className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[12px] hover:bg-red-600 disabled:opacity-40 transition-colors"
                    >
                      {isResettingMemory ? 'Clearing…' : 'Clear'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="px-3 py-1.5 rounded-lg border border-neutral-200 text-[12px] text-neutral-500 hover:border-red-200 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    Reset
                  </button>
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
