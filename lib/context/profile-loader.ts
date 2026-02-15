/**
 * Profile Loader
 *
 * Loads modular context profiles from the new context_profiles table.
 * Each profile type is stored separately and loaded on demand.
 */

import { createClient } from '@/lib/supabase/server';

// ============= PROFILE TYPES =============

export type ProfileType =
  | 'identity'
  | 'email_communication'
  | 'domain_knowledge'
  | 'relationships'  // Uses existing relationship_graph table
  | 'slack_communication'
  | 'meeting_behavior'
  | 'work_patterns';

export interface ProfileRecord {
  id: string;
  user_id: string;
  profile_type: ProfileType;
  profile_data: any;
  confidence_score: number;
  learned_from_count: number;
  created_at: string;
  last_updated: string;
}

// ============= PROFILE DATA TYPES =============

export interface IdentityProfile {
  fullName: string;
  role: string;
  email: string;
  responsibilities: string[];
  authority: 'ic' | 'manager' | 'executive' | 'unknown';
}

export interface EmailCommunicationProfile {
  signature: string | null;
  greetingPatterns: string[];
  tone: number; // 0=casual, 1=formal
  formalityScore: number;
  avgLength: number;
  emojiUsage: number;
  commonPhrases: string[];
  responsePatterns: {
    avgResponseTime: number;
    priorityAdjustments: Record<string, number>;
  };
}

export interface DomainKnowledgeProfile {
  vocabulary: Record<string, string>;
  workflows: WorkflowPattern[];
  expertise: string[];
}

export interface WorkflowPattern {
  id: string;
  name: string;
  frequency: string;
  steps: string[];
  userRole: 'owner' | 'contributor' | 'reviewer';
}

export interface RelationshipProfile {
  contacts: ContactContext[];
}

export interface MeetingBehaviorProfile {
  // Scheduling preferences
  preferredTimes: string[];           // ["10:00-12:00", "14:00-16:00"]
  noMeetingDays: string[];            // ["Friday PM", "Monday AM"]
  avgMeetingLength: number;           // Average duration in minutes

  // Patterns
  schedulingPatterns: {
    bufferTime: number;               // Preferred minutes between meetings
    backToBackTolerance: number;      // 0-1, how often they do back-to-back
    advanceBookingDays: number;       // How far in advance they typically book
  };

  // Participation
  participationStyle: 'active' | 'observant' | 'balanced';
  organizerRate: number;              // 0-1, how often they organize vs attend
  acceptanceRate: number;             // 0-1, how often they accept invites

  // Meeting types
  meetingTypes: Record<string, {
    frequency: number;                // Times per week
    avgDuration: number;              // Minutes
    typicalAttendees: string[];       // Email addresses
  }>;
}

export interface ContactContext {
  email: string;
  name?: string;
  relationship: 'client' | 'internal' | 'vendor' | 'other';
  importance: number;
  interactionCount: number;
  lastInteraction: string;
  topics: string[];
  preferredChannel?: 'email' | 'slack' | 'both';
}

// Map of profile types to their data structures
export type ProfileDataMap = {
  identity: IdentityProfile;
  email_communication: EmailCommunicationProfile;
  domain_knowledge: DomainKnowledgeProfile;
  relationships: RelationshipProfile;
  meeting_behavior: MeetingBehaviorProfile;
  slack_communication: any; // Future
  work_patterns: any; // Future
};

// Type for profiles loaded from DB (includes confidence metadata)
export type LoadedProfile<T> = T & {
  _confidence: number;
  _signalCount: number;
};

// ============= PROFILE LOADER CLASS =============

