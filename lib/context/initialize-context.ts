/**
 * Initialize User Context with Smart Defaults
 *
 * Extracts user info and applies domain-based defaults for communication style.
 * Identity (name, role) from onboarding, style learned from sent emails.
 */

import { UserContextProfile, DEFAULT_USER_CONTEXT } from '@/lib/types/user-context';

export interface UserInfo {
  fullName?: string;
  email: string;
  organizationDomain?: string;
}

/**
 * Initialize context with smart defaults based on user info
 */
export function initializeContextWithDefaults(
  userInfo: UserInfo,
  existingContext?: UserContextProfile
): UserContextProfile {
  const context = existingContext || { ...DEFAULT_USER_CONTEXT };

  // Extract name components
  const firstName = userInfo.fullName?.split(' ')[0] || 'there';
  const domain = userInfo.email.split('@')[1];

  // Infer formality from email domain
  const formalityScore = inferFormalityFromDomain(domain);

  // Update communication style with smart defaults
  context.communicationStyle.formalityScore = formalityScore;
  context.communicationStyle.toneVector.formal = formalityScore;
  context.communicationStyle.toneVector.casual = 1 - formalityScore;
  context.communicationStyle.toneVector.friendly = 0.6;
  context.communicationStyle.toneVector.direct = 0.5;

  // Set default signature
  if (!context.communicationStyle.signatureStyle) {
    context.communicationStyle.signatureStyle = `Best,\n${firstName}`;
  }

  // Set default greeting
  if (context.communicationStyle.greetingPatterns.length === 0) {
    const greeting = formalityScore > 0.7 ? 'Dear' : formalityScore > 0.5 ? 'Hello' : 'Hi';
    context.communicationStyle.greetingPatterns = [greeting];
  }

  return context;
}

/**
 * Infer formality level from email domain
 */
function inferFormalityFromDomain(domain: string): number {
  // Very formal domains
  if (domain.match(/\.(gov|mil|edu|law|legal|consulting)$/)) {
    return 0.8;
  }

  // Formal business domains
  if (domain.match(/\.(corp|inc|llc|bank|finance|insurance)$/)) {
    return 0.7;
  }

  // Professional domains
  if (domain.match(/\.(com|co|io|ai|tech)$/)) {
    return 0.6;
  }

  // Casual domains
  if (domain.match(/\.(gmail|yahoo|hotmail|outlook|icloud)$/)) {
    return 0.4;
  }

  // Default: professional
  return 0.6;
}

/**
 * Get user info from database
 */
export async function getUserInfo(userId: string, supabase: any): Promise<UserInfo | null> {
  try {
    const { data: user, error } = await supabase
      .from('profiles')
      .select('full_name, email, organization_id')
      .eq('id', userId)
      .single();

    if (error || !user) {
      // Fallback to auth.users
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      if (authUser?.user) {
        return {
          email: authUser.user.email || '',
          fullName: authUser.user.user_metadata?.full_name,
        };
      }
      return null;
    }

    return {
      fullName: user.full_name,
      email: user.email,
      organizationDomain: user.email?.split('@')[1],
    };
  } catch (error) {
    console.error('[InitializeContext] Error fetching user info:', error);
    return null;
  }
}
