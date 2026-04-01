'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronRightIcon, PaperAirplaneIcon, SparklesIcon, ChatBubbleLeftRightIcon, ArrowTopRightOnSquareIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { DeskItem, DeskColumn } from '@/lib/types/desk';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

interface ParsedCreateTask {
  title: string;
  column: DeskColumn;
}

interface DeskChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  boardItems: DeskItem[];
  onDeskMove?: (itemId: string, column: DeskColumn) => void;
  onDeskDismiss?: (itemId: string) => void;
  onDeskConfirm?: (itemId: string) => void;
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
  onOpenProcess?: (processId: string) => void;
  onTaskCreated?: (item: DeskItem) => void;
}

const QUICK_PROMPTS = [
  "What should I focus on today?",
  "What's blocking me right now?",
  "Summarize what's in my pool",
  "What's high priority?",
];

// ── Token regexes ─────────────────────────────────────────────────────────────

const DESK_CREATE_RE = /DESK_ACTION:create::([^:\n]+)(?:::(todo|in_progress|waiting|done))?/;
const DESK_ACTION_RE = /DESK_ACTION:(\{[\s\S]+?\})/;
const OPEN_WORKFLOW_RE = /OPEN_WORKFLOW:(\{[\s\S]+?\})/;
const OPEN_PROCESS_RE = /OPEN_PROCESS:(\{[\s\S]+?\})/;
const REPLY_DRAFT_RE = /REPLY_DRAFT:(\{[\s\S]+?\})/;
const OPEN_COMPOSE_RE = /OPEN_COMPOSE:(\{[\s\S]+?\})/;
const MEETING_RE = /MEETING_SUGGESTION:(\{.+\})/;

function tryParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

