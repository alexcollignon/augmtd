'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import type { ProcessDetail, ProcessStepRecord, ProcessComment, ProcessStepStatus } from '@/lib/types/process';
import {
  CheckCircleIcon,
  LockClosedIcon,
  ClockIcon,
  UserCircleIcon,
  CpuChipIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
  ChevronLeftIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

interface Props {
  processId: string;
  userId: string;
  userEmail: string;
  companyRole: string;
}

// ── Health metrics ──────────────────────────────────────────────────────────
function computeHealth(detail: ProcessDetail) {
  const steps = detail.steps;
  const completed = steps.filter(s => s.status === 'completed');
  const blocked = steps.filter(s => s.status === 'blocked');
  const inProgress = steps.filter(s => s.status === 'in_progress');

  const avgDuration =
    completed.length > 0
      ? completed
          .filter(s => s.started_at && s.completed_at)
          .reduce((sum, s) => {
            const ms = new Date(s.completed_at!).getTime() - new Date(s.started_at!).getTime();
            return sum + ms / (1000 * 60 * 60 * 24);
          }, 0) / completed.length
      : null;

  // Heuristic on-time probability
  let onTimePct = 75;
  if (detail.due_date && detail.started_at) {
    const totalDays = (new Date(detail.due_date).getTime() - new Date(detail.started_at).getTime()) / (1000 * 60 * 60 * 24);
    const elapsed = (Date.now() - new Date(detail.started_at).getTime()) / (1000 * 60 * 60 * 24);
    const progress = steps.length > 0 ? completed.length / steps.length : 0;
    const expectedProgress = totalDays > 0 ? elapsed / totalDays : 0;
    onTimePct = progress >= expectedProgress ? 80 : Math.max(20, Math.round(progress / Math.max(expectedProgress, 0.01) * 100));
  }

  return { onTimePct, avgDuration, blockerCount: blocked.length, inProgress };
}

// ── Step status icon ─────────────────────────────────────────────────────────
function StepIcon({ status }: { status: ProcessStepStatus }) {
  if (status === 'completed') return <CheckCircleSolid className="w-5 h-5 text-green-500" />;
  if (status === 'blocked') return <LockClosedIcon className="w-5 h-5 text-red-400" />;
  if (status === 'in_progress') return <ClockIcon className="w-5 h-5 text-indigo-400" />;
  return <div className="w-5 h-5 rounded-full border-2 border-neutral-200" />;
}

// ── Step input form ──────────────────────────────────────────────────────────
function StepInputForm({
  step,
  onComplete,
}: {
  step: ProcessStepRecord;
  onComplete: (inputData: unknown) => void;
}) {
  const [value, setValue] = useState('');
  const [numValue, setNumValue] = useState('');
  const [rangeMin, setRangeMin] = useState('');
  const [rangeMax, setRangeMax] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (data: unknown) => {
    setSubmitting(true);
    await onComplete(data);
    setSubmitting(false);
  };

  if (step.step_type === 'generator') {
    return (
      <button
        onClick={() => submit({ generated: true })}
        disabled={submitting}
        className="px-4 py-2 bg-indigo-600 text-white text-[12px] rounded hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? 'Running AI...' : 'Run AI Step'}
      </button>
    );
  }

  switch (step.input_type) {
    case 'approval':
      return (
        <div className="flex gap-2">
          <button
            onClick={() => submit({ approved: true })}
            disabled={submitting}
            className="px-4 py-2 bg-green-600 text-white text-[12px] rounded hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => submit({ approved: false })}
            disabled={submitting}
            className="px-4 py-2 bg-red-500 text-white text-[12px] rounded hover:bg-red-600 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      );
    case 'number':
      return (
        <div className="flex gap-2">
          <input
            type="number"
            value={numValue}
            onChange={e => setNumValue(e.target.value)}
            placeholder={step.input_label ?? 'Enter value...'}
            className="border border-neutral-200 rounded px-3 py-1.5 text-[12px] w-40 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={() => submit({ value: parseFloat(numValue) })}
            disabled={submitting || !numValue}
            className="px-3 py-1.5 bg-indigo-600 text-white text-[12px] rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      );
    case 'range':
      return (
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={rangeMin}
            onChange={e => setRangeMin(e.target.value)}
            placeholder="Min"
            className="border border-neutral-200 rounded px-2 py-1.5 text-[12px] w-24 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <span className="text-neutral-400 text-[11px]">to</span>
          <input
            type="number"
            value={rangeMax}
            onChange={e => setRangeMax(e.target.value)}
            placeholder="Max"
            className="border border-neutral-200 rounded px-2 py-1.5 text-[12px] w-24 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={() => submit({ min: parseFloat(rangeMin), max: parseFloat(rangeMax) })}
            disabled={submitting || !rangeMin || !rangeMax}
            className="px-3 py-1.5 bg-indigo-600 text-white text-[12px] rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      );
    case 'file':
      return (
        <div>
          <input
            type="file"
            className="text-[12px] text-neutral-600"
            onChange={() => submit({ file_uploaded: true })}
          />
        </div>
      );
    default: // 'text'
      return (
        <div className="flex flex-col gap-2">
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={step.input_label ?? 'Enter your response...'}
            rows={3}
            className="border border-neutral-200 rounded px-3 py-2 text-[12px] resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={() => submit({ text: value })}
            disabled={submitting || !value.trim()}
            className="self-end px-4 py-1.5 bg-indigo-600 text-white text-[12px] rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      );
  }
}

export function ProcessDetailClient({ processId, userId, userEmail, companyRole }: Props) {
  const router = useRouter();
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // AI chat
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isAdmin = companyRole === 'owner' || companyRole === 'admin';

  const load = useCallback(async () => {
    const res = await fetch(`/api/processes/${processId}`);
    if (!res.ok) { router.push('/processes'); return; }
    const data = await res.json();
    setDetail(data.process);
    setNameMap(data.nameMap ?? {});
    setLoading(false);
  }, [processId, router]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const completeStep = async (stepIndex: number, inputData: unknown) => {
    const res = await fetch(`/api/processes/${processId}/steps/${stepIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_data: inputData }),
    });
    if (res.ok) {
      const data = await res.json();
      setDetail(prev => prev ? { ...prev, ...data.process, steps: data.steps, comments: prev.comments } : null);
    }
  };

  const postComment = async () => {
    if (!comment.trim() || postingComment) return;
    setPostingComment(true);
    const res = await fetch(`/api/processes/${processId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: comment.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setDetail(prev => prev ? { ...prev, comments: [...prev.comments, data.comment] } : null);
      setComment('');
    }
    setPostingComment(false);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatStreaming) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatStreaming(true);

    try {
      const res = await fetch('/api/processes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          processId,
          history: chatMessages,
        }),
      });
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const PLAN_SEPARATOR = '---PLAN_UPDATE---';
      let full = '';
      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        // Clip display at separator in real-time
        const sepIdx = full.indexOf(PLAN_SEPARATOR);
        const displayText = sepIdx !== -1 ? full.slice(0, sepIdx).trim() : full;
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: displayText };
          return updated;
        });
      }
    } finally {
      setChatStreaming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen overflow-hidden bg-neutral-50">
        <SidebarNav userEmail={userEmail} />
        <div className="flex-1 flex items-center justify-center">
          <ArrowPathIcon className="w-6 h-6 text-neutral-300 animate-spin" />
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const health = computeHealth(detail);
  const currentStep = detail.steps.find(s => s.status === 'in_progress');
  const isMyStep = currentStep?.assignee_id === userId;

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <SidebarNav userEmail={userEmail} />

      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* Center: Process detail */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-neutral-200 bg-white">
          {/* Header */}
          <div className="flex-shrink-0 px-6 py-4 border-b border-neutral-100">
            <button
              onClick={() => router.push('/processes')}
              className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 mb-2"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
              All Processes
            </button>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[16px] font-semibold text-neutral-900">{detail.title}</h1>
                {detail.description && (
                  <p className="text-[12px] text-neutral-500 mt-0.5">{detail.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-500">
                  <span>Owner: {detail.owner_name ?? 'Unknown'}</span>
                  {detail.due_date && <span>Due: {new Date(detail.due_date).toLocaleDateString()}</span>}
                  <StatusBadge status={detail.status} />
                </div>
              </div>
            </div>
            {/* Progress bar */}
            {detail.steps.length > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 rounded-full transition-all"
                    style={{ width: `${Math.round((detail.current_step / detail.steps.length) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] text-neutral-400">
                  {detail.current_step}/{detail.steps.length} steps
                </span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* WHAT NEEDS ATTENTION */}
            {isMyStep && currentStep && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded">
                <h2 className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider mb-1">
                  WHAT NEEDS ATTENTION NOW
                </h2>
                <p className="text-[13px] font-medium text-neutral-800">{currentStep.title}</p>
                {currentStep.description && (
                  <p className="text-[12px] text-neutral-600 mt-1">{currentStep.description}</p>
                )}
              </div>
            )}

            {/* STEPS */}
            <div>
              <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                STEPS ({detail.steps.length})
              </h2>
              <div className="space-y-2">
                {detail.steps.map((step) => {
                  const isActive = step.status === 'in_progress';
                  const isAssignee = step.assignee_id === userId;
                  const canComplete = isActive && (isAssignee || isAdmin);

                  return (
                    <div
                      key={step.id}
                      className={`border rounded p-3 ${
                        isActive
                          ? 'border-indigo-200 bg-indigo-50'
                          : step.status === 'completed'
                          ? 'border-neutral-100 bg-neutral-50 opacity-75'
                          : step.status === 'blocked'
                          ? 'border-red-200 bg-red-50'
                          : 'border-neutral-100'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          <StepIcon status={step.status} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[12px] font-medium ${
                              step.status === 'completed' ? 'text-neutral-500 line-through' : 'text-neutral-800'
                            }`}>
                              {step.step_index + 1}. {step.title}
                            </span>
                            {step.step_type === 'generator' && (
                              <CpuChipIcon className="w-3.5 h-3.5 text-indigo-400" />
                            )}
                            {step.assignee_id ? (
                              <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] rounded-full">
                                {nameMap[step.assignee_id] ?? 'Unknown'}
                              </span>
                            ) : step.department ? (
                              <span className="px-1.5 py-0.5 bg-neutral-100 text-neutral-600 text-[10px] rounded-full">
                                {step.department}
                              </span>
                            ) : null}
                          </div>
                          {step.description && (
                            <p className="text-[11px] text-neutral-500 mt-0.5">{step.description}</p>
                          )}
                          {step.status === 'completed' && step.completed_at && (
                            <p className="text-[10px] text-neutral-400 mt-1">
                              Completed {new Date(step.completed_at).toLocaleDateString()}
                              {step.completed_by ? ` by ${nameMap[step.completed_by] ?? 'someone'}` : ''}
                            </p>
                          )}
                          {/* Input form for active step */}
                          {canComplete && (
                            <div className="mt-3">
                              {step.input_label && (
                                <p className="text-[11px] text-neutral-600 mb-1.5">{step.input_label}</p>
                              )}
                              <StepInputForm
                                step={step}
                                onComplete={(data) => completeStep(step.step_index, data)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TEAM COMMENTS */}
            <div>
              <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                TEAM COMMENTS ({detail.comments.length})
              </h2>
              <div className="space-y-2 mb-3">
                {detail.comments.map((c: ProcessComment) => (
                  <div key={c.id} className="flex gap-2">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700">
                      {(c.full_name ?? 'U')[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-neutral-700">{c.full_name ?? 'Unknown'}</span>
                        <span className="text-[10px] text-neutral-400">
                          {new Date(c.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[12px] text-neutral-700 mt-0.5">{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && postComment()}
                  placeholder="Add a comment..."
                  className="flex-1 border border-neutral-200 rounded px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button
                  onClick={postComment}
                  disabled={!comment.trim() || postingComment}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-[12px] rounded hover:bg-indigo-700 disabled:opacity-40"
                >
                  Post
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: AI Assistant + Health */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-white">
          {/* Health metrics */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-neutral-100">
            <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">
              PROCESS HEALTH
            </h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[12px]">
                <span className="text-neutral-500">On-time probability</span>
                <span className={`font-medium ${health.onTimePct >= 60 ? 'text-green-600' : 'text-orange-600'}`}>
                  {health.onTimePct}%
                </span>
              </div>
              {health.avgDuration !== null && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-neutral-500">Avg step duration</span>
                  <span className="font-medium text-neutral-700">{health.avgDuration.toFixed(1)} days</span>
                </div>
              )}
              <div className="flex justify-between text-[12px]">
                <span className="text-neutral-500">Blockers</span>
                <span className={`font-medium ${health.blockerCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {health.blockerCount} active
                </span>
              </div>
            </div>
          </div>

          {/* AI Chat */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-neutral-50">
            <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">AI Assistant</h3>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {chatMessages.length === 0 && (
              <p className="text-[11px] text-neutral-400 italic">
                Ask about this process, team assignments, or next steps.
              </p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={`text-[12px] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <div className={`inline-block max-w-[90%] px-3 py-2 rounded text-left whitespace-pre-wrap ${
                  msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-800'
                }`}>
                  {msg.content || (chatStreaming && i === chatMessages.length - 1 ? '...' : '')}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="flex-shrink-0 px-4 py-3 border-t border-neutral-100">
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                placeholder="Ask about this process..."
                className="flex-1 border border-neutral-200 rounded px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || chatStreaming}
                className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-neutral-100 text-neutral-600',
    active: 'bg-blue-50 text-blue-700',
    completed: 'bg-green-50 text-green-700',
    archived: 'bg-neutral-100 text-neutral-400',
  };
  const label: Record<string, string> = {
    draft: 'Draft', active: 'Active', completed: 'Completed', archived: 'Archived',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${map[status] ?? 'bg-neutral-100 text-neutral-600'}`}>
      {label[status] ?? status}
    </span>
  );
}
