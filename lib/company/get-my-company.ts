import type { SupabaseClient } from '@supabase/supabase-js';
import type { MyCompany } from '@/lib/types/company';

export async function getMyCompany(userId: string, supabase: SupabaseClient): Promise<MyCompany | null> {
  // Query company_members directly — source of truth, not profiles.company_id (denormalized cache)
  const { data } = await supabase
    .from('company_members')
    .select('role, companies(id, name, slug, plan, status, settings, join_code, created_at, updated_at)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (!data?.companies) return null;

  const company = Array.isArray(data.companies) ? data.companies[0] : data.companies;

  // Keep profiles.company_id in sync (best-effort — doesn't block)
  if (company?.id) {
    supabase.from('profiles').update({ company_id: company.id }).eq('id', userId).then(() => {});
  }

  return {
    ...company,
    role: data.role as MyCompany['role'],
  } as MyCompany;
}
