'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PaperAirplaneIcon, SparklesIcon, ArrowTopRightOnSquareIcon, ChatBubbleLeftRightIcon, ChevronRightIcon, CalendarIcon } from '@heroicons/react/24/outline';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

export interface MeetingChatContext {
  title: string;
  date: string;
  durationMinutes?: number;
  attendees: string[];
  summary?: string;
  decisions?: string[];
  actionItems?: Array<{ text: string; assignee?: string; status?: string }>;
  risks?: Array<{ description: string; severity: string }>;
  suggestedNextStep?: string;
  /** Transcript ID — set when a processed recording is open, enables AI note editing */
  transcriptId?: string;
}

interface MeetingChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  meetingContext: MeetingChatContext;
  onOpenWorkflow: (title: string, skill?: string) => void;
  onOpenProcess?: (processId: string) => void;
  /** When true, renders without the outer w-[380px] wrapper — parent controls width */
  inline?: boolean;
  /** Auto-send a message when the component mounts with this value */
  autoMessage?: string;
  /** Called when the user clicks the switch-panel button (e.g. to open AssistantPanel) */
  onSwitchPanel?: () => void;
}

const QUICK_PROMPTS = [
  "What were the key decisions?",
  "Draft a follow-up email to attendees",
  "What action items need my attention?",
  "Start a workflow based on this meeting",
];

// ── Token regexes ─────────────────────────────────────────────────────────────

const OPEN_WORKFLOW_RE = /OPEN_WORKFLOW:(\{[\s\S]+?\})/;
const OPEN_PROCESS_RE = /OPEN_PROCESS:(\{[\s\S]+?\})/;
const REPLY_DRAFT_RE = /REPLY_DRAFT:(\{[\s\S]+?\})/;
const MEETING_RE = /MEETING_SUGGESTION:(\{.+\})/;
// Accept both UPDATE_MEETING:{ and UPDATE_MEETING({ (model sometimes uses parens)
// Greedy inner match so we capture the full JSON object, not just up to the first }
const UPDATE_MEETING_RE = /UPDATE_MEETING[:(]\s*(\{[\s\S]+\})\)?\s*$/;

function tryParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

