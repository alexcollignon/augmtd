'use client';

import { HEALTH_META, type ProjectHealthStatus } from '@/lib/projects/health';

// The auto-derived project health, as a small chip. Same visual everywhere a project appears.
export default function HealthChip({ status, size = 'md' }: { status: ProjectHealthStatus; size?: 'sm' | 'md' }) {
  const m = HEALTH_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${m.bg} ${m.text} ${size === 'sm' ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-1 text-[11px]'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}
    </span>
  );
}
