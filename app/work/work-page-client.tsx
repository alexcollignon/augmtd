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
    try {
      const response = await fetch('/api/work/create-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: input,
          executionPlan,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create work item');
      }

      router.push('/inbox');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create work item');
    }
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
            /* Execution Plan Display */
            <div className="bg-white border border-neutral-200 shadow-sm overflow-hidden">
              {/* Plan Details */}
              <div className="p-8 space-y-6">
                {/* Header */}
                <div className="flex items-start gap-4 pb-6 border-b border-neutral-200">
                  {(() => {
                    const Icon = getDeliverableIcon(executionPlan.deliverable_type);
                    return (
                      <div className="flex-shrink-0 w-12 h-12 bg-indigo-50 flex items-center justify-center">
                        <Icon className="w-6 h-6 text-indigo-600" />
                      </div>
                    );
                  })()}
                  <div className="flex-1">
                    <h2 className="text-[17px] font-bold text-neutral-900 mb-1">
                      Work Plan Ready
                    </h2>
                    <p className="text-[15px] text-neutral-600">
                      {executionPlan.deliverable_description}
                    </p>
                  </div>
                </div>

                {/* Metadata */}
                {(executionPlan.estimated_time || executionPlan.deadline) && (
                  <div className="flex items-center gap-6 text-[13px]">
                    {executionPlan.estimated_time && (
                      <div className="flex items-center gap-2 text-neutral-600">
                        <ClockIcon className="w-4 h-4 text-neutral-400" />
                        <span className="font-medium">Time:</span>
                        <span>{executionPlan.estimated_time}</span>
                      </div>
                    )}
                    {executionPlan.deadline && (
                      <div className="flex items-center gap-2 text-neutral-600">
                        <CalendarIcon className="w-4 h-4 text-neutral-400" />
                        <span className="font-medium">Deadline:</span>
                        <span>{new Date(executionPlan.deadline).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Steps */}
                <div>
                  <h3 className="text-[11px] font-semibold text-neutral-600 uppercase tracking-wide mb-4">
                    Execution Steps ({executionPlan.steps.length})
                  </h3>
                  <div className="space-y-3">
                    {executionPlan.steps.map((step: any, index: number) => (
                      <div
                        key={index}
                        className="flex items-start gap-4 p-4 bg-neutral-50 border border-neutral-200"
                      >
                        <div className="flex-shrink-0 w-7 h-7 bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center text-[13px]">
                          {step.number}
                        </div>
                        <div className="flex-1">
                          <p className="text-[14px] font-medium text-neutral-900 mb-1">
                            {step.action}
                          </p>
                          {step.skill && (
                            <p className="text-[12px] text-neutral-500">
                              Skill: <span className="font-medium">{step.skill}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-6 border-t border-neutral-200 flex items-center gap-3">
                  <button
                    onClick={() => {
                      setExecutionPlan(null);
                      setInput('');
                    }}
                    className="px-6 py-3 border border-neutral-300 text-neutral-700 text-[14px] font-semibold hover:bg-neutral-50 transition-colors"
                  >
                    Start Over
                  </button>
                  <button
                    onClick={handleCreateInboxItem}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white text-[14px] font-semibold hover:bg-indigo-700 transition-all shadow-sm hover:shadow"
                  >
                    Add to Inbox
                    <ArrowRightIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
