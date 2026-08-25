import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MyWorkspace } from './types';
import { normalizeFeatures } from './types';
import type { TierType } from '@/lib/ai/types';
import type { CompanyRole } from '@/lib/types/company';

const COMPANY_SELECT = 'role, companies(id, name, slug, plan, type, status, settings, features, join_code, ai_tier, created_at, updated_at)';

type CompanyShape = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  type: string;
  status: string;
  settings: Record<string, unknown> | null;
  features: unknown;
  join_code: string;
  ai_tier: string | null;
  created_at: string;
  updated_at: string;
};

type RawRow = {
  role: CompanyRole;
  companies: CompanyShape | CompanyShape[] | null;
};

function rowToWorkspace(data: RawRow): MyWorkspace | null {
  if (!data?.companies) return null;
  const company = Array.isArray(data.companies) ? data.companies[0] : data.companies;
  if (!company) return null;
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
    ai_tier: (company.ai_tier as TierType | null) ?? null,
    created_at: company.created_at,
    updated_at: company.updated_at,
    role: data.role,
  };
}

async function fetchWorkspace(
  userId: string,
  supabase: SupabaseClient,
): Promise<MyWorkspace | null> {
  const { data } = await supabase
    .from('company_members')
    .select(COMPANY_SELECT)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle() as { data: RawRow | null };

  if (!data) return null;
  return rowToWorkspace(data);
}

// React-cached — within a single request/RSC tree, only one DB round-trip.
export const getMyWorkspace = cache(fetchWorkspace);

// Features-only, works with any client (incl. the admin client used by internal/AgentOS
// routes that have no cookie session). Falls back to DEFAULT_FEATURES.
// LATENCY: it reads through getMyWorkspace, NOT fetchWorkspace — a route that BOTH gates on a
// feature (requireFeature → getMyWorkspace) and reads the feature map used to fire the identical
// `company_members` select twice per request. React's cache() is keyed on (userId, client), so a
// caller with its own admin client simply misses the cache and pays what it paid before.
export async function getWorkspaceFeatures(userId: string, supabase: SupabaseClient) {
  const ws = await getMyWorkspace(userId, supabase);
  const { DEFAULT_FEATURES } = await import('./types');
  return ws?.features ?? DEFAULT_FEATURES;
}

// The current user's profile row, React-cached by userId so the layout + feature guard +
// page share ONE query per render (was 2–3 separate `profiles` reads per navigation).
// Creates its own client internally so the cache key is just userId (reliably dedupes).
export const getMyProfile = cache(async (userId: string) => {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('is_super_admin, needs_join, full_name')
    .eq('id', userId)
    .maybeSingle();
  return data as { is_super_admin?: boolean | null; needs_join?: boolean | null; full_name?: string | null } | null;
});
