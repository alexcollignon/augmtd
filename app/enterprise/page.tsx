import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { EnterpriseEntry } from '@/components/auth/enterprise-entry';

// ─── THE ENTERPRISE DOOR ─────────────────────────────────────────────────────────────────────
// ONE generic entry for every corporate workspace: app.augmtd.ai/enterprise. The workspace
// code identifies the company (no slug, no per-client landing branding — the sidebar co-brand
// carries the client's mark once inside). Email+password ONLY (no Google/Microsoft anywhere —
// the whole point of the corporate tier). Create account AND sign in both live here; sign-out
// from a sovereign workspace returns here. Old branded /<slug> links redirect here.

export const dynamic = 'force-dynamic';

export default async function EnterpriseEntryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let mode: 'signup' | 'code' = 'signup';
  let authedEmail: string | null = null;
  if (user) {
    // A member of any active workspace goes straight home; an authed non-member
    // skips to the workspace-code step.
    const { data: mem } = await supabase
      .from('company_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (mem) redirect('/home');
    mode = 'code';
    authedEmail = user.email ?? null;
  }

  return <EnterpriseEntry mode={mode} authedEmail={authedEmail} />;
}
