import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { removeAugmtdLabels } from '@/lib/inbox/rules/mailbox-labels';

export const maxDuration = 300;

// W10 THE MAILBOX IS THE USER'S — the Settings door onto THE ONE cleanup
// (lib/inbox/rules/mailbox-labels.ts `removeAugmtdLabels`, the same function the ops script runs).
// Removes ONLY the labels/categories AUGMTD created in THIS user's own mailboxes, scoped by their own
// choice: labels off → every AUGMTD label; labels on → only the retired ones (kinds + FYI-era
// postures). Never a user's own label. A provider write → it runs only on the user's explicit,
// confirmed click: the body must carry `confirm: true` (the surface asks first). `dryRun: true`
// returns what would go without touching anything.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { confirm?: unknown; dryRun?: unknown };
  const dryRun = body.dryRun === true;
  if (!dryRun && body.confirm !== true) {
    return NextResponse.json({ error: 'Removing labels from your mailbox needs your confirmation.' }, { status: 400 });
  }

  const report = await removeAugmtdLabels(supabase, user.id, { apply: !dryRun, deadlineMs: 240_000 });
  const removed = report.connections.reduce((n, c) => n + c.labelsRemoved.length, 0);
  const found = report.connections.reduce((n, c) => n + c.labelsFound.length, 0);
  const leftBehind = report.connections.reduce((n, c) => n + c.leftBehind, 0);

  if (!dryRun) {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(supabase, user.id, {
      type: 'mailbox_labels_removed',
      title: `Removed ${removed} AUGMTD label${removed === 1 ? '' : 's'} from your mailbox${leftBehind ? ` (${leftBehind} left — run it again to finish)` : ''}`,
      metadata: { scope: report.scope, connections: report.connections },
    });
  }
  return NextResponse.json({ scope: report.scope, applied: report.applied, found, removed, leftBehind, connections: report.connections });
}
