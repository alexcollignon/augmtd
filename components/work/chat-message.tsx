'use client';

import { SparklesIcon, CheckCircleIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon } from '@heroicons/react/20/solid';
import { ClarificationWidget, ClarificationData } from './clarification-widget';

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="font-semibold text-neutral-900">{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*'))
          return <em key={i} className="italic">{part.slice(1, -1)}</em>;
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="font-mono text-[12.5px] bg-neutral-100 px-1 py-0.5 rounded">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function MarkdownText({ content, cursor }: { content: string; cursor?: boolean }) {
  const blocks = content.split(/\n{2,}/);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter(l => l.trim() !== '');
        if (lines.length === 0) return null;

        const isListBlock = lines.every(l => /^[-•*]\s/.test(l) || /^\d+\.\s/.test(l));
        if (isListBlock) {
          const isOrdered = /^\d+\.\s/.test(lines[0]);
          return (
            <ul key={bi} className="space-y-1">
              {lines.map((line, li) => {
                const text = isOrdered ? line.replace(/^\d+\.\s/, '') : line.replace(/^[-•*]\s/, '');
                return (
                  <li key={li} className="flex items-start gap-2 text-[13.5px] text-neutral-800 leading-relaxed">
                    <span className="text-neutral-400 flex-shrink-0 mt-px select-none text-[11px]">
                      {isOrdered ? `${li + 1}.` : '·'}
                    </span>
                    <span>
                      {renderInline(text)}
                      {cursor && bi === blocks.length - 1 && li === lines.length - 1 && (
                        <span className="inline-block w-0.5 h-3.5 bg-neutral-400 ml-0.5 animate-pulse align-middle" />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        }

        // Heading detection
        const firstLine = lines[0];
        if (firstLine.startsWith('### ')) {
          return (
            <p key={bi} className="text-[13px] font-semibold text-neutral-700 uppercase tracking-wide">
              {renderInline(firstLine.slice(4))}
            </p>
          );
        }
        if (firstLine.startsWith('## ')) {
          return (
            <p key={bi} className="text-[14px] font-semibold text-neutral-900">
              {renderInline(firstLine.slice(3))}
            </p>
          );
        }

        return (
          <p key={bi} className="text-[13.5px] text-neutral-800 leading-relaxed">
            {lines.map((line, li) => (
              <span key={li} className="block">
                {renderInline(line)}
                {cursor && bi === blocks.length - 1 && li === lines.length - 1 && (
                  <span className="inline-block w-0.5 h-3.5 bg-neutral-400 ml-0.5 animate-pulse align-middle" />
                )}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ── Tool status chip ──────────────────────────────────────────────────────────

export interface ToolStatus {
  id: string;
  name: string;
  status: 'loading' | 'done';
  label?: string;
  summary?: string;
}

export function ChatToolChip({ tool }: { tool: ToolStatus }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-100 text-[12px] text-neutral-500">
      {tool.status === 'loading' ? (
        <ArrowPathIcon className="w-3 h-3 animate-spin flex-shrink-0" />
      ) : (
        <CheckCircleIcon className="w-3 h-3 text-green-500 flex-shrink-0" />
      )}
      <span>{tool.status === 'loading' ? (tool.label ?? tool.name) : (tool.summary ?? tool.label ?? tool.name)}</span>
    </div>
  );
}

// ── Message types ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  metadata?: {
    tool_calls?: Array<{ name: string; summary?: string }>;
    artifact_ids?: string[];
    citations?: string[];
    clarification?: ClarificationData;
  };
}

// ── Citation chip ─────────────────────────────────────────────────────────────

function CitationChip({ filename }: { filename: string }) {
  const short = filename.length > 36 ? filename.slice(0, 34) + '…' : filename;
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-neutral-50 border border-neutral-200 text-[11.5px] text-neutral-500">
      <DocumentTextIcon className="w-3 h-3 flex-shrink-0 text-neutral-400" />
      <span>{short}</span>
    </div>
  );
}

// ── ChatMessage component ────────────────────────────────────────────────────

interface Props {
  message: ChatMessage;
  isLastAssistantMessage?: boolean;
  onViewArtifact?: (artifactId: string) => void;
  onClarificationConfirm?: (choices: { sources: string[]; options: Record<string, string> }) => void;
}

export function ChatMessageBubble({ message, isLastAssistantMessage, onViewArtifact, onClarificationConfirm }: Props) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-neutral-100 rounded-2xl rounded-br-sm px-4 py-2.5">
          <p className="text-[13.5px] text-neutral-800 leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  // Assistant message
  const toolCalls = message.metadata?.tool_calls ?? [];
  const artifactIds = message.metadata?.artifact_ids ?? [];
  const citations = message.metadata?.citations ?? [];
  const clarification = message.metadata?.clarification;

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <SparklesIcon className="w-3 h-3 text-indigo-500" />
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Tool call chips (from saved metadata) — hide internal meta tools */}
        {toolCalls.filter(t => t.name !== 'request_clarification').length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {toolCalls.filter(t => t.name !== 'request_clarification').map((t, i) => (
              <ChatToolChip
                key={i}
                tool={{ id: String(i), name: t.name, status: 'done', summary: t.summary }}
              />
            ))}
          </div>
        )}

        {/* Message text */}
        {message.content && <MarkdownText content={message.content} />}

        {/* Artifact cards */}
        {artifactIds.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {artifactIds.map(id => (
              <button
                key={id}
                onClick={() => onViewArtifact?.(id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-neutral-200 shadow-sm text-[12.5px] text-neutral-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
              >
                <SparklesIcon className="w-3.5 h-3.5 text-indigo-400" />
                View document
              </button>
            ))}
          </div>
        )}

        {/* KB citation chips */}
        {citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {citations.map((f, i) => (
              <CitationChip key={i} filename={f} />
            ))}
          </div>
        )}

        {/* Clarification widget */}
        {clarification && (
          <ClarificationWidget
            data={clarification}
            isResolved={!isLastAssistantMessage}
            onConfirm={onClarificationConfirm ?? (() => {})}
          />
        )}
      </div>
    </div>
  );
}

// ── Streaming assistant message ───────────────────────────────────────────────

interface StreamingMessageProps {
  text: string;
  tools: ToolStatus[];
  clarification?: ClarificationData;
  onClarificationConfirm?: (choices: { sources: string[]; options: Record<string, string> }) => void;
}

export function StreamingMessage({ text, tools, clarification, onClarificationConfirm }: StreamingMessageProps) {
  return (
    <div className="flex gap-3">
      <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <SparklesIcon className="w-3 h-3 text-indigo-500" />
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Active tool chips — hide internal meta tools */}
        {tools.filter(t => t.name !== 'request_clarification').length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.filter(t => t.name !== 'request_clarification').map(t => (
              <ChatToolChip key={t.id} tool={t} />
            ))}
          </div>
        )}

        {/* Streaming text */}
        {text ? (
          <MarkdownText content={text} cursor />
        ) : !clarification ? (
          <div className="flex gap-1 pt-1">
            <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        ) : null}

        {/* Clarification widget (live during stream) */}
        {clarification && (
          <ClarificationWidget
            data={clarification}
            isResolved={false}
            onConfirm={onClarificationConfirm ?? (() => {})}
          />
        )}
      </div>
    </div>
  );
}
