import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlatformStatus } from '@/lib/platform/status';

export const maxDuration = 60;

// ─── STATUS ALERTS (the status board's push half, Sep 1) ────────────────────────────────
// The status page is pull — this cron is the push: every 6h it runs the SAME probe pass
// and, ONLY when RED warnings exist, emails every superadmin. Amber never mails (ambient
// signals belong on the page; an inbox that cries amber trains people to ignore red).
// Dedup: the alert fingerprint (sorted red texts) is remembered per superadmin on an
// item_plans kind row ('status_alert' — the house settings-store precedent, zero
// migration) — an unchanged set of reds mails ONCE, a changed set mails again.

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const status = await getPlatformStatus(sb);
  const reds = status.warnings.filter(w => w.severity === 'red');
  if (reds.length === 0) return NextResponse.json({ ok: true, reds: 0, mailed: 0 });

  const fingerprint = reds.map(r => r.text).sort().join('|').slice(0, 2000);

  const { data: admins } = await sb
    .from('profiles')
    .select('id, email')
    .eq('is_super_admin', true);
  const targets = (admins ?? []).filter(a => a.email);
  if (!targets.length) return NextResponse.json({ ok: true, reds: reds.length, mailed: 0, note: 'no superadmin emails' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY missing' }, { status: 500 });
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  let mailed = 0;
  for (const admin of targets) {
    const { data: fpRow } = await sb.from('item_plans').select('tasks')
      .eq('user_id', admin.id).eq('kind', 'status_alert').eq('entity_id', 'platform').maybeSingle();
    const prev = (fpRow?.tasks as { fp?: string } | null)?.fp;
    if (prev === fingerprint) continue;
    const { error } = await resend.emails.send({
      from: 'AUGMTD Status <status@team.augmtd.ai>',
      to: admin.email as string,
      subject: `🔴 Platform status: ${reds.length} thing${reds.length === 1 ? '' : 's'} broken`,
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1a1a1a;max-width:560px">` +
        `<p><strong>${reds.length} red warning${reds.length === 1 ? '' : 's'}</strong> on the platform status board:</p>` +
        `<ul>${reds.map(r => `<li style="margin-bottom:8px">${r.text.replace(/</g, '&lt;')}</li>`).join('')}</ul>` +
        `<p><a href="https://app.augmtd.ai/platform-admin?tab=status">Open the status board →</a></p>` +
        `<p style="color:#888;font-size:12px">Sent only when something is red, and only once per distinct set of problems. Ambers stay on the board.</p>` +
        `</div>`,
    });
    if (!error) {
      mailed++;
      await sb.from('item_plans').upsert(
        { user_id: admin.id, kind: 'status_alert', entity_id: 'platform', tasks: { fp: fingerprint }, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,kind,entity_id' },
      );
    }
  }

  return NextResponse.json({ ok: true, reds: reds.length, mailed });
}
