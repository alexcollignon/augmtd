import Link from 'next/link';
import { ArrowLeftIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import { guardFeaturePage } from '@/lib/workspace/guards';
import UnifiedCalendar from '@/components/calendar/unified-calendar';

// The unified calendar — everything time-bound (meetings + commitments due + follow-up nudges) on one
// week grid, reading live data. Reached from the Home (no left-sidebar item). Gets the app chrome via
// the (main) layout. Gated on the Home feature (the same surface it's launched from).
export default async function CalendarPage() {
  await guardFeaturePage('home');
  return (
    <main className="flex-1 flex flex-col h-screen overflow-hidden bg-white">
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-neutral-100">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-400 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span className="hidden sm:inline">Home</span>
        </Link>
        <div className="w-px h-4 bg-neutral-200" />
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className="w-5 h-5 text-indigo-500" />
          <h1 className="text-[18px] font-semibold text-neutral-900">Calendar</h1>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <UnifiedCalendar />
      </div>
    </main>
  );
}
