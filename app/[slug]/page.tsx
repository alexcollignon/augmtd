import { redirect } from 'next/navigation';
import { createClient as createAdmin } from '@supabase/supabase-js';

// ─── LEGACY BRANDED LINKS → THE ONE ENTERPRISE DOOR ──────────────────────────────────────────
// The per-company branded landing (app.augmtd.ai/<slug>) was retired in favor of ONE generic
// corporate door at /enterprise — the workspace code identifies the company, so the slug adds
// nothing at signup (the sidebar co-brand carries the client's mark once inside). Links already
// in the wild keep working: a real workspace slug redirects to /enterprise; anything else
// bounces to /login (never an enumeration oracle — both paths look the same to a guesser
// except for the destination, which only confirms what the shared link already said).

export const dynamic = 'force-dynamic';

export default async function LegacyBrandedEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(slug)) redirect('/login');

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: company } = await admin
    .from('companies')
    .select('id')
    .ilike('slug', slug)
    .eq('status', 'active')
    .maybeSingle();

  redirect(company ? '/enterprise' : '/login');
}
