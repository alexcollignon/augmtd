// The ONE short-date grammar (just-works P4 — the single-source sweep). Four components each owned a
// private `toLocaleDateString` wrapper with subtly different names (fmtDue / fmtShort / fmtWhen /
// fmtDate); these are the canonical three. A date-only ISO ("2026-07-15") is anchored to local
// midnight so it never shifts a day across timezones.

const anchor = (iso: string): Date => new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);

/** "Jul 15" — the compact everywhere-date (row badges, chips, station rows). */
export function fmtMonthDay(iso?: string | null): string {
  if (!iso) return '';
  const d = anchor(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Jul 15, 4:32 PM" — a moment (email received, meeting start). */
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** "Tue, Jul 15" — a day with its weekday (due dates in prose contexts). */
export function fmtWeekdayDate(iso?: string | null): string {
  if (!iso) return '';
  const d = anchor(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
