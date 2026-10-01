// LAW `one-reader-zone` (invariant 14 TIME TRUTH) — THE SAME EVENT NEVER SHOWS TWO TIMES.
// Zero-AI. The outcomes and the render-site sweep live in tests/unit/user-zone.test.ts (one home for
// the assertions); this suite is the registry's named gate and runs exactly that file:
//   · Home's server label and the client helpers render one event identically in the user's zone;
//   · the served zone wins, the device zone is only the fallback; the hint speaks only on a real
//     clock difference;
//   · no client render site (components/**, app/** pages) formats an event's time or day in the
//     device's zone, or sends the device's zone as an event's zone;
//   · the shell serves the zone (app/(main)/layout.tsx) and Home + Meetings read it.
import { execSync } from 'node:child_process';
try {
  execSync('npx vitest run tests/unit/user-zone.test.ts', { stdio: 'inherit' });
  console.log('\n════ READER ZONE ════\n ✓ one event, one time, one zone\n');
} catch {
  console.log('\n════ READER ZONE ════\n ✗ a surface renders event times outside the user zone\n');
  process.exit(1);
}
