/**
 * Sent Email Analyzer
 *
 * Extracts learning signals from user's sent emails to bootstrap context.
 * Runs during email sync to learn communication patterns immediately.
 */

import { ContextService } from './context-service';

export interface SentEmailData {
  userId: string;
  emailId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  sentAt: string;
  threadId?: string;
  inReplyTo?: string;
}

/**
 * Analyze a sent email and extract learning signals
 * Bootstraps user context from historical communication
 */
export async function analyzeSentEmail(email: SentEmailData): Promise<void> {
  try {
    // Extract communication style patterns
    const styleSignals = extractCommunicationStyle(email.body);

    // Extract relationship data
    const relationshipSignals = extractRelationshipData(email);

    // Log as a reply_sent signal with extracted patterns
    // Note: No inbox_item_id for sent emails (they don't have inbox items)
    await ContextService.logReplySent(
      email.userId,
      {
        sender_email: email.to[0], // Primary recipient (who they're replying to)
        formality_score: styleSignals.formalityScore,
        topic: extractTopic(email.subject),
        // Store communication patterns in signal_data for learning
        communication_patterns: {
          length: email.body.length,
          greeting: styleSignals.greeting,
          signature: styleSignals.signature,
          emoji_count: styleSignals.emojiCount,
          tone_indicators: styleSignals.toneIndicators,
          common_phrases: styleSignals.commonPhrases,
        },
      }
      // inbox_item_id omitted - sent emails don't have inbox items
    );

    // Log relationship signals for each recipient
    for (const recipient of [...email.to, ...(email.cc || [])]) {
      // Skip if recipient is the user themselves
      if (recipient.toLowerCase() === email.from.toLowerCase()) {
        continue;
      }

      // Calculate response time if this is a reply
      let responseTime: number | undefined;
      if (email.inReplyTo) {
        // We could calculate this if we have the original email timestamp
        // For now, we'll leave it undefined and let real-time actions provide this
      }

      // Update relationship graph with interaction data
      // This will be processed by the context engine to build contact importance
      const isCC = email.cc?.includes(recipient);

      // Store interaction metadata
      await ContextService.logSignal(
        email.userId,
        'reply_sent',
        {
          sender_email: recipient,
          interaction_type: isCC ? 'cc' : 'to',
          sent_at: email.sentAt,
          topic: extractTopic(email.subject),
          formality_score: styleSignals.formalityScore,
          // This helps build the relationship graph
        }
        // inbox_item_id omitted - sent emails don't have inbox items
      );
    }

    console.log(`[SentEmailAnalyzer] Extracted learning signals from sent email: ${email.subject.substring(0, 50)}...`);

  } catch (error) {
    console.error('[SentEmailAnalyzer] Error analyzing sent email:', error);
    // Don't throw - learning should never break the sync process
  }
}

/**
 * Extract communication style patterns from email body
 */