export class ProfileLoader {
  /**
   * Load specific profile types for a user
   */
  static async loadProfiles<T extends ProfileType>(
    userId: string,
    profileTypes: T[]
  ): Promise<Partial<{ [K in T]: LoadedProfile<ProfileDataMap[K]> }>> {
    const supabase = await createClient();

    // Separate relationships from other profiles
    const regularProfiles = profileTypes.filter(t => t !== 'relationships');
    const needsRelationships = profileTypes.includes('relationships' as T);

    const result: any = {};

    // Load regular profiles from context_profiles table
    if (regularProfiles.length > 0) {
      const { data: profiles, error } = await supabase
        .from('context_profiles')
        .select('profile_type, profile_data, confidence_score, learned_from_count')
        .eq('user_id', userId)
        .in('profile_type', regularProfiles);

      if (error) {
        console.error('[ProfileLoader] Error loading profiles:', error);
      } else if (profiles) {
        profiles.forEach(profile => {
          result[profile.profile_type] = {
            ...profile.profile_data,
            _confidence: profile.confidence_score,
            _signalCount: profile.learned_from_count,
          };
        });
      }
    }

    // Load relationships from relationship_graph table
    if (needsRelationships) {
      const { data: contacts, error } = await supabase
        .from('relationship_graph')
        .select('*')
        .eq('user_id', userId)
        .order('importance', { ascending: false });

      if (error) {
        console.error('[ProfileLoader] Error loading relationships:', error);
      } else if (contacts) {
        result.relationships = {
          contacts: contacts.map(c => ({
            email: c.contact_email,
            name: c.contact_name,
            relationship: c.relationship_type,
            importance: c.importance,
            interactionCount: c.interaction_frequency,
            lastInteraction: c.last_interaction,
            topics: c.typical_topics || [],
            preferredChannel: c.preferred_channel,
          })),
          _confidence: contacts.length > 0 ? Math.min(contacts.length * 10, 100) : 0,
          _signalCount: contacts.length,
        };
      }
    }

    return result;
  }

  /**
   * Load a single profile
   */
  static async loadProfile<T extends ProfileType>(
    userId: string,
    profileType: T
  ): Promise<ProfileDataMap[T] | null> {
    const profiles = await this.loadProfiles(userId, [profileType]);
    return profiles[profileType] || null;
  }

  /**
   * Update a profile (upsert)
   */
  static async updateProfile<T extends ProfileType>(
    userId: string,
    profileType: T,
    profileData: ProfileDataMap[T],
    confidenceScore?: number,
    incrementSignalCount: boolean = false
  ): Promise<void> {
    const supabase = await createClient();

    // Handle relationships separately (different table)
    if (profileType === 'relationships') {
      console.warn('[ProfileLoader] Use relationship_graph table directly for relationships');
      return;
    }

    // Prepare the update
    const updateData: any = {
      user_id: userId,
      profile_type: profileType,
      profile_data: profileData,
    };

    if (confidenceScore !== undefined) {
      updateData.confidence_score = confidenceScore;
    }

    // Increment signal count if requested
    if (incrementSignalCount) {
      // Get current count
      const { data: current } = await supabase
        .from('context_profiles')
        .select('learned_from_count')
        .eq('user_id', userId)
        .eq('profile_type', profileType)
        .single();

      updateData.learned_from_count = (current?.learned_from_count || 0) + 1;
    }

    const { error } = await supabase
      .from('context_profiles')
      .upsert(updateData, {
        onConflict: 'user_id,profile_type',
      });

    if (error) {
      console.error('[ProfileLoader] Error updating profile:', error);
      throw error;
    }
  }

