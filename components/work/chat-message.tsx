'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { SparklesIcon, CheckCircleIcon, DocumentTextIcon, ExclamationTriangleIcon, PencilSquareIcon, DocumentDuplicateIcon, TableCellsIcon, PresentationChartBarIcon, EnvelopeIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon } from '@heroicons/react/20/solid';
import { ClarificationWidget, ClarificationData } from './clarification-widget';
import { MENTION_ICONS, MENTION_COLORS, MentionChip } from './chat-input-bar';

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
  // Ensure heading lines are always their own block so content after them renders correctly
  const normalized = content.replace(/(^#{1,4} .+$)\n(?!\n)/gm, '$1\n\n');
  const blocks = normalized.split(/\n{2,}/);

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

        // Table detection: all lines are pipe-delimited and at least one is a separator row
        const isTableBlock =
          lines.length >= 2 &&
          lines.every(l => l.trim().startsWith('|') && l.trim().endsWith('|')) &&
          lines.some(l => /^\|[\s|:-]+\|$/.test(l.trim()));

        if (isTableBlock) {
          const parseRow = (line: string) =>
            line.trim().split('|').slice(1, -1).map(c => c.trim());
          const dataRows = lines.filter(l => !/^\|[\s|:-]+\|$/.test(l.trim()));
          if (dataRows.length === 0) return null;
          const [headerRow, ...bodyRows] = dataRows;
          const headers = parseRow(headerRow);
          return (
            <div key={bi} className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full text-[13px] border-collapse">
                <thead className="bg-neutral-50">
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="text-left px-3 py-2 text-[11.5px] font-medium text-neutral-500 uppercase tracking-wide border-b border-neutral-200">
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-neutral-100 last:border-0">
                      {parseRow(row).map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-neutral-700 leading-snug">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        // Heading detection (H1–H4+)
        const firstLine = lines[0];
        const headingMatch = firstLine.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const text = headingMatch[2];
          const cls =
            level === 1 ? 'text-[15px] font-semibold text-neutral-900' :
            level === 2 ? 'text-[14px] font-semibold text-neutral-900' :
            level === 3 ? 'text-[13px] font-semibold text-neutral-700 uppercase tracking-wide' :
                          'text-[12.5px] font-semibold text-neutral-600 uppercase tracking-wide';
          return <p key={bi} className={cls}>{renderInline(text)}</p>;
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
  const isFailed = tool.status === 'done' && tool.summary?.toLowerCase().includes('failed');
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] ${isFailed ? 'bg-red-50 text-red-500' : 'bg-neutral-100 text-neutral-500'}`}>
      {tool.status === 'loading' ? (
        <ArrowPathIcon className="w-3 h-3 animate-spin flex-shrink-0" />
      ) : isFailed ? (
        <ExclamationTriangleIcon className="w-3 h-3 text-red-400 flex-shrink-0" />
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
  isEdited?: boolean;
  mentions?: Array<{ id: string; type: string; label: string }>;
  metadata?: {
    tool_calls?: Array<{ name: string; summary?: string }>;
    artifact_ids?: string[];
    citations?: string[];
    clarification?: ClarificationData;
    error?: boolean;
    attachments?: Array<{ id: string; name: string }>;
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
  onRetry?: () => void;
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  artifactVersionMap?: Map<string, { title: string; versionLabel: string; type?: string }>;
}

function UserBubble({ content, isEdited, onEdit }: { content: string; isEdited?: boolean; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="max-w-[75%] bg-neutral-100 rounded-2xl rounded-br-sm px-4 py-2.5">
        <p className="text-[13.5px] text-neutral-800 leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
      <div className="flex items-center gap-2">
        {isEdited && (
          <span className="text-[10.5px] text-neutral-400 italic select-none">edited</span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            title="Copy"
            className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            {copied
              ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500" />
              : <DocumentDuplicateIcon className="w-3.5 h-3.5" />}
          </button>
          {onEdit && (
            <button
              onClick={onEdit}
              title="Edit message"
              className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              <PencilSquareIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatMessageBubble({ message, isLastAssistantMessage, onViewArtifact, onClarificationConfirm, onRetry, onEditMessage, artifactVersionMap }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);

  if (message.role === 'user') {
    const mentions = message.mentions ?? [];
    const attachments = message.metadata?.attachments ?? [];
    const hasChips = mentions.length > 0 || attachments.length > 0;
    return (
      <div className="space-y-1.5">
        {hasChips && (
          <div className="flex justify-end">
            <div className="flex flex-wrap justify-end gap-1 max-w-[75%]">
              {mentions.map((m) => {
                const type = m.type as MentionChip['type'];
                const Icon = MENTION_ICONS[type];
                const colors = MENTION_COLORS[type] ?? 'bg-neutral-100 text-neutral-600 border-neutral-200';
                return (
                  <span
                    key={`mention:${m.type}:${m.id}`}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11.5px] ${colors}`}
                  >
                    {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
                    {m.label}
                  </span>
                );
              })}
              {attachments.map((a) => (
                <span
                  key={`attach:${a.id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11.5px] bg-neutral-50 text-neutral-600 border-neutral-200"
                >
                  <DocumentTextIcon className="w-3 h-3 flex-shrink-0 text-neutral-400" />
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {isEditing ? (
          <div className="flex justify-end">
            <div className="w-full max-w-[75%] space-y-2">
              <textarea
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                autoFocus
                rows={3}
                className="w-full text-[13.5px] text-neutral-800 bg-neutral-100 rounded-2xl rounded-br-sm px-4 py-2.5 resize-none outline-none focus:ring-2 focus:ring-indigo-300 leading-relaxed"
                onKeyDown={e => {
                  if (e.key === 'Escape') { setIsEditing(false); setEditValue(message.content); }
                }}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setIsEditing(false); setEditValue(message.content); }}
                  className="px-3 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={!editValue.trim() || editValue.trim() === message.content}
                  onClick={() => {
                    if (!message.id || !onEditMessage) return;
                    const next = editValue.trim();
                    setIsEditing(false); // close immediately — stream runs in background
                    onEditMessage(message.id, next);
                  }}
                  className="px-3 py-1.5 rounded-lg text-[12px] bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        ) : (
          <UserBubble
            content={message.content}
            isEdited={message.isEdited}
            onEdit={onEditMessage ? () => { setIsEditing(true); setEditValue(message.content); } : undefined}
          />
        )}
      </div>
    );
  }

  // Assistant error state
  if (message.metadata?.error) {
    return (
      <div className="flex gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <p className="text-[13px] text-neutral-400">Something went wrong.</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 text-[12.5px] text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              <ArrowPathIcon className="w-3.5 h-3.5" />
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  // Assistant message
  const rawToolCalls = message.metadata?.tool_calls ?? [];
  // Deduplicate by tool name — one chip per tool type, last result wins
  const toolCalls = rawToolCalls.reduce<typeof rawToolCalls>((acc, t) => {
    const idx = acc.findIndex(x => x.name === t.name);
    if (idx >= 0) { acc[idx] = t; return acc; }
    return [...acc, t];
  }, []);
  const artifactIds = message.metadata?.artifact_ids ?? [];
  const citations = message.metadata?.citations ?? [];
  const clarification = message.metadata?.clarification;

  return (
    <AssistantMessage content={message.content} toolCalls={toolCalls} artifactIds={artifactIds} citations={citations} clarification={clarification} isLastAssistantMessage={isLastAssistantMessage} onViewArtifact={onViewArtifact} onClarificationConfirm={onClarificationConfirm} onRetry={onRetry} artifactVersionMap={artifactVersionMap} />
  );
}

// ── Assistant message wrapper (with copy) ─────────────────────────────────────

function AssistantMessage({ content, toolCalls, artifactIds, citations, clarification, isLastAssistantMessage, onViewArtifact, onClarificationConfirm, onRetry, artifactVersionMap }: {
  content: string;
  toolCalls: Array<{ name: string; summary?: string }>;
  artifactIds: string[];
  citations: string[];
  clarification: ClarificationData | undefined;
  isLastAssistantMessage: boolean | undefined;
  onViewArtifact?: (id: string) => void;
  onClarificationConfirm?: (choices: { sources: string[]; options: Record<string, string> }) => void;
  onRetry?: () => void;
  artifactVersionMap?: Map<string, { title: string; versionLabel: string; type?: string }>;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex gap-3 group/assistant">
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
        {content && <MarkdownText content={content} />}

        {/* Artifact cards */}
        {artifactIds.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {artifactIds.map(id => {
              const meta = artifactVersionMap?.get(id);
              const ArtIcon =
                meta?.type === 'spreadsheet' ? TableCellsIcon
                : meta?.type === 'presentation' ? PresentationChartBarIcon
                : meta?.type === 'email' ? EnvelopeIcon
                : DocumentTextIcon;
              const typeLabel =
                meta?.type === 'spreadsheet' ? 'Spreadsheet'
                : meta?.type === 'presentation' ? 'Presentation'
                : meta?.type === 'email' ? 'Email draft'
                : 'Document';
              return (
                <button
                  key={id}
                  onClick={() => onViewArtifact?.(id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-neutral-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all group/artifact"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <ArtIcon className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-[12.5px] font-medium text-neutral-800 truncate max-w-[160px] leading-snug">
                      {meta?.title ?? 'Document'}
                    </p>
                    <p className="text-[11px] text-neutral-400 leading-tight">
                      {typeLabel}{meta?.versionLabel ? ` · ${meta.versionLabel}` : ''}
                    </p>
                  </div>
                  <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 text-neutral-300 group-hover/artifact:text-indigo-400 flex-shrink-0 transition-colors" />
                </button>
              );
            })}
          </div>
        )}

        {/* Generation failure — retry button */}
        {toolCalls.some(t => t.summary?.toLowerCase().includes('failed')) && artifactIds.length === 0 && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-[12.5px] text-red-600 hover:bg-red-100 transition-colors"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" />
            Retry generation
          </button>
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

        {/* Copy button — shown on hover, only when there's text content */}
        {content && (
          <div className="opacity-0 group-hover/assistant:opacity-100 transition-opacity pt-0.5">
            <button
              onClick={handleCopy}
              title="Copy"
              className="p-1 rounded-lg hover:bg-neutral-100 text-neutral-300 hover:text-neutral-500 transition-colors"
            >
              {copied
                ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500" />
                : <DocumentDuplicateIcon className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Streaming assistant message ───────────────────────────────────────────────

interface StreamingMessageProps {
  text: string;
  tools: ToolStatus[];
  thinking?: string;
  thinkingDone?: boolean;
  clarification?: ClarificationData;
  onClarificationConfirm?: (choices: { sources: string[]; options: Record<string, string> }) => void;
}

export function StreamingMessage({ text, tools, thinking, thinkingDone, clarification, onClarificationConfirm }: StreamingMessageProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const prevTextRef = useRef('');

  // Auto-collapse thinking when the actual response text starts appearing
  useEffect(() => {
    if (text && !prevTextRef.current && thinkingExpanded) {
      setThinkingExpanded(false);
    }
    prevTextRef.current = text;
  }, [text, thinkingExpanded]);

  // Strip any leftover <think> blocks from display text (fallback for models that don't use SSE events)
  const displayText = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();

  const hasThinking = thinking !== undefined && thinking !== '';

  return (
    <div className="flex gap-3">
      <div className="flex-1 min-w-0 space-y-2">

        {/* Thinking section */}
        {hasThinking && (
          <div className="rounded-lg border border-neutral-100 bg-neutral-50 overflow-hidden">
            <button
              onClick={() => setThinkingExpanded(v => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-100 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {!thinkingDone ? (
                  <>
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                    <span className="text-[11.5px] text-neutral-400 font-medium">Thinking…</span>
                  </>
                ) : (
                  <span className="text-[11.5px] text-neutral-400 font-medium">Thought</span>
                )}
              </div>
              <ChevronDownIcon className={`w-3.5 h-3.5 text-neutral-400 flex-shrink-0 transition-transform duration-150 ${thinkingExpanded ? 'rotate-180' : ''}`} />
            </button>
            {thinkingExpanded && (
              <div className="px-3 pb-3 pt-0.5 text-[11.5px] text-neutral-400 leading-relaxed whitespace-pre-wrap border-t border-neutral-100">
                {thinking}
              </div>
            )}
          </div>
        )}

        {/* Active tool chips — hide internal meta tools */}
        {tools.filter(t => t.name !== 'request_clarification').length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.filter(t => t.name !== 'request_clarification').map((t, i) => (
              <ChatToolChip key={`${t.id}-${i}`} tool={t} />
            ))}
          </div>
        )}

        {/* Streaming text */}
        {displayText ? (
          <MarkdownText content={displayText} cursor />
        ) : !clarification && !hasThinking ? (
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
