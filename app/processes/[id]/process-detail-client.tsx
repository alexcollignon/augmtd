'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SidebarNav from '@/components/sidebar-nav';
import { WorkspaceTabBar } from '@/components/work/workspace-tab-bar';
import type { ProcessDetail, ProcessStepRecord, ProcessComment, ProcessStepStatus, ProcessPlan } from '@/lib/types/process';
import { StepTypeIcon, AssigneePicker, TeamMember, ChatMessage as PlanChatMessage, getDisplayText, hasReachedJson, extractPlanJson, PLAN_SEPARATOR as PLAN_SEP } from '@/app/processes/_components/plan-components';
import { ProcessSidebar } from '@/app/processes/_components/process-sidebar';
import {
  CheckCircleIcon,
  LockClosedIcon,
  ClockIcon,
  CpuChipIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
  ChevronLeftIcon,
  BellAlertIcon,
  ChatBubbleLeftIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  TrashIcon,
  PencilIcon,
  PaperClipIcon,
  XMarkIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

interface Props {
  processId: string;
  userId: string;
  userEmail: string;
  companyRole: string;
}

interface MeetingRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  attendee_count: number;
}

interface AnalysisResult {
  attention: {
    title: string;
    blocker: string;
    action: string;
    cta: string;
  } | null;
  outcomes: Array<{ type: 'risk' | 'suggestion'; text: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const bullet = line.match(/^(\s*[-*])\s+(.+)/);
    const num = line.match(/^(\s*\d+\.)\s+(.+)/);
    if (bullet) return <li key={i} className="ml-4 list-disc">{bullet[2]}</li>;
    if (num) return <li key={i} className="ml-4 list-decimal">{num[2]}</li>;
    if (line.trim() === '') return <br key={i} />;
    return <span key={i} className="block">{line}</span>;
  });
}

function renderCommentText(text: string): React.ReactNode[] {
  // Split on @word(s) patterns
  const parts = text.split(/(@[\w][\w\s]*?(?=\s|—|$|\.))/g);
  return parts.map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="text-indigo-600 font-medium">{part}</span>
      : <span key={i}>{part}</span>
  );
}

function ctaLabel(step: ProcessStepRecord): string {
  if (step.cta_label) return step.cta_label;
  if (step.step_type === 'generator') return 'Run AI Step';
  if (step.input_type === 'approval') return ''; // uses Approve/Reject buttons
  if (!step.input_label) return 'Submit';

  const stripped = step.input_label
    .replace(/^(input|enter|add|provide|write|describe|specify|list|summarize|submit|upload)\s+/i, '')
    .replace(/^(a|an|the|your)\s+/i, '');

  const label = stripped.charAt(0).toUpperCase() + stripped.slice(1, 36);
  return `+ ${label}`;
}

