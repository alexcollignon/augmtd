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
  activeWorkspaceId?: string | null,
): Promise<MyWorkspace | null> {
  let query = supabase
    .from('company_members')
    .select(COMPANY_SELECT)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (activeWorkspaceId) {
    query = query.eq('company_id', activeWorkspaceId);
  }

  const { data } = await query.maybeSingle() as { data: RawRow | null };

  if (!data) return null;
  const workspace = rowToWorkspace(data);
  return workspace;
}

export async function getAllWorkspaces(userId: string): Promise<MyWorkspace[]> {
  // Must use service role to bypass the self-referential RLS policy on
  // company_members which otherwise returns incomplete results for multi-workspace users.
  const { createClient: createAdminClient } = await import('@supabase/supabase-js');
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data } = await admin
    .from('company_members')
    .select(COMPANY_SELECT)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true }) as { data: RawRow[] | null };

  if (!data) return [];
  return data.map(rowToWorkspace).filter((w): w is MyWorkspace => w !== null);
}

// React-cached — within a single request/RSC tree, only one DB round-trip.
export const getMyWorkspace = cache(fetchWorkspace);
