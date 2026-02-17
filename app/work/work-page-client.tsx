'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import {
  PlusIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  DocumentChartBarIcon,
  TableCellsIcon,
  EnvelopeIcon,
  ClockIcon,
  CalendarIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';

interface WorkPageClientProps {
  userEmail?: string;
}

export function WorkPageClient({ userEmail }: WorkPageClientProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [executionPlan, setExecutionPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Editable plan state
  const [editableDescription, setEditableDescription] = useState('');
  const [editableSteps, setEditableSteps] = useState<any[]>([]);
  const [editableDeadline, setEditableDeadline] = useState('');
  const [editableTime, setEditableTime] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setIsProcessing(true);
    setError(null);
    setExecutionPlan(null);

    try {
      const response = await fetch('/api/work/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: input }),
      });

      if (!response.ok) {
        throw new Error('Failed to process work');
      }

      const result = await response.json();

      if (result.executionPlan) {
        setExecutionPlan(result.executionPlan);
        // Initialize editable state
        setEditableDescription(result.executionPlan.deliverable_description || '');
        setEditableSteps(result.executionPlan.steps || []);
        setEditableDeadline(result.executionPlan.deadline || '');
        setEditableTime(result.executionPlan.estimated_time || '');
      } else {
        // If not executable, just go to inbox
        router.push('/inbox');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process work');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateInboxItem = async () => {
    setIsCreating(true);
    setError(null);

    try {
      // Use edited values
      const finalPlan = {
        ...executionPlan,
        deliverable_description: editableDescription,
        steps: editableSteps,
        deadline: editableDeadline,
        estimated_time: editableTime,
      };

      const response = await fetch('/api/work/create-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: input,
          executionPlan: finalPlan,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create work item');
      }

      router.push('/inbox');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create work item');
    } finally {
      setIsCreating(false);
    }
  };

  const updateStep = (index: number, field: string, value: string) => {
    const newSteps = [...editableSteps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setEditableSteps(newSteps);
  };

  const addStep = () => {
    const newStep = {
      number: editableSteps.length + 1,
      action: '',
      skill: '',
      status: 'pending',
    };
    setEditableSteps([...editableSteps, newStep]);
  };

  const removeStep = (index: number) => {
    const newSteps = editableSteps.filter((_, i) => i !== index);
    // Renumber steps
    const renumbered = newSteps.map((step, i) => ({ ...step, number: i + 1 }));
    setEditableSteps(renumbered);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === editableSteps.length - 1)
    ) {
      return;
    }

    const newSteps = [...editableSteps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];

    // Renumber steps
    const renumbered = newSteps.map((step, i) => ({ ...step, number: i + 1 }));
    setEditableSteps(renumbered);
  };

  const getDeliverableIcon = (type: string) => {
    switch (type) {
      case 'report':
        return DocumentTextIcon;
      case 'presentation':
        return PresentationChartBarIcon;
      case 'analysis':
        return DocumentChartBarIcon;
      case 'spreadsheet':
        return TableCellsIcon;
      case 'email':
        return EnvelopeIcon;
      default:
        return DocumentTextIcon;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <SidebarNav userEmail={userEmail} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
          {/* Page Header */}
          <div className="mb-10">
            <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-2">
              Create Work
            </h1>
            <p className="text-[15px] text-neutral-600">
              Describe what you need done, and I'll break it down into executable steps
            </p>
          </div>

          {!executionPlan ? (
            /* Input Form */
            <div className="bg-white border border-neutral-200 shadow-sm p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label htmlFor="work-input" className="block text-[14px] font-semibold text-neutral-900 mb-3">
                    What do you need done?
                  </label>
                  <textarea
                    id="work-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="E.g., Prepare Q4 board presentation with revenue metrics and product updates"
                    className="w-full px-4 py-3 border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none text-neutral-900 placeholder-neutral-400 text-[14px]"
                    rows={5}
                    disabled={isProcessing}
                  />
                </div>

                {error && (
                  <div className="p-4 bg-red-50 border border-red-200">
                    <p className="text-[13px] text-red-700">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!input.trim() || isProcessing}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white text-[14px] font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analyzing work...
                    </>
                  ) : (
                    <>
                      <PlusIcon className="w-5 h-5" />
                      Analyze & Create
                    </>
                  )}
                </button>
              </form>

              {/* Examples */}
              <div className="mt-8 pt-8 border-t border-neutral-200">
                <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-3">
                  Example Requests
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {[
                    'Create Q4 board presentation with revenue and product updates',
                    'Analyze customer churn data from last quarter',
                    'Draft response to vendor proposal about pricing',
                    'Generate monthly report with key metrics and insights',
                  ].map((example, index) => (
                    <button
                      key={index}
                      onClick={() => setInput(example)}
                      disabled={isProcessing}
                      className="text-left px-4 py-3 bg-neutral-50 hover:bg-indigo-50 border border-neutral-200 hover:border-indigo-200 transition-colors text-[13px] text-neutral-700 hover:text-indigo-700 disabled:opacity-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Execution Plan Display - Editable */
            <div className="bg-white border border-neutral-200 shadow-sm overflow-hidden">
              {/* Two-Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 p-8">
                {/* Left Column - Deliverable & Metadata */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Header - Editable */}
                  <div className="flex items-start gap-4">
                    {(() => {
                      const Icon = getDeliverableIcon(executionPlan.deliverable_type);
                      return (
                        <div className="flex-shrink-0 w-12 h-12 bg-indigo-50 flex items-center justify-center">
                          <Icon className="w-6 h-6 text-indigo-600" />
                        </div>
                      );
                    })()}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
                          Deliverable
                        </h2>
                      </div>
                      <textarea
                        value={editableDescription}
                        onChange={(e) => setEditableDescription(e.target.value)}
                        className="w-full text-[15px] font-medium text-neutral-900 border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 px-3 py-2 resize-none"
                        placeholder="What will be created..."
                        rows={3}
                      />
                    </div>
                  </div>

                  {/* Metadata - Editable */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                        Estimated Time
                      </label>
                      <input
                        type="text"
                        value={editableTime}
                        onChange={(e) => setEditableTime(e.target.value)}
                        className="w-full px-3 py-2 border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-[14px] text-neutral-900"
                        placeholder="e.g., 2 hours"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                        Deadline
                      </label>
                      <input
                        type="date"
                        value={editableDeadline}
                        onChange={(e) => setEditableDeadline(e.target.value)}
                        className="w-full px-3 py-2 border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-[14px] text-neutral-900"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="p-4 bg-red-50 border border-red-200">
                      <p className="text-[13px] text-red-700">{error}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-6 border-t border-neutral-200 space-y-3">
                    <button
                      onClick={handleCreateInboxItem}
                      disabled={isCreating || !editableDescription || editableSteps.length === 0}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white text-[14px] font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                    >
                      {isCreating ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          Add to Inbox
                          <ArrowRightIcon className="w-5 h-5" />
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setExecutionPlan(null);
                        setInput('');
                        setEditableDescription('');
                        setEditableSteps([]);
                        setEditableDeadline('');
                        setEditableTime('');
                      }}
                      className="w-full px-6 py-2.5 border border-neutral-300 text-neutral-700 text-[13px] font-medium hover:bg-neutral-50 transition-colors"
                    >
                      Start Over
                    </button>
                  </div>
                </div>

                {/* Right Column - Steps */}
                <div className="lg:col-span-3">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">
                      Execution Steps ({editableSteps.length})
                    </h3>
                    <button
                      onClick={addStep}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-indigo-700 hover:text-indigo-800 hover:bg-indigo-50 transition-colors"
                    >
                      <PlusIcon className="w-4 h-4" />
                      Add Step
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-2">
                    {editableSteps.map((step: any, index: number) => (
                      <div
                        key={index}
                        className="flex items-start gap-2.5 p-3 bg-neutral-50 border border-neutral-200 hover:border-neutral-300 transition-colors group"
                      >
                        {/* Step Number */}
                        <div className="flex-shrink-0 w-6 h-6 bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center text-[12px] mt-0.5">
                          {step.number}
                        </div>

                        {/* Step Content - Editable */}
                        <div className="flex-1 min-w-0">
                          <textarea
                            value={step.action}
                            onChange={(e) => updateStep(index, 'action', e.target.value)}
                            className="w-full text-[13px] text-neutral-900 bg-white border border-neutral-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 px-2 py-1.5 resize-none"
                            placeholder="Describe what to do..."
                            rows={2}
                          />
                          <input
                            type="text"
                            value={step.skill || ''}
                            onChange={(e) => updateStep(index, 'skill', e.target.value)}
                            className="w-full text-[11px] text-neutral-600 bg-white border border-neutral-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 px-2 py-1 mt-1.5"
                            placeholder="Skill (optional)"
                          />
                        </div>

                        {/* Step Actions */}
                        <div className="flex-shrink-0 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => moveStep(index, 'up')}
                            disabled={index === 0}
                            className="p-1 text-neutral-400 hover:text-neutral-700 hover:bg-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                            title="Move up"
                          >
                            <ArrowUpIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveStep(index, 'down')}
                            disabled={index === editableSteps.length - 1}
                            className="p-1 text-neutral-400 hover:text-neutral-700 hover:bg-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                            title="Move down"
                          >
                            <ArrowDownIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeStep(index)}
                            className="p-1 text-red-400 hover:text-red-700 hover:bg-white transition-colors"
                            title="Remove"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
