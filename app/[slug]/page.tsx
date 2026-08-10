import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { CorporateEntry } from '@/components/auth/corporate-entry';

// ─── THE BRANDED ENTRY (Aug 10 — the sovereign door, arc 2) ──────────────────────────────────
// app.augmtd.ai/<slug> is a client's own front door: co-branded, email+password ONLY (no
// Google/Microsoft anywhere — the whole point of the corporate tier), three steps:
//   1. Enter your email  ·  2. Password & workspace code  ·  3. Set up your agents
// Route precedence keeps every real route ahead of this catch-all; an unknown slug bounces to
// /login (this page must never become an enumeration oracle beyond name+logo, which the
// branded URL exists to show).

export const dynamic = 'force-dynamic';

export default async function BrandedEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(slug)) redirect('/login');

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: company } = await admin
    .from('companies')
    .select('id, name, slug, status, settings')
    .ilike('slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (!company) redirect('/login');

  const branding = ((company.settings ?? {}) as { branding?: { logo_url?: string; tagline?: string } }).branding ?? {};

  // Already signed in? A member goes straight home; a non-member skips to the code step.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let mode: 'signup' | 'code' = 'signup';
  let authedEmail: string | null = null;
  if (user) {
    const { data: mem } = await admin.from('company_members').select('id')
      .eq('company_id', company.id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (mem) redirect('/home');
    mode = 'code';
    authedEmail = user.email ?? null;
  }

  return (
    <CorporateEntry
      company={{ name: company.name, slug: company.slug, logoUrl: branding.logo_url ?? null, tagline: branding.tagline ?? null }}
      mode={mode}
      authedEmail={authedEmail}
    />
  );
}
