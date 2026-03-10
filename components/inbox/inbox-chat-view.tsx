'use client';

import { useEffect, useRef, useState, RefObject } from 'react';
import type { InboxItem } from '@/lib/types/inbox';
import EmailListCard from './email-list-card';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ParsedAction {
  type: 'archive' | 'open' | 'workflow';
  itemId: string;
  label: string;
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
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ACTION_RE = /ACTION:\{[^}]+\}/g;

/** Strip ACTION tokens and return { text, actions } */
function parseContent(raw: string): { text: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const text = raw.replace(ACTION_RE, (match) => {
    try {
      const json = match.slice('ACTION:'.length);
      const parsed = JSON.parse(json);
      if (parsed.type && parsed.itemId && parsed.label) actions.push(parsed as ParsedAction);
    } catch { /* ignore */ }
    return '';
  }).trim();
  return { text, actions };
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
}: {
  content: string;
  inboxItems: InboxItem[];
  onSelectItem: (item: InboxItem) => void;
  onAction: (type: string, itemId: string) => Promise<void>;
}) {
  const { text, actions } = parseContent(content);
  const parts = splitOnRefs(text);

  return (
    <div>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <span key={i} className="whitespace-pre-wrap">
              {part.value}
            </span>
          );
        }
        const item = inboxItems.find(it => it.id === part.value);
        if (!item) return null;
        return (
          <div key={i} className="mt-2 mb-1 border border-neutral-200 overflow-hidden">
            <EmailListCard
              item={item}
              isSelected={false}
              onSelect={onSelectItem}
              compact
            />
          </div>
        );
      })}
      {actions.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {actions.map((a, i) => (
            <ActionChip key={i} action={a} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  'Summarize my inbox today',
  'What emails need a reply?',
  'Show me emails from this week',
];

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
}: InboxChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamingContent]);

  const isEmpty = history.length === 0 && !isStreaming;

  const handleSubmit = () => {
    if (chatInput.trim() && !isStreaming) onSendMessage(chatInput);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center gap-4">
            <p className="text-[13px] text-neutral-400">Ask anything about your inbox</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onSendMessage(s)}
                  className="text-left px-3 py-2 text-[12px] text-neutral-600 border border-neutral-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors"
                >
                  {s}
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

      {/* Input bar — always at bottom */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-neutral-200 bg-white">
        <input
          ref={chatInputRef}
          type="text"
          value={chatInput}
          onChange={e => onChatInputChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="Ask about your inbox..."
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
  );
}
