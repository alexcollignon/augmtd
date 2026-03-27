'use client';

import React, { useEffect, useRef, useState, RefObject, useCallback } from 'react';
import type { InboxItem } from '@/lib/types/inbox';
import type { DeskColumn } from '@/lib/types/desk';
import EmailListCard from '@/components/inbox/email-list-card';
import MeetingProposalCard from '@/components/inbox/meeting-proposal-card';
import {
  PaperAirplaneIcon,
  DocumentTextIcon,
  PaperClipIcon,
  XMarkIcon,
  EnvelopeIcon,
  SparklesIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ComposeDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

interface ParsedAction {
  type: 'archive' | 'open';
  itemId: string;
  label: string;
}

interface ParsedDeskAction {
  type: 'move' | 'dismiss' | 'confirm';
  itemId: string;
  column?: DeskColumn;
  label: string;
}

interface ParsedOpenWorkflow {
  itemId: string;
  skill?: string;
  prefillTitle?: string;
}

interface ParsedOpenProcess {
  processId: string;
  label: string;
}

interface MeetingSuggestion {
  title: string;
  duration_minutes: number;
  attendees: string[];
  proposed_times: string[];
  notes?: string;
}

export interface AiChatPanelProps {
  context: 'inbox' | 'desk';

  // Controlled chat state
  history: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  chatInput: string;
  onChatInputChange: (val: string) => void;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  onSendMessage: (message: string) => void;
  onClose?: () => void;

  // Sources (inbox shows toggle UI)
  chatSources?: string[];
  onSourcesChange?: (sources: string[]) => void;

  // File attachment (inbox only)
  attachedFiles?: Array<{ filename: string; extractedText: string }>;
  onFileAttach?: (file: File) => void;
  onRemoveFile?: (filename: string) => void;
  isAttaching?: boolean;

  // Inbox items (for inline email card rendering in messages)
  inboxItems?: InboxItem[];
  onSelectItem?: (item: InboxItem) => void;

  // Email context chip (inbox)
  emailChipActive?: boolean;
  emailChipData?: {
    subject?: string; from?: string; fromName?: string;
    itemType?: string | null; connectionId?: string | null;
  };
  onDismissEmailChip?: () => void;

  // Compose / reply (inbox)
  mode?: 'inbox' | 'compose' | 'reply';
  composeDraft?: ComposeDraft;
  onUpdateComposeDraft?: (fields: Partial<ComposeDraft>) => void;
  onOpenCompose?: (draft: Partial<ComposeDraft>) => void;
  onUseAsReply?: (body: string) => void;
  replyDraft?: string;
  onUpdateReplyDraft?: (body: string) => void;

  // Inbox action handler (archive, open)
  onAction?: (type: string, itemId: string) => Promise<void>;

  // Navigation (both surfaces)
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
  onOpenProcess?: (processId: string, label: string) => void;

  // Desk action handlers
  onDeskMove?: (itemId: string, column: DeskColumn) => void;
  onDeskDismiss?: (itemId: string) => void;
  onDeskConfirm?: (itemId: string) => void;
}

// ── Token regexes ────────────────────────────────────────────────────────────

const ACTION_RE = /ACTION:\{[^}]+\}/g;
const MEETING_RE = /MEETING_SUGGESTION:(\{.+\})/;
const UPDATE_DRAFT_RE = /UPDATE_DRAFT:(\{[\s\S]+?\})/;
const REPLY_DRAFT_RE = /REPLY_DRAFT:(\{[\s\S]+?\})/;
const OPEN_COMPOSE_RE = /OPEN_COMPOSE:(\{[\s\S]+?\})/;
const OPEN_WORKFLOW_RE = /OPEN_WORKFLOW:(\{[\s\S]+?\})/;
const OPEN_PROCESS_RE = /OPEN_PROCESS:(\{[\s\S]+?\})/;
const DESK_ACTION_RE = /DESK_ACTION:(\{[\s\S]+?\})/;

// ── Source options ───────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'kb', label: 'Drive' },
  { id: 'calendar', label: 'Calendar' },
];

const CONTEXT_SOURCE_IDS = SOURCE_OPTIONS.map(s => s.id); // inbox, kb, calendar — excludes chat

// ── Quick prompts ────────────────────────────────────────────────────────────

