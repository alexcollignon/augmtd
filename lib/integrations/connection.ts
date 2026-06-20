// ─── Integration connection resolution (scope-aware) ─────────────────────────
// Resolves which Nango connection_id to use for a user + provider, honouring the
// provider's scope (company-shared like Slack, vs personal). Used by both the
// API routes and the tool executors.

import { createClient } from '@supabase/supabase-js';
import { getIntegration, INTEGRATIONS } from './registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

let _admin: Admin = null;
/** Service-role client for integration reads/writes that must bypass RLS. */
export function integrationsAdmin(): Admin {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _admin;
}

export async function getCompanyForUser(admin: Admin, userId: string): Promise<{ companyId: string; role: string } | null> {
  const { data } = await admin
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (!data?.company_id) return null;
  return { companyId: data.company_id as string, role: (data.role as string) ?? 'member' };
}

export function canManageIntegrations(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** The Nango connection key for this user + provider (company_id or user_id). null if no company for a company-scoped provider. */
export async function resolveConnectionKey(admin: Admin, userId: string, provider: string): Promise<string | null> {
  const def = getIntegration(provider);
  if (!def) return null;
  if (def.scope === 'company') {
    const company = await getCompanyForUser(admin, userId);
    return company?.companyId ?? null;
  }
  return userId;
}

export interface ResolvedConnection {
  connectionId: string;
  metadata: Record<string, unknown>;
}

/** Active connection for this user + provider, or null if not connected. */
export async function resolveConnection(admin: Admin, userId: string, provider: string): Promise<ResolvedConnection | null> {
  const def = getIntegration(provider);
  if (!def) return null;

  if (def.scope === 'company') {
    const company = await getCompanyForUser(admin, userId);
    if (!company) return null;
    const { data } = await admin
      .from('integration_connections')
      .select('nango_connection_id, status, metadata')
      .eq('company_id', company.companyId)
      .eq('provider', provider)
      .eq('scope', 'company')
      .maybeSingle();
    if (!data || data.status !== 'active') return null;
    return { connectionId: data.nango_connection_id as string, metadata: (data.metadata as Record<string, unknown>) ?? {} };
  }

  const { data } = await admin
    .from('integration_connections')
    .select('nango_connection_id, status, metadata')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('scope', 'user')
    .maybeSingle();
  if (!data || data.status !== 'active') return null;
  return { connectionId: data.nango_connection_id as string, metadata: (data.metadata as Record<string, unknown>) ?? {} };
}

/** Active provider keys available to this user (own + their company's), for tool gating + context. */
export async function listConnectedProviders(admin: Admin, userId: string): Promise<string[]> {
  const company = await getCompanyForUser(admin, userId);
  const filters = [`user_id.eq.${userId}`];
  if (company) filters.push(`company_id.eq.${company.companyId}`);
  const { data } = await admin
    .from('integration_connections')
    .select('provider')
    .eq('status', 'active')
    .or(filters.join(','));
  return [...new Set<string>((data ?? []).map((r: { provider: string }) => r.provider))];
}

/** A `[CONNECTED INTEGRATIONS]` prompt block, or '' if none. Injected into worker context. */
export async function buildConnectedIntegrationsBlock(admin: Admin, userId: string): Promise<string> {
  try {
    const providers = await listConnectedProviders(admin, userId);
    if (providers.length === 0) return '';
    const names = providers.map(p => INTEGRATIONS.find(i => i.provider === p)?.name ?? p);
    return (
      `[CONNECTED INTEGRATIONS]\nConnected and available to you: ${names.join(', ')}. ` +
      `Use their tools to read or act in them — don't claim you can't. ` +
      `If the user asks about a tool that isn't connected, say it can be connected in Settings → Connections.`
    );
  } catch {
    return '';
  }
}
