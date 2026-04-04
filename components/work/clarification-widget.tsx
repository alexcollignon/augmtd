'use client';

import { useState } from 'react';
import {
  DocumentTextIcon,
  EnvelopeIcon,
  CalendarIcon,
  FolderIcon,
  CheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

export interface ClarificationSource {
  id: string;
  title: string;
  type: 'kb' | 'email' | 'calendar' | 'process' | string;
}

export interface ClarificationOption {
  key: string;
  label: string;
  choices: string[];
  default?: string;
}

export interface ClarificationData {
  question: string;
  sources?: ClarificationSource[];
  options?: ClarificationOption[];
}

interface Props {
  data: ClarificationData;
  isResolved: boolean;
  onConfirm: (choices: { sources: string[]; options: Record<string, string> }) => void;
}

function sourceIcon(type: string) {
  switch (type) {
    case 'email': return <EnvelopeIcon className="w-3 h-3" />;
    case 'calendar': return <CalendarIcon className="w-3 h-3" />;
    case 'process': return <FolderIcon className="w-3 h-3" />;
    default: return <DocumentTextIcon className="w-3 h-3" />;
  }
}

function sourceColor(type: string): string {
  switch (type) {
    case 'email': return 'text-blue-500';
    case 'calendar': return 'text-violet-500';
    case 'process': return 'text-orange-500';
    default: return 'text-neutral-400';
  }
}

export function ClarificationWidget({ data, isResolved, onConfirm }: Props) {
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set((Array.isArray(data.sources) ? data.sources : []).map(s => s.id))
  );
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(
    Object.fromEntries((Array.isArray(data.options) ? data.options : []).map(o => [o.key, o.default ?? o.choices[0]]))
  );

  function toggleSource(id: string) {
    if (isResolved) return;
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectOption(key: string, choice: string) {
    if (isResolved) return;
    setSelectedOptions(prev => ({ ...prev, [key]: choice }));
  }

  function handleConfirm() {
    onConfirm({
      sources: (Array.isArray(data.sources) ? data.sources : []).filter(s => selectedSources.has(s.id)).map(s => s.title),
      options: selectedOptions,
    });
  }

  const hasSources = (Array.isArray(data.sources) ? data.sources : []).length > 0;
  const hasOptions = (Array.isArray(data.options) ? data.options : []).length > 0;

  return (
    <div className={`rounded-xl border overflow-hidden transition-opacity ${isResolved ? 'opacity-60' : 'border-neutral-200 bg-white'}`}>
      {/* Header */}
      <div className="flex items-start gap-2.5 px-4 pt-4 pb-3">
        <div className="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <SparklesIcon className="w-3 h-3 text-indigo-500" />
        </div>
        <p className="text-[13.5px] text-neutral-800 leading-relaxed">
          {data.question}
        </p>
      </div>

      {(hasSources || hasOptions) && (
        <div className="px-4 pb-4 space-y-4 ml-7">
          {/* Sources */}
          {hasSources && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">
                Sources to include
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Array.isArray(data.sources) ? data.sources : []).map((source, i) => {
                  const active = selectedSources.has(source.id);
                  return (
                    <button
                      key={source.id ?? i}
                      onClick={() => toggleSource(source.id)}
                      disabled={isResolved}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] transition-all ${
                        active
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-400 line-through'
                      } ${isResolved ? 'cursor-default' : 'hover:border-indigo-300 cursor-pointer'}`}
                    >
                      <span className={active ? 'text-indigo-400' : sourceColor(source.type)}>
                        {sourceIcon(source.type)}
                      </span>
                      <span className="max-w-[180px] truncate">{source.title}</span>
                      {active && !isResolved && (
                        <CheckIcon className="w-2.5 h-2.5 text-indigo-400 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Options */}
          {hasOptions && (Array.isArray(data.options) ? data.options : []).map((option, i) => (
            <div key={option.key ?? i} className="space-y-1.5">
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">
                {option.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {option.choices.map(choice => {
                  const active = selectedOptions[option.key] === choice;
                  return (
                    <button
                      key={choice}
                      onClick={() => selectOption(option.key, choice)}
                      disabled={isResolved}
                      className={`px-3 py-1 rounded-full text-[12px] border transition-all ${
                        active
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300'
                      } ${isResolved ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* CTA */}
          {!isResolved && (
            <button
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 transition-colors"
            >
              Generate
              <span className="text-indigo-300">→</span>
            </button>
          )}

          {isResolved && (
            <div className="flex items-center gap-1.5 text-[12px] text-neutral-400">
              <CheckIcon className="w-3.5 h-3.5 text-green-500" />
              Confirmed
            </div>
          )}
        </div>
      )}

      {/* No sources/options — just a confirm button */}
      {!hasSources && !hasOptions && !isResolved && (
        <div className="px-4 pb-4 ml-7">
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 transition-colors"
          >
            Generate
            <span className="text-indigo-300">→</span>
          </button>
        </div>
      )}
    </div>
  );
}
