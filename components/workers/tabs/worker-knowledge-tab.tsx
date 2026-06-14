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
  const [instructions, setInstructions] = useState('');
  const [memoryText, setMemoryText] = useState<string | null>(null);
  const [kbFiles, setKbFiles] = useState<KBFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch(`/api/agents/${workerId}`).then(r => r.json()),
      fetch(`/api/agents/${workerId}/knowledge`).then(r => r.json()),
    ]).then(([agent, knowledge]) => {
      setInstructions(agent.instructions ?? '');
      setMemoryText(agent.memory_text ?? null);
      setKbFiles(knowledge.sources ?? []);
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
        body: JSON.stringify({ instructions }),
      });
      setSavedAt(new Date());
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }

  function handleInstructionsChange(val: string) {
    setInstructions(val);
    setIsDirty(true);
    setSavedAt(null);
  }

  if (isLoading) {
    return (
      <div className="flex-1 p-6 space-y-6 animate-pulse">
        <div className="h-5 bg-neutral-100 rounded w-32" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-3 bg-neutral-100 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-6 py-8 space-y-10">

        {/* Policy */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[13px] font-semibold text-neutral-800">Policy</h2>
              <p className="text-[11.5px] text-neutral-400 mt-0.5">
                Rules and behaviour {workerName} always follows
              </p>
            </div>
            <div className="flex items-center gap-2">
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
            value={instructions}
            onChange={e => handleInstructionsChange(e.target.value)}
            rows={14}
            className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-700 leading-relaxed resize-none outline-none focus:border-neutral-300 focus:bg-white transition-colors placeholder:text-neutral-400"
            placeholder={`Describe how ${workerName} should behave, what it should prioritise, and any rules it should follow…`}
          />
        </section>

        {/* Memory */}
        <section>
          <div className="mb-3">
            <div className="flex items-center gap-1.5">
              <SparklesIcon className="w-3.5 h-3.5 text-neutral-400" />
              <h2 className="text-[13px] font-semibold text-neutral-800">Memory</h2>
            </div>
            <p className="text-[11.5px] text-neutral-400 mt-0.5">
              What {workerName} has learned about you from your interactions
            </p>
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
