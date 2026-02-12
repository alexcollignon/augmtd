/**
 * Body Content Analyzer
 *
 * Analyzes email body content to detect explicit assignments,
 * action requests, and ownership indicators
 */

export interface BodyAnalysisResult {
  explicitAssignments: Array<{
    email: string;
    confidence: number;
    context: string;
  }>;
  actionVerbs: string[];
  hasDeadline: boolean;
  deadlineText?: string;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  isQuestion: boolean;
  questionTarget?: string;
}

/**
 * Analyze email body for explicit assignments and ownership signals
 */
export function analyzeBodyContent(
  body: string,
  subject: string,
  recipients: Array<{ email: string; fullName?: string }>
): BodyAnalysisResult {
  const result: BodyAnalysisResult = {
    explicitAssignments: [],
    actionVerbs: [],
    hasDeadline: false,
    urgencyLevel: 'low',
    isQuestion: false,
  };

  const bodyLower = body.toLowerCase();
  const subjectLower = subject.toLowerCase();

  // === EXPLICIT ASSIGNMENTS ===
  // Pattern: "Name, can you...", "Name - please...", "@Name", etc.
  for (const recipient of recipients) {
    const firstName = recipient.fullName?.split(' ')[0]?.toLowerCase();
    const email = recipient.email.toLowerCase();
    const emailPrefix = email.split('@')[0];

    if (!firstName && !emailPrefix) continue;

    const patterns = [
      // Direct address patterns
      firstName ? new RegExp(`\\b${firstName},?\\s+(can you|could you|please|would you)`, 'i') : null,
      firstName ? new RegExp(`\\b${firstName}\\s*-\\s*(can you|could you|please|would you)`, 'i') : null,
      new RegExp(`@${emailPrefix}\\b`, 'i'),

      // Assignment patterns
      firstName ? new RegExp(`(assign|assigned|assigning)\\s+(this|to)\\s+${firstName}`, 'i') : null,
      firstName ? new RegExp(`${firstName}\\s+(to|will|should)\\s+(handle|own|take|lead)`, 'i') : null,

      // Question patterns
      firstName ? new RegExp(`${firstName},?\\s+(can|could|would)\\s+you`, 'i') : null,
    ].filter(p => p !== null) as RegExp[];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) {
        result.explicitAssignments.push({
          email: recipient.email,
          confidence: 0.9, // High confidence for explicit mentions
          context: match[0],
        });
        break; // One match per recipient is enough
      }
    }
  }

  // === ACTION VERBS ===
  const actionVerbPatterns = [
    /\b(review|approve|sign|complete|finish|send|submit|update|create|build|fix|resolve)\b/gi,
    /\b(please|need|required|must|should|action required)\b/gi,
    /\b(asap|urgent|priority|deadline|due)\b/gi,
  ];

  for (const pattern of actionVerbPatterns) {
    const matches = body.match(pattern);
    if (matches) {
      result.actionVerbs.push(...matches.map(m => m.toLowerCase()));
    }
  }

  // Deduplicate action verbs
  result.actionVerbs = [...new Set(result.actionVerbs)];

  // === DEADLINE DETECTION ===
  const deadlinePatterns = [
    /by\s+(?:EOD|COB|end of (?:day|week|month))/i,
    /due\s+(?:today|tomorrow|this week|next week)/i,
    /deadline[:\s]+\w+/i,
    /before\s+\w+\s+\d+/i,
    /by\s+\w+\s+\d+/i,
  ];

  for (const pattern of deadlinePatterns) {
    const match = body.match(pattern);
    if (match) {
      result.hasDeadline = true;
      result.deadlineText = match[0];
      break;
    }
  }

  // === URGENCY DETECTION ===
  const urgencyKeywords = {
    critical: ['urgent', 'asap', 'immediately', 'critical', 'emergency'],
    high: ['important', 'priority', 'needed soon', 'time-sensitive'],
    medium: ['please', 'when you can', 'at your convenience'],
  };

  const combinedText = (subject + ' ' + body).toLowerCase();

  if (urgencyKeywords.critical.some(kw => combinedText.includes(kw))) {
    result.urgencyLevel = 'critical';
  } else if (urgencyKeywords.high.some(kw => combinedText.includes(kw))) {
    result.urgencyLevel = 'high';
  } else if (urgencyKeywords.medium.some(kw => combinedText.includes(kw))) {
    result.urgencyLevel = 'medium';
  } else if (result.hasDeadline) {
    result.urgencyLevel = 'high';
  }

  // === QUESTION DETECTION ===
  const questionPatterns = [
    /\?/,
    /\b(can you|could you|would you|will you)\b/i,
    /\b(what|when|where|who|why|how)\s+/i,
  ];

  result.isQuestion = questionPatterns.some(p => p.test(body));

  // Try to identify question target
  if (result.isQuestion) {
    for (const recipient of recipients) {
      const firstName = recipient.fullName?.split(' ')[0]?.toLowerCase();
      if (firstName && bodyLower.includes(`${firstName},`) || bodyLower.includes(`@${firstName}`)) {
        result.questionTarget = recipient.email;
        break;
      }
    }
  }

  return result;
}

/**
 * Boost confidence score based on body analysis
 */
export function applyBodyBoost(
  baseConfidence: number,
  recipientEmail: string,
  bodyAnalysis: BodyAnalysisResult
): number {
  let boosted = baseConfidence;

  // Explicit assignment = major boost
  const assignment = bodyAnalysis.explicitAssignments.find(a =>
    a.email.toLowerCase() === recipientEmail.toLowerCase()
  );

  if (assignment) {
    boosted = Math.max(boosted, assignment.confidence);
  }

  // Question directed at this person = moderate boost
  if (bodyAnalysis.isQuestion && bodyAnalysis.questionTarget === recipientEmail) {
    boosted = Math.min(boosted + 0.2, 1.0);
  }

  // Many action verbs + this person in To = small boost
  if (bodyAnalysis.actionVerbs.length >= 3) {
    boosted = Math.min(boosted + 0.1, 1.0);
  }

  return boosted;
}