  /**
   * Get profile metadata (confidence, signal count)
   */
  static async getProfileMetadata(
    userId: string,
    profileType: ProfileType
  ): Promise<{ confidence: number; signalCount: number } | null> {
    const supabase = await createClient();

    // Handle relationships separately
    if (profileType === 'relationships') {
      const { count } = await supabase
        .from('relationship_graph')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      return {
        confidence: count ? Math.min(count * 10, 100) : 0,
        signalCount: count || 0,
      };
    }

    const { data, error } = await supabase
      .from('context_profiles')
      .select('confidence_score, learned_from_count')
      .eq('user_id', userId)
      .eq('profile_type', profileType)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      confidence: data.confidence_score,
      signalCount: data.learned_from_count,
    };
  }

  /**
   * Get all profiles for a user (summary)
   */
  static async getAllProfilesSummary(userId: string): Promise<
    {
      profileType: ProfileType;
      confidence: number;
      signalCount: number;
      lastUpdated: string;
    }[]
  > {
    const supabase = await createClient();

    // Get regular profiles
    const { data: profiles } = await supabase
      .from('context_profiles')
      .select('profile_type, confidence_score, learned_from_count, last_updated')
      .eq('user_id', userId);

    // Get relationships count
    const { count: contactsCount } = await supabase
      .from('relationship_graph')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const summary = [
      ...(profiles || []).map(p => ({
        profileType: p.profile_type as ProfileType,
        confidence: p.confidence_score,
        signalCount: p.learned_from_count,
        lastUpdated: p.last_updated,
      })),
    ];

    // Add relationships if they exist
    if (contactsCount && contactsCount > 0) {
      summary.push({
        profileType: 'relationships',
        confidence: Math.min(contactsCount * 10, 100),
        signalCount: contactsCount,
        lastUpdated: new Date().toISOString(), // Could fetch from relationship_graph
      });
    }

    return summary;
  }

  /**
   * Initialize default profiles for a new user
   */
  static async initializeUser(
    userId: string,
    fullName: string,
    role: string,
    email: string
  ): Promise<void> {
    const supabase = await createClient();

    // Create identity profile
    await supabase.from('context_profiles').insert({
      user_id: userId,
      profile_type: 'identity',
      profile_data: {
        fullName,
        role,
        email,
        responsibilities: [],
        authority: 'unknown',
      },
      confidence_score: 95.0, // High - explicit from onboarding
      learned_from_count: 1,
    });

    // Create email communication profile (defaults)
    const firstName = fullName.split(' ')[0] || 'there';
    const domain = email.split('@')[1];
    const formalityScore = inferFormalityFromDomain(domain);

    await supabase.from('context_profiles').insert({
      user_id: userId,
      profile_type: 'email_communication',
      profile_data: {
        signature: `Best,\n${firstName}`,
        greetingPatterns: [formalityScore > 0.7 ? 'Dear' : formalityScore > 0.5 ? 'Hello' : 'Hi'],
        tone: formalityScore,
        formalityScore,
        avgLength: 0,
        emojiUsage: 0,
        commonPhrases: [],
        responsePatterns: {
          avgResponseTime: 0,
          priorityAdjustments: {},
        },
      },
      confidence_score: 20.0, // Low - domain heuristic
      learned_from_count: 0,
    });

    // Create domain knowledge profile (empty)
    await supabase.from('context_profiles').insert({
      user_id: userId,
      profile_type: 'domain_knowledge',
      profile_data: {
        vocabulary: {},
        workflows: [],
        expertise: [],
      },
      confidence_score: 0,
      learned_from_count: 0,
    });

    // Create meeting behavior profile (defaults)
    await supabase.from('context_profiles').insert({
      user_id: userId,
      profile_type: 'meeting_behavior',
      profile_data: {
        preferredTimes: [],
        noMeetingDays: [],
        avgMeetingLength: 30,
        schedulingPatterns: {
          bufferTime: 15,
          backToBackTolerance: 0.5,
          advanceBookingDays: 7,
        },
        participationStyle: 'balanced',
        organizerRate: 0.5,
        acceptanceRate: 0.5,
        meetingTypes: {},
      },
      confidence_score: 0,
      learned_from_count: 0,
    });
  }
}

// ============= HELPER FUNCTIONS =============

function inferFormalityFromDomain(domain: string): number {
  if (domain.match(/\.(gov|mil|edu|law|legal|consulting)$/)) return 0.8;
  if (domain.match(/\.(corp|inc|llc|bank|finance|insurance)$/)) return 0.7;
  if (domain.match(/\.(com|co|io|ai|tech)$/)) return 0.6;
  if (domain.match(/\.(gmail|yahoo|hotmail|outlook|icloud)$/)) return 0.4;
  return 0.6;
}
