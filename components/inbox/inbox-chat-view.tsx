'use client';

import React, { useEffect, useRef, useState, RefObject } from 'react';
import type { InboxItem } from '@/lib/types/inbox';
import EmailListCard from './email-list-card';
import MeetingProposalCard from './meeting-proposal-card';
import { PaperAirplaneIcon, DocumentTextIcon, PaperClipIcon, XMarkIcon, EnvelopeIcon } from '@heroicons/react/24/outline';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ParsedAction {
  type: 'archive' | 'open' | 'workflow';
  itemId: string;
  label: string;
}

interface MeetingSuggestion {
  title: string;
  duration_minutes: number;
  attendees: string[];
  proposed_times: string[];
  notes?: string;
}

interface ComposeDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

interface InboxChatViewProps {
  history: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  inboxItems: InboxItem[];
  onSelectItem: (item: InboxItem) => void;
  onSendMessage: (message: string) => void;
  onAction: (type: string, itemId: string) => Promise<void>;
  chatInput: string;
  onChatInputChange: (val: string) => void;
  chatInputRef: RefObject<HTMLInputElement | null>;
  chatSources: string[];
  onSourcesChange: (sources: string[]) => void;
  attachedFiles: Array<{ filename: string; extractedText: string }>;
  onFileAttach: (file: File) => void;
  onRemoveFile: (filename: string) => void;
  isAttaching: boolean;
  composeDraft?: ComposeDraft;
  onUpdateComposeDraft?: (fields: Partial<ComposeDraft>) => void;
  onOpenCompose?: (draft: Partial<ComposeDraft>) => void;
  onUseAsReply?: (body: string) => void;
  mode?: 'inbox' | 'compose' | 'reply';
  replyDraft?: string;
  onUpdateReplyDraft?: (body: string) => void;
  emailChipActive?: boolean;
  emailChipData?: { subject?: string; from?: string; fromName?: string; itemType?: string | null };
  onDismissEmailChip?: () => void;
  onClose?: () => void;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ACTION_RE = /ACTION:\{[^}]+\}/g;
const MEETING_RE = /MEETING_SUGGESTION:(\{.+\})/;
const UPDATE_DRAFT_RE = /UPDATE_DRAFT:(\{[\s\S]+?\})/;
const REPLY_DRAFT_RE = /REPLY_DRAFT:(\{[\s\S]+?\})/;
const OPEN_COMPOSE_RE = /OPEN_COMPOSE:(\{[\s\S]+?\})/;

const SOURCE_OPTIONS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'kb', label: 'KB' },
  { id: 'calendar', label: 'Calendar' },
];

const QUICK_PROMPTS = [
  "What's pending in my inbox?",
  "Any emails waiting on a reply?",
  "Summarize my recent emails",
];

const EMAIL_PROMPTS_BY_TYPE: Record<string, string[]> = {
  meeting: [
    "Check my availability",
    "Draft an acceptance reply",
    "Who else is attending?",
    "Find relevant docs",
  ],
  reply: [
    "What are they asking?",
    "Draft a reply",
    "How should I respond?",
    "Find relevant docs",
  ],
  decision: [
    "Summarize the decision needed",
    "Draft a reply",
    "Find relevant docs",
    "What context do I have on this?",
  ],
  review: [
    "Summarize what to review",
    "Draft feedback reply",
    "Find relevant docs",
    "Any related docs in my KB?",
  ],
  fyi: [
    "Summarize this",
    "Is any action needed?",
    "Find related docs",
    "Draft a reply",
  ],
  notification: [
    "Summarize this notification",
    "Is any action needed?",
    "Find related docs",
    "Draft a reply",
  ],
  default: [
    "Summarize what they're asking",
    "Draft a reply",
    "Find relevant docs",
    "Check my availability",
  ],
};

function getEmailPrompts(itemType?: string | null): string[] {
  if (itemType && itemType in EMAIL_PROMPTS_BY_TYPE) return EMAIL_PROMPTS_BY_TYPE[itemType];
  return EMAIL_PROMPTS_BY_TYPE.default;
}

