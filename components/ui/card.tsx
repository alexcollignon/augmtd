'use client';

import React from 'react';
import { cn } from '@/lib/cn';

// ─── Panel & Card ─────────────────────────────────────────────────────────────
// Panel  — the outer wrapper of a column/surface (rounded-2xl bg-white shadow-sm).
// Card   — a content card / list-item container (rounded-xl border). `interactive`
//          adds the standard hover treatment (indigo border + subtle shadow).

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl bg-white shadow-sm', className)} {...props} />;
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-neutral-200 bg-white',
        interactive && 'transition-all hover:border-indigo-200 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]',
        className,
      )}
      {...props}
    />
  );
}
