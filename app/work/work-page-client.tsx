'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import SidebarNav from '@/components/sidebar-nav';
import {
  PlusIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  DocumentChartBarIcon,
  TableCellsIcon,
  EnvelopeIcon,
  CalendarIcon,
  SparklesIcon,
  CheckCircleIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { WorkBlueprint } from '@/lib/types/work-blueprints';
import { ExecutionPlan, DocumentArtifact } from '@/lib/types/inbox';
import OnboardingModal from '@/components/onboarding-modal';

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-neutral-900">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function MarkdownText({ content, cursor }: { content: string; cursor?: boolean }) {
  const blocks = content.split(/\n{2,}/);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');

        if (lines.length > 0 && lines.every((l) => /^[-•]\s/.test(l) || /^\d+\.\s/.test(l))) {
          const isOrdered = /^\d+\.\s/.test(lines[0]);
          return (
            <ul key={bi} className="space-y-1">
              {lines.map((line, li) => {
                const text = isOrdered
                  ? line.replace(/^\d+\.\s/, '')
                  : line.replace(/^[-•]\s/, '');
                return (
                  <li key={li} className="flex items-start gap-2 text-[13.5px] text-neutral-800 leading-relaxed">
                    <span className="text-neutral-400 flex-shrink-0 mt-px select-none">
                      {isOrdered ? `${li + 1}.` : '·'}
                    </span>
                    <span>
                      {renderInline(text)}
                      {cursor && bi === blocks.length - 1 && li === lines.length - 1 && (
                        <span className="inline-block w-0.5 h-3.5 bg-neutral-400 ml-0.5 animate-pulse align-middle" />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        }

        return (
          <p key={bi} className="text-[13.5px] text-neutral-800 leading-relaxed">
            {lines.map((line, li) => {
              const isBullet = /^[-•]\s/.test(line);
              const isOrdered = /^\d+\.\s/.test(line);
              const text = isBullet
                ? line.replace(/^[-•]\s/, '')
                : isOrdered
                ? line.replace(/^\d+\.\s/, '')
                : line;
              return (
                <span key={li} className={isBullet || isOrdered ? 'flex items-start gap-2' : 'block'}>
                  {(isBullet || isOrdered) && (
                    <span className="text-neutral-400 flex-shrink-0 select-none">·</span>
                  )}
                  <span>
                    {renderInline(text)}
                    {li < lines.length - 1 && !isBullet && !isOrdered && <br />}
                    {cursor && bi === blocks.length - 1 && li === lines.length - 1 && (
                      <span className="inline-block w-0.5 h-3.5 bg-neutral-400 ml-0.5 animate-pulse align-middle" />
                    )}
                  </span>
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkMode = 'planning' | 'generating' | 'document';

interface WorkThread {
  id: string;
  title: string;
  plan: ExecutionPlan | null;
  artifact: DocumentArtifact | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WorkMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface WorkPageClientProps {
  userEmail?: string;
  userFullName?: string;
  hasCompletedOnboarding: boolean;
  blueprints: WorkBlueprint[];
  initialThreads: WorkThread[];
  initialActiveThreadId?: string | null;
  initialWorkflowPrompt?: string | null;
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';
const ARTIFACT_SEPARATOR = '---ARTIFACT_UPDATE---';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getDeliverableIcon(type: string) {
  switch (type) {
    case 'presentation': return PresentationChartBarIcon;
    case 'analysis': return DocumentChartBarIcon;
    case 'spreadsheet': return TableCellsIcon;
    case 'email': return EnvelopeIcon;
    default: return DocumentTextIcon;
  }
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'planning': return CalendarIcon;
    case 'analysis': return DocumentChartBarIcon;
    default: return DocumentTextIcon;
  }
}

// ─── Plan Panel ───────────────────────────────────────────────────────────────

function PlanPanel({
  plan,
  isUpdating,
  planJustUpdated,
  workMode,
  onGenerate,
  threadId,
  artifact,
  onViewDocument,
}: {
  plan: ExecutionPlan | null;
  isUpdating: boolean;
  planJustUpdated: boolean;
  workMode: WorkMode;
  onGenerate: (threadId: string) => void;
  threadId: string | null;
  artifact: DocumentArtifact | null;
  onViewDocument: () => void;
}) {
  const isGenerating = workMode === 'generating';

  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center border-r border-neutral-200 bg-neutral-50">
        <div className="text-center px-8">
          {isUpdating ? (
            <>
              <div className="flex items-center justify-center gap-1.5 mb-3">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
              <p className="text-[13px] text-neutral-400">Building your plan…</p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <DocumentTextIcon className="w-5 h-5 text-neutral-400" />
              </div>
              <p className="text-[13px] text-neutral-400">
                Describe your work — the plan will appear here
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const Icon = getDeliverableIcon(plan.deliverable_type);

  return (
    <div className="flex-1 overflow-y-auto border-r border-neutral-200 bg-white flex flex-col">
      {/* Generating overlay banner */}
      {isGenerating && (
        <div className="flex items-center gap-2 px-4 py-3 bg-indigo-50 border-b border-indigo-100">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
          <p className="text-[12px] text-indigo-700 font-medium">Building your document…</p>
        </div>
      )}

      {/* Document ready banner */}
      {!isGenerating && artifact && workMode === 'planning' && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-green-50 border-b border-green-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <DocumentTextIcon className="w-3.5 h-3.5 text-green-600" />
            <span className="text-[11px] text-green-700 font-medium">Document ready</span>
          </div>
          <button
            onClick={onViewDocument}
            className="text-[11px] text-green-600 hover:text-green-800 font-medium px-2 py-1 hover:bg-green-100 transition-colors"
          >
            View document →
          </button>
        </div>
      )}

      {/* Status bar (plan updates) */}
      {!isGenerating && (isUpdating || planJustUpdated) && (
        <div className={`flex items-center gap-1.5 px-4 py-2 border-b text-[11px] font-medium transition-all ${
          planJustUpdated && !isUpdating
            ? 'border-green-100 bg-green-50 text-green-600'
            : 'border-indigo-100 bg-indigo-50 text-indigo-600'
        }`}>
          {isUpdating ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
              Updating plan…
            </>
          ) : (
            <>
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Plan updated
            </>
          )}
        </div>
      )}

      <div className="flex-1 p-6 space-y-6">
        {/* Deliverable header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 bg-indigo-50 flex items-center justify-center">
            <Icon className="w-4.5 h-4.5 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">
              Deliverable
            </p>
            <p className="text-[14px] font-medium text-neutral-900 leading-snug">
              {plan.deliverable_description}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] text-indigo-600 bg-indigo-50 px-2 py-0.5 capitalize">
                {plan.deliverable_type}
              </span>
            </div>
          </div>
        </div>

        {/* Inputs */}
        {plan.inputs && plan.inputs.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
              Inputs needed
            </p>
            <div className="space-y-1.5">
              {plan.inputs.map((input) => (
                <div
                  key={input.id}
                  className="p-3 bg-blue-50 border border-blue-100"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-neutral-900">
                        {input.name}
                        {input.required && (
                          <span className="text-red-400 ml-1 text-[10px]">required</span>
                        )}
                      </p>
                      <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
                        {input.description}
                      </p>
                      {input.examples && input.examples.length > 0 && (
                        <p className="text-[10px] text-neutral-400 mt-1">
                          e.g. {input.examples[0]}
                        </p>
                      )}
                    </div>
                    <span className="flex-shrink-0 text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5">
                      {input.type.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Steps */}
        {plan.steps && plan.steps.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
              Steps ({plan.steps.length})
            </p>
            <div className="space-y-1.5">
              {plan.steps.map((step) => (
                <div
                  key={step.number}
                  className={`flex items-start gap-2.5 p-3 border ${
                    isGenerating
                      ? 'bg-indigo-50 border-indigo-100'
                      : 'bg-neutral-50 border-neutral-100'
                  }`}
                >
                  <div className={`flex-shrink-0 w-5 h-5 text-[10px] font-bold flex items-center justify-center mt-0.5 ${
                    isGenerating ? 'bg-indigo-200 text-indigo-700' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {isGenerating ? (
                      <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                    ) : (
                      step.number
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-neutral-900">{step.action}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {step.skill && (
                        <span className="text-[10px] text-neutral-500 bg-neutral-200 px-1.5 py-0.5">
                          {step.skill.replace('_', ' ')}
                        </span>
                      )}
                      {step.toolsNeeded?.map((t) => (
                        <span key={t} className="text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outputs */}
        {plan.outputs && plan.outputs.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
              Expected outputs
            </p>
            <div className="space-y-1.5">
              {plan.outputs.map((output) => (
                <div
                  key={output.id}
                  className="flex items-start gap-2.5 p-3 bg-green-50 border border-green-100"
                >
                  <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-neutral-900">{output.name}</p>
                    <p className="text-[11px] text-neutral-600 mt-0.5">{output.description}</p>
                    <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 mt-1 inline-block">
                      {output.type.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA — docx only (document/report) */}
      {workMode === 'planning' && threadId && (plan.deliverable_type === 'document' || plan.deliverable_type === 'report') && (
        <div className="p-4 border-t border-neutral-100">
          {artifact ? (
            <button
              onClick={onViewDocument}
              className="w-full px-4 py-2.5 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              <DocumentTextIcon className="w-4 h-4" />
              View document
            </button>
          ) : (
            <button
              onClick={() => onGenerate(threadId)}
              className="w-full px-4 py-2.5 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              <SparklesIcon className="w-4 h-4" />
              Generate {plan.deliverable_type}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Document Panel ───────────────────────────────────────────────────────────

function DocumentPanel({
  artifact,
  onDownload,
  onRegenerate,
  isDownloading,
}: {
  artifact: DocumentArtifact;
  onDownload: () => void;
  onRegenerate: () => void;
  isDownloading: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col border-r border-neutral-200 bg-neutral-100 min-w-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <DocumentTextIcon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <span className="text-[12px] font-medium text-neutral-700 truncate">{artifact.title}</span>
          <span className="text-[10px] text-neutral-400 flex-shrink-0">
            · {new Date(artifact.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onRegenerate}
            className="text-[11px] text-neutral-500 hover:text-neutral-700 px-2 py-1 hover:bg-neutral-100 transition-colors"
          >
            Back to plan
          </button>
          <button
            onClick={onDownload}
            disabled={isDownloading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            {isDownloading ? 'Downloading…' : 'Download .docx'}
          </button>
        </div>
      </div>

      {/* Document preview */}
      <div className="flex-1 overflow-y-auto p-6">
        {artifact.content ? (
          /* Paper */
          <div className="max-w-2xl mx-auto bg-white shadow-sm border border-neutral-200 px-12 py-10 min-h-full">
            {/* Title */}
            <h1 className="text-[22px] font-bold text-neutral-900 leading-tight mb-1">
              {artifact.content.title}
            </h1>
            {artifact.content.subtitle && (
              <p className="text-[13px] text-neutral-500 mb-8">{artifact.content.subtitle}</p>
            )}
            {!artifact.content.subtitle && <div className="mb-8" />}

            {/* Sections */}
            {artifact.content.sections.map((section, i) => (
              <div key={i} className={section.level === 1 ? 'mt-8 first:mt-0' : 'mt-5'}>
                {section.level === 1 ? (
                  <h2 className="text-[15px] font-bold text-neutral-900 mb-3 pb-1.5 border-b border-neutral-100">
                    {section.heading}
                  </h2>
                ) : (
                  <h3 className="text-[13px] font-semibold text-neutral-800 mb-2">
                    {section.heading}
                  </h3>
                )}
                <div className="space-y-3">
                  {section.paragraphs.map((para, j) => (
                    <p key={j} className="text-[13px] text-neutral-700 leading-relaxed">
                      {para}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Fallback for artifacts without content */
          <div className="max-w-2xl mx-auto bg-white shadow-sm border border-neutral-200 px-12 py-10 flex items-center justify-center min-h-64">
            <div className="text-center">
              <CheckCircleIcon className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-[13px] text-neutral-600">Document ready</p>
              <p className="text-[11px] text-neutral-400 mt-1">Regenerate to see a preview</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WorkPageClient({
  userEmail,
  userFullName,
  hasCompletedOnboarding,
  blueprints,
  initialThreads,
  initialActiveThreadId,
  initialWorkflowPrompt,
}: WorkPageClientProps) {
  const [threads, setThreads] = useState<WorkThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [planJustUpdated, setPlanJustUpdated] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [entryInput, setEntryInput] = useState('');
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(!hasCompletedOnboarding);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Document states
  const [workMode, setWorkMode] = useState<WorkMode>('planning');
  const [artifact, setArtifact] = useState<DocumentArtifact | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [artifactInput, setArtifactInput] = useState('');
  const [isEditingArtifact, setIsEditingArtifact] = useState(false);
  const [editStreamText, setEditStreamText] = useState('');

  const planUpdatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipLoadRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const editTitleInputRef = useRef<HTMLInputElement>(null);
  const artifactInputRef = useRef<HTMLTextAreaElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  useEffect(() => {
    if (initialActiveThreadId && initialWorkflowPrompt) {
      skipLoadRef.current = initialActiveThreadId;
      setMessages([]);
      setActiveThreadId(initialActiveThreadId);
      sendMessage(initialWorkflowPrompt, initialActiveThreadId);
    } else if (initialActiveThreadId) {
      setActiveThreadId(initialActiveThreadId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, editStreamText]);

  const loadThread = useCallback(async (threadId: string) => {
    setIsLoadingThread(true);
    setMessages([]);
    setStreamingText('');
    setEditStreamText('');
    try {
      const res = await fetch(`/api/work/threads/${threadId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      // Sync plan + artifact from server
      if (data.thread) {
        setThreads((prev) =>
          prev.map((t) => t.id === threadId ? {
            ...t,
            plan: data.thread.plan ?? t.plan,
            artifact: data.thread.artifact ?? null,
          } : t)
        );
        if (data.thread.artifact) {
          setArtifact(data.thread.artifact);
          setWorkMode('document');
        } else {
          setArtifact(null);
          setWorkMode('planning');
        }
      }
    } finally {
      setIsLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (activeThreadId) {
      if (skipLoadRef.current === activeThreadId) {
        skipLoadRef.current = null;
        return;
      }
      loadThread(activeThreadId);
    } else {
      // Reset when going back to entry view
      setWorkMode('planning');
      setArtifact(null);
    }
  }, [activeThreadId, loadThread]);

  const sendMessage = useCallback(async (content: string, threadId: string) => {
    if (!content.trim() || isStreaming) return;

    const tempUserMsg: WorkMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setChatInput('');
    setIsStreaming(true);
    setStreamingText('');

    try {
      const res = await fetch(`/api/work/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      });

      if (!res.ok || !res.body) throw new Error('Stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const sepIdx = buffer.indexOf(PLAN_SEPARATOR);
        const display = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer;
        setStreamingText(display);
      }

      const sepIdx = buffer.indexOf(PLAN_SEPARATOR);
      const finalText = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer.trim();
      const planRaw = sepIdx !== -1 ? buffer.slice(sepIdx + PLAN_SEPARATOR.length).trim() : null;

      const aiMsg: WorkMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: finalText,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setStreamingText('');

      if (planRaw && planRaw !== 'null') {
        try {
          const plan = JSON.parse(planRaw) as ExecutionPlan;
          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId
                ? { ...t, plan, updated_at: new Date().toISOString() }
                : t
            )
          );
          if (planUpdatedTimerRef.current) clearTimeout(planUpdatedTimerRef.current);
          setPlanJustUpdated(true);
          planUpdatedTimerRef.current = setTimeout(() => setPlanJustUpdated(false), 2000);
        } catch {
          // plan parse failed
        }
      }

      setThreads((prev) => {
        const thread = prev.find((t) => t.id === threadId);
        if (!thread) return prev;
        return [
          { ...thread, updated_at: new Date().toISOString() },
          ...prev.filter((t) => t.id !== threadId),
        ];
      });
    } catch (err) {
      console.error('Stream error:', err);
      setStreamingText('');
    } finally {
      setIsStreaming(false);
      chatInputRef.current?.focus();
    }
  }, [isStreaming]);

  const generateDocument = useCallback(async (threadId: string) => {
    setWorkMode('generating');
    try {
      const res = await fetch(`/api/work/threads/${threadId}/generate`, { method: 'POST' });
      if (!res.ok) {
        setWorkMode('planning');
        return;
      }
      const data = await res.json();
      const newArtifact: DocumentArtifact = data.artifact;
      setArtifact(newArtifact);
      setWorkMode('document');
      setThreads((prev) =>
        prev.map((t) => t.id === threadId ? { ...t, artifact: newArtifact } : t)
      );
    } catch (err) {
      console.error('Generate error:', err);
      setWorkMode('planning');
    }
  }, []);

  const editArtifact = useCallback(async (instruction: string, threadId: string) => {
    if (!instruction.trim() || isEditingArtifact) return;

    setIsEditingArtifact(true);
    setArtifactInput('');
    setEditStreamText('');

    try {
      const res = await fetch(`/api/work/threads/${threadId}/edit-artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction.trim() }),
      });

      if (!res.ok || !res.body) throw new Error('Edit failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const sepIdx = buffer.indexOf(ARTIFACT_SEPARATOR);
        const display = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer;
        setEditStreamText(display);
      }

      // Extract updated artifact from buffer
      const sepIdx = buffer.indexOf(ARTIFACT_SEPARATOR);
      const finalText = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer.trim();
      const artifactRaw = sepIdx !== -1 ? buffer.slice(sepIdx + ARTIFACT_SEPARATOR.length).trim() : null;

      if (artifactRaw) {
        try {
          const updatedArtifact = JSON.parse(artifactRaw) as DocumentArtifact;
          setArtifact(updatedArtifact);
          setThreads((prev) =>
            prev.map((t) => t.id === threadId ? { ...t, artifact: updatedArtifact } : t)
          );
        } catch {
          // artifact parse failed
        }
      }

      // Add the exchange to messages
      const userMsg: WorkMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: instruction.trim(),
        created_at: new Date().toISOString(),
      };
      const aiMsg: WorkMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: finalText,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setEditStreamText('');
    } catch (err) {
      console.error('Edit artifact error:', err);
      setEditStreamText('');
    } finally {
      setIsEditingArtifact(false);
      artifactInputRef.current?.focus();
    }
  }, [isEditingArtifact]);

  const downloadDocument = useCallback(async (threadId: string) => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/work/threads/${threadId}/download`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifact?.title ?? 'document'}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  }, [artifact]);

  const startThread = useCallback(async (description: string) => {
    if (!description.trim() || isCreatingThread) return;

    const title = description.trim().slice(0, 80);
    setIsCreatingThread(true);

    try {
      const res = await fetch('/api/work/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });

      if (!res.ok) throw new Error('Failed to create thread');
      const data = await res.json();
      const newThread: WorkThread = data.thread;

      setThreads((prev) => [newThread, ...prev]);
      skipLoadRef.current = newThread.id;
      setActiveThreadId(newThread.id);
      setMessages([]);
      setEntryInput('');
      setWorkMode('planning');
      setArtifact(null);
      setIsCreatingThread(false);
      sendMessage(description, newThread.id);
    } catch (err) {
      console.error('Failed to start thread:', err);
      setIsCreatingThread(false);
    }
  }, [isCreatingThread, sendMessage]);

  const startEditing = (thread: WorkThread) => {
    setEditingThreadId(thread.id);
    setEditingTitle(thread.title);
    setConfirmDeleteId(null);
    setTimeout(() => editTitleInputRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    setEditingThreadId(null);
    setEditingTitle('');
  };

  const handleRenameThread = async (threadId: string) => {
    const title = editingTitle.trim();
    if (!title) { cancelEditing(); return; }
    setEditingThreadId(null);
    setThreads((prev) =>
      prev.map((t) => t.id === threadId ? { ...t, title } : t)
    );
    try {
      await fetch(`/api/work/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    } catch {
      setThreads((prev) =>
        prev.map((t) => t.id === threadId ? { ...t, title: t.title } : t)
      );
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    setConfirmDeleteId(null);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setWorkMode('planning');
      setArtifact(null);
    }
    try {
      await fetch(`/api/work/threads/${threadId}`, { method: 'DELETE' });
    } catch {
      console.error('Failed to delete thread');
    }
  };

  const handleBlueprintSelect = (blueprint: WorkBlueprint) => {
    const description = `${blueprint.name}: ${blueprint.description}`;
    startThread(description);
  };

  const handleEntrySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (entryInput.trim()) startThread(entryInput);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeThreadId && chatInput.trim()) {
      sendMessage(chatInput, activeThreadId);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeThreadId && chatInput.trim() && !isStreaming) {
        sendMessage(chatInput, activeThreadId);
      }
    }
  };

  const handleArtifactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeThreadId && artifactInput.trim()) {
      editArtifact(artifactInput, activeThreadId);
    }
  };

  const handleArtifactKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeThreadId && artifactInput.trim() && !isEditingArtifact) {
        editArtifact(artifactInput, activeThreadId);
      }
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <SidebarNav userEmail={userEmail} />

      {/* Thread list sidebar */}
      <div className="w-52 border-r border-neutral-200 flex flex-col flex-shrink-0 bg-white">
        <div className="p-3 border-b border-neutral-100">
          <button
            onClick={() => setActiveThreadId(null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New work
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {threads.length === 0 ? (
            <p className="text-[11px] text-neutral-400 px-4 py-6 text-center leading-relaxed">
              Your work threads will appear here
            </p>
          ) : (
            threads.map((thread) => {
              const isActive = activeThreadId === thread.id;
              const isEditing = editingThreadId === thread.id;
              const isConfirmingDelete = confirmDeleteId === thread.id;

              return (
                <div
                  key={thread.id}
                  className={`group relative border-b border-neutral-50 ${
                    isActive ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-neutral-50'
                  } transition-colors`}
                >
                  {isEditing ? (
                    <div className="px-2 py-2 flex items-center gap-1">
                      <input
                        ref={editTitleInputRef}
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameThread(thread.id);
                          if (e.key === 'Escape') cancelEditing();
                        }}
                        className="flex-1 min-w-0 text-[12px] text-neutral-900 border border-indigo-300 focus:outline-none focus:border-indigo-500 px-2 py-1 bg-white"
                      />
                      <button
                        onClick={() => handleRenameThread(thread.id)}
                        className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="flex-shrink-0 p-1 text-neutral-400 hover:text-neutral-600"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : isConfirmingDelete ? (
                    <div className="px-3 py-2.5">
                      <p className="text-[11px] text-red-600 mb-1.5">Delete this thread?</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDeleteThread(thread.id)}
                          className="text-[11px] font-medium text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] text-neutral-500 hover:text-neutral-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start">
                      <button
                        onClick={() => setActiveThreadId(thread.id)}
                        className="flex-1 min-w-0 text-left px-3 py-2.5"
                      >
                        <p className={`text-[12px] leading-snug truncate ${
                          isActive ? 'text-indigo-900 font-medium' : 'text-neutral-800'
                        }`}>
                          {thread.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-neutral-400">
                            {relativeTime(thread.updated_at)}
                          </p>
                          {thread.artifact && (
                            <span className="text-[9px] text-green-600 bg-green-50 px-1 py-px">docx</span>
                          )}
                        </div>
                      </button>

                      <div className="flex-shrink-0 flex items-center gap-0.5 pr-1.5 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditing(thread); }}
                          className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
                          title="Rename"
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(thread.id); setEditingThreadId(null); }}
                          className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main content */}
      {!activeThreadId ? (
        /* ── Entry view ── */
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-2xl mx-auto px-6 py-12">
            <div className="mb-10">
              <h1 className="text-2xl font-bold text-neutral-900 mb-1">Create Work</h1>
              <p className="text-[14px] text-neutral-500">
                Describe what you need done — the AI will propose a plan and guide you through it.
              </p>
            </div>

            <form onSubmit={handleEntrySubmit} className="mb-10">
              <div className="bg-white border border-neutral-200 shadow-sm">
                <textarea
                  value={entryInput}
                  onChange={(e) => setEntryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (entryInput.trim()) startThread(entryInput);
                    }
                  }}
                  placeholder="e.g. Prepare the Q4 board presentation with revenue metrics and product updates"
                  className="w-full px-5 py-4 text-[14px] text-neutral-900 placeholder-neutral-400 resize-none focus:outline-none"
                  rows={4}
                  disabled={isCreatingThread}
                />
                <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100">
                  <p className="text-[11px] text-neutral-400">Press Enter to start</p>
                  <button
                    type="submit"
                    disabled={!entryInput.trim() || isCreatingThread}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isCreatingThread ? (
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : null}
                    Start
                  </button>
                </div>
              </div>
            </form>

            {blueprints.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <SparklesIcon className="w-4 h-4 text-neutral-400" />
                  <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                    Quick start
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {blueprints.slice(0, 8).map((blueprint) => {
                    const Icon = getCategoryIcon(blueprint.category);
                    return (
                      <button
                        key={blueprint.id}
                        onClick={() => handleBlueprintSelect(blueprint)}
                        disabled={isCreatingThread}
                        className="text-left p-3.5 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed group"
                      >
                        <div className="flex items-start gap-2.5">
                          <Icon className="w-4 h-4 text-neutral-400 group-hover:text-indigo-500 flex-shrink-0 mt-0.5 transition-colors" />
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-neutral-900 truncate">
                              {blueprint.name}
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2 leading-relaxed">
                              {blueprint.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Split view: left panel + right chat ── */
        <>
          {/* Left panel: plan or document */}
          {workMode === 'document' && artifact ? (
            <DocumentPanel
              artifact={artifact}
              onDownload={() => activeThreadId && downloadDocument(activeThreadId)}
              onRegenerate={() => setWorkMode('planning')}
              isDownloading={isDownloading}
            />
          ) : (
            <PlanPanel
              plan={activeThread?.plan ?? null}
              isUpdating={isStreaming}
              planJustUpdated={planJustUpdated}
              workMode={workMode}
              onGenerate={generateDocument}
              threadId={activeThreadId}
              artifact={artifact}
              onViewDocument={() => setWorkMode('document')}
            />
          )}

          {/* Right panel: chat or document edit */}
          <div className="w-[400px] flex-shrink-0 flex flex-col border-l border-neutral-200 bg-white">

            {workMode === 'generating' ? (
              /* Generating state — disabled chat */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center px-8">
                  <div className="flex items-center justify-center gap-1.5 mb-3">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                  <p className="text-[13px] text-neutral-500 font-medium">Generating your document…</p>
                  <p className="text-[11px] text-neutral-400 mt-1">This may take a few seconds</p>
                </div>
              </div>
            ) : workMode === 'document' ? (
              /* Document edit mode */
              <>
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-0">
                  {isLoadingThread ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
                    </div>
                  ) : (
                    <>
                      {messages.length === 0 && !isEditingArtifact && (
                        <div className="text-center pt-8 pb-4">
                          <p className="text-[12px] text-neutral-400 leading-relaxed">
                            Document generated. Ask me to make edits — I'll regenerate it with your changes.
                          </p>
                        </div>
                      )}

                      {messages.map((msg, i) => (
                        msg.role === 'assistant' ? (
                          <div key={msg.id} className={`${i > 0 ? 'pt-5' : ''}`}>
                            <MarkdownText content={msg.content} />
                          </div>
                        ) : (
                          <div key={msg.id} className="flex justify-end pt-5 pb-1">
                            <div className="max-w-[85%]">
                              <p className="text-[12px] text-neutral-500 leading-relaxed">
                                {msg.content}
                              </p>
                              <p className="text-[10px] text-neutral-300 mt-1">
                                {new Date(msg.created_at).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        )
                      ))}

                      {isEditingArtifact && editStreamText && (
                        <div className="pt-5">
                          <MarkdownText content={editStreamText} cursor />
                        </div>
                      )}

                      {isEditingArtifact && !editStreamText && (
                        <div className="pt-5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      )}

                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                <div className="border-t border-neutral-100" />

                <form onSubmit={handleArtifactSubmit} className="p-4">
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={artifactInputRef}
                      value={artifactInput}
                      onChange={(e) => setArtifactInput(e.target.value)}
                      onKeyDown={handleArtifactKeyDown}
                      placeholder="Edit the document… e.g. 'make the summary shorter'"
                      rows={1}
                      disabled={isEditingArtifact}
                      className="flex-1 text-[13px] text-neutral-900 placeholder-neutral-400 resize-none focus:outline-none border border-neutral-200 focus:border-indigo-400 px-3 py-2.5 max-h-32 disabled:opacity-50 leading-relaxed"
                      style={{ height: 'auto', minHeight: '40px' }}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!artifactInput.trim() || isEditingArtifact}
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-end mb-px"
                    >
                      <svg className="w-3.5 h-3.5 rotate-90" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-[10px] text-neutral-400 mt-2">
                    Enter to send · Shift+Enter for new line
                  </p>
                </form>
              </>
            ) : (
              /* Planning mode chat */
              <>
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-0">
                  {isLoadingThread ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
                    </div>
                  ) : (
                    <>
                      {messages.map((msg, i) => (
                        msg.role === 'assistant' ? (
                          <div key={msg.id} className={`${i > 0 ? 'pt-5' : ''}`}>
                            <MarkdownText content={msg.content} />
                          </div>
                        ) : (
                          <div key={msg.id} className="flex justify-end pt-5 pb-1">
                            <div className="max-w-[85%]">
                              <p className="text-[12px] text-neutral-500 leading-relaxed">
                                {msg.content}
                              </p>
                              <p className="text-[10px] text-neutral-300 mt-1">
                                {new Date(msg.created_at).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        )
                      ))}

                      {isStreaming && streamingText && (
                        <div className="pt-5">
                          <MarkdownText content={streamingText} cursor />
                        </div>
                      )}

                      {(isStreaming || isCreatingThread) && !streamingText && (
                        <div className="pt-5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      )}

                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                <div className="border-t border-neutral-100" />

                <form onSubmit={handleChatSubmit} className="p-4">
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={chatInputRef}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleChatKeyDown}
                      placeholder="Reply…"
                      rows={1}
                      disabled={isStreaming}
                      className="flex-1 text-[13px] text-neutral-900 placeholder-neutral-400 resize-none focus:outline-none border border-neutral-200 focus:border-indigo-400 px-3 py-2.5 max-h-32 disabled:opacity-50 leading-relaxed"
                      style={{ height: 'auto', minHeight: '40px' }}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isStreaming}
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-end mb-px"
                    >
                      <svg className="w-3.5 h-3.5 rotate-90" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-[10px] text-neutral-400 mt-2">
                    Enter to send · Shift+Enter for new line
                  </p>
                </form>
              </>
            )}
          </div>
        </>
      )}

      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        userEmail={userEmail}
        userFullName={userFullName}
      />
    </div>
  );
}
