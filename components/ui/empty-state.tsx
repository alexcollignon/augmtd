'use client';

import React from 'react';
import { cn } from '@/lib/cn';

// ─── EmptyState ───────────────────────────────────────────────────────────────
// Canonical empty placeholder: centered icon + title + optional subtitle/action.
// `bordered` wraps it in the standard dashed card (for in-section empties).

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  bordered?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, bordered, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'text-center',
        bordered ? 'rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-12' : 'py-12',
        className,
      )}
    >
      {Icon && <Icon className="w-8 h-8 text-neutral-300 mx-auto mb-3" />}
      <p className="text-[13px] font-medium text-neutral-600">{title}</p>
      {description && <p className="text-[12px] text-neutral-400 mt-1 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
