/**
 * User Context Engine
 *
 * Processes learning signals to build user behavior profiles.
 * All learning happens automatically from micro-corrections during workflow.
 */

import { createClient } from '@/lib/supabase/server';
import { ProfileLoader } from './profile-loader';
import {
  UserContextProfile,
  LearningSignal,
  ToneDelta,
  DEFAULT_USER_CONTEXT,
  CommunicationStyle,
  RolePatterns,
  UrgencySensitivity,
  ContactContext,
} from '@/lib/types/user-context';

export class UserContextEngine {
  /**
   * Fetch current context profile for user
   */
  static async getContext(userId: string): Promise<UserContextProfile> {
    const { getUserContextLegacy } = await import('./profile-adapter');
    const supabase = await createClient();

    const context = await getUserContextLegacy(userId, supabase);

    if (!context) {
      // Return default context if none exists
      return DEFAULT_USER_CONTEXT;
    }

    return context;
  }

  /**
   * Main dispatcher - processes a signal and updates context
   */
  static async updateFromSignal(userId: string, signal: LearningSignal): Promise<void> {
    // Get current context
    const context = await this.getContext(userId);

    // Route to appropriate handler based on signal type
    switch (signal.signal_type) {
      case 'draft_modified':
        await this.updateCommunicationStyle(context, signal);
        break;
      case 'suggestion_confirmed':
      case 'suggestion_rejected':
        await this.updateRolePatterns(context, signal);
        break;
      case 'reply_sent':
        // Learn from sent emails (both style and relationships)
        await this.updateCommunicationStyle(context, signal); // NEW: Learn style from sent emails
        await this.updateUrgencySensitivity(context, signal);
        await this.updateRelationshipGraph(context, signal);
        break;
      case 'item_completed':
        await this.updateUrgencySensitivity(context, signal);
        break;
      case 'item_dismissed':
        await this.updateRolePatterns(context, signal);
        break;
    }

    // Increment confidence metrics
    context.confidenceMetrics.signalCount++;
    context.confidenceMetrics.lastUpdated = new Date().toISOString();
    this.updateConfidenceScores(context);

    // Save updated context
    await this.saveContext(userId, context);
  }

