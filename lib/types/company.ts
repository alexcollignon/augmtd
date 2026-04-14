export type CompanyRole = 'owner' | 'admin' | 'member';
export type CompanyPlan = 'starter' | 'growth' | 'enterprise';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked';
export type MemberStatus = 'active' | 'suspended';
export type CompanyType = 'company' | 'beta' | 'pilot' | 'internal';
export type CompanyStatus = 'active' | 'suspended' | 'deleting';

export interface Company {
  id: string;
  name: string;
  slug: string;
  plan: CompanyPlan;
  type: CompanyType;
  status: CompanyStatus;
  settings: Record<string, unknown>;
  features: Record<string, boolean>;
  join_code: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  role: CompanyRole;
  status: MemberStatus;
  joined_at: string;
  last_active_at: string | null;
  // Joined from profiles
  email?: string;
  full_name?: string | null;
}

export interface CompanyInvitation {
  id: string;
  company_id: string;
  invited_by: string;
  email: string;
  role: CompanyRole;
  token: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
}

export interface MyCompany extends Company {
  role: CompanyRole;
}