// ── Artifact display ─────────────────────────────────────────────────────────
function ArtifactPreview({ artifact }: { artifact: Record<string, unknown> }) {
  if (!artifact) return null;
  const a = artifact as Record<string, unknown>;
  if (!a.content || typeof a.content !== 'string') return null;

  const download = () => {
    const blob = new Blob([a.content as string], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = (a.filename as string) ?? 'output.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-3 border border-indigo-100 rounded bg-indigo-50/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-indigo-100">
        <span className="text-[11px] font-medium text-indigo-700">
          {a.type === 'email_draft' ? 'Generated email' : 'Generated document'} — {a.filename as string}
        </span>
        <button
          onClick={download}
          className="text-[11px] text-indigo-600 hover:text-indigo-800 underline"
        >
          Download
        </button>
      </div>
      <pre className="px-3 py-2 text-[11px] text-neutral-700 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto leading-relaxed">
        {(a.content as string).slice(0, 1200)}{(a.content as string).length > 1200 ? '\n…' : ''}
      </pre>
    </div>
  );
}

// ── File input data display ───────────────────────────────────────────────────
function FileChip({ inputData, onRemove }: { inputData: Record<string, unknown>; onRemove?: () => void }) {
  const d = inputData;
  if (!d.filename || !d.content_base64) return null;

  const download = () => {
    try {
      const binary = atob(d.content_base64 as string);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: (d.mime_type as string) ?? 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = d.filename as string;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const sizeKb = d.size_bytes ? Math.round((d.size_bytes as number) / 1024) : null;

  return (
    <span className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 bg-neutral-100 border border-neutral-200 rounded text-[11px] text-neutral-700">
      <button onClick={download} className="hover:text-indigo-600 transition-colors">
        📎 {d.filename as string}{sizeKb ? ` (${sizeKb} KB)` : ''}
      </button>
      {onRemove && (
        <button onClick={e => { e.stopPropagation(); onRemove(); }} className="ml-1 text-neutral-400 hover:text-red-500">
          <XMarkIcon className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

// ── Health metrics ────────────────────────────────────────────────────────────
function computeHealth(detail: ProcessDetail) {
  const steps = detail.steps;
  const completed = steps.filter(s => s.status === 'completed');
  const blocked = steps.filter(s => s.status === 'blocked');

  const avgDuration =
    completed.length > 0
      ? completed
          .filter(s => s.started_at && s.completed_at)
          .reduce((sum, s) => {
            const ms = new Date(s.completed_at!).getTime() - new Date(s.started_at!).getTime();
            return sum + ms / (1000 * 60 * 60 * 24);
          }, 0) / Math.max(completed.filter(s => s.started_at && s.completed_at).length, 1)
      : null;

  let onTimePct = 75;
  if (detail.due_date && detail.started_at) {
    const totalDays = (new Date(detail.due_date).getTime() - new Date(detail.started_at).getTime()) / (1000 * 60 * 60 * 24);
    const elapsed = (Date.now() - new Date(detail.started_at).getTime()) / (1000 * 60 * 60 * 24);
    const progress = steps.length > 0 ? completed.length / steps.length : 0;
    const expectedProgress = totalDays > 0 ? elapsed / totalDays : 0;
    onTimePct = progress >= expectedProgress ? 80 : Math.max(20, Math.round(progress / Math.max(expectedProgress, 0.01) * 100));
  }

  return { onTimePct, avgDuration, blockerCount: blocked.length };
}

// ── Step icon ─────────────────────────────────────────────────────────────────
function StepIcon({ status }: { status: ProcessStepStatus }) {
  if (status === 'completed') return <CheckCircleSolid className="w-5 h-5 text-green-500" />;
  if (status === 'blocked') return <LockClosedIcon className="w-5 h-5 text-red-400" />;
  if (status === 'in_progress') return <ClockIcon className="w-5 h-5 text-indigo-400" />;
  return <div className="w-5 h-5 rounded-full border-2 border-neutral-200" />;
}

// ── Step input form ───────────────────────────────────────────────────────────
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

  const label = ctaLabel(step);

  if (step.step_type === 'generator') {
    const studioUrl = `/work?processStep=${step.step_index}&processId=${step.id}&stepTitle=${encodeURIComponent(step.title ?? '')}&stepDesc=${encodeURIComponent(step.description ?? '')}`;
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => submit({ generated: true })}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-[12px] hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? (
            <>
              <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:300ms]" />
            </>
          ) : (
            <SparklesIcon className="w-3.5 h-3.5" />
          )}
          {submitting ? 'Running…' : 'Run in Studio'}
        </button>
        <Link
          href={studioUrl}
          className="text-[11px] text-indigo-500 hover:text-indigo-700 transition-colors"
        >
          Open in Studio →
        </Link>
        {submitting && (
          <span className="text-[11px] text-neutral-400">This may take 10–20 seconds</span>
        )}
      </div>
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
            {label}
          </button>
        </div>
      );
    case 'range':
      return (
        <div className="flex gap-2 items-center flex-wrap">
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
            {label}
          </button>
        </div>
      );
    case 'file':
      return (
        <div className="flex flex-col gap-2">
          <input
            type="file"
            className="text-[12px] text-neutral-600"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                alert('File must be under 2 MB');
                e.target.value = '';
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                // readAsDataURL returns "data:mime;base64,..." — strip prefix
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(',')[1];
                submit({
                  filename: file.name,
                  content_base64: base64,
                  mime_type: file.type,
                  size_bytes: file.size,
                });
              };
              reader.readAsDataURL(file);
            }}
          />
          <p className="text-[10px] text-neutral-400">Max 2 MB</p>
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
          <div className="flex items-center justify-between">
            <Link
              href={`/work?processStep=${step.step_index}&processId=${step.id}&stepTitle=${encodeURIComponent(step.title ?? '')}&stepDesc=${encodeURIComponent(step.description ?? '')}`}
              className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              <SparklesIcon className="w-3 h-3" />
              Create in Studio →
            </Link>
            <button
              onClick={() => submit({ text: value })}
              disabled={submitting || !value.trim()}
              className="px-4 py-1.5 bg-indigo-600 text-white text-[12px] rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : label}
            </button>
          </div>
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
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);

  // AI chat
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Inline meta editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [editDueDate, setEditDueDate] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Meetings + files
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [savingFiles, setSavingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Draft re-planning state (only used when status === 'draft')
  const [draftPlan, setDraftPlan] = useState<ProcessPlan | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftChat, setDraftChat] = useState<PlanChatMessage[]>([]);
  const [draftInput, setDraftInput] = useState('');
  const [draftStreaming, setDraftStreaming] = useState(false);
  const [draftPlanUpdating, setDraftPlanUpdating] = useState(false);
  const [draftLaunching, setDraftLaunching] = useState(false);
  const [draftTeamMembers, setDraftTeamMembers] = useState<TeamMember[]>([]);
  const draftChatEndRef = useRef<HTMLDivElement>(null);
  const draftOriginalSuggestionsRef = useRef<Record<number, string | null>>({});

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

  // Mark notifications as read when detail opens
  useEffect(() => {
    fetch('/api/notifications/processes/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ process_id: processId }),
    }).catch(() => {});
  }, [processId]);

  // Fetch analysis when process is active
  useEffect(() => {
    if (!detail || detail.status !== 'active') return;
    fetch(`/api/processes/${processId}/analysis`)
      .then(r => r.json())
      .then(d => setAnalysis(d))
      .catch(() => {});
  }, [detail?.status, processId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch meetings when active
  useEffect(() => {
    if (!detail || detail.status !== 'active') return;
    fetch(`/api/processes/${processId}/meetings`)
      .then(r => r.json())
      .then(d => setMeetings(d.meetings ?? []))
      .catch(() => {});
  }, [detail?.status, processId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize draft state
  useEffect(() => {
    if (detail?.status === 'draft') {
      setDraftPlan(detail.plan ?? null);
      setDraftTitle(detail.title ?? '');
      fetch('/api/company/members')
        .then(r => r.json())
        .then(d => setDraftTeamMembers(d.members ?? []))
        .catch(() => {});
    }
  }, [detail?.status, detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    draftChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [draftChat]);

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
      // Refresh analysis after step completion
      fetch(`/api/processes/${processId}/analysis`)
        .then(r => r.json())
        .then(d => setAnalysis(d))
        .catch(() => {});
    }
  };

  const postCommentContent = async (content: string) => {
    if (!content.trim() || postingComment) return;
    setPostingComment(true);
    const res = await fetch(`/api/processes/${processId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      setDetail(prev => prev ? { ...prev, comments: [...prev.comments, data.comment] } : null);
      setComment('');
    }
    setPostingComment(false);
  };

  const nudgeCurrentAssignee = async () => {
    if (!detail) return;
    const currentStep = detail.steps.find(s => s.status === 'in_progress');
    if (!currentStep) return;
    const assigneeName = nameMap[currentStep.assignee_id ?? ''] ?? currentStep.department ?? 'the assignee';
    const content = `@${assigneeName} — this step needs your attention. Please review and complete "${currentStep.title}" at your earliest convenience.`;
    await postCommentContent(content);
  };

  const deleteProcess = async () => {
    if (!confirm('Delete this process? This cannot be undone — all steps and comments will be removed.')) return;
    setDeleting(true);
    const res = await fetch(`/api/processes/${processId}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/processes');
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? 'Failed to delete process');
      setDeleting(false);
    }
  };

  const saveMeta = async (fields: Record<string, string | null>) => {
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/processes/${processId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (res.ok) {
        const data = await res.json();
        setDetail(prev => prev ? { ...prev, ...data.process } : null);
      }
    } finally {
      setSavingMeta(false);
    }
  };

  const attachFile = (file: File) => {
    if (file.size > 2 * 1024 * 1024) { alert('File must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      const entry = {
        filename: file.name,
        content_base64: base64,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_at: new Date().toISOString(),
      };
      const newFiles = [...(detail?.files ?? []), entry];
      setSavingFiles(true);
      try {
        const res = await fetch(`/api/processes/${processId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: newFiles }),
        });
        if (res.ok) {
          const data = await res.json();
          setDetail(prev => prev ? { ...prev, files: data.process.files } : null);
        }
      } finally { setSavingFiles(false); }
    };
    reader.readAsDataURL(file);
  };

  const removeFile = async (filename: string) => {
    const newFiles = (detail?.files ?? []).filter(f => f.filename !== filename);
    setSavingFiles(true);
    try {
      const res = await fetch(`/api/processes/${processId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: newFiles }),
      });
      if (res.ok) {
        const data = await res.json();
        setDetail(prev => prev ? { ...prev, files: data.process.files } : null);
      }
    } finally { setSavingFiles(false); }
  };

  // Draft re-planning functions
  const draftSendMessageWith = async (userMsg: string) => {
    if (!userMsg.trim() || draftStreaming) return;
    setDraftChat(prev => [...prev, { role: 'user', content: userMsg }]);
    setDraftStreaming(true);
    const history = draftChat.map(m => ({ role: m.role, content: m.content }));
    try {
      const res = await fetch('/api/processes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, history }),
      });
      if (!res.ok || !res.body) {
        setDraftChat(prev => [...prev, { role: 'assistant', content: 'Error connecting to AI.' }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let jsonStarted = false;
      setDraftChat(prev => [...prev, { role: 'assistant', content: '' }]);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const displayText = getDisplayText(full);
        if (!jsonStarted && hasReachedJson(full)) { jsonStarted = true; setDraftPlanUpdating(true); }
        setDraftChat(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: displayText }; return u; });
      }
      const jsonText = extractPlanJson(full);
      if (jsonText) {
        try {
          const parsed = JSON.parse(jsonText) as ProcessPlan;
          if (parsed?.steps?.length) {
            setDraftPlan(parsed);
            if (Object.keys(draftOriginalSuggestionsRef.current).length === 0) {
              const sugg: Record<number, string | null> = {};
              parsed.steps.forEach(s => { sugg[s.step_index] = s.assignee_id ?? null; });
              draftOriginalSuggestionsRef.current = sugg;
            }
            if (!draftTitle && parsed.description) setDraftTitle(parsed.description.slice(0, 80));
            await fetch(`/api/processes/${processId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan: parsed, title: draftTitle || parsed.description?.slice(0, 80) }),
            });
          }
        } catch { /* ignore */ }
      }
      setDraftPlanUpdating(false);
    } catch (err) {
      setDraftChat(prev => [...prev, { role: 'assistant', content: 'Error: ' + String(err) }]);
    } finally {
      setDraftStreaming(false);
    }
  };

  const draftSendMessage = () => {
    if (!draftInput.trim() || draftStreaming) return;
    const msg = draftInput.trim();
    setDraftInput('');
    draftSendMessageWith(msg);
  };

  const reassignDraftStep = (stepIndex: number, memberId: string | null) => {
    if (!draftPlan) return;
    const member = memberId ? draftTeamMembers.find(m => m.id === memberId) : null;
    setDraftPlan({
      ...draftPlan,
      steps: draftPlan.steps.map(s =>
        s.step_index === stepIndex
          ? { ...s, assignee_id: memberId ?? undefined, department: member?.department }
          : s
      ),
    });
  };

  const launchDraftProcess = async () => {
    if (!draftPlan || !draftTitle.trim() || draftLaunching) return;
    setDraftLaunching(true);
    try {
      await fetch(`/api/processes/${processId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draftTitle.trim(), plan: draftPlan }),
      });
      const launchRes = await fetch(`/api/processes/${processId}/launch`, { method: 'POST' });
      if (!launchRes.ok) {
        const err = await launchRes.json();
        throw new Error(err.error ?? 'Failed to launch');
      }
      await load();
    } catch (err) {
      alert('Launch failed: ' + String(err));
      setDraftLaunching(false);
    }
  };

  const sendChatMessageWith = async (msg: string) => {
    if (chatStreaming) return;
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatStreaming(true);

    try {
      const res = await fetch('/api/processes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, processId, history: chatMessages }),
      });
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const PLAN_SEP = '---PLAN_UPDATE---';
      let full = '';
      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });

        // Strip THINKING blocks and clip at separator
        let display = full.replace(/<THINKING>[\s\S]*?<\/THINKING>\n?/g, '');
        const openThink = display.indexOf('<THINKING>');
        if (openThink !== -1) display = display.slice(0, openThink);
        const sepIdx = display.indexOf(PLAN_SEP);
        if (sepIdx !== -1) display = display.slice(0, sepIdx);

        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: display.trim() };
          return updated;
        });
      }
    } finally {
      setChatStreaming(false);
    }
  };

  const sendQuickPrompt = (prompt: string) => {
    if (chatStreaming) return;
    sendChatMessageWith(prompt);
  };

  const sendChatMessage = () => {
    if (!chatInput.trim() || chatStreaming) return;
    const msg = chatInput.trim();
    setChatInput('');
    sendChatMessageWith(msg);
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

  // Draft layout — plan editing + AI chat
  if (detail.status === 'draft') {
    const draftAssigned = draftPlan?.steps.filter(s => s.assignee_id || s.department).length ?? 0;
    const draftTotal = draftPlan?.steps.length ?? 0;
    const draftAllAssigned = draftTotal > 0 && draftAssigned === draftTotal;
    const draftReady = draftAllAssigned && draftTitle.trim().length > 0;

    return (
      <div className="flex h-screen overflow-hidden bg-neutral-50">
        <SidebarNav userEmail={userEmail} />
        <ProcessSidebar currentId={processId} userId={userId} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <WorkspaceTabBar />
        <div className="flex-1 flex min-w-0 overflow-hidden">
          {/* Center: Plan preview */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-neutral-200 bg-white">
            <div className="flex-shrink-0 px-6 py-4 border-b border-neutral-100">
              <button onClick={() => router.push('/processes')} className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 mb-2">
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                All Processes
              </button>
              <div className="flex items-center gap-2">
                <StatusBadge status={detail.status} />
                <span className="text-[11px] text-neutral-400">Draft — refine plan before launching</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {draftPlanUpdating && !draftPlan ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <ArrowPathIcon className="w-6 h-6 text-indigo-400 animate-spin mx-auto mb-2" />
                    <p className="text-[12px] text-neutral-500">Building your plan...</p>
                  </div>
                </div>
              ) : !draftPlan ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-sm">
                    <ArrowPathIcon className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
                    <p className="text-[13px] text-neutral-500">No plan yet</p>
                    <p className="text-[11px] text-neutral-400 mt-1">Describe your process in the chat to generate a plan.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Title */}
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 mb-1">Process title</label>
                    <input
                      value={draftTitle}
                      onChange={e => setDraftTitle(e.target.value)}
                      placeholder="Name this process..."
                      className="w-full border border-neutral-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>

                  {draftPlan.description && (
                    <p className="text-[12px] text-neutral-600 bg-neutral-50 rounded px-3 py-2 leading-relaxed">
                      {draftPlan.description}
                    </p>
                  )}

                  {draftPlanUpdating && (
                    <div className="flex items-center gap-2 text-[11px] text-indigo-500">
                      <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                      Updating plan...
                    </div>
                  )}

                  {/* INPUTS NEEDED */}
                  <div className="border border-neutral-200 rounded p-3">
                    <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">INPUTS NEEDED</h3>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[12px]">
                        <CheckCircleSolid className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="text-neutral-600">Process description</span>
                      </div>
                      <div className="flex items-center gap-2 text-[12px]">
                        {draftAllAssigned ? (
                          <CheckCircleSolid className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <CheckCircleIcon className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                        )}
                        <span className={draftAllAssigned ? 'text-neutral-600' : 'text-amber-600'}>
                          Team assignments ({draftAssigned}/{draftTotal} steps assigned)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="flex gap-4 text-[11px] text-neutral-500 flex-wrap">
                    <span>{draftTotal} steps</span>
                    {draftPlan.estimated_total_days && <span>~{draftPlan.estimated_total_days} days</span>}
                  </div>

                  {/* Steps */}
                  <div>
                    <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">STEPS ({draftTotal})</h3>
                    <div className="space-y-2">
                      {draftPlan.steps.map((step, i) => {
                        const isUnassigned = !step.assignee_id && !step.department;
                        const originalSuggestion = draftOriginalSuggestionsRef.current[step.step_index] ?? null;
                        return (
                          <div key={step.step_index} className={`flex gap-3 p-3 border rounded ${isUnassigned ? 'border-amber-200 bg-amber-50' : 'border-neutral-100 bg-neutral-50'}`}>
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-[10px] font-semibold text-neutral-500 mt-0.5">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <StepTypeIcon type={step.step_type} />
                                <span className="text-[12px] font-medium text-neutral-800 leading-snug">{step.title}</span>
                              </div>
                              {step.description && (
                                <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{step.description}</p>
                              )}
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <AssigneePicker
                                  step={step}
                                  teamMembers={draftTeamMembers}
                                  originalSuggestion={originalSuggestion}
                                  onAssign={(memberId) => reassignDraftStep(step.step_index, memberId)}
                                />
                                {(step.estimated_days ?? 0) > 0 && (
                                  <span className="text-[10px] text-neutral-400">~{step.estimated_days}d</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Expected outcomes */}
                  {draftPlan.expected_outcomes && draftPlan.expected_outcomes.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">EXPECTED OUTCOMES</h3>
                      <div className="space-y-1.5">
                        {draftPlan.expected_outcomes.map((o, i) => (
                          <div key={i} className="flex items-start gap-2 text-[12px]">
                            {o.type === 'risk' ? (
                              <ExclamationTriangleIcon className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <LightBulbIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                            )}
                            <span className="text-neutral-600 leading-relaxed">{o.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Launch */}
                  {draftReady ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded text-[12px] text-green-700">
                        <CheckCircleSolid className="w-4 h-4 flex-shrink-0" />
                        Process ready — all steps assigned and title set.
                      </div>
                      <button onClick={launchDraftProcess} disabled={draftLaunching} className="w-full py-2.5 bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                        {draftLaunching ? 'Launching...' : 'Launch Process'}
                      </button>
                    </div>
                  ) : (
                    <div className="pt-1">
                      <button onClick={launchDraftProcess} disabled={draftLaunching || !draftTitle.trim()} className="w-full py-2.5 bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                        {draftLaunching ? 'Launching...' : 'Launch Process'}
                      </button>
                      {!draftTitle.trim() && <p className="text-[11px] text-neutral-400 text-center mt-1">Add a title above to launch</p>}
                      {draftTitle.trim() && !draftAllAssigned && (
                        <p className="text-[11px] text-amber-600 text-center mt-1">
                          {draftTotal - draftAssigned} step{draftTotal - draftAssigned !== 1 ? 's' : ''} still need assignment
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: AI Chat */}
          <div className="w-80 flex-shrink-0 flex flex-col bg-white">
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-neutral-100">
              <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">AI ASSISTANT</h3>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {draftChat.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[12px] text-neutral-400 font-medium">Try asking...</p>
                  {['Add an approval step', 'Assign Finance department', 'Add estimated days', 'What steps are missing?'].map(prompt => (
                    <button key={prompt} onClick={() => draftSendMessageWith(prompt)} className="text-left px-3 py-2 text-[12px] text-neutral-600 border border-neutral-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors">
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
              {draftChat.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[80%] px-3 py-2 bg-indigo-600 text-white text-[13px] leading-relaxed">{msg.content}</div>
                  ) : (
                    <div className="max-w-[90%] text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                      {msg.content || (draftStreaming && i === draftChat.length - 1 ? (
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      ) : null)}
                    </div>
                  )}
                </div>
              ))}
              <div ref={draftChatEndRef} />
            </div>
            <div className="flex-shrink-0 border-t border-neutral-200 bg-white">
              <div className="flex items-end gap-2 px-3 py-3">
                <textarea
                  value={draftInput}
                  onChange={e => {
                    setDraftInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); draftSendMessage(); (e.target as HTMLTextAreaElement).style.height = 'auto'; } }}
                  placeholder="Refine your process plan..."
                  disabled={draftStreaming}
                  rows={1}
                  className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
                  style={{ maxHeight: '160px', overflowY: 'auto' }}
                />
                <button onClick={draftSendMessage} disabled={!draftInput.trim() || draftStreaming} className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800 disabled:text-neutral-300 transition-colors mb-px">
                  <PaperAirplaneIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>{/* end flex-1 flex-col */}
      </div>
    );
  }

  const health = computeHealth(detail);
  const currentStep = detail.steps.find(s => s.status === 'in_progress');
  const isMyStep = currentStep?.assignee_id === userId;

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <SidebarNav userEmail={userEmail} />
      <ProcessSidebar currentId={processId} userId={userId} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <WorkspaceTabBar />
      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* Center: Process detail */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-neutral-200 bg-white">
          {/* Header */}
          <div className="relative flex-shrink-0 px-6 py-4 border-b border-neutral-100">
            {savingMeta && <ArrowPathIcon className="w-3 h-3 text-neutral-400 animate-spin absolute top-4 right-4" />}
            <button
              onClick={() => router.push('/processes')}
              className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 mb-2"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
              All Processes
            </button>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={detail.status} />
                </div>
                {/* Title */}
                {editingTitle ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={() => { setEditingTitle(false); if (editTitle.trim() && editTitle !== detail.title) saveMeta({ title: editTitle.trim() }); }}
                    onKeyDown={e => { if (e.key === 'Enter') { setEditingTitle(false); if (editTitle.trim() && editTitle !== detail.title) saveMeta({ title: editTitle.trim() }); } if (e.key === 'Escape') setEditingTitle(false); }}
                    className="text-[16px] font-semibold text-neutral-900 border-b border-indigo-400 outline-none bg-transparent w-full"
                  />
                ) : (
                  <button
                    onClick={() => { setEditTitle(detail.title); setEditingTitle(true); }}
                    className="flex items-center gap-1.5 group"
                  >
                    <h1 className="text-[16px] font-semibold text-neutral-900">{detail.title}</h1>
                    <PencilIcon className="w-3.5 h-3.5 text-neutral-300 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                  </button>
                )}
                {/* Description */}
                {editingDescription ? (
                  <textarea
                    autoFocus
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    onBlur={() => { setEditingDescription(false); saveMeta({ description: editDescription.trim() || null }); }}
                    onKeyDown={e => { if (e.key === 'Escape') setEditingDescription(false); }}
                    rows={2}
                    className="mt-0.5 text-[12px] text-neutral-500 border-b border-indigo-300 outline-none bg-transparent w-full resize-none"
                  />
                ) : (
                  <button
                    onClick={() => { setEditDescription(detail.description ?? ''); setEditingDescription(true); }}
                    className="flex items-start gap-1 mt-0.5 text-left group"
                  >
                    <p className="text-[12px] text-neutral-500">
                      {detail.description ?? <span className="italic text-neutral-300">Add description...</span>}
                    </p>
                    <PencilIcon className="w-3 h-3 text-neutral-300 opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5" />
                  </button>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[11px] text-neutral-500">Owner: {detail.owner_name ?? 'Unknown'}</span>
                  {/* Due date */}
                  {editingDueDate ? (
                    <input
                      autoFocus
                      type="date"
                      value={editDueDate}
                      onChange={e => setEditDueDate(e.target.value)}
                      onBlur={() => { setEditingDueDate(false); saveMeta({ due_date: editDueDate || null }); }}
                      onKeyDown={e => { if (e.key === 'Escape') setEditingDueDate(false); }}
                      className="text-[11px] text-neutral-500 border-b border-indigo-300 outline-none bg-transparent"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditDueDate(detail.due_date ? new Date(detail.due_date).toISOString().split('T')[0] : ''); setEditingDueDate(true); }}
                      className="flex items-center gap-1 group"
                    >
                      <span className="text-[11px] text-neutral-500">
                        {detail.due_date ? `Due: ${new Date(detail.due_date).toLocaleDateString()}` : 'Set due date'}
                      </span>
                      <PencilIcon className="w-3 h-3 text-neutral-300 opacity-0 group-hover:opacity-100" />
                    </button>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {detail.status === 'active' && (
                  <>
                    <button
                      onClick={nudgeCurrentAssignee}
                      disabled={!currentStep || postingComment}
                      title="Nudge current step assignee via comment"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border border-neutral-200 rounded hover:bg-neutral-50 disabled:opacity-40 text-neutral-600"
                    >
                      <BellAlertIcon className="w-3.5 h-3.5" />
                      Nudge
                    </button>
                    <button
                      onClick={() => commentInputRef.current?.focus()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border border-neutral-200 rounded hover:bg-neutral-50 text-neutral-600"
                    >
                      <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
                      Comment
                    </button>
                  </>
                )}
                {(detail.owner_id === userId || isAdmin) && (
                  <button
                    onClick={deleteProcess}
                    disabled={deleting}
                    title="Delete this process"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border border-red-200 rounded hover:bg-red-50 disabled:opacity-40 text-red-500"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                )}
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
            {detail.status === 'active' && (isMyStep || analysis?.attention) && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded">
                <h2 className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-2">
                  WHAT NEEDS ATTENTION NOW
                </h2>
                {analysis?.attention ? (
                  <div>
                    <p className="text-[13px] font-medium text-neutral-800">{analysis.attention.title}</p>
                    <p className="text-[12px] text-neutral-600 mt-1">{analysis.attention.blocker}</p>
                    <p className="text-[12px] text-neutral-700 mt-1">{analysis.attention.action}</p>
                    {analysis.attention.cta && (
                      <span className="inline-block mt-2 px-2.5 py-1 bg-amber-100 text-amber-800 text-[11px] font-medium rounded">
                        {analysis.attention.cta}
                      </span>
                    )}
                  </div>
                ) : currentStep ? (
                  <div>
                    <p className="text-[13px] font-medium text-neutral-800">{currentStep.title}</p>
                    {currentStep.description && (
                      <p className="text-[12px] text-neutral-600 mt-1">{currentStep.description}</p>
                    )}
                  </div>
                ) : null}
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
                      className={`border rounded p-3 transition-colors ${
                        isActive
                          ? 'border-indigo-200 bg-indigo-50'
                          : step.status === 'completed'
                          ? 'border-neutral-100 bg-neutral-50 opacity-70'
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
                              step.status === 'completed' ? 'text-neutral-400 line-through' : 'text-neutral-800'
                            }`}>
                              {step.step_index + 1}. {step.title}
                            </span>
                            {step.step_type === 'generator' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-[9px] font-semibold uppercase tracking-wide border border-indigo-100">
                                <SparklesIcon className="w-2.5 h-2.5" />
                                Studio
                              </span>
                            )}
                            {step.assignee_id ? (
                              <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] rounded-full border border-indigo-100">
                                {nameMap[step.assignee_id] ?? 'Unknown'}
                              </span>
                            ) : step.department ? (
                              <span className="px-1.5 py-0.5 bg-neutral-100 text-neutral-600 text-[10px] rounded-full">
                                {step.department}
                              </span>
                            ) : null}
                            {(step.estimated_days ?? 0) > 0 && (
                              <span className="text-[10px] text-neutral-400">~{step.estimated_days}d</span>
                            )}
                          </div>
                          {step.description && !isActive && (
                            <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">{step.description}</p>
                          )}
                          {step.status === 'completed' && step.completed_at && (
                            <p className="text-[10px] text-neutral-400 mt-1">
                              Completed {new Date(step.completed_at).toLocaleDateString()}
                              {step.completed_by ? ` by ${nameMap[step.completed_by] ?? 'someone'}` : ''}
                            </p>
                          )}
                          {step.status === 'completed' && step.step_type === 'generator' && !!step.artifact && (
                            <ArtifactPreview artifact={step.artifact as Record<string, unknown>} />
                          )}
                          {step.status === 'completed' && step.input_type === 'file' && !!step.input_data && (
                            <FileChip inputData={step.input_data as Record<string, unknown>} />
                          )}
                          {/* Active step — show description + input form */}
                          {isActive && (
                            <div className="mt-2">
                              {step.description && (
                                <p className="text-[12px] text-neutral-600 mb-2 leading-relaxed">{step.description}</p>
                              )}
                              {canComplete && (
                                <div>
                                  {step.input_label && step.input_type !== 'approval' && (
                                    <p className="text-[11px] text-neutral-600 mb-1.5 font-medium">{step.input_label}</p>
                                  )}
                                  <StepInputForm
                                    step={step}
                                    onComplete={(data) => completeStep(step.step_index, data)}
                                  />
                                </div>
                              )}
                              {!canComplete && !isAssignee && !isAdmin && (
                                <p className="text-[11px] text-neutral-400 mt-1 italic">
                                  Waiting on {nameMap[step.assignee_id ?? ''] ?? step.department ?? 'assignee'}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* EXPECTED OUTCOMES */}
            {analysis && analysis.outcomes.length > 0 && (
              <div>
                <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                  EXPECTED OUTCOMES
                </h2>
                <div className="space-y-2">
                  {analysis.outcomes.map((outcome, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-[12px]">
                      {outcome.type === 'risk' ? (
                        <ExclamationTriangleIcon className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <LightBulbIcon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                      )}
                      <span className="text-neutral-600 leading-relaxed">{outcome.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DOCUMENTS & FILES */}
            <div>
              <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                DOCUMENTS & FILES
              </h2>
              <div className="flex flex-wrap gap-2 mb-2">
                {(detail.files ?? []).map(f => (
                  <FileChip key={f.filename} inputData={f as Record<string, unknown>} onRemove={() => removeFile(f.filename)} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={savingFiles}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 text-neutral-600 text-[12px] hover:bg-neutral-50 disabled:opacity-40"
                >
                  {savingFiles ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <PaperClipIcon className="w-3.5 h-3.5" />}
                  Attach file
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) attachFile(f); e.target.value = ''; }} />
              </div>
            </div>

            {/* MEETINGS */}
            {meetings.length > 0 && (
              <div>
                <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                  MEETINGS
                </h2>
                <div className="space-y-2">
                  {meetings.map(m => (
                    <div key={m.id} className="flex items-center gap-3 py-2 border-b border-neutral-50 text-[12px]">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-neutral-800 truncate">{m.title}</p>
                        <p className="text-[11px] text-neutral-400 mt-0.5">
                          {new Date(m.start_time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          {' · '}
                          {new Date(m.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          {m.attendee_count > 0 && ` · ${m.attendee_count} attendees`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TEAM COMMENTS */}
            <div>
              <h2 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                TEAM COMMENTS ({detail.comments.length})
              </h2>
              <div className="space-y-3 mb-3">
                {detail.comments.length === 0 && (
                  <p className="text-[11px] text-neutral-400 italic">No comments yet.</p>
                )}
                {detail.comments.map((c: ProcessComment) => (
                  <div key={c.id} className="flex gap-2.5">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-[11px] font-semibold text-indigo-700">
                      {(c.full_name ?? 'U')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-semibold text-neutral-700">{c.full_name ?? 'Unknown'}</span>
                        <span className="text-[10px] text-neutral-400">{relativeTime(c.created_at)}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-700 leading-relaxed">
                        {renderCommentText(c.content)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  ref={commentInputRef}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && postCommentContent(comment)}
                  placeholder="Add a comment... (use @name to mention)"
                  className="flex-1 border border-neutral-200 rounded px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button
                  onClick={() => postCommentContent(comment)}
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
            <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">
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
                  <span className="font-medium text-neutral-700">{health.avgDuration.toFixed(1)}d</span>
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
          <div className="flex-shrink-0 px-4 py-2.5 border-b border-neutral-100">
            <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">AI ASSISTANT</h3>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {chatMessages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-neutral-400 font-medium">Try asking...</p>
                {[
                  'Who owns the next step?',
                  'Are we on track to finish on time?',
                  'What are the current blockers?',
                  'Summarize progress so far',
                ].map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => sendQuickPrompt(prompt)}
                    className="text-left px-3 py-2 text-[12px] text-neutral-600 border border-neutral-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[80%] px-3 py-2 bg-indigo-600 text-white text-[13px] leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] text-[13px] text-neutral-800 leading-relaxed">
                    {msg.content
                      ? renderMarkdown(msg.content)
                      : (chatStreaming && i === chatMessages.length - 1 ? (
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      ) : null)
                    }
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="flex-shrink-0 border-t border-neutral-200 bg-white">
            <div className="flex items-end gap-2 px-3 py-3">
              <textarea
                value={chatInput}
                onChange={e => {
                  setChatInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); (e.target as HTMLTextAreaElement).style.height = 'auto'; } }}
                placeholder="Ask about this process..."
                disabled={chatStreaming}
                rows={1}
                className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
                style={{ maxHeight: '160px', overflowY: 'auto' }}
              />
              <button
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || chatStreaming}
                className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800 disabled:text-neutral-300 transition-colors mb-px"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>{/* end flex-1 flex-col */}
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