const DESK_QUICK_PROMPTS = [
  "What should I focus on today?",
  "What's blocking me right now?",
  "What's high priority?",
  "Summarize my inbox",
];

const INBOX_QUICK_PROMPTS = [
  "What's pending in my inbox?",
  "Any emails waiting on a reply?",
  "Summarize my recent emails",
];

const EMAIL_PROMPTS_BY_TYPE: Record<string, string[]> = {
  meeting: ["Check my availability", "Draft an acceptance reply", "Who else is attending?", "Find relevant docs"],
  reply: ["What are they asking?", "Draft a reply", "How should I respond?", "Find relevant docs"],
  decision: ["Summarize the decision needed", "Draft a reply", "Find relevant docs", "What context do I have on this?"],
  review: ["Summarize what to review", "Draft feedback reply", "Find relevant docs", "Any related docs in my KB?"],
  fyi: ["Summarize this", "Is any action needed?", "Find related docs", "Draft a reply"],
  notification: ["Summarize this notification", "Is any action needed?", "Find related docs", "Draft a reply"],
  default: ["Summarize what they're asking", "Draft a reply", "Find relevant docs", "Check my availability"],
};

function getEmailPrompts(itemType?: string | null): string[] {
  if (itemType && itemType in EMAIL_PROMPTS_BY_TYPE) return EMAIL_PROMPTS_BY_TYPE[itemType];
  return EMAIL_PROMPTS_BY_TYPE.default;
}

const CHAT_QUICK_PROMPTS = [
  "Help me think through something",
  "Explain a concept to me",
  "What should I focus on today?",
  "Brainstorm ideas with me",
];

const COMPOSE_START_PROMPTS = ["Help me draft an email", "Write a follow-up email", "Draft a cold outreach", "Write a thank you note"];
const COMPOSE_REFINE_PROMPTS = ["Make it more concise", "Make it more formal", "Suggest a subject line", "Add a professional closing"];
const REPLY_PROMPTS = ["Make it more formal", "Make it shorter", "Add a professional closing", "Check my availability"];

// ── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(line: string, key: number) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    if (m[2]) parts.push(<strong key={m.index}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={m.index}>{m[3]}</em>);
    last = re.lastIndex;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <span key={key}>{parts}</span>;
}

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h3Match = line.match(/^###\s+(.+)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const bulletMatch = line.match(/^(\s*[-*])\s+(.+)/);
    const numMatch = line.match(/^(\s*\d+\.)\s+(.+)/);
    if (h3Match) {
      nodes.push(<span key={i} className="block text-[12px] font-semibold text-neutral-700 mt-2">{renderInline(h3Match[1], i)}</span>);
    } else if (h2Match) {
      nodes.push(<span key={i} className="block text-[12px] font-semibold text-neutral-700 mt-2">{renderInline(h2Match[1], i)}</span>);
    } else if (bulletMatch) {
      nodes.push(<li key={i} className="ml-4 list-disc">{renderInline(bulletMatch[2], i)}</li>);
    } else if (numMatch) {
      nodes.push(<li key={i} className="ml-4 list-decimal">{renderInline(numMatch[2], i)}</li>);
    } else if (line.trim() === '') {
      nodes.push(<br key={i} />);
    } else {
      nodes.push(<span key={i} className="block">{renderInline(line, i)}</span>);
    }
    i++;
  }
  return nodes;
}

// ── Token parser ─────────────────────────────────────────────────────────────

function parseKBSources(text: string): string[] {
  const match = text.match(/\nKB_REFS:([^\n]+)/);
  if (!match) return [];
  return match[1].split('|').filter(Boolean);
}

function tryParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