function parseMessage(raw: string) {
  let openWorkflow: ParsedOpenWorkflow | null = null;
  let openProcess: ParsedOpenProcess | null = null;
  let replyDraft: { body: string } | null = null;
  let updateMeeting: { notes?: string; action_items?: Array<{ text: string; assignee?: string; due_date?: string }> } | null = null;

  const workflowMatch = raw.match(OPEN_WORKFLOW_RE);
  if (workflowMatch) openWorkflow = tryParse(workflowMatch[1]);

  const processMatch = raw.match(OPEN_PROCESS_RE);
  if (processMatch) openProcess = tryParse(processMatch[1]);

  const replyMatch = raw.match(REPLY_DRAFT_RE);
  if (replyMatch) replyDraft = tryParse(replyMatch[1]);

  const updateMatch = raw.match(UPDATE_MEETING_RE);
  if (updateMatch) updateMeeting = tryParse(updateMatch[1]);

  const text = raw
    .replace(OPEN_WORKFLOW_RE, '')
    .replace(OPEN_PROCESS_RE, '')
    .replace(REPLY_DRAFT_RE, '')
    .replace(UPDATE_MEETING_RE, '')
    .replace(/\nMEETING_SUGGESTION:\{.+\}/g, '')
    .replace(MEETING_RE, '')
    .replace(/\nKB_REFS:[^\n]*/g, '')
    .replace(/^INTENT DETECTION:\s*\w+\s*\n?/im, '')
    .replace(/^---+\s*$/gm, '')
    .replace(/\nACTION:\{[\s\S]+?\}/g, '')
    .trim();

  return { text, openWorkflow, openProcess, replyDraft, updateMeeting };
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

function WorkflowChip({ workflow, onOpenWorkflow }: {
  workflow: ParsedOpenWorkflow;
  onOpenWorkflow: (title: string, skill?: string) => void;
}) {
  const [clicked, setClicked] = useState(false);
  return (
    <button
      onClick={() => { if (clicked) return; setClicked(true); onOpenWorkflow(workflow.prefillTitle ?? '', workflow.skill); }}
      disabled={clicked}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 rounded-lg text-[12px] text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
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
  if (!onOpenProcess) return null;
  return (
    <button
      onClick={() => onOpenProcess(process.processId)}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-neutral-50 rounded-lg text-[12px] text-neutral-700 hover:bg-neutral-100 transition-colors"
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
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 rounded-lg text-[12px] text-indigo-700 hover:bg-indigo-100 transition-colors"
    >
      <PaperAirplaneIcon className="w-3 h-3 flex-shrink-0" />
      {state === 'copied' ? 'Copied ✓' : 'Copy draft →'}
    </button>
  );
}

// ── Message renderer ──────────────────────────────────────────────────────────

function MessageContent({ content, onOpenWorkflow, onOpenProcess }: {
  content: string;
  onOpenWorkflow: (title: string, skill?: string) => void;
  onOpenProcess?: (processId: string) => void;
}) {
  const { text, openWorkflow, openProcess, replyDraft } = parseMessage(content);

  return (
    <div>
      {renderMarkdown(text)}
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

export default function MeetingChatSidebar({
  isOpen,
  onClose,
  meetingContext,
  onOpenWorkflow,
  onOpenProcess,
  inline,
  autoMessage,
  onSwitchPanel,
}: MeetingChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-send a message (e.g. "Draft a follow-up email...")
  const autoMessageSent = useRef(false);
  useEffect(() => {
    if (autoMessage && isOpen && !autoMessageSent.current && messages.length === 0) {
      autoMessageSent.current = true;
      // Small delay to let the component render first
      const t = setTimeout(() => sendMessage(autoMessage), 200);
      return () => clearTimeout(t);
    }
  }, [autoMessage, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
        body: JSON.stringify({ context: 'meeting', message: text, history, meetingContext }),
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

      // Apply UPDATE_MEETING token if present and we have a transcript ID
      const { updateMeeting } = parseMessage(accumulated);
      if (updateMeeting && meetingContext.transcriptId) {
        fetch(`/api/meetings/${meetingContext.transcriptId}/notes`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(updateMeeting.notes !== undefined ? { document: updateMeeting.notes } : {}),
            ...(updateMeeting.action_items !== undefined ? { action_items: updateMeeting.action_items } : {}),
          }),
        }).then(() => {
          new BroadcastChannel('meeting-updates').postMessage('updated');
        }).catch(() => {});
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
  }, [messages, streaming, meetingContext]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className={inline ? 'flex flex-col h-full' : 'w-[380px] flex-shrink-0 h-full bg-neutral-50 pt-2 pr-2 pb-2 flex flex-col'}>
      <div className={inline ? 'flex-1 flex flex-col overflow-hidden min-h-0' : 'flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden min-h-0'}>
        {/* Header */}
        <div className="h-10 flex items-center justify-between px-3 border-b border-neutral-100 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            {onSwitchPanel && (
              <button onClick={onSwitchPanel} title="Calendar" className="p-1.5 border border-neutral-200 text-neutral-500 hover:bg-neutral-50 rounded-md transition-colors">
                <CalendarIcon className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="p-1.5 border rounded-md bg-indigo-600 border-indigo-600 text-white">
              <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 min-h-0">
          {isEmpty ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-neutral-400 font-medium px-1">Try asking…</p>
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left px-3 py-2.5 text-[12px] text-neutral-600 rounded-xl bg-neutral-50 shadow-sm hover:bg-neutral-100 transition-colors"
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
                    <div className="max-w-[80%] px-3 py-2 bg-neutral-100 rounded-2xl rounded-br-sm text-[13px] text-neutral-800 leading-relaxed">
                      {msg.content}
                    </div>
                  ) : (
                    <>
                      <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <SparklesIcon className="w-3 h-3 text-indigo-500" />
                      </div>
                      <div className="flex-1 min-w-0 text-[13px] text-neutral-800 leading-relaxed">
                        {msg.content ? (
                          <MessageContent
                            content={msg.content}
                            onOpenWorkflow={onOpenWorkflow}
                            onOpenProcess={onOpenProcess}
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

        {/* Input */}
        <div className="flex-shrink-0 px-3 pb-3 pt-2">
          <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 bg-white shadow-sm px-3 py-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this meeting…"
              disabled={streaming}
              rows={1}
              className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
              style={{ maxHeight: '120px', overflowY: 'auto' }}
            />
            <button
              onClick={() => sendMessage(inputValue)}
              disabled={!inputValue.trim() || streaming}
              className="flex-shrink-0 w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity mb-px"
            >
              <PaperAirplaneIcon className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
