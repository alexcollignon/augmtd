'use client';

import { ChatInputBar, SourceId, MentionChip, AttachmentChip } from './chat-input-bar';

interface Props {
  onStart: (message: string, sources: SourceId[], mentions: MentionChip[]) => void;
  userFirstName?: string;
  savedWorkflows?: Array<{ id: string; name: string; prompt: string }>;
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  attachments?: AttachmentChip[];
}

export function ChatEmptyState({ onStart, userFirstName, savedWorkflows = [], onAttach, onRemoveAttachment, attachments }: Props) {
  const name = userFirstName?.split(' ')[0];
  const heading = name ? `What's on your mind, ${name}?` : "What's on your mind?";

  function start(message: string) {
    onStart(message, ['kb', 'inbox', 'calendar', 'processes'], []);
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
      <h1 className="text-[22px] font-semibold text-neutral-700 mb-7 tracking-tight">
        {heading}
      </h1>

      <div className="w-full max-w-[580px]">
        <ChatInputBar
          onSubmit={onStart}
          onAttach={onAttach}
          onRemoveAttachment={onRemoveAttachment}
          attachments={attachments}
          autoFocus
        />

        <div className="mt-2">
          {[
            'What should I work on today?',
            'Check my recent emails',
            'Summarize my upcoming calendar events',
            'What should I focus on this week?',
          ].map((prompt, i, arr) => (
            <div
              key={prompt}
              className="animate-prompt-in"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}
            >
              <button
                onClick={() => start(prompt)}
                className="w-full text-left px-1 py-2.5 text-[13px] text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                {prompt}
              </button>
              {i < arr.length - 1 && <div className="border-t border-neutral-100" />}
            </div>
          ))}
        </div>
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