function extractCommunicationStyle(body: string): {
  formalityScore: number;
  greeting: string | null;
  signature: string | null;
  emojiCount: number;
  toneIndicators: string[];
  commonPhrases: string[];
} {
  const result = {
    formalityScore: 0.5,
    greeting: null as string | null,
    signature: null as string | null,
    emojiCount: 0,
    toneIndicators: [] as string[],
    commonPhrases: [] as string[],
  };

  // Count emojis
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const emojiMatches = body.match(emojiRegex);
  result.emojiCount = emojiMatches ? emojiMatches.length : 0;

  // Detect formality
  const formalPatterns = [
    'Dear',
    'Sincerely',
    'Best regards',
    'Kind regards',
    'Respectfully',
    'I hope this email finds you well',
    'Thank you for your time',
    'I appreciate your',
    'Please let me know',
    'I would like to',
    'I am writing to',
  ];

  const casualPatterns = [
    'Hey',
    'Hi there',
    'Thanks',
    'Cheers',
    'Let me know',
    'Sounds good',
    'No worries',
    'Awesome',
    'Cool',
    'Yeah',
    'Yep',
    'lol',
    'btw',
  ];

  let formalCount = 0;
  let casualCount = 0;

  formalPatterns.forEach(pattern => {
    if (body.includes(pattern)) {
      formalCount++;
      result.toneIndicators.push(`formal:${pattern}`);
    }
  });

  casualPatterns.forEach(pattern => {
    if (body.toLowerCase().includes(pattern.toLowerCase())) {
      casualCount++;
      result.toneIndicators.push(`casual:${pattern}`);
    }
  });

  // Calculate formality score (0 = very casual, 1 = very formal)
  if (formalCount + casualCount > 0) {
    result.formalityScore = formalCount / (formalCount + casualCount);
  }

  // Adjust for emoji usage (emojis indicate casual)
  if (result.emojiCount > 0) {
    result.formalityScore = Math.max(0, result.formalityScore - 0.1);
  }

  // Extract greeting (first line patterns)
  const greetingPatterns = [
    /^(Hi|Hello|Hey|Dear)\s+[^,\n]+[,\n]/im,
    /^Good\s+(morning|afternoon|evening)[,\n]/im,
  ];

  for (const pattern of greetingPatterns) {
    const match = body.match(pattern);
    if (match) {
      result.greeting = match[0].trim();
      break;
    }
  }

  // Extract signature (last few lines)
  const lines = body.trim().split('\n');
  const lastLines = lines.slice(-5); // Check last 5 lines

  const signaturePatterns = [
    /^(Best regards|Sincerely|Thanks|Cheers|Best|Regards|Warmly|Kind regards)/i,
  ];

  for (let i = 0; i < lastLines.length; i++) {
    const line = lastLines[i].trim();
    for (const pattern of signaturePatterns) {
      if (pattern.test(line)) {
        // Capture signature + following lines (name, title, etc.)
        result.signature = lastLines.slice(i).join('\n').trim();
        break;
      }
    }
    if (result.signature) break;
  }

  // Extract common phrases (3-word sequences)
  const words = body.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(w => w.length > 0);

  const phrases: string[] = [];
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = `${words[i]} ${words[i+1]} ${words[i+2]}`;
    // Filter out common filler phrases
    if (!phrase.includes('the') && !phrase.includes('and') && !phrase.includes('that')) {
      phrases.push(phrase);
    }
  }

  // Get top 5 phrases (would be better with frequency analysis)
  result.commonPhrases = phrases.slice(0, 5);

  return result;
}

/**
 * Extract relationship data from sent email
 */
function extractRelationshipData(email: SentEmailData): {
  primaryRecipient: string | null;
  recipientCount: number;
  isGroupEmail: boolean;
  hasCC: boolean;
} {
  return {
    primaryRecipient: email.to[0] || null,
    recipientCount: email.to.length + (email.cc?.length || 0),
    isGroupEmail: email.to.length > 3,
    hasCC: (email.cc?.length || 0) > 0,
  };
}

/**
 * Extract topic from subject line
 */
function extractTopic(subject: string): string {
  // Remove common prefixes
  let topic = subject
    .replace(/^(Re|Fwd|RE|FW|Fw):\s*/gi, '')
    .trim();

  // Truncate to reasonable length
  if (topic.length > 50) {
    topic = topic.substring(0, 50);
  }

  return topic;
}

/**
 * Bootstrap user context from all historical sent emails
 * Useful for new users to get immediate personalization
 */
export async function bootstrapFromSentEmails(
  userId: string,
  supabase: any,
  limit: number = 50
): Promise<number> {
  console.log(`[SentEmailAnalyzer] Bootstrapping context from sent emails for user ${userId}...`);

  try {
    // Fetch user's sent emails
    const { data: sentEmails, error } = await supabase
      .from('emails')
      .select('*')
      .eq('user_id', userId)
      .eq('is_from_user', true)
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[SentEmailAnalyzer] Error fetching sent emails:', error);
      return 0;
    }

    if (!sentEmails || sentEmails.length === 0) {
      console.log('[SentEmailAnalyzer] No sent emails found');
      return 0;
    }

    console.log(`[SentEmailAnalyzer] Found ${sentEmails.length} sent emails to analyze`);

    // Process each sent email
    let processed = 0;
    for (const email of sentEmails) {
      await analyzeSentEmail({
        userId: userId,
        emailId: email.id,
        from: email.from_address,
        to: email.to_addresses || [],
        cc: email.cc_addresses || [],
        subject: email.subject || '',
        body: email.body || '',
        sentAt: email.received_at || new Date().toISOString(),
        threadId: email.thread_id,
        inReplyTo: email.in_reply_to,
      });
      processed++;
    }

    console.log(`[SentEmailAnalyzer] Bootstrapped context from ${processed} sent emails`);
    return processed;

  } catch (error) {
    console.error('[SentEmailAnalyzer] Error during bootstrap:', error);
    return 0;
  }
}