function parseMessage(raw: string) {
  let createTask: ParsedCreateTask | null = null;
  let deskAction: ParsedDeskAction | null = null;
  let openWorkflow: ParsedOpenWorkflow | null = null;
  let openProcess: ParsedOpenProcess | null = null;
  let replyDraft: { body: string } | null = null;
  let openCompose: { to?: string; subject?: string; body?: string } | null = null;

  const createMatch = raw.match(DESK_CREATE_RE);
  if (createMatch) {
    createTask = {
      title: createMatch[1].trim(),
      column: (createMatch[2] as DeskColumn) ?? 'todo',
    };
  }

  const deskMatch = raw.match(DESK_ACTION_RE);
  if (deskMatch) deskAction = tryParse(deskMatch[1]);

  const workflowMatch = raw.match(OPEN_WORKFLOW_RE);
  if (workflowMatch) openWorkflow = tryParse(workflowMatch[1]);

  const processMatch = raw.match(OPEN_PROCESS_RE);
  if (processMatch) openProcess = tryParse(processMatch[1]);

  const replyMatch = raw.match(REPLY_DRAFT_RE);
  if (replyMatch) replyDraft = tryParse(replyMatch[1]);

  const composeMatch = raw.match(OPEN_COMPOSE_RE);
  if (composeMatch) openCompose = tryParse(composeMatch[1]);

  const text = raw
    .replace(DESK_CREATE_RE, '')
    .replace(DESK_ACTION_RE, '')
    .replace(OPEN_WORKFLOW_RE, '')
    .replace(OPEN_PROCESS_RE, '')
    .replace(REPLY_DRAFT_RE, '')
    .replace(OPEN_COMPOSE_RE, '')
    .replace(/\nMEETING_SUGGESTION:\{.+\}/g, '')
    .replace(MEETING_RE, '')
    .replace(/\nKB_REFS:[^\n]*/g, '')
    .replace(/^INTENT DETECTION:\s*\w+\s*\n?/im, '')
    .replace(/^---+\s*$/gm, '')
    .trim();

  return { text, createTask, deskAction, openWorkflow, openProcess, replyDraft, openCompose };
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

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

// ── Chip components ───────────────────────────────────────────────────────────

function DeskActionChip({ action, onMove, onDismiss, onConfirm }: {
  action: ParsedDeskAction;
  onMove?: (itemId: string, column: DeskColumn) => void;
  onDismiss?: (itemId: string) => void;
  onConfirm?: (itemId: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'confirming' | 'loading' | 'done' | 'error'>('idle');

  const execute = async () => {
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
    <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-[12px]">
      <span className="text-neutral-600">{action.label}</span>
      {state === 'loading' ? (
        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      ) : state === 'confirming' ? (
        <>
          <button onClick={execute} className="text-indigo-600 font-semibold hover:text-indigo-800">Confirm</button>
          <button onClick={() => setState('idle')} className="text-neutral-400 hover:text-neutral-600 text-[11px]">✕</button>
        </>
      ) : (
        <button onClick={() => setState('confirming')} className="text-indigo-600 font-semibold hover:text-indigo-800">Do it</button>
      )}
    </div>
  );
}

function WorkflowChip({ workflow, onOpenWorkflow }: {
  workflow: ParsedOpenWorkflow;
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
}) {
  const [clicked, setClicked] = useState(false);
  return (
    <button
      onClick={() => { if (clicked) return; setClicked(true); onOpenWorkflow?.(workflow.itemId, workflow.skill, workflow.prefillTitle); }}
      disabled={clicked}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-[12px] text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
    >
      <SparklesIcon className="w-3 h-3 flex-shrink-0" />
      {workflow.prefillTitle ? `Start: ${workflow.prefillTitle} →` : 'Open workflow →'}
    </button>
  );
}

function ProcessChip({ process, onOpenProcess }: {
  process: ParsedOpenProcess;
  onOpenProcess?: (processId: string) => void;
}) {
  const [clicked, setClicked] = useState(false);
  return (
    <button
      onClick={() => { if (clicked) return; setClicked(true); onOpenProcess?.(process.processId); }}
      disabled={clicked}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-[12px] text-neutral-700 hover:bg-neutral-100 transition-colors disabled:opacity-50"
    >
      <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
      Open: {process.label} →
    </button>
  );
}

function CreateTaskChip({ task, onTaskCreated }: {
  task: ParsedCreateTask;
  onTaskCreated?: (item: DeskItem) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const COLUMN_LABELS: Record<DeskColumn, string> = {
    pool: 'Pool', todo: 'To Do', in_progress: 'In Progress', waiting: 'Waiting', done: 'Done',
  };

  const execute = async () => {
    setState('loading');
    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: task.title, kanban_column: task.column }),
      });
      if (!res.ok) throw new Error();
      const { item } = await res.json();
      onTaskCreated?.(item);
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') return <span className="text-[11px] text-green-600 font-medium">Task added ✓</span>;
  if (state === 'error') return <span className="text-[11px] text-red-500">Something went wrong</span>;

  return (
    <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-[12px]">
      <PlusIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
      <span className="text-neutral-600">"{task.title}" → {COLUMN_LABELS[task.column]}</span>
      {state === 'loading' ? (
        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      ) : (
        <button onClick={execute} className="text-indigo-600 font-semibold hover:text-indigo-800">Add it</button>
      )}
    </div>
  );
}

function ReplyDraftButton({ body }: { body: string }) {
  const [state, setState] = useState<'idle' | 'copied'>('idle');
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(body); setState('copied'); setTimeout(() => setState('idle'), 2000); }}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-[12px] text-indigo-700 hover:bg-indigo-100 transition-colors"
    >
      <PaperAirplaneIcon className="w-3 h-3 flex-shrink-0" />
      {state === 'copied' ? 'Copied ✓' : 'Copy draft →'}
    </button>
  );
}

// ── Message renderer ──────────────────────────────────────────────────────────

