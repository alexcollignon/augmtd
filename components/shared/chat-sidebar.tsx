'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PaperAirplaneIcon, SparklesIcon, ChatBubbleLeftRightIcon, ChevronRightIcon, CalendarIcon } from '@heroicons/react/24/outline';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  context: 'meeting' | 'drive';
  inline?: boolean;
  /** Called when the user clicks the switch-panel button */
  onSwitchPanel?: () => void;
}

export default function ChatSidebar({ isOpen, onClose, context, inline = false, onSwitchPanel }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);
    setInputValue('');
    setStreaming(true);

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, message: trimmed, history }),
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: (updated[updated.length - 1].content ?? '') + delta,
                };
                return updated;
              });
            }
          } catch {
            // ignore parse errors
          }
        }
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
  }, [messages, streaming, context]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  if (!isOpen) return null;

  const isEmpty = messages.length === 0;

  const inner = (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 min-h-0">
        {isEmpty ? (
          <p className="text-[11px] text-neutral-400 px-1">Ask anything…</p>
        ) : (
          messages.map((msg, i) => (
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
                  <div className="flex-1 min-w-0 text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
                    {msg.content ? msg.content : (
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
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 bg-white shadow-sm px-3 py-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything…"
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
    </>
  );

  if (inline) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="h-10 flex items-center justify-between px-3 border-b border-neutral-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-[12px] font-semibold text-neutral-700">Assistant</span>
          </div>
          <div className="flex items-center gap-1">
            {onSwitchPanel && (
              <button onClick={onSwitchPanel} title="Calendar" className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
                <CalendarIcon className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {inner}
      </div>
    );
  }

  return (
    <div className="w-[380px] flex-shrink-0 h-full bg-neutral-50 pt-2 pr-2 pb-2 flex flex-col">
      <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden min-h-0">
        {/* Header */}
        <div className="h-10 flex items-center justify-between px-3 border-b border-neutral-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-[12px] font-semibold text-neutral-700">Assistant</span>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors">
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        {inner}
      </div>
    </div>
  );
}
