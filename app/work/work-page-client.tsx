'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import SidebarNav from '@/components/sidebar-nav';
import {
  PlusIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  DocumentChartBarIcon,
  TableCellsIcon,
  EnvelopeIcon,
  CalendarIcon,
  SparklesIcon,
  CheckCircleIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  ArrowDownTrayIcon,
  PaperClipIcon,
  BookmarkIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { WorkBlueprint, SavedWorkflow } from '@/lib/types/work-blueprints';
import { ExecutionPlan, DocumentArtifact, DocContent, PptxContent, XlsxContent, EmailContent } from '@/lib/types/inbox';
import OnboardingModal from '@/components/onboarding-modal';

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-neutral-900">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function MarkdownText({ content, cursor }: { content: string; cursor?: boolean }) {
  const blocks = content.split(/\n{2,}/);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');

        if (lines.length > 0 && lines.every((l) => /^[-•]\s/.test(l) || /^\d+\.\s/.test(l))) {
          const isOrdered = /^\d+\.\s/.test(lines[0]);
          return (
            <ul key={bi} className="space-y-1">
              {lines.map((line, li) => {
                const text = isOrdered
                  ? line.replace(/^\d+\.\s/, '')
                  : line.replace(/^[-•]\s/, '');
                return (
                  <li key={li} className="flex items-start gap-2 text-[13.5px] text-neutral-800 leading-relaxed">
                    <span className="text-neutral-400 flex-shrink-0 mt-px select-none">
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

        return (
          <p key={bi} className="text-[13.5px] text-neutral-800 leading-relaxed">
            {lines.map((line, li) => {
              const isBullet = /^[-•]\s/.test(line);
              const isOrdered = /^\d+\.\s/.test(line);
              const text = isBullet
                ? line.replace(/^[-•]\s/, '')
                : isOrdered
                ? line.replace(/^\d+\.\s/, '')
                : line;
              return (
                <span key={li} className={isBullet || isOrdered ? 'flex items-start gap-2' : 'block'}>
                  {(isBullet || isOrdered) && (
                    <span className="text-neutral-400 flex-shrink-0 select-none">·</span>
                  )}
                  <span>
                    {renderInline(text)}
                    {li < lines.length - 1 && !isBullet && !isOrdered && <br />}
                    {cursor && bi === blocks.length - 1 && li === lines.length - 1 && (
                      <span className="inline-block w-0.5 h-3.5 bg-neutral-400 ml-0.5 animate-pulse align-middle" />
                    )}
                  </span>
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkMode = 'planning' | 'generating' | 'document';

interface WorkThread {
  id: string;
  title: string;
  plan: ExecutionPlan | null;
  artifact: DocumentArtifact | null;
  artifacts?: DocumentArtifact[];
  status: string;
  created_at: string;
  updated_at: string;
  auto_generated?: boolean;
  saved_workflow_id?: string;
}

interface WorkMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface WorkPageClientProps {
  userEmail?: string;
  userFullName?: string;
  hasCompletedOnboarding: boolean;
  blueprints: WorkBlueprint[];
  initialThreads: WorkThread[];
  initialActiveThreadId?: string | null;
  initialView?: string | null;
  initialSavedWorkflows: SavedWorkflow[];
}

const PLAN_SEPARATOR = '---PLAN_UPDATE---';
const ARTIFACT_SEPARATOR = '---ARTIFACT_UPDATE---';

const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // 10 MB — must match server
const ATTACH_ACCEPT = '.pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.zip';
const ATTACH_HINT = 'PDF, DOCX, TXT, images, ZIP · max 10 MB';

const ATTACH_ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
]);

function formatBytes(b: number): string {
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function validateAttachFiles(files: File[]): { valid: File[]; errorMsg: string | null } {
  const rejected: string[] = [];
  const valid: File[] = [];
  for (const f of files) {
    const isZip = f.name.toLowerCase().endsWith('.zip');
    if (f.size > MAX_ATTACH_BYTES) {
      rejected.push(`${f.name} is ${formatBytes(f.size)} — max 10 MB`);
    } else if (!isZip && !ATTACH_ALLOWED_MIME.has(f.type)) {
      rejected.push(`${f.name} is not a supported type`);
    } else {
      valid.push(f);
    }
  }
  const errorMsg = rejected.length > 0 ? rejected.join('; ') : null;
  return { valid, errorMsg };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getDeliverableIcon(type: string) {
  switch (type) {
    case 'presentation': return PresentationChartBarIcon;
    case 'analysis': return DocumentChartBarIcon;
    case 'spreadsheet': return TableCellsIcon;
    case 'email': return EnvelopeIcon;
    default: return DocumentTextIcon;
  }
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'planning': return CalendarIcon;
    case 'analysis': return DocumentChartBarIcon;
    default: return DocumentTextIcon;
  }
}

// ─── Plan Panel ───────────────────────────────────────────────────────────────

function PlanPanel({
  plan,
  isUpdating,
  planJustUpdated,
  workMode,
  onGenerate,
  threadId,
  artifact,
  onViewDocument,
  onAttach,
  uploadingInputId,
  onRemoveAttachment,
  isDocumentStale,
  attachErrorInputId,
  attachErrorMsg,
  savedWorkflowId,
  onSaveWorkflow,
  showSaveInput,
  saveWorkflowName,
  onSaveWorkflowNameChange,
  onSaveWorkflowConfirm,
  onCancelSave,
  isSavingWorkflow,
  onUpdateWorkflow,
}: {
  plan: ExecutionPlan | null;
  isUpdating: boolean;
  planJustUpdated: boolean;
  workMode: WorkMode;
  onGenerate: (threadId: string) => void;
  threadId: string | null;
  artifact: DocumentArtifact | null;
  onViewDocument: () => void;
  onAttach?: (inputId: string) => void;
  uploadingInputId?: string | null;
  onRemoveAttachment?: (inputId: string) => void;
  isDocumentStale?: boolean;
  attachErrorInputId?: string | null;
  attachErrorMsg?: string | null;
  savedWorkflowId?: string;
  onSaveWorkflow?: () => void;
  showSaveInput?: boolean;
  saveWorkflowName?: string;
  onSaveWorkflowNameChange?: (name: string) => void;
  onSaveWorkflowConfirm?: () => void;
  onCancelSave?: () => void;
  isSavingWorkflow?: boolean;
  onUpdateWorkflow?: () => void;
}) {
  const isGenerating = workMode === 'generating';

  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center border-r border-neutral-200 bg-neutral-50">
        <div className="text-center px-8">
          {isUpdating ? (
            <>
              <div className="flex items-center justify-center gap-1.5 mb-3">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
              <p className="text-[13px] text-neutral-400">Building your plan…</p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <DocumentTextIcon className="w-5 h-5 text-neutral-400" />
              </div>
              <p className="text-[13px] text-neutral-400">
                Describe your work — the plan will appear here
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const Icon = getDeliverableIcon(plan.deliverable_type);

  // Derive the output type for each generator step — more reliable than AI-set deliverableType
  const generatorStepTypes: string[] = (plan.steps ?? [])
    .filter((s: any) => ['excel-generator', 'word-generator', 'powerpoint-generator', 'email-drafter'].includes(s.skill))
    .map((s: any) => {
      if (s.skill === 'excel-generator') return 'spreadsheet';
      if (s.skill === 'powerpoint-generator') return 'presentation';
      if (s.skill === 'email-drafter') return 'email';
      // word-generator: use plan's primary type only if it's a doc-like type; otherwise default to 'document'
      return ['document', 'report', 'analysis'].includes(plan.deliverable_type) ? plan.deliverable_type : 'document';
    });

  return (
    <div className="flex-1 overflow-y-auto border-r border-neutral-200 bg-white flex flex-col">
      {/* Generating overlay banner */}
      {isGenerating && (
        <div className="flex items-center gap-2 px-4 py-3 bg-indigo-50 border-b border-indigo-100">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
          <p className="text-[12px] text-indigo-700 font-medium">
            Building your {plan.deliverable_type === 'presentation' ? 'presentation' : plan.deliverable_type === 'spreadsheet' ? 'spreadsheet' : 'document'}…
          </p>
        </div>
      )}

      {/* Document stale banner — plan changed after last generation */}
      {!isGenerating && artifact && isDocumentStale && workMode === 'planning' && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-[11px] text-amber-700 font-medium">Plan updated — document may not reflect latest changes</span>
          </div>
          <button
            onClick={onViewDocument}
            className="text-[11px] text-amber-600 hover:text-amber-800 font-medium px-2 py-1 hover:bg-amber-100 transition-colors"
          >
            View current →
          </button>
        </div>
      )}

      {/* Document ready banner — up to date */}
      {!isGenerating && artifact && !isDocumentStale && workMode === 'planning' && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-green-50 border-b border-green-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <DocumentTextIcon className="w-3.5 h-3.5 text-green-600" />
            <span className="text-[11px] text-green-700 font-medium">Document ready</span>
          </div>
          <button
            onClick={onViewDocument}
            className="text-[11px] text-green-600 hover:text-green-800 font-medium px-2 py-1 hover:bg-green-100 transition-colors"
          >
            View document →
          </button>
        </div>
      )}

      {/* Status bar (plan updates) */}
      {!isGenerating && (isUpdating || planJustUpdated) && (
        <div className={`flex items-center gap-1.5 px-4 py-2 border-b text-[11px] font-medium transition-all ${
          planJustUpdated && !isUpdating
            ? 'border-green-100 bg-green-50 text-green-600'
            : 'border-indigo-100 bg-indigo-50 text-indigo-600'
        }`}>
          {isUpdating ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
              Updating plan…
            </>
          ) : (
            <>
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Plan updated
            </>
          )}
        </div>
      )}

      <div className="flex-1 p-6 space-y-6">
        {/* Deliverable header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 bg-indigo-50 flex items-center justify-center">
            <Icon className="w-4.5 h-4.5 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">
              Deliverable
            </p>
            <p className="text-[14px] font-medium text-neutral-900 leading-snug">
              {plan.deliverable_description}
            </p>
            {(plan.deliverable_type || generatorStepTypes.length > 0) && (
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[11px] text-indigo-600 bg-indigo-50 px-2 py-0.5 capitalize">
                  {generatorStepTypes.length > 1
                    ? generatorStepTypes.join(' + ')
                    : plan.deliverable_type}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Inputs */}
        {plan.inputs && plan.inputs.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
              Inputs needed
            </p>
            <div className="space-y-1.5">
              {plan.inputs.map((input) => {
                const isProvided = input.status === 'provided';
                return (
                  <div
                    key={input.id}
                    className={`p-3 border ${isProvided ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Left: name + description + filename */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-neutral-900">
                          {input.name}
                          {input.required && !isProvided && (
                            <span className="text-red-400 ml-1 text-[10px]">required</span>
                          )}
                        </p>
                        <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
                          {input.description}
                        </p>
                        {input.examples && input.examples.length > 0 && !isProvided && (
                          <p className="text-[10px] text-neutral-400 mt-1">
                            e.g. {input.examples[0]}
                          </p>
                        )}
                        {isProvided && input.providedFilename && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <DocumentTextIcon className="w-3 h-3 text-green-600 flex-shrink-0" />
                            <span className="text-[10px] text-green-700 truncate">{input.providedFilename}</span>
                            <button
                              onClick={() => onRemoveAttachment?.(input.id)}
                              className="flex-shrink-0 ml-0.5 text-neutral-400 hover:text-red-500 transition-colors"
                              title="Remove attachment"
                            >
                              <XMarkIcon className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Right: badge + attach button */}
                      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 ${
                          isProvided ? 'text-green-700 bg-green-100' : 'text-blue-600 bg-blue-100'
                        }`}>
                          {isProvided ? 'provided' : input.type.replace('_', ' ')}
                        </span>
                        {!isProvided && (
                          <button
                            onClick={() => onAttach?.(input.id)}
                            disabled={uploadingInputId === input.id}
                            className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                          >
                            {uploadingInputId === input.id ? (
                              <>
                                <span className="w-2.5 h-2.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                                Attaching…
                              </>
                            ) : (
                              <>
                                <PaperClipIcon className="w-2.5 h-2.5" />
                                Attach
                              </>
                            )}
                          </button>
                        )}
                        {!isProvided && (
                          <span className="text-[9px] text-neutral-400 leading-tight text-right">
                            {ATTACH_HINT}
                          </span>
                        )}
                      </div>
                    </div>
                    {attachErrorInputId === input.id && attachErrorMsg && (
                      <p className="mt-1.5 text-[10px] text-red-500">{attachErrorMsg}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Steps */}
        {plan.steps && plan.steps.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
              Steps ({plan.steps.length})
            </p>
            <div className="space-y-1.5">
              {plan.steps.map((step) => (
                <div
                  key={step.number}
                  className={`flex items-start gap-2.5 p-3 border ${
                    isGenerating
                      ? 'bg-indigo-50 border-indigo-100'
                      : 'bg-neutral-50 border-neutral-100'
                  }`}
                >
                  <div className={`flex-shrink-0 w-5 h-5 text-[10px] font-bold flex items-center justify-center mt-0.5 ${
                    isGenerating ? 'bg-indigo-200 text-indigo-700' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {isGenerating ? (
                      <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                    ) : (
                      step.number
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-neutral-900">{step.action}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {step.skill && (
                        <span className="text-[10px] text-neutral-500 bg-neutral-200 px-1.5 py-0.5">
                          {step.skill.replace('_', ' ')}
                        </span>
                      )}
                      {step.toolsNeeded?.map((t) => (
                        <span key={t} className="text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outputs */}
        {plan.outputs && plan.outputs.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">
              Expected outputs
            </p>
            <div className="space-y-1.5">
              {plan.outputs.map((output, idx) => {
                const rawOutputType = (output as any).deliverableType;
                const validTypes = new Set(['spreadsheet', 'presentation', 'email', 'document', 'report', 'analysis']);
                const outputType = (rawOutputType && validTypes.has(rawOutputType) ? rawOutputType : null)
                  ?? generatorStepTypes[idx]
                  ?? (plan.deliverable_types as string[] | undefined)?.[idx]
                  ?? plan.deliverable_type;
                const OutputIcon = getDeliverableIcon(outputType);
                const fileExt = outputType === 'presentation' ? '.pptx' : outputType === 'spreadsheet' ? '.xlsx' : outputType === 'email' ? 'Email' : '.docx';
                return (
                  <div
                    key={output.id}
                    className="flex items-start gap-2.5 p-3 bg-neutral-50 border border-neutral-200"
                  >
                    <OutputIcon className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-neutral-900">{output.name}</p>
                      <p className="text-[11px] text-neutral-600 mt-0.5">{output.description}</p>
                      <span className="text-[10px] text-neutral-500 bg-neutral-200 px-1.5 py-0.5 mt-1 inline-block">
                        {fileExt}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {workMode === 'planning' && threadId && (
        <div className="p-4 border-t border-neutral-100 space-y-2">
          {(() => {
            // Use all declared output types (from steps or deliverable_types) for button label
            const allOutputTypes: string[] = generatorStepTypes.length > 0
              ? generatorStepTypes
              : Array.isArray(plan.deliverable_types) && plan.deliverable_types.length > 0
                ? plan.deliverable_types as string[]
                : [plan.deliverable_type];
            const isMulti = allOutputTypes.length > 1;
            const generateLabel = isMulti
              ? `Generate ${allOutputTypes.join(' + ')}`
              : `Generate ${allOutputTypes[0] ?? plan.deliverable_type}`;
            const newVersionLabel = isMulti ? 'Generate new versions' : 'Generate new version';
            return !artifact ? (
              /* First generation */
              <button
                onClick={() => onGenerate(threadId)}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <SparklesIcon className="w-4 h-4" />
                {generateLabel}
              </button>
            ) : !isDocumentStale ? (
              /* Document is current — just view it */
              <button
                onClick={onViewDocument}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <DocumentTextIcon className="w-4 h-4" />
                View document
              </button>
            ) : (
              /* Plan is stale — generate new version (appends, not destructive) */
              <button
                onClick={() => onGenerate(threadId)}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <SparklesIcon className="w-4 h-4" />
                {newVersionLabel}
              </button>
            );
          })()}

          {/* Save / Update workflow — secondary action */}
          {savedWorkflowId ? (
            <button
              onClick={onUpdateWorkflow}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-700 py-1 transition-colors"
            >
              <BookmarkIcon className="w-3 h-3" />
              Update saved workflow
            </button>
          ) : showSaveInput ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={saveWorkflowName}
                onChange={(e) => onSaveWorkflowNameChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && saveWorkflowName?.trim()) onSaveWorkflowConfirm?.();
                  if (e.key === 'Escape') onCancelSave?.();
                }}
                placeholder="Name this workflow…"
                autoFocus
                className="flex-1 text-[12px] border border-neutral-300 focus:border-indigo-400 focus:outline-none px-2 py-1.5 bg-white"
              />
              <button
                onClick={onSaveWorkflowConfirm}
                disabled={!saveWorkflowName?.trim() || isSavingWorkflow}
                className="text-[12px] text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 disabled:opacity-40 transition-colors"
              >
                {isSavingWorkflow ? '…' : 'Save'}
              </button>
              <button
                onClick={onCancelSave}
                className="text-neutral-400 hover:text-neutral-600 p-1"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onSaveWorkflow}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-700 py-1 transition-colors"
            >
              <BookmarkIcon className="w-3 h-3" />
              Save workflow
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Artifact Preview Components ──────────────────────────────────────────────

function DocPreview({ content }: { content: DocContent }) {
  return (
    <div className="max-w-2xl mx-auto bg-white shadow-sm border border-neutral-200 px-12 py-10 min-h-full">
      <h1 className="text-[22px] font-bold text-neutral-900 leading-tight mb-1">
        {content.title}
      </h1>
      {content.subtitle && (
        <p className="text-[13px] text-neutral-500 mb-8">{content.subtitle}</p>
      )}
      {!content.subtitle && <div className="mb-8" />}
      {(content.sections ?? []).map((section, i) => (
        <div key={i} className={section.level === 1 ? 'mt-8 first:mt-0' : 'mt-5'}>
          {section.level === 1 ? (
            <h2 className="text-[15px] font-bold text-neutral-900 mb-3 pb-1.5 border-b border-neutral-100">
              {section.heading}
            </h2>
          ) : (
            <h3 className="text-[13px] font-semibold text-neutral-800 mb-2">
              {section.heading}
            </h3>
          )}
          <div className="space-y-3">
            {(section.paragraphs ?? []).map((para, j) => (
              <p key={j} className="text-[13px] text-neutral-700 leading-relaxed">
                {para}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PptxPreview({ content }: { content: PptxContent }) {
  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {(content.slides ?? []).map((slide, i) => (
        <div
          key={i}
          className={`p-4 border ${slide.layout === 'title' ? 'bg-indigo-50 border-indigo-100' : 'bg-white border-neutral-200'}`}
        >
          <p className="text-[14px] font-bold text-neutral-900 mb-2">{slide.title}</p>
          {slide.bullets?.map((b, j) => (
            <p key={j} className="text-[12px] text-neutral-700 flex gap-2">
              <span className="text-neutral-400">·</span>{b}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function XlsxPreview({ content }: { content: XlsxContent }) {
  const sheet = (content.sheets ?? [])[0];
  if (!sheet) return null;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr>
              {sheet.headers.map((h, i) => (
                <th key={i} className="text-left p-2 bg-neutral-100 border border-neutral-200 font-semibold text-neutral-700">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-neutral-50'}>
                {row.map((cell, j) => (
                  <td key={j} className="p-2 border border-neutral-100 text-neutral-700">
                    {cell ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {content.sheets.length > 1 && (
        <p className="text-[11px] text-neutral-400 mt-2">
          + {content.sheets.length - 1} more sheet(s) in downloaded file
        </p>
      )}
    </div>
  );
}

// ─── Artifact Tab Strip ───────────────────────────────────────────────────────

function ArtifactTabStrip({
  artifacts,
  selectedArtifactId,
  onSelect,
  onDelete,
}: {
  artifacts: DocumentArtifact[];
  selectedArtifactId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (artifacts.length <= 1) return null;

  return (
    <div className="flex items-center border-b border-neutral-200 bg-white flex-shrink-0 overflow-x-auto">
      {artifacts.map((a, i) => {
        const isActive = a.id
          ? a.id === selectedArtifactId
          : i === artifacts.length - 1 && !selectedArtifactId;
        const Icon = getDeliverableIcon(a.type);
        return (
          <div
            key={a.id ?? i}
            className={`flex items-center gap-1.5 px-3 py-2 border-r border-neutral-200 flex-shrink-0 transition-colors ${
              isActive ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'
            }`}
          >
            <button
              onClick={() => a.id && onSelect(a.id)}
              className={`flex items-center gap-1.5 min-w-0 ${isActive ? 'text-indigo-700' : 'text-neutral-600'}`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-[11px] font-medium truncate max-w-[100px]">{a.title}</span>
              <span className="text-[9px] text-neutral-400 flex-shrink-0">
                {new Date(a.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </button>
            {confirmDeleteId === a.id ? (
              <div className="flex items-center gap-1 ml-1 flex-shrink-0">
                <button
                  onClick={() => { if (a.id) { onDelete(a.id); } setConfirmDeleteId(null); }}
                  className="text-[9px] text-red-600 hover:text-red-800 font-medium"
                >
                  Remove
                </button>
                <span className="text-[9px] text-neutral-300">/</span>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-[9px] text-neutral-500 hover:text-neutral-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); if (a.id) setConfirmDeleteId(a.id); }}
                className="ml-1 text-neutral-300 hover:text-neutral-500 transition-colors flex-shrink-0"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Document Panel ───────────────────────────────────────────────────────────

function EmailPreviewPanel({
  artifact,
  allArtifacts,
  threadId,
  onSent,
}: {
  artifact: DocumentArtifact;
  allArtifacts: DocumentArtifact[];
  threadId: string;
  onSent?: (artifactId: string, sentAt: string, sentTo: string) => void;
}) {
  const emailContent = artifact.content as EmailContent | undefined;
  const [emailTo, setEmailTo] = useState(emailContent?.to ?? '');
  const [emailCc, setEmailCc] = useState(emailContent?.cc ?? '');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [connections, setConnections] = useState<{ id: string; provider: string; email?: string }[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  // Sent state — initialised from persisted artifact data so it survives page reload
  const [localSentAt, setLocalSentAt] = useState<string | null>(artifact.sent_at ?? null);
  const [localSentTo, setLocalSentTo] = useState<string | null>(artifact.sent_to ?? null);

  useEffect(() => {
    fetch('/api/connections')
      .then((r) => r.json())
      .then((data) => {
        const conns = data.connections ?? [];
        setConnections(conns);
        if (conns.length > 0) setSelectedConnectionId(conns[0].id);
      })
      .catch(() => {});
  }, []);

  const nonEmailArtifacts = allArtifacts.filter((a) => a.type !== 'email' && a.storage_path);

  const handleSend = async () => {
    if (!emailTo.trim()) {
      setSendError('Please enter a recipient');
      setTimeout(() => setSendError(null), 5000);
      return;
    }
    setIsSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/work/threads/${threadId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId: artifact.id,
          to: emailTo.trim(),
          cc: emailCc.trim() || undefined,
          attachArtifactIds: selectedAttachmentIds,
          connectionId: selectedConnectionId || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send email');
      }
      const data = await res.json();
      const sentAt = data.sentAt as string;
      const sentTo = data.sentTo as string;
      setLocalSentAt(sentAt);
      setLocalSentTo(sentTo);
      if (artifact.id) onSent?.(artifact.id, sentAt, sentTo);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send email');
      setTimeout(() => setSendError(null), 5000);
    } finally {
      setIsSending(false);
    }
  };

  const toggleAttachment = (id: string) => {
    setSelectedAttachmentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto bg-white shadow-sm border border-neutral-200">
        {/* Header fields */}
        <div className="divide-y divide-neutral-100 border-b border-neutral-200">
          <div className="flex items-center px-5 py-2.5 gap-3">
            <span className="text-[11px] text-neutral-400 w-10 flex-shrink-0">From</span>
            {connections.length > 1 ? (
              <select
                value={selectedConnectionId}
                onChange={(e) => setSelectedConnectionId(e.target.value)}
                className="flex-1 text-[13px] text-neutral-700 focus:outline-none bg-transparent"
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.email ?? c.provider}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[13px] text-neutral-500">
                {connections[0]?.email ?? connections[0]?.provider ?? '—'}
              </span>
            )}
          </div>
          <div className="flex items-center px-5 py-2.5 gap-3">
            <label htmlFor="email-to" className="text-[11px] text-neutral-400 w-10 flex-shrink-0">To</label>
            <input
              id="email-to"
              type="text"
              value={emailTo}
              onChange={(e) => { setEmailTo(e.target.value); }}
              placeholder="recipient@example.com"
              className="flex-1 text-[13px] text-neutral-900 placeholder-neutral-300 focus:outline-none"
            />
          </div>
          <div className="flex items-center px-5 py-2.5 gap-3">
            <label htmlFor="email-cc" className="text-[11px] text-neutral-400 w-10 flex-shrink-0">CC</label>
            <input
              id="email-cc"
              type="text"
              value={emailCc}
              onChange={(e) => setEmailCc(e.target.value)}
              placeholder="optional"
              className="flex-1 text-[13px] text-neutral-900 placeholder-neutral-300 focus:outline-none"
            />
          </div>
          <div className="flex items-center px-5 py-2.5 gap-3">
            <span className="text-[11px] text-neutral-400 w-10 flex-shrink-0">Subj</span>
            <span className="text-[13px] text-neutral-700 font-medium">{emailContent?.subject}</span>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <pre className="text-[13px] text-neutral-800 whitespace-pre-wrap font-sans leading-relaxed">
            {emailContent?.body}
          </pre>
        </div>

        {/* Attachments */}
        {nonEmailArtifacts.length > 0 && (
          <div className="px-5 py-4 border-t border-neutral-100">
            <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2.5">Attach files</p>
            <div className="space-y-1.5">
              {nonEmailArtifacts.map((a) => {
                const ext = a.type === 'presentation' ? 'pptx' : a.type === 'spreadsheet' ? 'xlsx' : 'docx';
                const checked = selectedAttachmentIds.includes(a.id ?? '');
                return (
                  <label
                    key={a.id}
                    className="flex items-center gap-2.5 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => a.id && toggleAttachment(a.id)}
                      className="w-3.5 h-3.5 accent-indigo-600"
                    />
                    <span className="text-[12px] text-neutral-600 group-hover:text-neutral-900 transition-colors">
                      {(() => {
                        const label = a.title ?? `document`;
                        const short = label.length > 32 ? label.slice(0, 32).trimEnd() + '…' : label;
                        return `${short}.${ext}`;
                      })()}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Send bar */}
        <div className="px-5 py-3.5 border-t border-neutral-100 flex items-center justify-between gap-3">
          <div>
            {sendError && <p className="text-[11px] text-red-600">{sendError}</p>}
            {localSentAt && !sendError && (
              <p className="text-[11px] text-green-600 font-medium">
                Sent {new Date(localSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {localSentTo ? ` → ${localSentTo}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={isSending}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold transition-colors ${
              localSentAt
                ? 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
            }`}
          >
            {isSending ? (
              <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : (
              <EnvelopeIcon className="w-3.5 h-3.5" />
            )}
            {isSending ? 'Sending…' : localSentAt ? 'Send again' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocumentPanel({
  artifact,
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
  onDeleteArtifact,
  onDownload,
  onRegenerate,
  isDownloading,
  isEditing,
  threadId,
  onArtifactSent,
}: {
  artifact: DocumentArtifact;
  artifacts: DocumentArtifact[];
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  onDeleteArtifact: (id: string) => void;
  onDownload: () => void;
  onRegenerate: () => void;
  isDownloading: boolean;
  isEditing: boolean;
  threadId: string;
  onArtifactSent?: (artifactId: string, sentAt: string, sentTo: string) => void;
}) {
  const isEmail = artifact.type === 'email';

  return (
    <div className="flex-1 flex flex-col border-r border-neutral-200 bg-neutral-100 min-w-0">
      {/* Artifact tab strip — shown when multiple versions exist */}
      <ArtifactTabStrip
        artifacts={artifacts}
        selectedArtifactId={selectedArtifactId}
        onSelect={onSelectArtifact}
        onDelete={onDeleteArtifact}
      />

      {/* Editing banner */}
      {isEditing && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100 flex-shrink-0">
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
          <p className="text-[12px] text-indigo-700 font-medium">Updating document…</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <DocumentTextIcon className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <span className="text-[12px] font-medium text-neutral-700 truncate">{artifact.title}</span>
          <span className="text-[10px] text-neutral-400 flex-shrink-0">
            · {new Date(artifact.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onRegenerate}
            className="text-[11px] text-neutral-500 hover:text-neutral-700 px-2 py-1 hover:bg-neutral-100 transition-colors"
          >
            Revise plan
          </button>
          {!isEmail && (
            <button
              onClick={onDownload}
              disabled={isDownloading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              {isDownloading ? 'Downloading…' : `Download .${artifact.type === 'presentation' ? 'pptx' : artifact.type === 'spreadsheet' ? 'xlsx' : 'docx'}`}
            </button>
          )}
        </div>
      </div>

      {/* Document preview / Email preview */}
      {isEmail ? (
        <EmailPreviewPanel
          artifact={artifact}
          allArtifacts={artifacts}
          threadId={threadId}
          onSent={onArtifactSent}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {artifact.content ? (
            artifact.type === 'presentation'
              ? <PptxPreview content={artifact.content as PptxContent} />
              : artifact.type === 'spreadsheet'
              ? <XlsxPreview content={artifact.content as XlsxContent} />
              : <DocPreview content={artifact.content as DocContent} />
          ) : (
            /* Fallback for artifacts without content */
            <div className="max-w-2xl mx-auto bg-white shadow-sm border border-neutral-200 px-12 py-10 flex items-center justify-center min-h-64">
              <div className="text-center">
                <CheckCircleIcon className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-[13px] text-neutral-600">Document ready</p>
                <p className="text-[11px] text-neutral-400 mt-1">Regenerate to see a preview</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WorkPageClient({
  userEmail,
  userFullName,
  hasCompletedOnboarding,
  blueprints,
  initialThreads,
  initialActiveThreadId,
  initialView,
  initialSavedWorkflows,
}: WorkPageClientProps) {
  const [threads, setThreads] = useState<WorkThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [planJustUpdated, setPlanJustUpdated] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [entryInput, setEntryInput] = useState('');
  const [entryFiles, setEntryFiles] = useState<File[]>([]);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(!hasCompletedOnboarding);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Saved workflows state
  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>(initialSavedWorkflows);
  const [workflowsExpanded, setWorkflowsExpanded] = useState(true);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveWorkflowName, setSaveWorkflowName] = useState('');
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);
  const [confirmDeleteWorkflowId, setConfirmDeleteWorkflowId] = useState<string | null>(null);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [editingWorkflowName, setEditingWorkflowName] = useState('');

  // Document states — initialize directly from server data when ?view=document to avoid flash
  const initialThread = initialActiveThreadId
    ? initialThreads.find((t) => t.id === initialActiveThreadId) ?? null
    : null;
  const initialArtifacts = (() => {
    if (!initialThread) return [];
    const arr = initialThread.artifacts ?? [];
    if (arr.length > 0) return arr;
    if (initialThread.artifact) return [initialThread.artifact];
    return [];
  })();
  const [workMode, setWorkMode] = useState<WorkMode>(
    initialView === 'document' && initialArtifacts.length > 0 ? 'document' : 'planning'
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    initialView === 'document' && initialArtifacts.length > 0
      ? (initialArtifacts[initialArtifacts.length - 1].id ?? null)
      : null
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [artifactInput, setArtifactInput] = useState('');
  const [docChatMode, setDocChatMode] = useState<'ask' | 'edit'>('ask');
  const [isEditingArtifact, setIsEditingArtifact] = useState(false);
  const [isRebuildingDocument, setIsRebuildingDocument] = useState(false);
  const [editStreamText, setEditStreamText] = useState('');
  const [uploadingInputId, setUploadingInputId] = useState<string | null>(null);
  const [attachErrorInputId, setAttachErrorInputId] = useState<string | null>(null);
  const [attachErrorMsg, setAttachErrorMsg] = useState<string | null>(null);
  const [entryFileError, setEntryFileError] = useState<string | null>(null);

  const planUpdatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipLoadRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const editTitleInputRef = useRef<HTMLInputElement>(null);
  const artifactInputRef = useRef<HTMLTextAreaElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // Computed artifact list: prefer artifacts array, fall back to singular artifact (legacy)
  const activeArtifacts: DocumentArtifact[] = (() => {
    if (!activeThread) return [];
    const arr = activeThread.artifacts ?? [];
    if (arr.length > 0) return arr;
    if (activeThread.artifact) return [activeThread.artifact];
    return [];
  })();

  // Selected artifact: find by id, fall back to latest
  const selectedArtifact: DocumentArtifact | null =
    activeArtifacts.find((a) => a.id === selectedArtifactId)
    ?? activeArtifacts[activeArtifacts.length - 1]
    ?? null;

  // True when the plan/attachments have been modified after the last generation or edit.
  // Uses the LATEST artifact (not selected) so the stale banner reflects new ungenerated changes.
  const latestArtifact = activeArtifacts[activeArtifacts.length - 1] ?? null;
  const isDocumentStale = !!(
    latestArtifact &&
    activeThread?.updated_at &&
    new Date(activeThread.updated_at).getTime() - new Date(latestArtifact.generated_at).getTime() > 5000
  );

  useEffect(() => {
    if (initialActiveThreadId) {
      setActiveThreadId(initialActiveThreadId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, editStreamText]);

  const loadThread = useCallback(async (threadId: string) => {
    setIsLoadingThread(true);
    setMessages([]);
    setStreamingText('');
    setEditStreamText('');
    setWorkMode('planning');
    try {
      const res = await fetch(`/api/work/threads/${threadId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      if (data.thread) {
        const loadedArtifacts: DocumentArtifact[] = (() => {
          const arr = (data.thread.artifacts ?? []) as DocumentArtifact[];
          if (arr.length > 0) return arr;
          if (data.thread.artifact) return [data.thread.artifact as DocumentArtifact];
          return [];
        })();
        setThreads((prev) => {
          const exists = prev.some((t) => t.id === threadId);
          if (exists) {
            return prev.map((t) => t.id === threadId ? {
              ...t,
              plan: data.thread.plan ?? t.plan,
              artifact: data.thread.artifact ?? null,
              artifacts: (data.thread.artifacts ?? []) as DocumentArtifact[],
            } : t);
          }
          // Thread not in list (e.g. auto-generated, navigated to directly)
          return [...prev, {
            id: threadId,
            title: data.thread.title,
            plan: data.thread.plan ?? null,
            artifact: data.thread.artifact ?? null,
            artifacts: (data.thread.artifacts ?? []) as DocumentArtifact[],
            status: data.thread.status,
            created_at: data.thread.created_at,
            updated_at: data.thread.updated_at,
            auto_generated: data.thread.auto_generated ?? false,
          }];
        });
        if (loadedArtifacts.length > 0) {
          const latest = loadedArtifacts[loadedArtifacts.length - 1];
          setSelectedArtifactId(latest.id ?? null);
          if (initialView === 'document') {
            setWorkMode('document');
          }
        } else {
          setSelectedArtifactId(null);
        }
      }
    } finally {
      setIsLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (activeThreadId) {
      if (skipLoadRef.current === activeThreadId) {
        skipLoadRef.current = null;
        return;
      }
      loadThread(activeThreadId);
    } else {
      // Reset when going back to entry view
      setWorkMode('planning');
      setSelectedArtifactId(null);
    }
  }, [activeThreadId, loadThread]);

  const sendMessage = useCallback(async (content: string, threadId: string) => {
    if (!content.trim() || isStreaming) return;

    const tempUserMsg: WorkMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setChatInput('');
    setIsStreaming(true);
    setStreamingText('');

    try {
      const res = await fetch(`/api/work/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      });

      if (!res.ok || !res.body) throw new Error('Stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const sepIdx = buffer.indexOf(PLAN_SEPARATOR);
        const display = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer;
        setStreamingText(display);
      }

      const sepIdx = buffer.indexOf(PLAN_SEPARATOR);
      const finalText = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer.trim();
      const planRaw = sepIdx !== -1 ? buffer.slice(sepIdx + PLAN_SEPARATOR.length).trim() : null;

      const aiMsg: WorkMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: finalText,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setStreamingText('');

      if (planRaw && planRaw !== 'null') {
        try {
          const plan = JSON.parse(planRaw) as ExecutionPlan;
          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId
                ? { ...t, plan, updated_at: new Date().toISOString() }
                : t
            )
          );
          if (planUpdatedTimerRef.current) clearTimeout(planUpdatedTimerRef.current);
          setPlanJustUpdated(true);
          planUpdatedTimerRef.current = setTimeout(() => setPlanJustUpdated(false), 2000);
        } catch {
          // plan parse failed
        }
      }

      setThreads((prev) => {
        const thread = prev.find((t) => t.id === threadId);
        if (!thread) return prev;
        return [
          { ...thread, updated_at: new Date().toISOString() },
          ...prev.filter((t) => t.id !== threadId),
        ];
      });
    } catch (err) {
      console.error('Stream error:', err);
      setStreamingText('');
    } finally {
      setIsStreaming(false);
      chatInputRef.current?.focus();
    }
  }, [isStreaming]);

  const generateDocument = useCallback(async (threadId: string) => {
    setWorkMode('generating');
    try {
      const res = await fetch(`/api/work/threads/${threadId}/generate`, { method: 'POST' });
      if (!res.ok) {
        setWorkMode('planning');
        return;
      }
      const data = await res.json();
      const newArtifacts: DocumentArtifact[] = data.artifacts ?? (data.artifact ? [data.artifact] : []);
      const latestArtifact = newArtifacts[newArtifacts.length - 1] ?? null;
      setSelectedArtifactId(latestArtifact?.id ?? null);
      setWorkMode('document');
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t;
          const existingArtifacts = t.artifacts ?? [];
          // Replace existing artifacts of the same type with the newly generated ones;
          // keep types that weren't regenerated this time
          const regeneratedTypes = new Set(newArtifacts.map((a) => a.type));
          const kept = existingArtifacts.filter((a) => !regeneratedTypes.has(a.type));
          return {
            ...t,
            artifact: latestArtifact ?? t.artifact,
            artifacts: [...kept, ...newArtifacts],
            updated_at: latestArtifact?.generated_at ?? t.updated_at,
          };
        })
      );
    } catch (err) {
      console.error('Generate error:', err);
      setWorkMode('planning');
    }
  }, []);

  const editArtifact = useCallback(async (instruction: string, threadId: string, artifactId?: string) => {
    if (!instruction.trim() || isEditingArtifact) return;

    const isEditMode = docChatMode === 'edit';

    // Add user message immediately before the fetch
    const tempUserMsg: WorkMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: instruction.trim(),
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsEditingArtifact(true);
    if (isEditMode) setIsRebuildingDocument(true);
    setArtifactInput('');
    setEditStreamText('');

    try {
      const res = await fetch(`/api/work/threads/${threadId}/edit-artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction.trim(), mode: docChatMode, artifactId }),
      });

      if (!res.ok || !res.body) throw new Error('Edit failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const sepIdx = buffer.indexOf(ARTIFACT_SEPARATOR);
        const display = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer;
        setEditStreamText(display);
      }

      // Extract updated artifact from buffer
      const sepIdx = buffer.indexOf(ARTIFACT_SEPARATOR);
      const finalText = sepIdx !== -1 ? buffer.slice(0, sepIdx).trim() : buffer.trim();
      const artifactRaw = sepIdx !== -1 ? buffer.slice(sepIdx + ARTIFACT_SEPARATOR.length).trim() : null;

      if (artifactRaw && artifactRaw !== 'null') {
        try {
          const firstBrace = artifactRaw.indexOf('{');
          const lastBrace = artifactRaw.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            const updatedArtifact = JSON.parse(artifactRaw.slice(firstBrace, lastBrace + 1)) as DocumentArtifact;
            setThreads((prev) =>
              prev.map((t) => {
                if (t.id !== threadId) return t;
                const arr = t.artifacts ?? [];
                const updatedArray = arr.map((a) => a.id === updatedArtifact.id ? updatedArtifact : a);
                return {
                  ...t,
                  artifact: updatedArtifact,
                  artifacts: updatedArray,
                  updated_at: updatedArtifact.generated_at,
                };
              })
            );
          }
        } catch {
          // artifact parse failed
        }
      }

      // Add assistant response (user message was already added optimistically)
      const aiMsg: WorkMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: finalText,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setEditStreamText('');
    } catch (err) {
      console.error('Edit artifact error:', err);
      setEditStreamText('');
    } finally {
      setIsEditingArtifact(false);
      setIsRebuildingDocument(false);
      artifactInputRef.current?.focus();
    }
  }, [isEditingArtifact, docChatMode]);

  const showPlanAttachError = (inputId: string, msg: string) => {
    setAttachErrorInputId(inputId);
    setAttachErrorMsg(msg);
    setTimeout(() => { setAttachErrorInputId(null); setAttachErrorMsg(null); }, 5000);
  };

  const handleAttach = useCallback(async (inputId: string, threadId: string) => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = ATTACH_ACCEPT;
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files || []);
      if (files.length === 0) return;

      const { valid, errorMsg } = validateAttachFiles(files);
      if (errorMsg) showPlanAttachError(inputId, errorMsg);
      if (valid.length === 0) return;

      setUploadingInputId(inputId);
      try {
        // Step 1: Get presigned upload URLs (no file bytes sent to serverless fn)
        const presignRes = await fetch(`/api/work/threads/${threadId}/attach/presign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: valid.map(f => ({ filename: f.name, mimeType: f.type, size: f.size })),
            inputId,
          }),
        });
        if (!presignRes.ok) {
          const err = await presignRes.json();
          showPlanAttachError(inputId, err.error || 'Failed to prepare upload');
          return;
        }
        const { uploads } = await presignRes.json() as {
          uploads: Array<{ storagePath: string; signedUrl: string; filename: string; mimeType: string; size: number }>;
        };

        // Step 2: Upload files directly to Supabase Storage (bypasses Vercel size limit)
        await Promise.all(
          uploads.map((upload, i) =>
            fetch(upload.signedUrl, {
              method: 'PUT',
              headers: { 'Content-Type': valid[i].type || 'application/octet-stream' },
              body: valid[i],
            })
          )
        );

        // Step 3: Confirm — server downloads, extracts text, updates plan
        const confirmRes = await fetch(`/api/work/threads/${threadId}/attach/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploads, inputId }),
        });
        if (!confirmRes.ok) {
          const err = await confirmRes.json();
          showPlanAttachError(inputId, err.error || 'Failed to attach file');
          return;
        }
        const { plan: updatedPlan } = await confirmRes.json();
        setThreads((prev) =>
          prev.map((t) => t.id === threadId ? { ...t, plan: updatedPlan } : t)
        );
      } catch {
        showPlanAttachError(inputId, 'Failed to attach file');
      } finally {
        setUploadingInputId(null);
      }
    };
    fileInput.click();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemoveAttachment = useCallback(async (inputId: string, threadId: string) => {
    try {
      const res = await fetch(
        `/api/work/threads/${threadId}/attach?inputId=${encodeURIComponent(inputId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) return;
      const { plan: updatedPlan } = await res.json();
      setThreads((prev) =>
        prev.map((t) => t.id === threadId ? { ...t, plan: updatedPlan } : t)
      );
    } catch {
      console.error('Failed to remove attachment');
    }
  }, []);

  const downloadDocument = useCallback(async (threadId: string, artifactToDownload: DocumentArtifact) => {
    setIsDownloading(true);
    try {
      const url = artifactToDownload.id
        ? `/api/work/threads/${threadId}/download?artifactId=${artifactToDownload.id}`
        : `/api/work/threads/${threadId}/download`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      const ext = artifactToDownload.type === 'presentation' ? 'pptx' : artifactToDownload.type === 'spreadsheet' ? 'xlsx' : 'docx';
      a.download = `${artifactToDownload.title ?? 'document'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  }, []);

  const handleDeleteArtifact = useCallback(async (artifactId: string, threadId: string) => {
    try {
      const res = await fetch(`/api/work/threads/${threadId}/artifacts/${artifactId}`, { method: 'DELETE' });
      if (!res.ok) return;
      const { artifacts: remaining } = await res.json() as { artifacts: DocumentArtifact[] };
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t;
          const newLatest = remaining.length > 0 ? remaining[remaining.length - 1] : null;
          return { ...t, artifacts: remaining, artifact: newLatest };
        })
      );
      // Auto-switch to latest remaining (or null if none)
      const newLatest = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      setSelectedArtifactId(newLatest?.id ?? null);
      if (remaining.length === 0) setWorkMode('planning');
    } catch {
      console.error('Failed to delete artifact');
    }
  }, []);

  const startThread = useCallback(async (description: string) => {
    if (!description.trim() || isCreatingThread) return;

    const title = description.trim().slice(0, 80);
    setIsCreatingThread(true);

    try {
      const res = await fetch('/api/work/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });

      if (!res.ok) throw new Error('Failed to create thread');
      const data = await res.json();
      const newThread: WorkThread = data.thread;

      setThreads((prev) => [newThread, ...prev]);
      skipLoadRef.current = newThread.id;
      setActiveThreadId(newThread.id);
      setMessages([]);
      setEntryInput('');
      setWorkMode('planning');
      setSelectedArtifactId(null);

      // Upload any attached files, then enrich the initial prompt with their metadata
      let enrichedPrompt = description;
      if (entryFiles.length > 0) {
        // Presign → direct upload → confirm (same three-step flow as plan-mode attach)
        // All files share one inputId so the plan gets one grouped input, not one per file.
        try {
          const presignRes = await fetch(`/api/work/threads/${newThread.id}/attach/presign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              files: entryFiles.map(f => ({ filename: f.name, mimeType: f.type, size: f.size })),
              inputId: 'entry-files',
            }),
          });
          if (presignRes.ok) {
            const { uploads } = await presignRes.json() as {
              uploads: Array<{ storagePath: string; signedUrl: string; filename: string; mimeType: string; size: number }>;
            };
            await Promise.all(
              uploads.map((upload, i) =>
                fetch(upload.signedUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': entryFiles[i].type || 'application/octet-stream' },
                  body: entryFiles[i],
                })
              )
            );
            await fetch(`/api/work/threads/${newThread.id}/attach/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uploads, inputId: 'entry-files' }),
            });
          }
        } catch {
          // non-fatal — thread still created, prompt still sent
        }
        const fileMeta = entryFiles
          .map((f) => {
            const typeLabel = f.type.includes('pdf') ? 'PDF'
              : f.type.includes('wordprocessingml') ? 'Word document'
              : f.type === 'text/plain' ? 'text file'
              : f.type.startsWith('image/') ? 'image'
              : 'file';
            return `- ${f.name} (${typeLabel}, ${Math.round(f.size / 1024)} KB)`;
          })
          .join('\n');
        enrichedPrompt = `${description}\n\nAttached files (already provided — include ALL of these together as a single input with status "provided" in the plan):\n${fileMeta}`;
        setEntryFiles([]);
      }

      setIsCreatingThread(false);
      sendMessage(enrichedPrompt, newThread.id);
    } catch (err) {
      console.error('Failed to start thread:', err);
      setIsCreatingThread(false);
    }
  }, [isCreatingThread, sendMessage, entryFiles]);

  const runSavedWorkflow = useCallback(async (workflowId: string) => {
    if (isCreatingThread) return;
    setIsCreatingThread(true);
    try {
      const res = await fetch(`/api/work/saved-workflows/${workflowId}/run`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to run workflow');
      const { threadId, thread, messages: seeded } = await res.json();
      setThreads((prev) => [thread, ...prev]);
      setMessages(seeded || []);
      skipLoadRef.current = threadId;
      setActiveThreadId(threadId);
      setWorkMode('planning');
      setSelectedArtifactId(null);
    } catch (err) {
      console.error('Failed to run saved workflow:', err);
    } finally {
      setIsCreatingThread(false);
    }
  }, [isCreatingThread]);

  const saveWorkflow = useCallback(async (name: string) => {
    if (!activeThread || !name.trim()) return;
    // Use the plan's deliverable_description — it's the AI's synthesis of all chat refinements.
    // Falls back to the first user message if no plan exists yet.
    const prompt = activeThread.plan?.deliverable_description
      ?? messages.find((m) => m.role === 'user')?.content
      ?? '';
    if (!prompt) return;
    const deliverableTypes = activeThread.plan?.deliverable_types as string[] | undefined
      ?? (activeThread.plan?.deliverable_type ? [activeThread.plan.deliverable_type] : []);
    setIsSavingWorkflow(true);
    try {
      const res = await fetch('/api/work/saved-workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          prompt,
          deliverable_types: deliverableTypes,
          created_from_thread_id: activeThread.id,
        }),
      });
      if (!res.ok) throw new Error('Failed to save workflow');
      const { savedWorkflow } = await res.json();
      setSavedWorkflows((prev) => [savedWorkflow, ...prev]);
      setShowSaveInput(false);
      setSaveWorkflowName('');
    } catch (err) {
      console.error('Failed to save workflow:', err);
    } finally {
      setIsSavingWorkflow(false);
    }
  }, [activeThread, messages]);

  const updateWorkflowTemplate = useCallback(async () => {
    if (!activeThread?.saved_workflow_id) return;
    const prompt = activeThread.plan?.deliverable_description
      ?? messages.find((m) => m.role === 'user')?.content
      ?? '';
    if (!prompt) return;
    try {
      await fetch(`/api/work/saved-workflows/${activeThread.saved_workflow_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      // Update local state
      setSavedWorkflows((prev) =>
        prev.map((wf) =>
          wf.id === activeThread.saved_workflow_id ? { ...wf, prompt } : wf
        )
      );
    } catch (err) {
      console.error('Failed to update workflow template:', err);
    }
  }, [activeThread, messages]);

  const renameWorkflow = useCallback(async (workflowId: string, name: string) => {
    const trimmed = name.trim();
    setEditingWorkflowId(null);
    if (!trimmed) return;
    setSavedWorkflows((prev) =>
      prev.map((wf) => wf.id === workflowId ? { ...wf, name: trimmed } : wf)
    );
    try {
      await fetch(`/api/work/saved-workflows/${workflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
    } catch (err) {
      console.error('Failed to rename workflow:', err);
    }
  }, []);

  const deleteWorkflow = useCallback(async (workflowId: string) => {
    setConfirmDeleteWorkflowId(null);
    setSavedWorkflows((prev) => prev.filter((wf) => wf.id !== workflowId));
    try {
      await fetch(`/api/work/saved-workflows/${workflowId}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    }
  }, []);

  const startEditing = (thread: WorkThread) => {
    setEditingThreadId(thread.id);
    setEditingTitle(thread.title);
    setConfirmDeleteId(null);
    setTimeout(() => editTitleInputRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    setEditingThreadId(null);
    setEditingTitle('');
  };

  const handleRenameThread = async (threadId: string) => {
    const title = editingTitle.trim();
    if (!title) { cancelEditing(); return; }
    setEditingThreadId(null);
    setThreads((prev) =>
      prev.map((t) => t.id === threadId ? { ...t, title } : t)
    );
    try {
      await fetch(`/api/work/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    } catch {
      setThreads((prev) =>
        prev.map((t) => t.id === threadId ? { ...t, title: t.title } : t)
      );
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    setConfirmDeleteId(null);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setWorkMode('planning');
      setSelectedArtifactId(null);
    }
    try {
      await fetch(`/api/work/threads/${threadId}`, { method: 'DELETE' });
    } catch {
      console.error('Failed to delete thread');
    }
  };

  const handleBlueprintSelect = (blueprint: WorkBlueprint) => {
    const description = `${blueprint.name}: ${blueprint.description}`;
    startThread(description);
  };

  const handleEntrySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (entryInput.trim()) startThread(entryInput);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeThreadId && chatInput.trim()) {
      sendMessage(chatInput, activeThreadId);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeThreadId && chatInput.trim() && !isStreaming) {
        sendMessage(chatInput, activeThreadId);
      }
    }
  };

  const handleArtifactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeThreadId && artifactInput.trim()) {
      editArtifact(artifactInput, activeThreadId, selectedArtifact?.id);
    }
  };

  const handleArtifactKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeThreadId && artifactInput.trim() && !isEditingArtifact) {
        editArtifact(artifactInput, activeThreadId, selectedArtifact?.id);
      }
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <SidebarNav userEmail={userEmail} />

      {/* Thread list sidebar */}
      <div className="w-52 border-r border-neutral-200 flex flex-col flex-shrink-0 bg-white">
        <div className="p-3 border-b border-neutral-100">
          <button
            onClick={() => setActiveThreadId(null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New work
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {/* My Workflows section */}
          {savedWorkflows.length > 0 && (
            <div className="border-b border-neutral-100 pb-1">
              <button
                onClick={() => setWorkflowsExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold tracking-wide text-neutral-400 hover:text-neutral-600 uppercase"
              >
                <span>My Workflows</span>
                <ChevronDownIcon className={`w-3 h-3 transition-transform ${workflowsExpanded ? '' : '-rotate-90'}`} />
              </button>
              {workflowsExpanded && savedWorkflows.map((wf) => (
                <div key={wf.id} className="group relative flex items-center">
                  {editingWorkflowId === wf.id ? (
                    <div className="flex-1 flex items-center gap-1 px-2 py-1.5">
                      <input
                        autoFocus
                        value={editingWorkflowName}
                        onChange={(e) => setEditingWorkflowName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameWorkflow(wf.id, editingWorkflowName);
                          if (e.key === 'Escape') setEditingWorkflowId(null);
                        }}
                        onBlur={() => renameWorkflow(wf.id, editingWorkflowName)}
                        className="flex-1 min-w-0 text-[12px] text-neutral-900 border border-indigo-300 focus:outline-none focus:border-indigo-500 px-2 py-0.5 bg-white"
                      />
                    </div>
                  ) : confirmDeleteWorkflowId === wf.id ? (
                    <div className="flex-1 px-3 py-2">
                      <p className="text-[10px] text-red-600 mb-1">Delete this workflow?</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => deleteWorkflow(wf.id)}
                          className="text-[10px] font-medium text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteWorkflowId(null)}
                          className="text-[10px] text-neutral-500 hover:text-neutral-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => runSavedWorkflow(wf.id)}
                        disabled={isCreatingThread}
                        className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50 text-left disabled:opacity-50"
                      >
                        <BookmarkIcon className="w-3 h-3 text-neutral-300 flex-shrink-0" />
                        <span className="text-[12px] text-neutral-600 truncate">{wf.name}</span>
                      </button>
                      <div className="flex-shrink-0 flex items-center pr-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingWorkflowId(wf.id); setEditingWorkflowName(wf.name); setConfirmDeleteWorkflowId(null); }}
                          className="p-1 text-neutral-300 hover:text-neutral-600 transition-colors"
                          title="Rename"
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteWorkflowId(wf.id); setEditingWorkflowId(null); }}
                          className="p-1 text-neutral-300 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {threads.length === 0 ? (
            <p className="text-[11px] text-neutral-400 px-4 py-6 text-center leading-relaxed">
              Your work threads will appear here
            </p>
          ) : (
            threads.map((thread) => {
              const isActive = activeThreadId === thread.id;
              const isEditing = editingThreadId === thread.id;
              const isConfirmingDelete = confirmDeleteId === thread.id;

              return (
                <div
                  key={thread.id}
                  className={`group relative border-b border-neutral-50 ${
                    isActive ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-neutral-50'
                  } transition-colors`}
                >
                  {isEditing ? (
                    <div className="px-2 py-2 flex items-center gap-1">
                      <input
                        ref={editTitleInputRef}
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameThread(thread.id);
                          if (e.key === 'Escape') cancelEditing();
                        }}
                        className="flex-1 min-w-0 text-[12px] text-neutral-900 border border-indigo-300 focus:outline-none focus:border-indigo-500 px-2 py-1 bg-white"
                      />
                      <button
                        onClick={() => handleRenameThread(thread.id)}
                        className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800"
                      >
                        <CheckIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="flex-shrink-0 p-1 text-neutral-400 hover:text-neutral-600"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : isConfirmingDelete ? (
                    <div className="px-3 py-2.5">
                      <p className="text-[11px] text-red-600 mb-1.5">Delete this thread?</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDeleteThread(thread.id)}
                          className="text-[11px] font-medium text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] text-neutral-500 hover:text-neutral-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start">
                      <button
                        onClick={() => setActiveThreadId(thread.id)}
                        className="flex-1 min-w-0 text-left px-3 py-2.5"
                      >
                        <p className={`text-[12px] leading-snug truncate ${
                          isActive ? 'text-indigo-900 font-medium' : 'text-neutral-800'
                        }`}>
                          {thread.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-neutral-400">
                            {relativeTime(thread.updated_at)}
                          </p>
                          {(() => {
                            const arr = thread.artifacts ?? [];
                            const latest = arr.length > 0 ? arr[arr.length - 1] : thread.artifact;
                            if (!latest) return null;
                            const ext = latest.type === 'presentation' ? 'pptx' : latest.type === 'spreadsheet' ? 'xlsx' : latest.type === 'email' ? 'email' : 'docx';
                            const hasSent = arr.some((a) => a.sent_at);
                            return (
                              <>
                                {hasSent ? (
                                  <span className="text-[9px] text-green-600 bg-green-50 px-1 py-px">✓ sent</span>
                                ) : (
                                  <span className="text-[9px] text-green-600 bg-green-50 px-1 py-px">{ext}</span>
                                )}
                                {arr.length > 1 && !hasSent && (
                                  <span className="text-[9px] text-indigo-600 bg-indigo-50 px-1 py-px">{arr.length}</span>
                                )}
                              </>
                            );
                          })()}
                          {thread.auto_generated && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-indigo-500 bg-indigo-50 px-1 py-px">
                              <SparklesIcon className="w-2.5 h-2.5" />
                              inbox
                            </span>
                          )}
                        </div>
                      </button>

                      <div className="flex-shrink-0 flex items-center gap-0.5 pr-1.5 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditing(thread); }}
                          className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
                          title="Rename"
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(thread.id); setEditingThreadId(null); }}
                          className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main content */}
      {!activeThreadId ? (
        /* ── Entry view ── */
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-2xl mx-auto px-6 py-12">
            <div className="mb-10">
              <h1 className="text-2xl font-bold text-neutral-900 mb-1">Create Work</h1>
              <p className="text-[14px] text-neutral-500">
                Describe what you need done — the AI will propose a plan and guide you through it.
              </p>
            </div>

            <form onSubmit={handleEntrySubmit} className="mb-10">
              <div className="bg-white border border-neutral-200 shadow-sm">
                <textarea
                  value={entryInput}
                  onChange={(e) => setEntryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (entryInput.trim()) startThread(entryInput);
                    }
                  }}
                  placeholder="e.g. Prepare the Q4 board presentation with revenue metrics and product updates"
                  className="w-full px-5 py-4 text-[14px] text-neutral-900 placeholder-neutral-400 resize-none focus:outline-none"
                  rows={4}
                  disabled={isCreatingThread}
                />
                {/* Attached file chips */}
                {entryFiles.length > 0 && (
                  <div className="px-4 py-2.5 border-t border-neutral-100 flex flex-wrap gap-1.5">
                    {entryFiles.map((file, i) => (
                      <div key={i} className="inline-flex items-center gap-1.5 text-[11px] bg-neutral-100 text-neutral-700 px-2 py-1">
                        <PaperClipIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
                        <span className="truncate max-w-[180px]">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setEntryFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="flex-shrink-0 text-neutral-400 hover:text-neutral-600"
                        >
                          <XMarkIcon className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100">
                  <div className="flex items-center gap-3">
                    <p className="text-[11px] text-neutral-400">Press Enter to start</p>
                    <button
                      type="button"
                      disabled={isCreatingThread}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = ATTACH_ACCEPT;
                        input.multiple = true;
                        input.onchange = () => {
                          const files = Array.from(input.files || []);
                          const { valid, errorMsg } = validateAttachFiles(files);
                          if (errorMsg) {
                            setEntryFileError(errorMsg);
                            setTimeout(() => setEntryFileError(null), 5000);
                          }
                          if (valid.length) setEntryFiles((prev) => [...prev, ...valid]);
                        };
                        input.click();
                      }}
                      className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 disabled:opacity-40 transition-colors"
                    >
                      <PaperClipIcon className="w-3.5 h-3.5" />
                      Attach
                    </button>
                    <span className="text-[10px] text-neutral-400">{ATTACH_HINT}</span>
                    {entryFileError && (
                      <span className="text-[10px] text-red-500">{entryFileError}</span>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!entryInput.trim() || isCreatingThread}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isCreatingThread ? (
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : null}
                    Start
                  </button>
                </div>
              </div>
            </form>

            {blueprints.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <SparklesIcon className="w-4 h-4 text-neutral-400" />
                  <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                    Quick start
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {blueprints.slice(0, 8).map((blueprint) => {
                    const Icon = getCategoryIcon(blueprint.category);
                    return (
                      <button
                        key={blueprint.id}
                        onClick={() => handleBlueprintSelect(blueprint)}
                        disabled={isCreatingThread}
                        className="text-left p-3.5 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed group"
                      >
                        <div className="flex items-start gap-2.5">
                          <Icon className="w-4 h-4 text-neutral-400 group-hover:text-indigo-500 flex-shrink-0 mt-0.5 transition-colors" />
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-neutral-900 truncate">
                              {blueprint.name}
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2 leading-relaxed">
                              {blueprint.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Split view: left panel + right chat ── */
        <>
          {/* Left panel: plan or document */}
          {workMode === 'document' && selectedArtifact ? (
            <DocumentPanel
              artifact={selectedArtifact}
              artifacts={activeArtifacts}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={setSelectedArtifactId}
              onDeleteArtifact={(artifactId) => activeThreadId && handleDeleteArtifact(artifactId, activeThreadId)}
              onDownload={() => activeThreadId && selectedArtifact && downloadDocument(activeThreadId, selectedArtifact)}
              onRegenerate={() => setWorkMode('planning')}
              isDownloading={isDownloading}
              isEditing={isRebuildingDocument}
              threadId={activeThreadId!}
              onArtifactSent={(artifactId, sentAt, sentTo) => {
                if (!activeThreadId) return;
                setThreads((prev) => prev.map((t) => {
                  if (t.id !== activeThreadId) return t;
                  const updatedArtifacts = (t.artifacts ?? []).map((a) =>
                    a.id === artifactId ? { ...a, sent_at: sentAt, sent_to: sentTo } : a
                  );
                  return { ...t, artifacts: updatedArtifacts };
                }));
              }}
            />
          ) : (
            <PlanPanel
              plan={activeThread?.plan ?? null}
              isUpdating={isStreaming}
              planJustUpdated={planJustUpdated}
              workMode={workMode}
              onGenerate={generateDocument}
              threadId={activeThreadId}
              artifact={selectedArtifact}
              onViewDocument={() => setWorkMode('document')}
              onAttach={(inputId) => activeThreadId && handleAttach(inputId, activeThreadId)}
              uploadingInputId={uploadingInputId}
              onRemoveAttachment={(inputId) => activeThreadId && handleRemoveAttachment(inputId, activeThreadId)}
              isDocumentStale={isDocumentStale}
              attachErrorInputId={attachErrorInputId}
              attachErrorMsg={attachErrorMsg}
              savedWorkflowId={activeThread?.saved_workflow_id}
              onSaveWorkflow={() => setShowSaveInput(true)}
              showSaveInput={showSaveInput}
              saveWorkflowName={saveWorkflowName}
              onSaveWorkflowNameChange={setSaveWorkflowName}
              onSaveWorkflowConfirm={() => saveWorkflow(saveWorkflowName)}
              onCancelSave={() => { setShowSaveInput(false); setSaveWorkflowName(''); }}
              isSavingWorkflow={isSavingWorkflow}
              onUpdateWorkflow={updateWorkflowTemplate}
            />
          )}

          {/* Right panel: chat or document edit */}
          <div className="w-[400px] flex-shrink-0 flex flex-col border-l border-neutral-200 bg-white">

            {workMode === 'generating' ? (
              /* Generating state — disabled chat */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center px-8">
                  <div className="flex items-center justify-center gap-1.5 mb-3">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                  <p className="text-[13px] text-neutral-500 font-medium">Generating your {activeThread?.plan?.deliverable_type === 'presentation' ? 'presentation' : activeThread?.plan?.deliverable_type === 'spreadsheet' ? 'spreadsheet' : 'document'}…</p>
                  <p className="text-[11px] text-neutral-400 mt-1">This may take a few seconds</p>
                </div>
              </div>
            ) : workMode === 'document' ? (
              /* Document edit mode */
              <>
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-0">
                  {isLoadingThread ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
                    </div>
                  ) : (
                    <>
                      {messages.length === 0 && !isEditingArtifact && (
                        <div className="text-center pt-8 pb-4">
                          <p className="text-[12px] text-neutral-400 leading-relaxed">
                            Ask questions about the document, or switch to Edit to make changes.
                          </p>
                        </div>
                      )}

                      {messages.map((msg, i) => (
                        msg.role === 'assistant' ? (
                          <div key={msg.id} className={`${i > 0 ? 'pt-5' : ''}`}>
                            <MarkdownText content={msg.content} />
                          </div>
                        ) : (
                          <div key={msg.id} className="flex justify-end pt-5 pb-1">
                            <div className="max-w-[85%]">
                              <p className="text-[12px] text-neutral-500 leading-relaxed">
                                {msg.content}
                              </p>
                              <p className="text-[10px] text-neutral-300 mt-1">
                                {new Date(msg.created_at).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        )
                      ))}

                      {isEditingArtifact && editStreamText && (
                        <div className="pt-5">
                          <MarkdownText content={editStreamText} cursor />
                        </div>
                      )}

                      {isEditingArtifact && !editStreamText && (
                        <div className="pt-5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      )}

                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                <div className="border-t border-neutral-100" />

                <form onSubmit={handleArtifactSubmit} className="p-4">
                  {/* Ask / Edit toggle */}
                  <div className="flex items-center gap-0.5 mb-3 bg-neutral-100 rounded p-0.5 w-fit">
                    <button
                      type="button"
                      onClick={() => setDocChatMode('ask')}
                      disabled={isEditingArtifact}
                      className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                        docChatMode === 'ask'
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-400 hover:text-neutral-600'
                      }`}
                    >
                      Ask
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocChatMode('edit')}
                      disabled={isEditingArtifact}
                      className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                        docChatMode === 'edit'
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-400 hover:text-neutral-600'
                      }`}
                    >
                      Edit
                    </button>
                  </div>

                  <div className="flex items-end gap-2">
                    <textarea
                      ref={artifactInputRef}
                      value={artifactInput}
                      onChange={(e) => setArtifactInput(e.target.value)}
                      onKeyDown={handleArtifactKeyDown}
                      placeholder={docChatMode === 'ask'
                        ? 'Ask about the document or attached files…'
                        : selectedArtifact?.type === 'presentation'
                        ? "Edit the presentation… (e.g., 'add a slide about risks')"
                        : selectedArtifact?.type === 'spreadsheet'
                        ? "Edit the spreadsheet… (e.g., 'add a totals row')"
                        : "Edit the document… (e.g., 'make the summary shorter')"}
                      rows={1}
                      disabled={isEditingArtifact}
                      className="flex-1 text-[13px] text-neutral-900 placeholder-neutral-400 resize-none focus:outline-none border border-neutral-200 focus:border-indigo-400 px-3 py-2.5 max-h-32 disabled:opacity-50 leading-relaxed"
                      style={{ height: 'auto', minHeight: '40px' }}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!artifactInput.trim() || isEditingArtifact}
                      className={`flex-shrink-0 w-8 h-8 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-end mb-px ${
                        docChatMode === 'edit' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-neutral-700 hover:bg-neutral-800'
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 rotate-90" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-[10px] text-neutral-400 mt-2">
                    Enter to send · Shift+Enter for new line
                  </p>
                </form>
              </>
            ) : (
              /* Planning mode chat */
              <>
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-0">
                  {isLoadingThread ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
                    </div>
                  ) : (
                    <>
                      {messages.map((msg, i) => (
                        msg.role === 'assistant' ? (
                          <div key={msg.id} className={`${i > 0 ? 'pt-5' : ''}`}>
                            <MarkdownText content={msg.content} />
                          </div>
                        ) : (
                          <div key={msg.id} className="flex justify-end pt-5 pb-1">
                            <div className="max-w-[85%]">
                              <p className="text-[12px] text-neutral-500 leading-relaxed">
                                {msg.content}
                              </p>
                              <p className="text-[10px] text-neutral-300 mt-1">
                                {new Date(msg.created_at).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        )
                      ))}

                      {isStreaming && streamingText && (
                        <div className="pt-5">
                          <MarkdownText content={streamingText} cursor />
                        </div>
                      )}

                      {(isStreaming || isCreatingThread) && !streamingText && (
                        <div className="pt-5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      )}

                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                <div className="border-t border-neutral-100" />

                <form onSubmit={handleChatSubmit} className="p-4">
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={chatInputRef}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleChatKeyDown}
                      placeholder="Reply…"
                      rows={1}
                      disabled={isStreaming}
                      className="flex-1 text-[13px] text-neutral-900 placeholder-neutral-400 resize-none focus:outline-none border border-neutral-200 focus:border-indigo-400 px-3 py-2.5 max-h-32 disabled:opacity-50 leading-relaxed"
                      style={{ height: 'auto', minHeight: '40px' }}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isStreaming}
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-end mb-px"
                    >
                      <svg className="w-3.5 h-3.5 rotate-90" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-[10px] text-neutral-400 mt-2">
                    Enter to send · Shift+Enter for new line
                  </p>
                </form>
              </>
            )}
          </div>
        </>
      )}

      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        userEmail={userEmail}
        userFullName={userFullName}
      />
    </div>
  );
}
