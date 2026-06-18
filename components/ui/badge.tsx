'use client';

import React from 'react';
import { cn } from '@/lib/cn';

// ─── Badge ────────────────────────────────────────────────────────────────────
// Small pill for status/labels. Semantic tones; default neutral.

type Tone = 'neutral' | 'indigo' | 'emerald' | 'amber' | 'red' | 'blue';

const TONE: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-500',
  indigo:  'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber:   'bg-amber-50 text-amber-600',
  red:     'bg-red-50 text-red-600',
  blue:    'bg-blue-50 text-blue-500',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
        TONE[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
