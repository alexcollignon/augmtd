'use client';

import React from 'react';

const BOT_STEPS = ['Joining', 'Recording', 'Transcribing', 'Analyzing', 'Ready'];
const RECORDING_STEPS = ['Transcribing', 'Analyzing', 'Ready'];
const TEXT_STEPS = ['Analyzing', 'Ready'];

function getActiveStep(
  source: string,
  attendeeBotState: string | null | undefined,
  botState: string | null,
  processed: boolean,
): number {
  if (source === 'text') return processed ? 2 : 0;
  if (processed) return source === 'bot' ? 5 : 3; // past last step = all done
  if (source === 'bot') {
    // Prefer botState as primary signal — always accurate from transcript row
    if (botState === 'joining') return 0;
    if (botState === 'recording') return 1;
    if (botState === 'processing') return 2;
    // Fall back to attendeeBotState (calendar event) when botState is null/ended
    if (attendeeBotState === 'joining') return 0;
    if (attendeeBotState === 'recording') return 1;
    if (attendeeBotState === 'done') return 3; // analyzing (generate-insights running)
    return 0;
  } else {
    if (botState === 'processing') return 0;
    return 1; // analyzing
  }
}

interface ProcessingPipelineProps {
  source: 'bot' | 'recording' | 'upload' | 'text';
  attendeeBotState?: string | null;
  botState: string | null;
  processed: boolean;
}

export default function ProcessingPipeline({
  source,
  attendeeBotState,
  botState,
  processed,
}: ProcessingPipelineProps) {
  const steps = source === 'bot' ? BOT_STEPS : source === 'text' ? TEXT_STEPS : RECORDING_STEPS;
  const activeStep = getActiveStep(source, attendeeBotState, botState, processed);

  return (
    <div className="px-4 py-3 bg-neutral-50 border border-neutral-100">
      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide mb-3">
        {processed ? 'Analysis complete' : 'Processing…'}
      </p>
      {/* Dots row */}
      <div className="flex items-center">
        {steps.map((label, i) => {
          const done = i < activeStep;
          const active = i === activeStep && !processed;
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <div className={`flex-1 h-px ${done ? 'bg-emerald-300' : 'bg-neutral-200'}`} />
              )}
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  done || processed
                    ? 'bg-emerald-500'
                    : active
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-neutral-200'
                }`} />
                <span className={`text-[9px] font-medium whitespace-nowrap ${
                  done || processed
                    ? 'text-emerald-600'
                    : active
                    ? 'text-amber-600'
                    : 'text-neutral-400'
                }`}>
                  {label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
