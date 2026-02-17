'use client';

import { useState, useEffect } from 'react';
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
  PencilIcon,
  Bars3Icon,
  CheckIcon,
  CheckCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { WorkBlueprint } from '@/lib/types/work-blueprints';

interface WorkPageClientProps {
  userEmail?: string;
  hasCompletedOnboarding: boolean;
  blueprints: WorkBlueprint[];
}

export function WorkPageClient({
  userEmail,
  hasCompletedOnboarding: initialOnboarding,
  blueprints: initialBlueprints,
}: WorkPageClientProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [executionPlan, setExecutionPlan] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Blueprints state
  const [blueprints, setBlueprints] = useState<WorkBlueprint[]>(initialBlueprints);

  // Editable plan state
  const [editableDescription, setEditableDescription] = useState('');
  const [editableSteps, setEditableSteps] = useState<any[]>([]);
  const [editableDeadline, setEditableDeadline] = useState('');
  const [editableTime, setEditableTime] = useState('');
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);
  const [saveAsWorkflow, setSaveAsWorkflow] = useState(false);


  const handleBlueprintSelect = (blueprint: WorkBlueprint) => {
    // Pre-fill with blueprint template
    const description = `${blueprint.name}: ${blueprint.description}`;
    setInput(description);

    // Track usage
    fetch('/api/work/track-blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprintId: blueprint.id }),
    }).catch(console.error);

    // Auto-submit to get execution plan with blueprint steps
    handleSubmitWithBlueprint(blueprint);
  };

  const handleSubmitWithBlueprint = async (blueprint: WorkBlueprint) => {
    setIsProcessing(true);
    setError(null);
    setExecutionPlan(null);

    try {
      const response = await fetch('/api/work/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `${blueprint.name}: ${blueprint.description}`,
          blueprintId: blueprint.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process work');
      }

      const result = await response.json();

      if (result.executionPlan) {
        setExecutionPlan(result.executionPlan);
        setEditableDescription(result.executionPlan.deliverable_description || '');
        setEditableSteps(result.executionPlan.steps || []);
        setEditableDeadline(result.executionPlan.deadline || '');
        setEditableTime(result.executionPlan.estimated_time || blueprint.estimatedTime || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process work');
    } finally {
      setIsProcessing(false);
    }
  };

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
        setEditableDescription(result.executionPlan.deliverable_description || '');
        setEditableSteps(result.executionPlan.steps || []);
        setEditableDeadline(result.executionPlan.deadline || '');
        setEditableTime(result.executionPlan.estimated_time || '');
      } else {
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
      const finalPlan = {
        ...executionPlan,
        deliverable_description: editableDescription,
        steps: editableSteps,
        deadline: editableDeadline,
        estimated_time: editableTime,
      };

      // Save as workflow if requested
      if (saveAsWorkflow) {
        const workflowResponse = await fetch('/api/workflows/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.split(/[.\n]/)[0].trim().substring(0, 100),
            description: editableDescription,
            category: 'custom',
            inputs: finalPlan.inputs || [],
            steps: editableSteps,
            outputs: finalPlan.outputs || [],
            estimatedTime: editableTime,
            sourceType: 'ai_generated',
          }),
        });

        if (workflowResponse.ok) {
          console.log('Workflow saved successfully');
        }
      }

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
    const renumbered = newSteps.map((step, i) => ({ ...step, number: i + 1 }));
    setEditableSteps(renumbered);
  };

  const handleDragStart = (index: number) => {
    setDraggedStepIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedStepIndex === null || draggedStepIndex === dropIndex) return;

    const newSteps = [...editableSteps];
    const [draggedStep] = newSteps.splice(draggedStepIndex, 1);
    newSteps.splice(dropIndex, 0, draggedStep);

    const renumbered = newSteps.map((step, i) => ({ ...step, number: i + 1 }));
    setEditableSteps(renumbered);
    setDraggedStepIndex(null);
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

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'reporting':
        return DocumentTextIcon;
      case 'planning':
        return CalendarIcon;
      case 'analysis':
        return DocumentChartBarIcon;
      default:
        return DocumentTextIcon;
    }
  };

  return (
    <>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {/* Sidebar */}
        <SidebarNav userEmail={userEmail} />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
            {/* Page Header */}
            <div className="mb-8">
              <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-2">
                Create Work
              </h1>
              <p className="text-[15px] text-neutral-600">
                Start from a template or describe custom work
              </p>
            </div>

            {!executionPlan ? (
              <div className="space-y-8">
                {/* Blueprint Templates */}
                {blueprints.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <SparklesIcon className="w-5 h-5 text-indigo-600" />
                      <h2 className="text-[15px] font-semibold text-neutral-900">
                        Quick Start Templates
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {blueprints.slice(0, 9).map((blueprint) => {
                        const Icon = getCategoryIcon(blueprint.category);
                        return (
                          <button
                            key={blueprint.id}
                            onClick={() => handleBlueprintSelect(blueprint)}
                            disabled={isProcessing}
                            className="text-left p-4 bg-white border border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                                <Icon className="w-5 h-5 text-indigo-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-[13px] font-semibold text-neutral-900 mb-1 truncate">
                                  {blueprint.name}
                                </h3>
                                <p className="text-[11px] text-neutral-600 line-clamp-2 leading-relaxed">
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

                {/* Divider */}
                {blueprints.length > 0 && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-neutral-200" />
                    </div>
                    <div className="relative flex justify-center text-[12px]">
                      <span className="bg-gray-50 px-4 text-neutral-500 uppercase tracking-wide">
                        Or describe custom work
                      </span>
                    </div>
                  </div>
                )}

                {/* Custom Input Form */}
                <div className="bg-white border border-neutral-200 shadow-sm p-8">
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                      <label
                        htmlFor="work-input"
                        className="block text-[14px] font-semibold text-neutral-900 mb-3"
                      >
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
              </div>
            ) : (
              /* Execution Plan Display - Editable */
              <div className="bg-white border border-neutral-200 shadow-sm overflow-hidden">
                <div className="p-8 space-y-6">
                  {/* Header - Deliverable */}
                  <div className="space-y-4">
                    <div className="flex items-start gap-4 pb-4 border-b border-neutral-200">
                      {(() => {
                        const Icon = getDeliverableIcon(executionPlan.deliverable_type);
                        return (
                          <div className="flex-shrink-0 w-10 h-10 bg-indigo-50 flex items-center justify-center">
                            <Icon className="w-5 h-5 text-indigo-600" />
                          </div>
                        );
                      })()}
                      <div className="flex-1">
                        <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                          Deliverable
                        </label>
                        <textarea
                          value={editableDescription}
                          onChange={(e) => setEditableDescription(e.target.value)}
                          className="w-full text-[14px] font-medium text-neutral-900 border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 px-3 py-2 resize-none"
                          placeholder="What will be created..."
                          rows={2}
                        />
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                          Estimated Time
                        </label>
                        <input
                          type="text"
                          value={editableTime}
                          onChange={(e) => setEditableTime(e.target.value)}
                          className="w-full px-3 py-2 border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-[13px] text-neutral-900"
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
                          className="w-full px-3 py-2 border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-[13px] text-neutral-900"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Inputs Section */}
                  {executionPlan.inputs && executionPlan.inputs.length > 0 && (
                    <div className="border-t border-neutral-200 pt-6">
                      <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                        Required Inputs ({executionPlan.inputs.length})
                      </h3>
                      <div className="space-y-2">
                        {executionPlan.inputs.map((input: any) => (
                          <div
                            key={input.id}
                            className="p-3 bg-blue-50 border border-blue-100 rounded"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="text-[13px] font-medium text-neutral-900">
                                  {input.name}
                                  {input.required && (
                                    <span className="text-red-500 ml-1">*</span>
                                  )}
                                </p>
                                <p className="text-[12px] text-neutral-600 mt-0.5">
                                  {input.description}
                                </p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className="text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                                    {input.type}
                                  </span>
                                  {input.examples && input.examples.length > 0 && (
                                    <span className="text-[10px] text-neutral-500">
                                      e.g., {input.examples[0]}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Steps - Compact, non-editable by default */}
                  <div className="border-t border-neutral-200 pt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide">
                        Execution Steps ({editableSteps.length})
                      </h3>
                      <button
                        onClick={addStep}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-indigo-700 hover:text-indigo-800 hover:bg-indigo-50 transition-colors"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                        Add Step
                      </button>
                    </div>

                    <div className="space-y-2">
                      {editableSteps.map((step: any, index: number) => (
                        <div
                          key={index}
                          draggable
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDrop={(e) => handleDrop(e, index)}
                          className={`flex items-center gap-2 p-2.5 bg-neutral-50 border border-neutral-200 hover:border-neutral-300 transition-colors group cursor-move ${
                            draggedStepIndex === index ? 'opacity-50' : ''
                          }`}
                        >
                          {/* Drag Handle */}
                          <Bars3Icon className="w-4 h-4 text-neutral-400 flex-shrink-0" />

                          {/* Step Number */}
                          <div className="flex-shrink-0 w-5 h-5 bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center text-[11px]">
                            {step.number}
                          </div>

                          {/* Step Content */}
                          {editingStepIndex === index ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                type="text"
                                value={step.action}
                                onChange={(e) => updateStep(index, 'action', e.target.value)}
                                className="flex-1 text-[13px] text-neutral-900 border border-indigo-300 focus:ring-1 focus:ring-indigo-500 px-2 py-1"
                                placeholder="Describe what to do..."
                                autoFocus
                              />
                              <button
                                onClick={() => setEditingStepIndex(null)}
                                className="p-1 text-green-600 hover:text-green-700"
                              >
                                <CheckIcon className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex-1 flex items-center justify-between min-w-0">
                              <p className="text-[13px] text-neutral-900 truncate">
                                {step.action}
                              </p>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setEditingStepIndex(index)}
                                  className="p-1 text-neutral-500 hover:text-neutral-700"
                                  title="Edit"
                                >
                                  <PencilIcon className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => removeStep(index)}
                                  className="p-1 text-red-500 hover:text-red-700"
                                  title="Remove"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Outputs Section */}
                  {executionPlan.outputs && executionPlan.outputs.length > 0 && (
                    <div className="border-t border-neutral-200 pt-6">
                      <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-3">
                        Expected Outputs ({executionPlan.outputs.length})
                      </h3>
                      <div className="space-y-2">
                        {executionPlan.outputs.map((output: any) => (
                          <div
                            key={output.id}
                            className="p-3 bg-green-50 border border-green-100 rounded"
                          >
                            <div className="flex items-start gap-2">
                              <CheckCircleIcon className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="text-[13px] font-medium text-neutral-900">
                                  {output.name}
                                </p>
                                <p className="text-[12px] text-neutral-600 mt-0.5">
                                  {output.description}
                                </p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                                    {output.type}
                                  </span>
                                  {output.deliverableType && (
                                    <span className="text-[10px] text-neutral-500">
                                      {output.deliverableType}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200">
                      <p className="text-[12px] text-red-700">{error}</p>
                    </div>
                  )}

                  {/* Save as Workflow Option */}
                  <div className="pb-4 border-t border-neutral-200 pt-6">
                    <label className="flex items-center gap-2 text-[13px] text-neutral-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveAsWorkflow}
                        onChange={(e) => setSaveAsWorkflow(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 border-neutral-300 rounded focus:ring-indigo-500"
                      />
                      <span>Save this as a reusable workflow</span>
                    </label>
                    {saveAsWorkflow && (
                      <p className="text-[11px] text-neutral-500 ml-6 mt-1">
                        You'll be able to use this workflow again from your workflow library
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="pt-4 flex items-center gap-3">
                    <button
                      onClick={() => {
                        setExecutionPlan(null);
                        setInput('');
                        setEditableDescription('');
                        setEditableSteps([]);
                        setEditableDeadline('');
                        setEditableTime('');
                        setEditingStepIndex(null);
                        setSaveAsWorkflow(false);
                      }}
                      className="px-5 py-2.5 border border-neutral-300 text-neutral-700 text-[13px] font-semibold hover:bg-neutral-50 transition-colors"
                    >
                      Start Over
                    </button>
                    <button
                      onClick={handleCreateInboxItem}
                      disabled={
                        isCreating || !editableDescription || editableSteps.length === 0
                      }
                      className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                    >
                      {isCreating ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          Add to Inbox
                          <ArrowRightIcon className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
