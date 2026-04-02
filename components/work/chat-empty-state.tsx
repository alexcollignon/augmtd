'use client';

import { useState, useEffect } from 'react';
import { ChatInputBar, SourceId, MentionChip } from './chat-input-bar';

const FALLBACK_PROMPTS = [
  'What should I work on today?',
  'Draft a client update email',
  'Summarize my upcoming meetings',
  'Create a weekly status report',
];

interface Props {
  onStart: (message: string, sources: SourceId[], mentions: MentionChip[]) => void;
  userFirstName?: string;
  savedWorkflows?: Array<{ id: string; name: string; prompt: string }>;
}

export function ChatEmptyState({ onStart, userFirstName, savedWorkflows = [] }: Props) {
  const name = userFirstName?.split(' ')[0];
  const heading = name ? `What's on the agenda, ${name}?` : "What's on the agenda?";

  const [prompts, setPrompts] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/work/quick-prompts')
      .then(r => r.json())
      .then(data => {
        setPrompts(data.prompts?.length ? data.prompts : FALLBACK_PROMPTS);
      })
      .catch(() => setPrompts(FALLBACK_PROMPTS));
  }, []);

  function start(message: string) {
    onStart(message, ['kb', 'inbox', 'calendar', 'processes'], []);
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
      <h1 className="text-[22px] font-semibold text-neutral-700 mb-7 tracking-tight">
        {heading}
      </h1>

      <div className="w-full max-w-[580px]">
        <ChatInputBar onSubmit={onStart} autoFocus />
      </div>

      {/* Quick prompts */}
      <div className="mt-6 flex flex-col items-center gap-2.5">
        {prompts.map((prompt, i) => (
          <button
            key={prompt}
            onClick={() => start(prompt)}
            style={{
              animationDelay: `${i * 80}ms`,
              animationFillMode: 'both',
            }}
            className="text-[13px] text-neutral-500 hover:text-neutral-800 transition-colors animate-prompt-in"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Saved workflows */}
      {savedWorkflows.length > 0 && (
        <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-[580px]">
          {savedWorkflows.slice(0, 6).map((wf) => (
            <button
              key={wf.id}
              onClick={() => start(wf.prompt)}
              className="px-3 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200 text-[12px] text-neutral-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
            >
              {wf.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
