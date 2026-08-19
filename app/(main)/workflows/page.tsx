import { redirect } from 'next/navigation';

// ── /workflows — the bare route is NOT a second surface. The Workflows page lives inside the
// Home shell (`/home?view=workflows`); this seat exists only so the deep-dive's parent path
// (and any hand-typed/deep link) lands on the real surface instead of a 404.
export default function WorkflowsIndexPage() {
  redirect('/home?view=workflows');
}
