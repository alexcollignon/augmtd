'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ThreadTimeline, ThreadComposer, type ThreadItem } from '@/components/thread';
import { useCosSeat } from '@/hooks/use-cos-seat';
import { ChatBubbleLeftRightIcon, ChevronRightIcon, CalendarIcon } from '@heroicons/react/24/outline';

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
  const seat = useCosSeat();
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

  if (!isOpen) return null;

  const isEmpty = messages.length === 0;

  // ── ONE THREAD COMPONENT (W4.1b) ─────────────────────────────────────────────────────────────
  // The panel's own bubbles/textarea are gone: its messages MAP onto the kit's ThreadItem grammar
  // (user bubble · the seat's actor bubble) and its box is the kit's composer. The data flow above
  // (the /api/assistant/chat stream, the state) is untouched — only the render layer moved.
  const actorId = seat?.agentId ?? 'cos';
  const actorName = seat?.name ?? 'Your assistant';
  const items: ThreadItem[] = messages.map((msg, i): ThreadItem => {
    if (msg.role === 'user') return { type: 'user_bubble', id: `m:${i}`, text: msg.content };
    const live = streaming && i === messages.length - 1;
    return {
      type: 'actor_bubble', id: `m:${i}`, actorId, actorName,
      actorRoleLabel: seat ? seat.seatLabel : undefined,
      text: msg.content || undefined,
      // THE AVATAR STATUS GRAMMAR: the face carries the wait — no dots, no spinner.
      status: live && !msg.content ? 'working' : 'idle',
    };
  });

  const inner = (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {isEmpty ? (
          <p className="text-[11px] text-neutral-400 px-1">Ask anything…</p>
        ) : (
          <ThreadTimeline items={items} />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input — the kit's composer, the panel's own handler */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <ThreadComposer
          inputRef={inputRef}
          value={inputValue}
          onChange={setInputValue}
          onSend={(t) => sendMessage(t)}
          placeholder="Ask anything…"
        />
      </div>
    </>
  );

  if (inline) {
    return (
      <div className="flex flex-col h-full min-h-0">
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