function parseContent(raw: string) {
  const actions: ParsedAction[] = [];
  let meetingSuggestion: MeetingSuggestion | null = null;
  let updateDraft: Partial<ComposeDraft> | null = null;
  let replyDraft: { body: string } | null = null;
  let openCompose: Partial<ComposeDraft> | null = null;
  let openWorkflow: ParsedOpenWorkflow | null = null;
  let openProcess: ParsedOpenProcess | null = null;
  let deskAction: ParsedDeskAction | null = null;

  const meetingMatch = raw.match(MEETING_RE);
  if (meetingMatch) meetingSuggestion = tryParse(meetingMatch[1]);

  const updateMatch = raw.match(UPDATE_DRAFT_RE);
  if (updateMatch) updateDraft = tryParse(updateMatch[1]);

  const replyMatch = raw.match(REPLY_DRAFT_RE);
  if (replyMatch) replyDraft = tryParse(replyMatch[1]);

  const composeMatch = raw.match(OPEN_COMPOSE_RE);
  if (composeMatch) openCompose = tryParse(composeMatch[1]);

  const workflowMatch = raw.match(OPEN_WORKFLOW_RE);
  if (workflowMatch) openWorkflow = tryParse(workflowMatch[1]);

  const processMatch = raw.match(OPEN_PROCESS_RE);
  if (processMatch) openProcess = tryParse(processMatch[1]);

  const deskMatch = raw.match(DESK_ACTION_RE);
  if (deskMatch) deskAction = tryParse(deskMatch[1]);

  const text = raw
    .replace(ACTION_RE, (match) => {
      const json = match.slice('ACTION:'.length);
      const parsed = tryParse<ParsedAction>(json);
      if (parsed?.type && parsed?.itemId && parsed?.label) actions.push(parsed);
      return '';
    })
    .replace(/\nMEETING_SUGGESTION:\{.+\}/g, '')
    .replace(/MEETING_SUGGESTION:\{.+\}/g, '')
    .replace(UPDATE_DRAFT_RE, '')
    .replace(REPLY_DRAFT_RE, '')
    .replace(OPEN_COMPOSE_RE, '')
    .replace(OPEN_WORKFLOW_RE, '')
    .replace(OPEN_PROCESS_RE, '')
    .replace(DESK_ACTION_RE, '')
    .replace(/\nKB_REFS:[^\n]*/g, '')
    .replace(/^INTENT DETECTION:\s*\w+\s*\n?/im, '')
    .replace(/^---+\s*$/gm, '')
    .trim();

  return { text, actions, meetingSuggestion, updateDraft, replyDraft, openCompose, openWorkflow, openProcess, deskAction };
}

