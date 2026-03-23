'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { XMarkIcon, PaperAirplaneIcon, SparklesIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
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

interface DeskChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  boardItems: DeskItem[];
  onDeskMove?: (itemId: string, column: DeskColumn) => void;
  onDeskDismiss?: (itemId: string) => void;
  onDeskConfirm?: (itemId: string) => void;
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
  onOpenProcess?: (processId: string) => void;
}

const QUICK_PROMPTS = [
  "What should I focus on today?",
  "What's blocking me right now?",
  "Summarize what's in my pool",
  "What's high priority?",
];

// ── Token regexes ─────────────────────────────────────────────────────────────

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
  let deskAction: ParsedDeskAction | null = null;
  let openWorkflow: ParsedOpenWorkflow | null = null;
  let openProcess: ParsedOpenProcess | null = null;
  let replyDraft: { body: string } | null = null;
  let openCompose: { to?: string; subject?: string; body?: string } | null = null;

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

  return { text, deskAction, openWorkflow, openProcess, replyDraft, openCompose };
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
    <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 text-[12px]">
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
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-[12px] text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
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
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 text-[12px] text-neutral-700 hover:bg-neutral-100 transition-colors disabled:opacity-50"
    >
      <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
      Open: {process.label} →
    </button>
  );
}

function ReplyDraftButton({ body }: { body: string }) {
  const [state, setState] = useState<'idle' | 'copied'>('idle');
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(body); setState('copied'); setTimeout(() => setState('idle'), 2000); }}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-[12px] text-indigo-700 hover:bg-indigo-100 transition-colors"
    >
      <PaperAirplaneIcon className="w-3 h-3 flex-shrink-0" />
      {state === 'copied' ? 'Copied ✓' : 'Copy draft →'}
    </button>
  );
}

// ── Message renderer ──────────────────────────────────────────────────────────

function MessageContent({ content, onDeskMove, onDeskDismiss, onDeskConfirm, onOpenWorkflow, onOpenProcess }: {
  content: string;
  onDeskMove?: (itemId: string, column: DeskColumn) => void;
  onDeskDismiss?: (itemId: string) => void;
  onDeskConfirm?: (itemId: string) => void;
  onOpenWorkflow?: (itemId: string, skill?: string, prefillTitle?: string) => void;
  onOpenProcess?: (processId: string) => void;
}) {
  const { text, deskAction, openWorkflow, openProcess, replyDraft } = parseMessage(content);

  return (
    <div>
      {renderMarkdown(text)}
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

  if (!isOpen) return null;

  const isEmpty = messages.length === 0;

  return (
    <div className="w-80 flex-shrink-0 border-l border-neutral-200 bg-white flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 flex-shrink-0">
        <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">AI ASSISTANT</h3>
        <button onClick={onClose} className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors">
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-neutral-400 font-medium">Try asking...</p>
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className="text-left px-3 py-2 text-[12px] text-neutral-600 border border-neutral-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[80%] px-3 py-2 bg-indigo-600 text-white text-[13px] leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] text-[13px] text-neutral-800 leading-relaxed">
                    {msg.content ? (
                      <MessageContent
                        content={msg.content}
                        onDeskMove={onDeskMove}
                        onDeskDismiss={onDeskDismiss}
                        onDeskConfirm={onDeskConfirm}
                        onOpenWorkflow={onOpenWorkflow}
                        onOpenProcess={onOpenProcess}
                      />
                    ) : (
                      streaming && i === messages.length - 1 ? (
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-white">
        <div className="flex items-end gap-2 px-3 py-3">
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
            className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
            style={{ maxHeight: '160px', overflowY: 'auto' }}
          />
          <button
            onClick={() => sendMessage(inputValue)}
            disabled={!inputValue.trim() || streaming}
            className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800 disabled:text-neutral-300 transition-colors mb-px"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
