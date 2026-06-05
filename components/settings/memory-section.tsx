'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { ClipboardDocumentIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';

const IMPORT_PROMPT = `Please summarize everything you know about me in this JSON format. Omit fields you don't know.

{
  "name": "...",
  "role": "...",
  "expertise": ["area1", "area2"],
  "communication_style": "formal | casual | mixed",
  "typical_email_length": "short | medium | long",
  "greeting_patterns": ["Hi", "Hello,"],
  "common_phrases": ["sounds good", "let me know"],
  "key_contacts": [{"name": "...", "email": "...", "relationship": "client | colleague | vendor"}],
  "domain_vocabulary": {"term": "definition"},
  "meeting_preferences": "..."
}`;

const SECTION_LABELS: Record<string, string> = {
  identity: 'Identity',
  email_communication: 'Communication style',
  domain_knowledge: 'Domain knowledge',
  relationships: 'Key relationships',
  meeting_behavior: 'Meeting behavior',
};

interface MemorySection {
  profile_type: string;
  rendered_text: string | null;
  confidence_score: number;
  learned_from_count: number;
  rendered_at: string | null;
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score);
  const cls = pct >= 70
    ? 'text-emerald-600 bg-emerald-50'
    : pct >= 30
    ? 'text-amber-600 bg-amber-50'
    : 'text-neutral-400 bg-neutral-100';
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {pct}%
    </span>
  );
}

export default function MemorySection() {
  const [sections, setSections] = useState<MemorySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2>(1);
  const [pastedText, setPastedText] = useState('');
  const [importing, setImporting] = useState(false);

  const fetchMemory = useCallback(async () => {
    const res = await fetch('/api/settings/memory');
    if (res.ok) {
      const { sections: data } = await res.json();
      setSections(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchMemory(); }, [fetchMemory]);

  const handleExport = () => {
    const lines = sections
      .filter(s => s.rendered_text)
      .map(s => `${SECTION_LABELS[s.profile_type] ?? s.profile_type}\n${s.rendered_text}`);
    if (lines.length === 0) {
      toast.error('No memory to export yet — keep using augmtd to build it up');
      return;
    }
    const text = `Here's context about me to help personalize your responses:\n\n${lines.join('\n\n')}`;
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const handleImport = async () => {
    if (!pastedText.trim()) return;
    setImporting(true);
    try {
      const res = await fetch('/api/settings/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pastedText }),
      });
      if (!res.ok) throw new Error();
      toast.success('Memory updated from import');
      setImportOpen(false);
      setPastedText('');
      setImportStep(1);
      setLoading(true);
      fetchMemory();
    } catch {
      toast.error('Failed to import — please try again');
    } finally {
      setImporting(false);
    }
  };

  const closeModal = () => {
    setImportOpen(false);
    setPastedText('');
    setImportStep(1);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-[14px] font-semibold text-neutral-900">Your memory</h3>
            <p className="text-[12px] text-neutral-400 mt-0.5">What augmtd has learned about how you work. Updated automatically.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <button
              onClick={() => { setImportOpen(true); setImportStep(1); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-neutral-600 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors"
            >
              <ArrowUpTrayIcon className="w-3.5 h-3.5" />
              Import
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-indigo-600 border border-indigo-200 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              <ClipboardDocumentIcon className="w-3.5 h-3.5" />
              Copy as AI context
            </button>
          </div>
        </div>

        {/* Profile cards */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 rounded-xl bg-neutral-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {sections.map(section => (
              <div key={section.profile_type} className="border border-neutral-100 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-medium text-neutral-700">
                    {SECTION_LABELS[section.profile_type] ?? section.profile_type}
                  </span>
                  <ConfidenceBadge score={section.confidence_score} />
                </div>
                {section.rendered_text ? (
                  <p className="text-[13px] text-neutral-600 leading-relaxed">{section.rendered_text}</p>
                ) : (
                  <p className="text-[12px] text-neutral-300 italic">Not enough data yet</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import modal */}
      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-neutral-100">
              <h4 className="text-[14px] font-semibold text-neutral-900">Import from another AI tool</h4>
              <p className="text-[12px] text-neutral-400 mt-0.5">
                {importStep === 1
                  ? 'Copy the prompt below and paste it into ChatGPT, Claude, or any AI tool.'
                  : "Paste the AI's response below."}
              </p>
            </div>

            <div className="px-6 py-4">
              {importStep === 1 ? (
                <>
                  <div className="relative bg-neutral-50 rounded-xl border border-neutral-200 p-4">
                    <pre className="text-[11px] text-neutral-600 font-mono whitespace-pre-wrap leading-relaxed pr-8">
                      {IMPORT_PROMPT}
                    </pre>
                    <button
                      onClick={() => { navigator.clipboard.writeText(IMPORT_PROMPT); toast.success('Prompt copied'); }}
                      className="absolute top-3 right-3 p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors"
                      title="Copy prompt"
                    >
                      <ClipboardDocumentIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      onClick={closeModal}
                      className="px-4 py-2 text-[13px] text-neutral-500 hover:text-neutral-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setImportStep(2)}
                      className="px-4 py-2 text-[13px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      I have the response →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    className="w-full h-40 p-3 text-[13px] border border-neutral-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    placeholder="Paste the AI's response here..."
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    autoFocus
                  />
                  <div className="flex items-center justify-between mt-4">
                    <button
                      onClick={() => setImportStep(1)}
                      className="text-[13px] text-neutral-400 hover:text-neutral-600 transition-colors"
                    >
                      ← Back
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={closeModal}
                        className="px-4 py-2 text-[13px] text-neutral-500 hover:text-neutral-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImport}
                        disabled={!pastedText.trim() || importing}
                        className="px-4 py-2 text-[13px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                      >
                        {importing ? 'Importing…' : 'Import'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
