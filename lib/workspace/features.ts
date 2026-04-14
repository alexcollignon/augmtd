import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MyWorkspace } from './types';
import { normalizeFeatures } from './types';
import type { CompanyRole } from '@/lib/types/company';

type RawRow = {
  role: CompanyRole;
  companies: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    type: string;
    status: string;
    settings: Record<string, unknown> | null;
    features: unknown;
    join_code: string;
    created_at: string;
    updated_at: string;
  } | {
    id: string;
    name: string;
    slug: string;
    plan: string;
    type: string;
    status: string;
    settings: Record<string, unknown> | null;
    features: unknown;
    join_code: string;
    created_at: string;
    updated_at: string;
  }[] | null;
};

async function fetchWorkspace(
  userId: string,
  supabase: SupabaseClient
): Promise<MyWorkspace | null> {
  const { data } = await supabase
    .from('company_members')
    .select(
      'role, companies(id, name, slug, plan, type, status, settings, features, join_code, created_at, updated_at)'
    )
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle() as { data: RawRow | null };

  if (!data?.companies) return null;

  const company = Array.isArray(data.companies) ? data.companies[0] : data.companies;
  if (!company) return null;

  // Best-effort profile sync (not awaited)
  supabase
    .from('profiles')
    .update({ company_id: company.id })
    .eq('id', userId)
    .then(() => {});

  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    plan: company.plan as MyWorkspace['plan'],
    type: company.type as MyWorkspace['type'],
    status: company.status as MyWorkspace['status'],
    features: normalizeFeatures(company.features),
    settings: (company.settings ?? {}) as Record<string, unknown>,
    join_code: company.join_code,
    created_at: company.created_at,
    updated_at: company.updated_at,
    role: data.role,
  };
}

// React-cached — within a single request/RSC tree, only one DB round-trip.
export const getMyWorkspace = cache(fetchWorkspace);
