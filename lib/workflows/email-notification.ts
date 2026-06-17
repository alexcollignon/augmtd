// ─── Workflow email notification via Resend ────────────────────────────────────
// Called at the end of run-workflow.ts when notification_mode === 'email_digest'.
// Sends a branded email with either a presigned artifact download link or the
// text output inline in the body.

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import type { DocumentArtifact } from '@/lib/types/inbox';

const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://app.augmtd.ai';

// ── HTML template ─────────────────────────────────────────────────────────────

function buildEmailHtml(params: {
  workflowName: string;
  runDate: string;
  bodyHtml: string;
  artifactTitle?: string;
  artifactUrl?: string;
}): string {
  const { workflowName, runDate, bodyHtml, artifactTitle, artifactUrl } = params;
  const logoUrl = `${BASE_URL}/augmtd-logo.png`;

  const artifactButton = artifactTitle && artifactUrl ? `
    <tr>
      <td align="center" style="padding: 8px 0 32px;">
        <a href="${artifactUrl}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">
          Download ${escHtml(artifactTitle)}
        </a>
      </td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(workflowName)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f2;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <img src="${logoUrl}" alt="augmtd" height="28"
                   style="display:block;height:28px;width:auto;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
              <table width="100%" cellpadding="0" cellspacing="0">

                <!-- Header stripe -->
                <tr>
                  <td style="background:#4f46e5;padding:20px 32px;">
                    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Workflow complete</p>
                    <h1 style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">${escHtml(workflowName)}</h1>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:28px 32px 4px;">
                    ${bodyHtml}
                  </td>
                </tr>

                <!-- Artifact CTA -->
                ${artifactButton}

                <!-- Footer inside card -->
                <tr>
                  <td style="padding:0 32px 24px;border-top:1px solid #f0f0f0;padding-top:16px;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;">
                      Run completed ${escHtml(runDate)}
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Global footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                augmtd · <a href="${BASE_URL}/workers" style="color:#9ca3af;text-decoration:underline;">Open AUGMTD</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Convert plain markdown-ish text to safe inline HTML paragraphs.
// Preserves headings (## → <h3>) and paragraph breaks without injecting arbitrary HTML.
function textToBodyHtml(text: string): string {
  const paragraphs = text.split(/\n{2,}/).map(block => {
    const line = block.trim();
    if (!line) return '';
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) return `<h3 style="margin:16px 0 6px;color:#111827;font-size:15px;font-weight:600;">${escHtml(h2[1])}</h3>`;
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) return `<h4 style="margin:12px 0 4px;color:#374151;font-size:14px;font-weight:600;">${escHtml(h3[1])}</h4>`;
    // Bold **text**
    const inner = escHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.6;">${inner}</p>`;
  });
  return paragraphs.join('');
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendWorkflowEmail(params: {
  userId: string;
  workflowName: string;
  messageContent: string;
  artifact?: DocumentArtifact;
  notificationEmailIds?: string[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[workflow-email] RESEND_API_KEY not set — skipping email');
    return;
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Resolve recipient addresses from selected connection IDs
  let toAddresses: string[] = [];
  if (params.notificationEmailIds && params.notificationEmailIds.length > 0) {
    const { data: conns } = await admin
      .from('connections')
      .select('id, metadata')
      .eq('user_id', params.userId)
      .eq('status', 'active')
      .in('id', params.notificationEmailIds);
    toAddresses = (conns ?? [])
      .map((c: { metadata: unknown }) => (c.metadata as Record<string, string>)?.email)
      .filter(Boolean) as string[];
  }

  // Fallback to auth email if no connection IDs configured
  if (toAddresses.length === 0) {
    const { data: { user }, error: userErr } = await admin.auth.admin.getUserById(params.userId);
    if (userErr || !user?.email) {
      console.error('[workflow-email] could not resolve recipient email:', userErr);
      return;
    }
    toAddresses = [user.email];
  }

  // Build presigned URL for artifact (7 day expiry)
  let artifactUrl: string | undefined;
  if (params.artifact?.storage_path) {
    const { data: signed } = await admin.storage
      .from('work-artifacts')
      .createSignedUrl(params.artifact.storage_path, 7 * 24 * 3600);
    artifactUrl = signed?.signedUrl;
  }

  const runDate = new Date().toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const bodyHtml = params.artifact
    ? `<p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6;">
        Your <strong>${escHtml(params.artifact.title)}</strong> is ready to download.
       </p>`
    : textToBodyHtml(params.messageContent.slice(0, 2000));

  const html = buildEmailHtml({
    workflowName: params.workflowName,
    runDate,
    bodyHtml,
    artifactTitle: params.artifact?.title,
    artifactUrl,
  });

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: 'augmtd <noreply@workflows.augmtd.ai>',
    to: toAddresses,
    subject: `${params.workflowName} — run complete`,
    html,
  });

  if (error) {
    console.error('[workflow-email] send failed:', error);
  }
}
