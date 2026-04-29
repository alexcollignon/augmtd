'use client';

import React from 'react';

const RECORDING_STEPS = ['Transcribing', 'Analyzing', 'Ready'];
const TEXT_STEPS = ['Analyzing', 'Ready'];

function getActiveStep(
  source: string,
  botState: string | null,
  processed: boolean,
): number {
  if (processed) return 99;
  if (source === 'text') return 0;
  if (botState === 'processing') return 0;
  return 1; // analyzing
}

interface ProcessingPipelineProps {
  source: 'bot' | 'recording' | 'upload' | 'text';
  attendeeBotState?: string | null;
  botState: string | null;
  processed: boolean;
}

export default function ProcessingPipeline({
  source,
  botState,
  processed,
}: ProcessingPipelineProps) {
  const steps = source === 'text' ? TEXT_STEPS : RECORDING_STEPS;
  const activeStep = getActiveStep(source, botState, processed);
  const currentLabel = processed ? 'Ready' : steps[Math.min(activeStep, steps.length - 1)];

  return (
    <div className="flex items-center gap-3 py-2">
      {/* Spinner or check */}
      {processed ? (
        <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-2.5 h-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      ) : (
        <span className="w-4 h-4 rounded-full border-2 border-neutral-200 border-t-indigo-500 animate-spin flex-shrink-0" />
      )}

      {/* Step pills */}
      <div className="flex items-center gap-1.5">
        {steps.map((label, i) => {
          const done = i < activeStep || processed;
          const active = i === activeStep && !processed;
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className="text-neutral-200 text-[10px]">→</span>
              )}
              <span className={`text-[11px] font-medium transition-colors ${
                done
                  ? 'text-emerald-600'
                  : active
                  ? 'text-indigo-600'
                  : 'text-neutral-300'
              }`}>
                {label}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
