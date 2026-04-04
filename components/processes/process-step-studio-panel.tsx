'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  XMarkIcon,
  SparklesIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  TableCellsIcon,
  EnvelopeIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  PaperAirplaneIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import type { ProcessStepRecord } from '@/lib/types/process';
import type { DocumentArtifact } from '@/lib/types/inbox';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface PlanInput {
  id: string;
  name: string;
  description?: string;
  status?: string;
  type?: string;
  source_type?: string;
}

interface PlanStep {
  number?: number;
  action: string;
}

interface PanelPlan {
  deliverable_description?: string;
  inputs?: PlanInput[];
  steps?: PlanStep[];
}

interface WorkThread {
  id: string;
  title: string;
  plan: Record<string, unknown> | null;
  artifact: DocumentArtifact | null;
  artifacts: DocumentArtifact[] | null;
  is_generating: boolean;
}

interface KnowledgeFileResult {
  id: string;
  filename: string;
  mime_type?: string;
  knowledge_sources?: { provider: string; name: string } | null;
}

interface Props {
  processId: string;
  step: ProcessStepRecord;
  previousSteps: ProcessStepRecord[];
  onClose: () => void;
  onStepCompleted: (artifact: DocumentArtifact) => void;
  onThreadFound?: (stepIndex: number, threadId: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  google_drive: 'Drive',
  onedrive: 'OneDrive',
  upload: 'Upload',
  augmtd: 'Augmtd',
};

function getArtifactIcon(type: string) {
  switch (type) {
    case 'presentation': return PresentationChartBarIcon;
    case 'spreadsheet': return TableCellsIcon;
    case 'email': return EnvelopeIcon;
    default: return DocumentTextIcon;
  }
}

function getArtifactExt(type: string) {
  switch (type) {
    case 'presentation': return 'pptx';
    case 'spreadsheet': return 'xlsx';
    case 'email': return 'email';
    default: return 'docx';
  }
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';
const KICKSTART_PREFIX = 'Generate a document for this process step:';

// Clip text at PLAN_SEPARATOR, also trimming any partial prefix of the separator
// that sits at the end of the buffer (avoids briefly showing e.g. "---PLAN_UP").
function clipAtSeparator(text: string): string {
  const idx = text.indexOf(PLAN_SEPARATOR);
  if (idx !== -1) return text.slice(0, idx);
  for (let len = PLAN_SEPARATOR.length - 1; len > 0; len--) {
    if (text.endsWith(PLAN_SEPARATOR.slice(0, len))) return text.slice(0, -len);
  }
  return text;
}

export function ProcessStepStudioPanel({ processId, step, previousSteps, onClose, onStepCompleted, onThreadFound }: Props) {
  const [thread, setThread] = useState<WorkThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState<'inputs' | 'plan'>('inputs');

  // Drive / upload state per input
  const [driveResults, setDriveResults] = useState<Record<string, KnowledgeFileResult[]>>({});
  const [driveLoading, setDriveLoading] = useState<Record<string, boolean>>({});
  const [driveQuery, setDriveQuery] = useState<Record<string, string>>({});
  const [localProvided, setLocalProvided] = useState<Record<string, string>>({}); // inputId → filename

  const initializedRef = useRef(false);
  const prevPlanRef = useRef(false);
  const inputsFetchedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadRef = useRef<{ inputId: string; inputName: string } | null>(null);
  const driveDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Switch to Inputs tab when plan first arrives
  useEffect(() => {
    const hasPlan = !!thread?.plan;
    if (hasPlan && !prevPlanRef.current) {
      setActiveTab('inputs');
    }
    prevPlanRef.current = hasPlan;
  }, [thread?.plan]);

  const fetchDriveResultsForInput = useCallback(async (inputId: string, query: string) => {
    if (!query.trim()) return;
    setDriveLoading(prev => ({ ...prev, [inputId]: true }));
    try {
      const res = await fetch(`/api/knowledge/files?search=${encodeURIComponent(query.trim())}&limit=8`);
      if (!res.ok) return;
      const data = await res.json();
      setDriveResults(prev => ({ ...prev, [inputId]: data.data ?? [] }));
    } catch { /* ignore */ } finally {
      setDriveLoading(prev => ({ ...prev, [inputId]: false }));
    }
  }, []);

  // Auto-fetch Drive results when plan first arrives for each pending input
  const plan = (thread?.plan ?? null) as PanelPlan | null;
  const planInputs = plan?.inputs ?? [];
  const planSteps = plan?.steps ?? [];

  useEffect(() => {
    if (!plan || inputsFetchedRef.current) return;
    const pending = planInputs.filter(i => i.status !== 'provided');
    if (pending.length === 0) return;
    inputsFetchedRef.current = true;
    for (const inp of pending) {
      const semanticQuery = [inp.name, inp.description].filter(Boolean).join(' ');
      // Auto-fetch silently — don't populate the search bar
      if (semanticQuery) fetchDriveResultsForInput(inp.id, semanticQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const buildEnrichedPrompt = useCallback(() => {
    const lines: string[] = [];
    lines.push(`Generate a document for this process step:`);
    lines.push(`Step title: ${step.title}`);
    if (step.description) lines.push(`Description: ${step.description}`);

    const completed = previousSteps.filter(s => s.status === 'completed');
    if (completed.length > 0) {
      lines.push('');
      lines.push('Context from previous completed steps:');
      for (const s of completed) {
        lines.push(`\n[Step ${s.step_index + 1}: ${s.title}]`);
        const d = s.input_data as Record<string, unknown> | null;
        if (d?.text) lines.push(`Input: ${String(d.text).slice(0, 500)}`);
        if (d?.value !== undefined) lines.push(`Value: ${d.value}`);
        if (d?.filename) lines.push(`File attached: ${d.filename}`);
        const a = s.artifact as Record<string, unknown> | null;
        if (a?.content && typeof a.content === 'string') {
          lines.push(`Output: ${a.content.slice(0, 600)}`);
        }
      }
    }
    return lines.join('\n');
  }, [step, previousSteps]);

  const reloadThread = useCallback(async (targetThreadId: string) => {
    const res = await fetch(`/api/work/threads/${targetThreadId}/messages`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.thread) setThread(data.thread as WorkThread);
    setMessages(
      (data.messages ?? []).map((m: { id: string; role: string; content: string }) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))
    );
  }, []);

  const streamMessage = useCallback(async (targetThreadId: string, content: string): Promise<string> => {
    abortRef.current = new AbortController();
    const res = await fetch(`/api/work/threads/${targetThreadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortRef.current.signal,
      body: JSON.stringify({ content }),
    });
    if (!res.ok || !res.body) throw new Error('Failed to send message');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      setStreamingText(clipAtSeparator(buffer));
    }
    return clipAtSeparator(buffer);
  }, []);

  const sendMessage = useCallback(async (text: string, overrideThreadId?: string) => {
    const targetId = overrideThreadId ?? thread?.id;
    if (!targetId || !text.trim()) return;

    setMessages(prev => [...prev, { id: `opt-${Date.now()}`, role: 'user', content: text }]);
    setChatInput('');
    setIsStreaming(true);
    setStreamingText('');
    setErrorMsg(null);

    try {
      const finalText = await streamMessage(targetId, text);
      setMessages(prev => [...prev, { id: `ast-${Date.now()}`, role: 'assistant', content: finalText }]);
      setStreamingText('');
      await reloadThread(targetId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('abort') && !msg.includes('AbortError')) setErrorMsg(msg);
      setStreamingText('');
    } finally {
      setIsStreaming(false);
    }
  }, [thread?.id, streamMessage, reloadThread]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      try {
        const lookupRes = await fetch(`/api/work/threads?processId=${processId}&stepIndex=${step.step_index}`);
        if (!lookupRes.ok) throw new Error('Lookup failed');
        const { thread: existingThread } = await lookupRes.json();

        if (existingThread) {
          await reloadThread(existingThread.id);
          onThreadFound?.(step.step_index, existingThread.id);
          setInitialized(true);
          return;
        }

        const createRes = await fetch('/api/work/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: step.title, processId, processStepIndex: step.step_index }),
        });
        if (!createRes.ok) throw new Error('Failed to create thread');
        const { thread: newThread } = await createRes.json();
        setThread(newThread as WorkThread);
        onThreadFound?.(step.step_index, newThread.id);
        setInitialized(true);

        await sendMessage(buildEnrichedPrompt(), newThread.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setInitialized(true);
      }
    };

    init();
    return () => { abortRef.current?.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileProvided = useCallback((inputId: string, _inputName: string, filename: string) => {
    setLocalProvided(prev => ({ ...prev, [inputId]: filename }));
    // Don't sendMessage — inputs tab is static; AI updates only via explicit chat
  }, []);

  const handleUploadClick = (inputId: string, inputName: string) => {
    pendingUploadRef.current = { inputId, inputName };
    fileInputRef.current?.click();
  };

  const handleDriveQueryChange = (inputId: string, value: string, inp: PlanInput) => {
    setDriveQuery(prev => ({ ...prev, [inputId]: value }));
    if (driveDebounceRef.current[inputId]) clearTimeout(driveDebounceRef.current[inputId]);
    const semanticFallback = [inp.name, inp.description].filter(Boolean).join(' ');
    driveDebounceRef.current[inputId] = setTimeout(() => {
      fetchDriveResultsForInput(inputId, value.trim() || semanticFallback);
    }, 300);
  };

  const handleGenerate = async () => {
    if (!thread?.id) return;
    setGenerating(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/work/threads/${thread.id}/generate`, { method: 'POST' });
      if (!res.ok) throw new Error('Generation failed');
      const data = await res.json();
      const generatedArtifact: DocumentArtifact = data.artifact ?? data.artifacts?.[0];
      if (!generatedArtifact) throw new Error('No artifact returned');
      setThread(prev => prev ? { ...prev, artifact: generatedArtifact } : prev);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleComplete = async () => {
    const artifact = thread?.artifact;
    if (!artifact) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/processes/${processId}/steps/${step.step_index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_data: { generated: true, via: 'studio_panel', threadId: thread!.id },
          artifact,
        }),
      });
      if (!res.ok) throw new Error('Failed to complete step');
      onStepCompleted(artifact);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCompleting(false);
    }
  };

  const handleDownload = async () => {
    const artifact = thread?.artifact;
    if (!thread?.id || !artifact) return;
    setDownloading(true);
    try {
      const url = artifact.id
        ? `/api/work/threads/${thread.id}/download?artifactId=${artifact.id}`
        : `/api/work/threads/${thread.id}/download`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${artifact.title ?? step.title}.${getArtifactExt(artifact.type)}`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch { /* ignore */ } finally {
      setDownloading(false);
    }
  };

  const artifact = thread?.artifact ?? null;
  const ArtifactIcon = artifact ? getArtifactIcon(artifact.type) : DocumentTextIcon;

  const visibleMessages = messages.filter(
    (m, i) => !(i === 0 && m.role === 'user' && m.content.startsWith(KICKSTART_PREFIX))
  );

  const showFooter = !(activeTab === 'inputs' && !!plan);

  return (
    <>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-neutral-200">
        <div className="flex items-center gap-2 min-w-0">
          <SparklesIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">AI Studio</p>
            <p className="text-[12px] font-semibold text-neutral-800 truncate leading-tight">{step.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {thread?.id && (
            <Link
              href={`/work?view=document&thread=${thread.id}`}
              className="p-1 text-neutral-400 hover:text-indigo-600 transition-colors"
              title="Open in full Studio"
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
            </Link>
          )}
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors">
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tab section — capped height, never takes over the panel */}
      <div className="flex-shrink-0 flex flex-col border-b border-neutral-200" style={{ maxHeight: '48%' }}>
        {/* Sub-tab bar */}
        <div className="flex-shrink-0 flex border-b border-neutral-100">
          {(['inputs', 'plan'] as const).map(tab => {
            const pendingCount = tab === 'inputs'
              ? planInputs.filter(i => i.status !== 'provided' && !localProvided[i.id]).length
              : 0;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold transition-colors capitalize ${
                  activeTab === tab
                    ? 'text-indigo-600 border-b-2 border-indigo-500'
                    : 'text-neutral-400 hover:text-neutral-600 border-b-2 border-transparent'
                }`}
              >
                {tab}
                {pendingCount > 0 && (
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable tab content */}
        <div className="overflow-y-auto px-4 py-3 min-h-0 flex-1">
          {!initialized ? (
            <div className="flex items-center justify-center py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          ) : activeTab === 'inputs' ? (
            /* Inputs tab */
            !plan ? (
              <p className="text-[11px] text-neutral-400 italic">Building plan…</p>
            ) : planInputs.length === 0 ? (
              <p className="text-[11px] text-neutral-400 italic">No specific inputs required — use the chat below to refine.</p>
            ) : (
              <div className="space-y-4">
                {planInputs.map((inp, i) => {
                  const isProvided = inp.status === 'provided' || !!localProvided[inp.id];
                  const providedFilename = localProvided[inp.id];
                  const results = driveResults[inp.id] ?? [];
                  const loading = driveLoading[inp.id] ?? false;
                  const query = driveQuery[inp.id] ?? '';

                  return (
                    <div key={inp.id ?? i} className="space-y-1.5">
                      <div className="flex items-start gap-2">
                        <span className={`flex-shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded-full ${
                          isProvided ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {isProvided ? 'Provided' : 'Pending'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-neutral-800 leading-snug">{inp.name}</p>
                          {inp.description && (
                            <p className="text-[10px] text-neutral-400 mt-0.5 leading-snug">{inp.description}</p>
                          )}
                          {isProvided && providedFilename && (
                            <p className="text-[10px] text-green-600 mt-0.5 truncate">{providedFilename}</p>
                          )}
                        </div>
                      </div>

                      {!isProvided && (
                        <div className="space-y-1.5 pl-0">
                          {/* Drive search field */}
                          <div className="flex items-center gap-1.5 border border-neutral-200 px-2 py-1.5">
                            <MagnifyingGlassIcon className="w-3 h-3 text-neutral-300 flex-shrink-0" />
                            <input
                              type="text"
                              value={query}
                              onChange={(e) => handleDriveQueryChange(inp.id, e.target.value, inp)}
                              placeholder="Search Drive…"
                              className="flex-1 text-[11px] focus:outline-none placeholder:text-neutral-300 bg-transparent"
                            />
                          </div>

                          {/* Drive results */}
                          {loading && (
                            <div className="flex gap-1 py-1 pl-1">
                              <span className="w-1 h-1 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                              <span className="w-1 h-1 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                              <span className="w-1 h-1 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
                            </div>
                          )}
                          {!loading && results.length > 0 && (
                            <div className="border border-neutral-100 max-h-28 overflow-y-auto">
                              {results.map(f => (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => handleFileProvided(inp.id, inp.name, f.filename)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-indigo-50 text-left border-b border-neutral-50 last:border-0 transition-colors"
                                >
                                  <DocumentTextIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
                                  <span className="flex-1 text-[10px] text-neutral-700 truncate">{f.filename}</span>
                                  <span className="flex-shrink-0 text-[9px] text-neutral-400">
                                    {f.knowledge_sources ? (SOURCE_LABELS[f.knowledge_sources.provider] ?? f.knowledge_sources.provider) : 'Drive'}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {!loading && results.length === 0 && query.length >= 2 && (
                            <p className="text-[10px] text-neutral-300 pl-1">No files found</p>
                          )}

                          {/* Upload button */}
                          <button
                            type="button"
                            onClick={() => handleUploadClick(inp.id, inp.name)}
                            className="flex items-center gap-1.5 text-[10px] text-neutral-400 hover:text-indigo-600 transition-colors py-0.5"
                          >
                            <ArrowUpTrayIcon className="w-3 h-3" />
                            Upload file
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* Plan tab */
            !plan ? (
              <p className="text-[11px] text-neutral-400 italic">Building plan…</p>
            ) : (
              <div className="space-y-3">
                {plan.deliverable_description && (
                  <div>
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Deliverable</p>
                    <p className="text-[11px] text-neutral-800 leading-snug">{plan.deliverable_description}</p>
                  </div>
                )}
                {planSteps.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Steps</p>
                    <div className="space-y-1.5">
                      {planSteps.map((s, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-bold flex items-center justify-center mt-0.5">
                            {s.number ?? i + 1}
                          </span>
                          <span className="text-[11px] text-neutral-700 leading-snug">{s.action}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Plan tab CTA — always visible at bottom of tab section */}
        {activeTab === 'plan' && initialized && (
          <div className="flex-shrink-0 px-4 py-2.5 border-t border-neutral-100">
            {artifact ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 border border-green-100 bg-green-50">
                  <ArtifactIcon className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-green-800 truncate">{artifact.title ?? step.title}</p>
                    <p className="text-[10px] text-green-600 uppercase">{getArtifactExt(artifact.type)}</p>
                  </div>
                  <button onClick={handleDownload} disabled={downloading} className="p-1 text-green-600 hover:text-green-800 transition-colors" title="Download">
                    <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleComplete}
                    disabled={completing}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    {completing ? 'Completing…' : 'Complete step →'}
                  </button>
                  <button onClick={handleGenerate} disabled={completing || generating} className="p-1.5 text-neutral-400 border border-neutral-200 hover:border-neutral-300 hover:text-neutral-600 transition-colors" title="Regenerate">
                    <ArrowPathIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                {thread?.id && (
                  <Link
                    href={`/work?view=document&thread=${thread.id}`}
                    className="flex items-center justify-center gap-1.5 py-1.5 border border-indigo-200 text-indigo-600 text-[11px] font-semibold hover:bg-indigo-50 transition-colors"
                  >
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                    Review &amp; edit in Studio
                  </Link>
                )}
              </div>
            ) : generating ? (
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
                <p className="text-[11px] text-neutral-500">Generating… (15–30s)</p>
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!plan || isStreaming}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <SparklesIcon className="w-3.5 h-3.5" />
                Generate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Chat messages — always visible, fills remaining space */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {visibleMessages.length === 0 && !isStreaming && initialized && (
          <p className="text-[11px] text-neutral-300 italic">Chat with the AI to refine the plan…</p>
        )}

        {visibleMessages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'user' ? (
              <div className="max-w-[80%] px-3 py-2 bg-indigo-600 text-white text-[12px] leading-relaxed">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[90%] text-[12px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                {m.content}
              </div>
            )}
          </div>
        ))}

        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[90%] text-[12px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
              {streamingText}
              <span className="inline-block w-1 h-3 bg-neutral-400 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="flex gap-1 py-1">
              <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 border border-red-100 bg-red-50">
            <p className="text-[11px] text-red-600">{errorMsg}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer — hidden when Inputs tab active and plan exists */}
      {showFooter && (
        <div className="flex-shrink-0 border-t border-neutral-200">
          <form
            className="flex items-center gap-2 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (chatInput.trim() && !isStreaming) sendMessage(chatInput);
            }}
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={initialized ? 'Refine the plan or ask a question…' : 'Setting up…'}
              disabled={!initialized || isStreaming || generating}
              className="flex-1 text-[12px] border border-neutral-200 px-3 py-2 focus:outline-none focus:border-indigo-400 placeholder:text-neutral-300 disabled:bg-neutral-50"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || isStreaming || !initialized || generating}
              className="p-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              <PaperAirplaneIcon className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file || !pendingUploadRef.current) return;
          const { inputId, inputName } = pendingUploadRef.current;
          handleFileProvided(inputId, inputName, file.name);
          pendingUploadRef.current = null;
          e.target.value = '';
        }}
      />
    </>
  );
}