const COMPOSE_START_PROMPTS = [
  "Help me draft an email",
  "Write a follow-up email",
  "Draft a cold outreach",
  "Write a thank you note",
];

const COMPOSE_REFINE_PROMPTS = [
  "Make it more concise",
  "Make it more formal",
  "Suggest a subject line",
  "Add a professional closing",
];

const REPLY_PROMPTS = [
  "Make it more formal",
  "Make it shorter",
  "Add a professional closing",
  "Check my availability",
];

/** Strip all structured tokens and return parsed results */
function parseContent(raw: string): {
  text: string;
  actions: ParsedAction[];
  meetingSuggestion: MeetingSuggestion | null;
  updateDraft: Partial<ComposeDraft> | null;
  replyDraft: { body: string } | null;
  openCompose: Partial<ComposeDraft> | null;
} {
  const actions: ParsedAction[] = [];
  let meetingSuggestion: MeetingSuggestion | null = null;

  const meetingMatch = raw.match(MEETING_RE);
  if (meetingMatch) {
    try { meetingSuggestion = JSON.parse(meetingMatch[1]) as MeetingSuggestion; } catch { /* ignore */ }
  }

  const updateDraftMatch = raw.match(UPDATE_DRAFT_RE);
  const updateDraft = updateDraftMatch
    ? (() => { try { return JSON.parse(updateDraftMatch[1]); } catch { return null; } })()
    : null;

  const replyDraftMatch = raw.match(REPLY_DRAFT_RE);
  const replyDraft = replyDraftMatch
    ? (() => { try { return JSON.parse(replyDraftMatch[1]); } catch { return null; } })()
    : null;

  const openComposeMatch = raw.match(OPEN_COMPOSE_RE);
  const openCompose = openComposeMatch
    ? (() => { try { return JSON.parse(openComposeMatch[1]); } catch { return null; } })()
    : null;

  const text = raw
    .replace(ACTION_RE, (match) => {
      try {
        const json = match.slice('ACTION:'.length);
        const parsed = JSON.parse(json);
        if (parsed.type && parsed.itemId && parsed.label) actions.push(parsed as ParsedAction);
      } catch { /* ignore */ }
      return '';
    })
    .replace(/\nMEETING_SUGGESTION:\{.+\}/g, '')
    .replace(/MEETING_SUGGESTION:\{.+\}/g, '')
    .replace(UPDATE_DRAFT_RE, '')
    .replace(REPLY_DRAFT_RE, '')
    .replace(OPEN_COMPOSE_RE, '')
    .replace(/\nKB_REFS:[^\n]*/g, '')
    .replace(/^INTENT DETECTION:\s*\w+\s*\n?/im, '')
    .replace(/^---+\s*$/gm, '')
    .trim();
  return { text, actions, meetingSuggestion, updateDraft, replyDraft, openCompose };
}

/** Extract KB filenames from the AI-emitted KB_REFS token */
function parseKBSources(text: string): string[] {
  const match = text.match(/\nKB_REFS:([^\n]+)/);
  if (!match) return [];
  return match[1].split('|').filter(Boolean);
}

/** Render a line with inline **bold** and *italic* */
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

