'use client';

import React from 'react';
import { cn } from '@/lib/cn';

// ─── Button ───────────────────────────────────────────────────────────────────
// Canonical button. Variants + sizes cover every CTA in the app.
//   primary   — main action (indigo fill)
//   secondary — outlined neutral (Cancel, secondary actions)
//   soft      — indigo tint (lighter CTAs, e.g. "New task")
//   ghost     — text-only (tertiary)
//   danger    — destructive fill (red)
// Sizes: sm (px-3 py-1.5 / 12px) · md (px-3.5 py-2 / 13px)

type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary:   'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50',
  soft:      'bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
  ghost:     'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100',
  danger:    'bg-red-600 text-white hover:bg-red-700',
};

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[12px] gap-1',
  md: 'px-3.5 py-2 text-[13px] gap-1.5',
};

const BASE =
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return <button className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...props} />;
}

// ─── IconButton ─────────────────────────────────────────────────────────────
// Square icon-only button. tone: default | danger. size: sm (p-1) | md (p-1.5).

type IconTone = 'default' | 'danger';

const ICON_TONE: Record<IconTone, string> = {
  default: 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100',
  danger:  'text-neutral-400 hover:text-red-500 hover:bg-red-50',
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: IconTone;
  size?: Size;
}

export function IconButton({ tone = 'default', size = 'md', className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        size === 'sm' ? 'p-1' : 'p-1.5',
        ICON_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
