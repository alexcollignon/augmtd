'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SparklesIcon,
  PlusIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  DocumentChartBarIcon,
  TableCellsIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

export default function WorkPage() {
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
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-indigo-50/30">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 mb-6 shadow-lg">
            <SparklesIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-neutral-900 mb-3">
            Create Work
          </h1>
          <p className="text-neutral-600 text-lg">
            Tell me what you need done, and I'll break it down into actionable steps
          </p>
        </div>

        {!executionPlan ? (
          /* Input Form */
          <div className="bg-white rounded-2xl shadow-xl border border-neutral-200 p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="work-input" className="block text-sm font-semibold text-neutral-900 mb-3">
                  What do you need done?
                </label>
                <textarea
                  id="work-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="E.g., Prepare Q4 board presentation with revenue metrics and product updates"
                  className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none text-neutral-900 placeholder-neutral-400"
                  rows={4}
                  disabled={isProcessing}
                />
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={!input.trim() || isProcessing}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-lg hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
              >
                {isProcessing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing work...
                  </>
                ) : (
                  <>
                    <PlusIcon className="w-5 h-5" />
                    Create Work
                  </>
                )}
              </button>
            </form>

            {/* Examples */}
            <div className="mt-8 pt-8 border-t border-neutral-200">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">
                Example Requests
              </p>
              <div className="space-y-2">
                {[
                  'Create Q4 board presentation with revenue and product updates',
                  'Analyze customer churn data from last quarter',
                  'Draft response to vendor proposal about pricing',
                  'Generate monthly report with key metrics and insights',
                ].map((example, index) => (
                  <button
                    key={index}
                    onClick={() => setInput(example)}
                    className="w-full text-left px-4 py-2.5 bg-neutral-50 hover:bg-indigo-50 border border-neutral-200 hover:border-indigo-200 rounded-lg transition-colors text-sm text-neutral-700 hover:text-indigo-700"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Execution Plan Display */
          <div className="bg-white rounded-2xl shadow-xl border border-neutral-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-500 to-violet-600 px-8 py-6">
              <div className="flex items-start gap-4">
                {(() => {
                  const Icon = getDeliverableIcon(executionPlan.deliverable_type);
                  return <Icon className="w-8 h-8 text-white flex-shrink-0 mt-1" />;
                })()}
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-white mb-2">
                    Work Plan Ready
                  </h2>
                  <p className="text-indigo-100 text-lg">
                    {executionPlan.deliverable_description}
                  </p>
                </div>
              </div>
            </div>

            {/* Plan Details */}
            <div className="p-8 space-y-6">
              {/* Metadata */}
              <div className="flex items-center gap-6 text-sm">
                {executionPlan.estimated_time && (
                  <div className="flex items-center gap-2 text-neutral-600">
                    <span className="font-semibold">Estimated Time:</span>
                    <span>{executionPlan.estimated_time}</span>
                  </div>
                )}
                {executionPlan.deadline && (
                  <div className="flex items-center gap-2 text-neutral-600">
                    <span className="font-semibold">Deadline:</span>
                    <span>{new Date(executionPlan.deadline).toLocaleDateString()}</span>
                  </div>
                )}
              </div>

              {/* Steps */}
              <div>
                <h3 className="text-sm font-semibold text-neutral-600 uppercase tracking-wide mb-4">
                  Execution Steps ({executionPlan.steps.length})
                </h3>
                <div className="space-y-3">
                  {executionPlan.steps.map((step: any, index: number) => (
                    <div
                      key={index}
                      className="flex items-start gap-4 p-4 bg-neutral-50 border border-neutral-200 rounded-lg"
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center text-sm">
                        {step.number}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-neutral-900 mb-1">
                          {step.action}
                        </p>
                        {step.skill && (
                          <p className="text-xs text-neutral-500">
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
                  className="px-6 py-3 border border-neutral-300 text-neutral-700 font-semibold rounded-lg hover:bg-neutral-50 transition-colors"
                >
                  Start Over
                </button>
                <button
                  onClick={handleCreateInboxItem}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold rounded-lg hover:from-indigo-700 hover:to-violet-700 transition-all shadow-lg hover:shadow-xl"
                >
                  Add to Inbox
                  <ArrowRightIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