  /**
   * Learn communication style from draft edits or sent emails
   */
  private static async updateCommunicationStyle(
    context: UserContextProfile,
    signal: LearningSignal
  ): Promise<void> {
    const { original_draft, edited_draft, communication_patterns } = signal.signal_data;

    const style = context.communicationStyle;

    // Handle sent email patterns (from bootstrapping)
    if (communication_patterns && signal.signal_type === 'reply_sent') {
      this.updateFromSentEmail(style, communication_patterns, context.confidenceMetrics.signalCount);
      return;
    }

    // Handle draft edits (from user modifications)
    if (!original_draft || !edited_draft) return;

    const delta = this.extractToneDelta(original_draft, edited_draft);

    // Update average length (running average)
    style.avgLength = this.runningAverage(
      style.avgLength,
      edited_draft.length,
      context.confidenceMetrics.signalCount
    );

    // Update formality score
    if (delta.formalityChange !== 0) {
      style.formalityScore = Math.max(0, Math.min(1,
        style.formalityScore + delta.formalityChange * 0.1
      ));
    }

    // Update tone vector
    Object.keys(delta.toneVectorDelta).forEach(key => {
      const toneKey = key as keyof typeof style.toneVector;
      const change = delta.toneVectorDelta[toneKey] || 0;
      style.toneVector[toneKey] = Math.max(0, Math.min(1,
        style.toneVector[toneKey] + change * 0.1
      ));
    });

    // Learn new phrases
    delta.addedPhrases.forEach(phrase => {
      if (!style.commonPhrases.includes(phrase)) {
        style.commonPhrases.push(phrase);
      }
    });

    // Update emoji usage
    const emojiCount = (edited_draft.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length;
    const hasEmoji = emojiCount > 0 ? 1 : 0;
    style.emojiUsage = this.runningAverage(
      style.emojiUsage,
      hasEmoji,
      context.confidenceMetrics.signalCount
    );

    // Extract greeting patterns
    const greeting = this.extractGreeting(edited_draft);
    if (greeting && !style.greetingPatterns.includes(greeting)) {
      style.greetingPatterns.push(greeting);
    }

    // Extract signature
    const signature = this.extractSignature(edited_draft);
    if (signature) {
      style.signatureStyle = signature;
    }
  }

  /**
   * Learn role patterns from confirmations/rejections
   */
  private static async updateRolePatterns(
    context: UserContextProfile,
    signal: LearningSignal
  ): Promise<void> {
    const { role, position_in_to, action } = signal.signal_data;
    const patterns = context.rolePatterns;

    // Determine if user accepted or rejected
    const accepted = signal.signal_type === 'suggestion_confirmed' ||
                     action === 'confirm_as_mine';

    const acceptValue = accepted ? 1 : 0;

    // Update response rates based on role
    if (role === 'primary_recipient') {
      patterns.respondsWhenInTo = this.runningAverage(
        patterns.respondsWhenInTo,
        acceptValue,
        context.confidenceMetrics.signalCount
      );
    } else if (role === 'cc_recipient') {
      patterns.respondsWhenInCC = this.runningAverage(
        patterns.respondsWhenInCC,
        acceptValue,
        context.confidenceMetrics.signalCount
      );
    }

    // Update position sensitivity
    if (position_in_to === 0) {
      patterns.positionSensitivity.primary = this.runningAverage(
        patterns.positionSensitivity.primary,
        acceptValue,
        context.confidenceMetrics.signalCount
      );
    } else if (position_in_to && position_in_to > 0) {
      patterns.positionSensitivity.secondary = this.runningAverage(
        patterns.positionSensitivity.secondary,
        acceptValue,
        context.confidenceMetrics.signalCount
      );
    }

    // Check for @mentions
    const hasMention = signal.signal_data.has_mention;
    if (hasMention !== undefined) {
      patterns.mentionSensitivity = this.runningAverage(
        patterns.mentionSensitivity,
        acceptValue,
        context.confidenceMetrics.signalCount
      );
    }

    // Check for explicit assignments
    const hasExplicitAssignment = signal.signal_data.has_explicit_assignment;
    if (hasExplicitAssignment) {
      patterns.explicitAssignmentRate = this.runningAverage(
        patterns.explicitAssignmentRate,
        acceptValue,
        context.confidenceMetrics.signalCount
      );
    }
  }

  /**
   * Learn urgency sensitivity from response times
   */
  private static async updateUrgencySensitivity(
    context: UserContextProfile,
    signal: LearningSignal
  ): Promise<void> {
    const { response_time_seconds, urgency_score, met_deadline } = signal.signal_data;
    const urgency = context.urgencySensitivity;

    // Update average response time
    if (response_time_seconds !== undefined) {
      urgency.avgResponseTime = this.runningAverage(
        urgency.avgResponseTime,
        response_time_seconds,
        context.confidenceMetrics.signalCount
      );
    }

    // Update deadline adherence
    if (met_deadline !== undefined) {
      const metValue = met_deadline ? 1 : 0;
      urgency.deadlineAdherence = this.runningAverage(
        urgency.deadlineAdherence,
        metValue,
        context.confidenceMetrics.signalCount
      );
    }

    // Learn urgency threshold
    if (urgency_score !== undefined) {
      // If user responded to this urgency level, it's above their threshold
      urgency.thresholdScore = Math.min(urgency.thresholdScore, urgency_score);
    }

    // Extract urgency keywords from content
    const content = signal.signal_data.content;
    if (content) {
      const keywords = this.extractUrgencyKeywords(content);
      keywords.forEach(keyword => {
        if (!urgency.urgencyKeywords.includes(keyword)) {
          urgency.urgencyKeywords.push(keyword);
        }
      });
    }
  }

  /**
   * Learn relationship patterns from interactions
   */
  private static async updateRelationshipGraph(
    context: UserContextProfile,
    signal: LearningSignal
  ): Promise<void> {
    const { sender_email, response_time_seconds, topic } = signal.signal_data;

    if (!sender_email) return;

    // Get or create contact context
    let contact = context.relationshipGraph[sender_email];
    if (!contact) {
      contact = {
        email: sender_email,
        importance: 0.5,
        typicalTone: 'mixed',
        responseRate: 0,
        avgResponseTime: 0,
        lastInteraction: new Date().toISOString(),
        interactionCount: 0,
        topics: [],
      };
      context.relationshipGraph[sender_email] = contact;
    }

    // Update interaction count
    contact.interactionCount++;
    contact.lastInteraction = new Date().toISOString();

    // Update response rate (if user responded)
    if (signal.signal_type === 'reply_sent') {
      contact.responseRate = this.runningAverage(
        contact.responseRate,
        1,
        contact.interactionCount
      );
    }

    // Update average response time
    if (response_time_seconds !== undefined) {
      contact.avgResponseTime = this.runningAverage(
        contact.avgResponseTime,
        response_time_seconds,
        contact.interactionCount
      );
    }

    // Update importance (based on response rate and frequency)
    const frequencyScore = Math.min(contact.interactionCount / 100, 1);
    contact.importance = (contact.responseRate * 0.7) + (frequencyScore * 0.3);

    // Track topics
    if (topic && !contact.topics.includes(topic)) {
      contact.topics.push(topic);
      // Keep only top 10 topics
      if (contact.topics.length > 10) {
        contact.topics = contact.topics.slice(-10);
      }
    }

    // Determine typical tone
    const { formality_score } = signal.signal_data;
    if (formality_score !== undefined) {
      if (formality_score > 0.7) {
        contact.typicalTone = 'formal';
      } else if (formality_score < 0.3) {
        contact.typicalTone = 'casual';
      } else {
        contact.typicalTone = 'mixed';
      }
    }
  }

  /**
   * Update confidence scores for each dimension
   */
  private static updateConfidenceScores(context: UserContextProfile): void {
    const signalCount = context.confidenceMetrics.signalCount;

    // Confidence grows with signal count, asymptotically approaching 1.0
    // Using 1 - e^(-x/k) where k controls growth rate
    const calculateConfidence = (signals: number, growthRate: number = 50): number => {
      return Math.min(1, 1 - Math.exp(-signals / growthRate));
    };

    const conf = context.confidenceMetrics.dimensionConfidence;

    conf.communicationStyle = calculateConfidence(signalCount, 30);
    conf.rolePatterns = calculateConfidence(signalCount, 40);
    conf.urgencySensitivity = calculateConfidence(signalCount, 50);
    conf.relationshipGraph = calculateConfidence(
      Object.keys(context.relationshipGraph).length,
      20
    );
    conf.delegationBehavior = calculateConfidence(signalCount, 60);

    // Overall score is weighted average
    context.confidenceMetrics.overallScore = (
      conf.communicationStyle * 0.25 +
      conf.rolePatterns * 0.25 +
      conf.urgencySensitivity * 0.2 +
      conf.relationshipGraph * 0.2 +
      conf.delegationBehavior * 0.1
    );
  }

  /**
   * Save updated context to modular context_profiles table
   * Maps UserContextProfile to individual profile types
   */
  private static async saveContext(
    userId: string,
    context: UserContextProfile
  ): Promise<void> {
    try {
      // Calculate confidence from signalCount
      const emailCommConfidence = Math.min(95, 20 + (context.confidenceMetrics.signalCount * 2));

      // Update email_communication profile with learned patterns
      await ProfileLoader.updateProfile(
        userId,
        'email_communication',
        {
          signature: context.communicationStyle.signatureStyle || null,
          greetingPatterns: context.communicationStyle.greetingPatterns,
          tone: context.communicationStyle.toneVector.formal, // 0-1 value
          formalityScore: context.communicationStyle.formalityScore,
          avgLength: Math.round(context.communicationStyle.avgLength),
          emojiUsage: context.communicationStyle.emojiUsage,
          commonPhrases: context.communicationStyle.commonPhrases,
          responsePatterns: {
            avgResponseTime: context.urgencySensitivity.avgResponseTime,
            priorityAdjustments: {},
          },
        },
        emailCommConfidence,
        false // Don't auto-increment, we manage confidence manually
      );

      // Update identity profile if role information exists
      if (context.rolePatterns.primaryRole) {
        // Load current identity to preserve fullName and email
        const currentIdentity = await ProfileLoader.loadProfile(userId, 'identity');

        await ProfileLoader.updateProfile(
          userId,
          'identity',
          {
            fullName: currentIdentity?.fullName || '',
            role: context.rolePatterns.primaryRole || '',
            email: currentIdentity?.email || '',
            responsibilities: context.rolePatterns.responsibilities || [],
            authority: context.rolePatterns.decisionMakingLevel as any,
          },
          Math.round(context.confidenceMetrics.dimensionConfidence.rolePatterns * 100),
          false
        );
      }

      // Note: relationshipGraph is stored separately in relationship_graph table
      // It's managed by the relationship sync process, not here

      // TEMPORARY: Also write to old table for backward compatibility during transition
      // TODO: Remove this after validating modular profiles work correctly (1-2 weeks)
      try {
        const supabase = await createClient();
        await supabase
          .from('user_context_profiles')
          .upsert({
            user_id: userId,
            context_data: context,
          });
        console.log(`[UserContextEngine] Saved to modular profiles + old table (${context.confidenceMetrics.signalCount} signals)`);
      } catch (err: any) {
        // Don't fail if old table write fails (might be deleted)
        console.warn('[UserContextEngine] Old table write failed (expected if table deleted):', err.message);
      }

    } catch (error) {
      console.error('[UserContextEngine] Failed to save context:', error);
      throw error;
    }
  }

  /**
   * Update communication style from sent email patterns
   */
  private static updateFromSentEmail(
    style: CommunicationStyle,
    patterns: any,
    signalCount: number
  ): void {
    // Update average length
    if (patterns.length !== undefined) {
      style.avgLength = this.runningAverage(
        style.avgLength,
        patterns.length,
        signalCount
      );
    }

    // Update formality score
    if (patterns.formality_score !== undefined) {
      style.formalityScore = this.runningAverage(
        style.formalityScore,
        patterns.formality_score,
        signalCount
      );
    }

    // Learn greeting pattern
    if (patterns.greeting && !style.greetingPatterns.includes(patterns.greeting)) {
      style.greetingPatterns.push(patterns.greeting);
      // Keep only most recent 10 greetings
      if (style.greetingPatterns.length > 10) {
        style.greetingPatterns = style.greetingPatterns.slice(-10);
      }
    }

    // Learn signature
    if (patterns.signature) {
      style.signatureStyle = patterns.signature;
    }

    // Update emoji usage
    if (patterns.emoji_count !== undefined) {
      const hasEmoji = patterns.emoji_count > 0 ? 1 : 0;
      style.emojiUsage = this.runningAverage(
        style.emojiUsage,
        hasEmoji,
        signalCount
      );
    }

    // Learn common phrases
    if (patterns.common_phrases && Array.isArray(patterns.common_phrases)) {
      patterns.common_phrases.forEach((phrase: string) => {
        if (!style.commonPhrases.includes(phrase)) {
          style.commonPhrases.push(phrase);
        }
      });
      // Keep only top 20 phrases
      if (style.commonPhrases.length > 20) {
        style.commonPhrases = style.commonPhrases.slice(-20);
      }
    }

    // Update tone vector from tone indicators
    if (patterns.tone_indicators && Array.isArray(patterns.tone_indicators)) {
      patterns.tone_indicators.forEach((indicator: string) => {
        const [tone, _phrase] = indicator.split(':');
        if (tone === 'formal') {
          style.toneVector.formal = Math.min(1, style.toneVector.formal + 0.05);
          style.toneVector.casual = Math.max(0, style.toneVector.casual - 0.02);
        } else if (tone === 'casual') {
          style.toneVector.casual = Math.min(1, style.toneVector.casual + 0.05);
          style.toneVector.formal = Math.max(0, style.toneVector.formal - 0.02);
        }
      });
    }
  }

  /**
   * Helper: Calculate running average
   */
  private static runningAverage(
    currentAvg: number,
    newValue: number,
    count: number
  ): number {
    return (currentAvg * count + newValue) / (count + 1);
  }

  /**
   * Helper: Extract tone delta between original and edited draft
   */
  private static extractToneDelta(original: string, edited: string): ToneDelta {
    const delta: ToneDelta = {
      formalityChange: 0,
      lengthChange: edited.length - original.length,
      toneVectorDelta: {},
      addedPhrases: [],
      removedPhrases: [],
    };

    // Detect formality changes
    const formalPatterns = ['Dear', 'Sincerely', 'Best regards', 'Thank you for', 'I appreciate'];
    const casualPatterns = ['Hey', 'Thanks', 'Cheers', 'Let me know', 'Sounds good'];

    const originalFormal = formalPatterns.filter(p => original.includes(p)).length;
    const editedFormal = formalPatterns.filter(p => edited.includes(p)).length;
    const originalCasual = casualPatterns.filter(p => original.includes(p)).length;
    const editedCasual = casualPatterns.filter(p => edited.includes(p)).length;

    if (editedFormal > originalFormal) {
      delta.formalityChange = 0.1;
      delta.toneVectorDelta.formal = 0.1;
    } else if (editedCasual > originalCasual) {
      delta.formalityChange = -0.1;
      delta.toneVectorDelta.casual = 0.1;
    }

    // Extract added phrases (simple approach: look for common 3-word sequences)
    const getThreeWordPhrases = (text: string): string[] => {
      const words = text.toLowerCase().split(/\s+/);
      const phrases: string[] = [];
      for (let i = 0; i < words.length - 2; i++) {
        phrases.push(`${words[i]} ${words[i+1]} ${words[i+2]}`);
      }
      return phrases;
    };

    const originalPhrases = getThreeWordPhrases(original);
    const editedPhrases = getThreeWordPhrases(edited);

    delta.addedPhrases = editedPhrases.filter(p => !originalPhrases.includes(p)).slice(0, 5);
    delta.removedPhrases = originalPhrases.filter(p => !editedPhrases.includes(p)).slice(0, 5);

    return delta;
  }

  /**
   * Helper: Extract greeting from email
   */
  private static extractGreeting(text: string): string | null {
    const greetingPatterns = [
      /^(Hi|Hello|Hey|Dear)\s+[^,\n]+[,\n]/i,
    ];

    for (const pattern of greetingPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    return null;
  }

  /**
   * Helper: Extract signature from email
   */
  private static extractSignature(text: string): string | null {
    // Look for common signature patterns at end of email
    const signaturePatterns = [
      /\n(Best regards|Sincerely|Thanks|Cheers|Best)[,\n].*$/i,
    ];

    for (const pattern of signaturePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    return null;
  }

  /**
   * Helper: Extract urgency keywords from content
   */
  private static extractUrgencyKeywords(content: string): string[] {
    const keywords: string[] = [];
    const urgencyPatterns = [
      'urgent', 'asap', 'immediately', 'critical', 'emergency',
      'today', 'now', 'deadline', 'time-sensitive', 'priority'
    ];

    urgencyPatterns.forEach(pattern => {
      if (content.toLowerCase().includes(pattern)) {
        keywords.push(pattern);
      }
    });

    return keywords;
  }
}
