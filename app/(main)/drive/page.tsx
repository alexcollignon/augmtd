import { redirect } from 'next/navigation';

// THE DRIVE DEMOTION (one-surface plan): the folder grid died; Knowledge is a SETTINGS section
// (grounded in the Settings nav — the owner's law, Aug 6). /drive survives only so old links
// keep landing somewhere true.
export default function DrivePage() {
  redirect('/settings?tab=knowledge');
}
