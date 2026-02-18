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
} from '@heroicons/react/24/outline';
import { WorkBlueprint } from '@/lib/types/work-blueprints';
import { ExecutionPlan } from '@/lib/types/inbox';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkThread {
  id: string;
  title: string;
  plan: ExecutionPlan | null;
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
  hasCompletedOnboarding: boolean;
  blueprints: WorkBlueprint[];
  initialThreads: WorkThread[];
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';

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

function PlanPanel({ plan }: { plan: ExecutionPlan | null }) {
  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center border-r border-neutral-200 bg-neutral-50">
        <div className="text-center px-8">
          <div className="w-10 h-10 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <DocumentTextIcon className="w-5 h-5 text-neutral-400" />
          </div>
          <p className="text-[13px] text-neutral-400">
            Describe your work — the plan will appear here
          </p>
        </div>
      </div>
    );
  }

  const Icon = getDeliverableIcon(plan.deliverable_type);

  return (
    <div className="flex-1 overflow-y-auto border-r border-neutral-200 bg-white">
      <div className="p-6 space-y-6">
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
              {plan.estimated_time && (
                <span className="text-[11px] text-neutral-500 bg-neutral-100 px-2 py-0.5">
                  {plan.estimated_time}
                </span>
              )}
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
                  className="flex items-start gap-2.5 p-3 bg-neutral-50 border border-neutral-100"
                >
                  <div className="flex-shrink-0 w-5 h-5 bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {step.number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-neutral-900">{step.action}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {step.estimatedTime && (
                        <span className="text-[10px] text-neutral-400">
                          {step.estimatedTime}
                        </span>
                      )}
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
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WorkPageClient({
  userEmail,
  blueprints,
  initialThreads,
}: WorkPageClientProps) {
  const [threads, setThreads] = useState<WorkThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [entryInput, setEntryInput] = useState('');
  const [isCreatingThread, setIsCreatingThread] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Load thread messages when switching threads
  const loadThread = useCallback(async (threadId: string) => {
    setIsLoadingThread(true);
    setMessages([]);
    setStreamingText('');
    try {
      const res = await fetch(`/api/work/threads/${threadId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      // Sync plan from server into local thread state
      if (data.thread?.plan) {
        setThreads((prev) =>
          prev.map((t) => t.id === threadId ? { ...t, plan: data.thread.plan } : t)
        );
      }
    } finally {
      setIsLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (activeThreadId) {
      loadThread(activeThreadId);
    }
  }, [activeThreadId, loadThread]);

  // Stream a message to the active thread
  const sendMessage = useCallback(async (content: string, threadId: string) => {
    if (!content.trim() || isStreaming) return;

    // Optimistic user message
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

        // Display only the part before the plan separator
        const sepIdx = buffer.indexOf(PLAN_SEPARATOR);
        const display = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer;
        setStreamingText(display);
      }

      // Stream complete — extract plan from buffer
      const sepIdx = buffer.indexOf(PLAN_SEPARATOR);
      const finalText = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer.trim();
      const planRaw = sepIdx !== -1 ? buffer.slice(sepIdx + PLAN_SEPARATOR.length).trim() : null;

      // Add AI message to local state
      const aiMsg: WorkMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: finalText,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setStreamingText('');

      // Update plan in local thread state
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
        } catch {
          // plan parse failed — keep existing plan
        }
      }

      // Move thread to top of list
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

  // Create a new thread and send the first message
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
      setActiveThreadId(newThread.id);
      setMessages([]);
      setEntryInput('');

      // Wait a tick for activeThreadId to settle, then send first message
      setTimeout(() => {
        sendMessage(description, newThread.id);
      }, 50);
    } catch (err) {
      console.error('Failed to start thread:', err);
    } finally {
      setIsCreatingThread(false);
    }
  }, [isCreatingThread, sendMessage]);

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
            threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-neutral-50 transition-colors border-b border-neutral-50 ${
                  activeThreadId === thread.id ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : ''
                }`}
              >
                <p className={`text-[12px] leading-snug truncate ${
                  activeThreadId === thread.id ? 'text-indigo-900 font-medium' : 'text-neutral-800'
                }`}>
                  {thread.title}
                </p>
                <p className="text-[10px] text-neutral-400 mt-0.5">
                  {relativeTime(thread.updated_at)}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content: either entry view or split panel */}
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

            {/* Entry input */}
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

            {/* Blueprints */}
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
        /* ── Split view: plan + chat ── */
        <>
          {/* Plan panel */}
          <PlanPanel plan={activeThread?.plan ?? null} />

          {/* Chat panel */}
          <div className="w-[400px] flex-shrink-0 flex flex-col border-l border-neutral-200 bg-white">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-0">
              {isLoadingThread ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {messages.map((msg, i) => (
                    msg.role === 'assistant' ? (
                      /* AI message — full width, clean prose */
                      <div key={msg.id} className={`${i > 0 ? 'pt-5' : ''}`}>
                        <p className="text-[13.5px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    ) : (
                      /* User message — right-aligned, muted */
                      <div key={msg.id} className="flex justify-end pt-5 pb-1">
                        <div className="max-w-[85%] text-right">
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

                  {/* Streaming AI response */}
                  {isStreaming && streamingText && (
                    <div className="pt-5">
                      <p className="text-[13.5px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                        {streamingText}
                        <span className="inline-block w-0.5 h-3.5 bg-neutral-400 ml-0.5 animate-pulse align-middle" />
                      </p>
                    </div>
                  )}

                  {/* Typing indicator (before text starts) */}
                  {isStreaming && !streamingText && (
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

            {/* Divider */}
            <div className="border-t border-neutral-100" />

            {/* Chat input */}
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
          </div>
        </>
      )}
    </div>
  );
}