function MessageContent({ content, onDeskMove, onDeskDismiss, onDeskConfirm, onOpenWorkflow, onOpenProcess, onTaskCreated }: {
  content: string;
  onDeskMove?: (itemId: string, column: DeskColumn) => void;
  onDeskDismiss?: (itemId: string) => void;
  onDeskConfirm?: (itemId: string) => void;
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
  onOpenProcess?: (processId: string) => void;
  onTaskCreated?: (item: DeskItem) => void;
}) {
  const { text, createTask, deskAction, openWorkflow, openProcess, replyDraft } = parseMessage(content);

  return (
    <div>
      {renderMarkdown(text)}
      {createTask && (
        <CreateTaskChip task={createTask} onTaskCreated={onTaskCreated} />
      )}
      {deskAction && (
        <DeskActionChip action={deskAction} onMove={onDeskMove} onDismiss={onDeskDismiss} onConfirm={onDeskConfirm} />
      )}
      {openWorkflow && (
        <WorkflowChip workflow={openWorkflow} onOpenWorkflow={onOpenWorkflow} />
      )}
      {openProcess && (
        <ProcessChip process={openProcess} onOpenProcess={onOpenProcess} />
      )}
      {replyDraft?.body && (
        <ReplyDraftButton body={replyDraft.body} />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeskChatSidebar({
  isOpen,
  onClose,
  boardItems,
  onDeskMove,
  onDeskDismiss,
  onDeskConfirm,
  onOpenWorkflow,
  onOpenProcess,
  onTaskCreated,
}: DeskChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const history = [...messages];
    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);
    setInputValue('');
    setStreaming(true);

    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'desk', message: text, history, boardItems }),
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: accumulated };
          return updated;
        });
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: 'Sorry, something went wrong.' };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, boardItems]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="w-[380px] flex-shrink-0 h-full bg-neutral-50 pt-2 pl-2 pr-4 pb-4 flex flex-col">
      <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden min-h-0">

        {/* Header */}
        <div className="flex-shrink-0 h-10 flex items-center justify-between px-3 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="w-4 h-4 text-neutral-500" />
            <span className="text-[13px] font-semibold text-neutral-700">Assistant</span>
          </div>
          <button onClick={onClose} title="Close" className="p-0.5 text-neutral-400 hover:text-neutral-600 transition-colors">
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {isEmpty ? (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-[11px] text-neutral-400 font-medium px-1">Try asking...</p>
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left px-3 py-2 text-[12px] text-neutral-600 bg-neutral-50 rounded-xl shadow-sm hover:bg-neutral-100 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start gap-2'}`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[80%] px-3 py-2 bg-neutral-100 text-neutral-800 text-[13px] leading-relaxed rounded-2xl rounded-br-sm">
                      {msg.content}
                    </div>
                  ) : (
                    <>
                      <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <SparklesIcon className="w-3 h-3 text-indigo-400" />
                      </div>
                      <div className="flex-1 text-[13px] text-neutral-800 leading-relaxed">
                        {msg.content ? (
                          <MessageContent
                            content={msg.content}
                            onDeskMove={onDeskMove}
                            onDeskDismiss={onDeskDismiss}
                            onDeskConfirm={onDeskConfirm}
                            onOpenWorkflow={onOpenWorkflow}
                            onOpenProcess={onOpenProcess}
                            onTaskCreated={onTaskCreated}
                          />
                        ) : (
                          streaming && i === messages.length - 1 ? (
                            <span className="flex items-center gap-1 mt-1">
                              <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </span>
                          ) : null
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="flex-shrink-0 px-3 pb-3 pt-1">
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm px-3 py-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your work..."
              disabled={streaming}
              rows={1}
              className="w-full text-[13px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
              style={{ maxHeight: '120px', overflowY: 'auto' }}
            />
            <div className="flex justify-end mt-1.5">
              <button
                onClick={() => sendMessage(inputValue)}
                disabled={!inputValue.trim() || streaming}
                className="w-7 h-7 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-200 rounded-full transition-colors"
              >
                <PaperAirplaneIcon className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