/** Render text with basic markdown: bold, italic, bullet lists, numbered lists */
function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const bulletMatch = line.match(/^(\s*[-*])\s+(.+)/);
    const numMatch = line.match(/^(\s*\d+\.)\s+(.+)/);
    if (bulletMatch) {
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

/** Split text on [uuid] references */
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

function ActionChip({
  action,
  onAction,
}: {
  action: ParsedAction;
  onAction: (type: string, itemId: string) => Promise<void>;
}) {
  const [state, setState] = useState<'idle' | 'confirming' | 'loading' | 'done' | 'error'>('idle');

  const handleConfirm = async () => {
    setState('loading');
    try {
      await onAction(action.type, action.itemId);
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return <span className="text-[11px] text-green-600 font-medium">Done ✓</span>;
  }
  if (state === 'error') {
    return <span className="text-[11px] text-red-500">Something went wrong</span>;
  }

  return (
    <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 text-[12px]">
      <span className="text-neutral-600">{action.label}</span>
      {state === 'loading' ? (
        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      ) : state === 'confirming' ? (
        <>
          <button
            onClick={handleConfirm}
            className="text-indigo-600 font-semibold hover:text-indigo-800 transition-colors"
          >
            Confirm
          </button>
          <button
            onClick={() => setState('idle')}
            className="text-neutral-400 hover:text-neutral-600 transition-colors text-[11px]"
          >
            ✕
          </button>
        </>
      ) : (
        <button
          onClick={() => setState('confirming')}
          className="text-indigo-600 font-semibold hover:text-indigo-800 transition-colors"
        >
          Do it
        </button>
      )}
    </div>
  );
}

function MessageContent({
  content,
  inboxItems,
  onSelectItem,
  onAction,
  onUpdateComposeDraft,
  onOpenCompose,
  onUseAsReply,
  mode,
  onUpdateReplyDraft,
}: {
  content: string;
  inboxItems: InboxItem[];
  onSelectItem: (item: InboxItem) => void;
  onAction: (type: string, itemId: string) => Promise<void>;
  onUpdateComposeDraft?: (fields: Partial<ComposeDraft>) => void;
  onOpenCompose?: (draft: Partial<ComposeDraft>) => void;
  onUseAsReply?: (body: string) => void;
  mode?: 'inbox' | 'compose' | 'reply';
  onUpdateReplyDraft?: (body: string) => void;
}) {
  const kbSources = parseKBSources(content);
  const { text, actions, meetingSuggestion, updateDraft, replyDraft, openCompose } = parseContent(content);
  const parts = splitOnRefs(text);

  useEffect(() => {
    if (updateDraft && onUpdateComposeDraft) onUpdateComposeDraft(updateDraft);
    if (openCompose && onOpenCompose) onOpenCompose(openCompose);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <React.Fragment key={i}>{renderMarkdown(part.value)}</React.Fragment>;
        }
        const item = inboxItems.find(it => it.id === part.value);
        if (!item) return null;
        return (
          <div key={i} className="mt-2 mb-1 border border-neutral-200 overflow-hidden">
            <EmailListCard item={item} isSelected={false} onSelect={onSelectItem} compact />
          </div>
        );
      })}
      {actions.length > 0 && mode !== 'reply' && (
        <div className="flex flex-col gap-1 mt-1">
          {actions.map((a, i) => (
            <ActionChip key={i} action={a} onAction={onAction} />
          ))}
        </div>
      )}
      {meetingSuggestion && <MeetingProposalCard suggestion={meetingSuggestion} />}
      {updateDraft && (
        <div className="mt-2 px-2 py-1 text-[11px] text-green-700 bg-green-50 border border-green-200 inline-flex items-center gap-1">
          Draft updated ✓
        </div>
      )}
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
      {openCompose && (
        <div className="mt-2 px-2 py-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 inline-flex items-center gap-1">
          Compose opened ✓
        </div>
      )}
      {kbSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-neutral-100">
          {kbSources.map((filename) => (
            <span
              key={filename}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-neutral-600 bg-white border border-neutral-200 shadow-sm"
            >
              <DocumentTextIcon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              {filename}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InboxChatView({
  history,
  streamingContent,
  isStreaming,
  inboxItems,
  onSelectItem,
  onSendMessage,
  onAction,
  chatInput,
  onChatInputChange,
  chatInputRef,
  chatSources,
  onSourcesChange,
  attachedFiles,
  onFileAttach,
  onRemoveFile,
  isAttaching,
  composeDraft,
  onUpdateComposeDraft,
  onOpenCompose,
  onUseAsReply,
  mode,
  replyDraft,
  onUpdateReplyDraft,
  emailChipActive,
  emailChipData,
  onDismissEmailChip,
  onClose,
}: InboxChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamingContent]);

  const isEmpty = history.length === 0 && !isStreaming;

  const handleSubmit = () => {
    if (chatInput.trim() && !isStreaming) onSendMessage(chatInput);
  };

  const allActive = chatSources.length === SOURCE_OPTIONS.length;

  const toggleSource = (id: string) => {
    if (allActive) {
      onSourcesChange([id]);
    } else if (chatSources.includes(id)) {
      const next = chatSources.filter(s => s !== id);
      onSourcesChange(next.length === 0 ? SOURCE_OPTIONS.map(s => s.id) : next);
    } else {
      const next = [...chatSources, id];
      onSourcesChange(next.length === SOURCE_OPTIONS.length ? SOURCE_OPTIONS.map(s => s.id) : next);
    }
  };

  const showFileChips = attachedFiles.length > 0 || isAttaching;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Zone 1 — Source chips (always) + close */}
      <div className="flex-shrink-0 h-10 flex items-center gap-1.5 px-3 border-b border-neutral-100 bg-white">
        <button
          onClick={() => onSourcesChange(SOURCE_OPTIONS.map(s => s.id))}
          className={`text-[11px] font-semibold px-2.5 py-1 transition-colors ${
            allActive
              ? 'bg-indigo-600 text-white'
              : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
          }`}
        >
          All
        </button>
        {SOURCE_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => toggleSource(opt.id)}
            className={`text-[11px] font-semibold px-2.5 py-1 transition-colors ${
              !allActive && chatSources.includes(opt.id)
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="flex-1" />
        {onClose && (
          <button onClick={onClose} className="flex-shrink-0 p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors">
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Email context chip */}
      {emailChipActive && emailChipData && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border-b border-indigo-100">
          <EnvelopeIcon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
          <span className="text-[11px] text-indigo-700 font-medium truncate flex-1 min-w-0">
            {emailChipData.fromName || emailChipData.from} — {emailChipData.subject}
          </span>
          <button
            onClick={onDismissEmailChip}
            className="flex-shrink-0 text-indigo-400 hover:text-indigo-700 transition-colors"
            title="Remove email context"
          >
            <XMarkIcon className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Zone 2 — Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center gap-4">
            <p className="text-[12px] text-neutral-400 font-medium">Try asking...</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {(mode === 'reply'
                ? REPLY_PROMPTS
                : composeDraft !== undefined
                  ? (composeDraft.body?.trim() ? COMPOSE_REFINE_PROMPTS : COMPOSE_START_PROMPTS)
                  : emailChipActive ? getEmailPrompts(emailChipData?.itemType) : QUICK_PROMPTS
              ).map(prompt => (
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
                      inboxItems={inboxItems}
                      onSelectItem={onSelectItem}
                      onAction={onAction}
                      onUpdateComposeDraft={onUpdateComposeDraft}
                      onOpenCompose={onOpenCompose}
                      onUseAsReply={onUseAsReply}
                      mode={mode}
                      onUpdateReplyDraft={onUpdateReplyDraft}
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
                      inboxItems={inboxItems}
                      onSelectItem={onSelectItem}
                      onAction={onAction}
                      onUpdateComposeDraft={onUpdateComposeDraft}
                      onOpenCompose={onOpenCompose}
                      onUseAsReply={onUseAsReply}
                      mode={mode}
                      onUpdateReplyDraft={onUpdateReplyDraft}
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

      {/* Zone 3 — Input bar */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-white">
        {/* File chips sub-row */}
        {showFileChips && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachedFiles.map(f => (
              <span
                key={f.filename}
                className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-700 max-w-[160px]"
              >
                <DocumentTextIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{f.filename}</span>
                <button
                  onClick={() => onRemoveFile(f.filename)}
                  className="flex-shrink-0 ml-0.5 text-indigo-400 hover:text-indigo-700 transition-colors"
                >
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

        {/* Input row */}
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || isAttaching}
            title="Attach file"
            className="flex-shrink-0 p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 transition-colors"
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
              if (file) onFileAttach(file);
              e.target.value = '';
            }}
          />
          <input
            ref={chatInputRef}
            type="text"
            value={chatInput}
            onChange={e => onChatInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder={mode === 'reply' ? "Edit draft or ask a question..." : composeDraft !== undefined ? (composeDraft.body?.trim() ? "Refine your draft..." : "What would you like to write?") : emailChipActive ? "Ask about this email..." : "Ask about your inbox..."}
            disabled={isStreaming}
            className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!chatInput.trim() || isStreaming}
            className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800 disabled:text-neutral-300 transition-colors"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