function splitOnRefs(text: string): Array<{ type: 'text' | 'item'; value: string }> {
  const parts: Array<{ type: 'text' | 'item'; value: string }> = [];
  const regex = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    parts.push({ type: 'item', value: match[1] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  return parts;
}

// ── Chip sub-components ───────────────────────────────────────────────────────

function ActionChip({ action, onAction }: {
  action: ParsedAction;
  onAction: (type: string, itemId: string) => Promise<void>;
}) {
  const [state, setState] = useState<'idle' | 'confirming' | 'loading' | 'done' | 'error'>('idle');

  const handleConfirm = async () => {
    setState('loading');
    try { await onAction(action.type, action.itemId); setState('done'); }
    catch { setState('error'); }
  };

  if (state === 'done') return <span className="text-[11px] text-green-600 font-medium">Done ✓</span>;
  if (state === 'error') return <span className="text-[11px] text-red-500">Something went wrong</span>;

  return (
    <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 text-[12px]">
      <span className="text-neutral-600">{action.label}</span>
      {state === 'loading' ? (
        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      ) : state === 'confirming' ? (
        <>
          <button onClick={handleConfirm} className="text-indigo-600 font-semibold hover:text-indigo-800 transition-colors">Confirm</button>
          <button onClick={() => setState('idle')} className="text-neutral-400 hover:text-neutral-600 transition-colors text-[11px]">✕</button>
        </>
      ) : (
        <button onClick={() => setState('confirming')} className="text-indigo-600 font-semibold hover:text-indigo-800 transition-colors">Do it</button>
      )}
    </div>
  );
}

function DeskActionChip({ action, onMove, onDismiss, onConfirm }: {
  action: ParsedDeskAction;
  onMove?: (itemId: string, column: DeskColumn) => void;
  onDismiss?: (itemId: string) => void;
  onConfirm?: (itemId: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'confirming' | 'loading' | 'done' | 'error'>('idle');

  const handleConfirm = async () => {
    setState('loading');
    try {
      if (action.type === 'move' && action.column) onMove?.(action.itemId, action.column);
      else if (action.type === 'dismiss') onDismiss?.(action.itemId);
      else if (action.type === 'confirm') onConfirm?.(action.itemId);
      setState('done');
    } catch { setState('error'); }
  };

  if (state === 'done') return <span className="text-[11px] text-green-600 font-medium">Done ✓</span>;
  if (state === 'error') return <span className="text-[11px] text-red-500">Something went wrong</span>;

  return (
    <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 text-[12px]">
      <span className="text-neutral-600">{action.label}</span>
      {state === 'loading' ? (
        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      ) : state === 'confirming' ? (
        <>
          <button onClick={handleConfirm} className="text-indigo-600 font-semibold hover:text-indigo-800 transition-colors">Confirm</button>
          <button onClick={() => setState('idle')} className="text-neutral-400 hover:text-neutral-600 transition-colors text-[11px]">✕</button>
        </>
      ) : (
        <button onClick={() => setState('confirming')} className="text-indigo-600 font-semibold hover:text-indigo-800 transition-colors">Do it</button>
      )}
    </div>
  );
}

function WorkflowActionChip({ workflow, onOpenWorkflow }: {
  workflow: ParsedOpenWorkflow;
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
}) {
  const [clicked, setClicked] = useState(false);
  const label = workflow.prefillTitle ? `Start: ${workflow.prefillTitle} →` : 'Open workflow →';

  return (
    <button
      onClick={() => {
        if (clicked) return;
        setClicked(true);
        onOpenWorkflow?.(workflow.itemId, workflow.skill, workflow.prefillTitle);
      }}
      disabled={clicked}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-[12px] text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
    >
      <SparklesIcon className="w-3 h-3 flex-shrink-0" />
      {label}
    </button>
  );
}

function OpenProcessChip({ process, onOpenProcess }: {
  process: ParsedOpenProcess;
  onOpenProcess?: (processId: string, label: string) => void;
}) {
  const [clicked, setClicked] = useState(false);

  return (
    <button
      onClick={() => {
        if (clicked) return;
        setClicked(true);
        onOpenProcess?.(process.processId, process.label);
      }}
      disabled={clicked}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 text-[12px] text-neutral-700 hover:bg-neutral-100 transition-colors disabled:opacity-50"
    >
      <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
      Open: {process.label} →
    </button>
  );
}

// ── MessageContent ────────────────────────────────────────────────────────────

function MessageContent({
  content,
  context,
  inboxItems = [],
  onSelectItem,
  onAction,
  onUpdateComposeDraft,
  onOpenCompose,
  onUseAsReply,
  mode,
  onUpdateReplyDraft,
  connectionId,
  onOpenWorkflow,
  onOpenProcess,
  onDeskMove,
  onDeskDismiss,
  onDeskConfirm,
}: {
  content: string;
  context: 'inbox' | 'desk';
  inboxItems?: InboxItem[];
  onSelectItem?: (item: InboxItem) => void;
  onAction?: (type: string, itemId: string) => Promise<void>;
  onUpdateComposeDraft?: (fields: Partial<ComposeDraft>) => void;
  onOpenCompose?: (draft: Partial<ComposeDraft>) => void;
  onUseAsReply?: (body: string) => void;
  mode?: 'inbox' | 'compose' | 'reply';
  onUpdateReplyDraft?: (body: string) => void;
  connectionId?: string | null;
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
  onOpenProcess?: (processId: string, label: string) => void;
  onDeskMove?: (itemId: string, column: DeskColumn) => void;
  onDeskDismiss?: (itemId: string) => void;
  onDeskConfirm?: (itemId: string) => void;
}) {
  const kbSources = parseKBSources(content);
  const {
    text, actions, meetingSuggestion, updateDraft, replyDraft,
    openCompose, openWorkflow, openProcess, deskAction,
  } = parseContent(content);
  const parts = splitOnRefs(text);

  useEffect(() => {
    if (updateDraft && onUpdateComposeDraft) onUpdateComposeDraft(updateDraft);
    if (openCompose && onOpenCompose) onOpenCompose(openCompose);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {parts.map((part, i) => {
        if (part.type === 'text') return <React.Fragment key={i}>{renderMarkdown(part.value)}</React.Fragment>;
        const item = inboxItems.find(it => it.id === part.value);
        if (!item) return null;
        return (
          <div key={i} className="mt-2 mb-1 border border-neutral-200 overflow-hidden">
            <EmailListCard item={item} isSelected={false} onSelect={onSelectItem ?? (() => {})} compact />
          </div>
        );
      })}

      {/* Inbox-only: archive/open action chips */}
      {context === 'inbox' && actions.length > 0 && mode !== 'reply' && (
        <div className="flex flex-col gap-1 mt-1">
          {actions.map((a, i) => (
            <ActionChip key={i} action={a} onAction={onAction ?? (async () => {})} />
          ))}
        </div>
      )}

      {/* Meeting suggestion — both surfaces */}
      {meetingSuggestion && <MeetingProposalCard suggestion={meetingSuggestion} connectionId={connectionId} />}

      {/* Compose draft feedback */}
      {updateDraft && (
        <div className="mt-2 px-2 py-1 text-[11px] text-green-700 bg-green-50 border border-green-200 inline-flex items-center gap-1">
          Draft updated ✓
        </div>
      )}

      {/* Reply draft — both surfaces */}
      {replyDraft?.body && mode !== 'reply' && (
        <button
          onClick={() => onUseAsReply?.(replyDraft.body)}
          className="mt-2 px-3 py-1.5 text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors inline-flex items-center gap-1.5"
        >
          <PaperAirplaneIcon className="w-3.5 h-3.5" />
          Use as reply →
        </button>
      )}
      {replyDraft?.body && mode === 'reply' && (
        <div className="mt-2 px-2 py-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 inline-flex items-center gap-1">
          Draft updated ✓
        </div>
      )}

      {/* Compose opened */}
      {openCompose && (
        <div className="mt-2 px-2 py-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 inline-flex items-center gap-1">
          Compose opened ✓
        </div>
      )}

      {/* Workflow chip — both surfaces */}
      {openWorkflow && (
        <WorkflowActionChip workflow={openWorkflow} onOpenWorkflow={onOpenWorkflow} />
      )}

      {/* Process chip — both surfaces */}
      {openProcess && (
        <OpenProcessChip process={openProcess} onOpenProcess={onOpenProcess} />
      )}

      {/* Desk action chip — desk only */}
      {context === 'desk' && deskAction && (
        <DeskActionChip
          action={deskAction}
          onMove={onDeskMove}
          onDismiss={onDeskDismiss}
          onConfirm={onDeskConfirm}
        />
      )}

      {/* KB sources */}
      {kbSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-neutral-100">
          {kbSources.map((filename) => (
            <span key={filename} className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-neutral-600 bg-white border border-neutral-200 shadow-sm">
              <DocumentTextIcon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              {filename}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AiChatPanel({
  context,
  history,
  streamingContent,
  isStreaming,
  chatInput,
  onChatInputChange,
  chatInputRef,
  onSendMessage,
  onClose,
  chatSources = CONTEXT_SOURCE_IDS,
  onSourcesChange,
  attachedFiles = [],
  onFileAttach,
  onRemoveFile,
  isAttaching = false,
  inboxItems = [],
  onSelectItem,
  emailChipActive,
  emailChipData,
  onDismissEmailChip,
  mode,
  composeDraft,
  onUpdateComposeDraft,
  onOpenCompose,
  onUseAsReply,
  replyDraft,
  onUpdateReplyDraft,
  onAction,
  onOpenWorkflow,
  onOpenProcess,
  onDeskMove,
  onDeskDismiss,
  onDeskConfirm,
}: AiChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamingContent]);

  // Close source dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) {
        setSourceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isEmpty = history.length === 0 && !isStreaming;

  const handleSubmit = () => {
    if (chatInput.trim() && !isStreaming) onSendMessage(chatInput);
  };

  const isChatOnly = chatSources.length === 1 && chatSources[0] === 'chat';
  const activeContextSources = chatSources.filter(s => s !== 'chat');
  const allActive = !isChatOnly && activeContextSources.length === CONTEXT_SOURCE_IDS.length;

  // Source dropdown label
  const sourceLabel = isChatOnly
    ? 'No context'
    : allActive
      ? 'All sources'
      : activeContextSources.map(id => SOURCE_OPTIONS.find(o => o.id === id)?.label ?? id).join(', ');

  const toggleSource = useCallback((id: string) => {
    if (!onSourcesChange) return;
    const current = chatSources.filter(s => s !== 'chat');
    if (allActive) {
      onSourcesChange([id]);
    } else if (current.includes(id)) {
      const next = current.filter(s => s !== id);
      onSourcesChange(next.length === 0 ? CONTEXT_SOURCE_IDS : next);
    } else {
      const next = [...current, id];
      onSourcesChange(next.length === CONTEXT_SOURCE_IDS.length ? CONTEXT_SOURCE_IDS : next);
    }
  }, [chatSources, allActive, onSourcesChange]);

  const toggleChat = useCallback(() => {
    if (!onSourcesChange) return;
    onSourcesChange(isChatOnly ? CONTEXT_SOURCE_IDS : ['chat']);
  }, [isChatOnly, onSourcesChange]);

  const showFileChips = attachedFiles.length > 0 || isAttaching;

  const quickPrompts = context === 'desk'
    ? DESK_QUICK_PROMPTS
    : isChatOnly
      ? CHAT_QUICK_PROMPTS
      : mode === 'reply'
        ? REPLY_PROMPTS
        : composeDraft !== undefined
          ? (composeDraft.body?.trim() ? COMPOSE_REFINE_PROMPTS : COMPOSE_START_PROMPTS)
          : emailChipActive
            ? getEmailPrompts(emailChipData?.itemType)
            : INBOX_QUICK_PROMPTS;

  const placeholder = context === 'desk'
    ? 'Ask about your work...'
    : isChatOnly
      ? 'Ask me anything...'
      : mode === 'reply'
        ? 'Edit draft or ask a question...'
        : composeDraft !== undefined
          ? (composeDraft.body?.trim() ? 'Refine your draft...' : 'What would you like to write?')
          : emailChipActive
            ? 'Ask about this email...'
            : 'Ask about your inbox...';

  return (
    <div className="flex-1 min-h-0 flex flex-col">

      {/* ── Zone 1: Header / source toggles ── */}
      {context === 'desk' ? (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-neutral-100 bg-white">
          <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">AI ASSISTANT</h3>
          {onClose && (
            <button onClick={onClose} className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors">
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex-shrink-0 h-10 flex items-center gap-2.5 px-3 border-b border-neutral-100 bg-white">
          {/* Mode pill: Assistant | Chat */}
          <div className="flex items-center bg-neutral-100 rounded-md p-0.5 gap-0.5">
            <button
              onClick={() => { if (isChatOnly) toggleChat(); }}
              className={`text-[11px] font-medium px-2.5 py-1 rounded transition-colors ${
                !isChatOnly ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'
              }`}
            >
              Assistant
            </button>
            <button
              onClick={() => { if (!isChatOnly) toggleChat(); }}
              className={`text-[11px] font-medium px-2.5 py-1 rounded transition-colors ${
                isChatOnly ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'
              }`}
            >
              Chat
            </button>
          </div>

          {/* Source dropdown — only in Assistant mode */}
          {!isChatOnly && (
            <div ref={sourceDropdownRef} className="relative">
              <button
                onClick={() => setSourceDropdownOpen(v => !v)}
                className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-700 transition-colors"
              >
                <span>{sourceLabel}</span>
                <ChevronDownIcon className="w-3 h-3 flex-shrink-0" />
              </button>
              {sourceDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-neutral-200 shadow-md z-20 py-1">
                  <button
                    onClick={() => { onSourcesChange?.(CONTEXT_SOURCE_IDS); setSourceDropdownOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-neutral-50 transition-colors ${allActive ? 'text-indigo-700 font-semibold' : 'text-neutral-700'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${allActive ? 'bg-indigo-500' : 'bg-transparent'}`} />
                    All sources
                  </button>
                  <div className="border-t border-neutral-100 my-1" />
                  {SOURCE_OPTIONS.map(opt => {
                    const active = !allActive && activeContextSources.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleSource(opt.id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-neutral-50 transition-colors ${active ? 'text-indigo-700 font-semibold' : 'text-neutral-700'}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-indigo-500' : 'bg-transparent'}`} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex-1" />

          {onClose && (
            <>
              <span className="w-px h-4 bg-neutral-200 flex-shrink-0" />
              <button onClick={onClose} className="flex-shrink-0 p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors">
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Email context chip (inbox only) ── */}
      {context === 'inbox' && emailChipActive && emailChipData && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border-b border-indigo-100">
          <EnvelopeIcon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
          <span className="text-[11px] text-indigo-700 font-medium truncate flex-1 min-w-0">
            {emailChipData.fromName || emailChipData.from} — {emailChipData.subject}
          </span>
          <button onClick={onDismissEmailChip} className="flex-shrink-0 text-indigo-400 hover:text-indigo-700 transition-colors" title="Remove email context">
            <XMarkIcon className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Zone 2: Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty ? (
          <div className={`flex flex-col ${context === 'inbox' ? 'items-center justify-center h-full py-12 text-center' : ''} gap-${context === 'inbox' ? '4' : '2'}`}>
            {context === 'inbox' && <p className="text-[12px] text-neutral-400 font-medium">Try asking...</p>}
            {context === 'desk' && <p className="text-[12px] text-neutral-400 font-medium">Try asking...</p>}
            <div className={`flex flex-col gap-2 ${context === 'inbox' ? 'w-full max-w-xs' : 'w-full'}`}>
              {quickPrompts.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => onSendMessage(prompt)}
                  className="text-left px-3 py-2 text-[12px] text-neutral-600 border border-neutral-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {history.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[80%] px-3 py-2 bg-indigo-600 text-white text-[13px] leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] text-[13px] text-neutral-800 leading-relaxed">
                    <MessageContent
                      content={msg.content}
                      context={context}
                      inboxItems={inboxItems}
                      onSelectItem={onSelectItem}
                      onAction={onAction}
                      onUpdateComposeDraft={onUpdateComposeDraft}
                      onOpenCompose={onOpenCompose}
                      onUseAsReply={onUseAsReply}
                      mode={mode}
                      onUpdateReplyDraft={onUpdateReplyDraft}
                      connectionId={emailChipData?.connectionId}
                      onOpenWorkflow={onOpenWorkflow}
                      onOpenProcess={onOpenProcess}
                      onDeskMove={onDeskMove}
                      onDeskDismiss={onDeskDismiss}
                      onDeskConfirm={onDeskConfirm}
                    />
                  </div>
                )}
              </div>
            ))}

            {isStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[90%] text-[13px] text-neutral-800 leading-relaxed">
                  {streamingContent ? (
                    <MessageContent
                      content={streamingContent}
                      context={context}
                      inboxItems={inboxItems}
                      onSelectItem={onSelectItem}
                      onAction={onAction}
                      onUpdateComposeDraft={onUpdateComposeDraft}
                      onOpenCompose={onOpenCompose}
                      onUseAsReply={onUseAsReply}
                      mode={mode}
                      onUpdateReplyDraft={onUpdateReplyDraft}
                      connectionId={emailChipData?.connectionId}
                      onOpenWorkflow={onOpenWorkflow}
                      onOpenProcess={onOpenProcess}
                      onDeskMove={onDeskMove}
                      onDeskDismiss={onDeskDismiss}
                      onDeskConfirm={onDeskConfirm}
                    />
                  ) : (
                    <span className="flex items-center gap-1 text-neutral-400">
                      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Zone 3: Input bar ── */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-white">
        {/* File chips (inbox only) */}
        {context === 'inbox' && showFileChips && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachedFiles.map(f => (
              <span key={f.filename} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-700 max-w-[160px]">
                <DocumentTextIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{f.filename}</span>
                <button onClick={() => onRemoveFile?.(f.filename)} className="flex-shrink-0 ml-0.5 text-indigo-400 hover:text-indigo-700 transition-colors">
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            ))}
            {isAttaching && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-neutral-50 border border-neutral-200 text-[11px] text-neutral-500">
                <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                Extracting...
              </span>
            )}
          </div>
        )}

        <div className="flex items-end gap-2 px-3 py-3">
          {/* File attach button (inbox only) */}
          {context === 'inbox' && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || isAttaching}
                title="Attach file"
                className="flex-shrink-0 p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 transition-colors mb-px"
              >
                <PaperClipIcon className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.csv,.xlsx,.pptx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileAttach?.(file);
                  e.target.value = '';
                }}
              />
            </>
          )}

          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={e => {
              onChatInputChange(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
                (e.target as HTMLTextAreaElement).style.height = 'auto';
              }
            }}
            placeholder={placeholder}
            disabled={isStreaming}
            rows={1}
            className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
            style={{ maxHeight: '160px', overflowY: 'auto' }}
          />

          <button
            onClick={handleSubmit}
            disabled={!chatInput.trim() || isStreaming}
            className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800 disabled:text-neutral-300 transition-colors mb-px"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
