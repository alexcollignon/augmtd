/**
 * Profile Usage Example
 *
 * This file shows how to use the new modular ProfileLoader
 * in various parts of the application.
 */

import { ProfileLoader } from './profile-loader';

// ============= EXAMPLE 1: Email Drafting =============

async function draftEmailReply(emailData: any, userId: string) {
  // Load the 3 profiles needed for email drafting
  const profiles = await ProfileLoader.loadProfiles(userId, [
    'identity',
    'email_communication',
    'relationships',
  ]);

  const { identity, email_communication, relationships } = profiles;

  // Check if profiles exist
  if (!identity || !email_communication) {
    throw new Error('Required profiles not found');
  }

  // Find sender in relationships
  const sender = relationships?.contacts.find(
    c => c.email === emailData.from
  );

  // Generate draft using the profiles
  const draft = {
    greeting: email_communication.greetingPatterns[0] || 'Hi',
    recipientName: sender?.name || emailData.from.split('@')[0],
    body: '...', // Generated based on email context
    signature: email_communication.signature || `Best,\n${identity.fullName.split(' ')[0]}`,
    tone: email_communication.tone + ((sender?.importance ?? 0) > 80 ? 0.1 : 0), // Adjust for VIP
  };

  console.log('Draft generated with profiles:', {
    identity_confidence: identity._confidence,
    email_comm_confidence: email_communication._confidence,
    relationships_count: relationships?.contacts.length || 0,
  });

  return draft;
}

// ============= EXAMPLE 2: Onboarding - Initialize Profiles =============

async function handleOnboarding(userId: string, fullName: string, role: string, email: string) {
  // Initialize default profiles for new user
  await ProfileLoader.initializeUser(userId, fullName, role, email);

  console.log('✅ User profiles initialized:', {
    identity: '95% confident (from onboarding)',
    email_communication: '20% confident (domain heuristic)',
    domain_knowledge: '0% confident (empty)',
  });
}

// ============= EXAMPLE 3: Learning - Update Profile =============

async function learnFromDraftEdit(
  userId: string,
  originalDraft: string,
  editedDraft: string
) {
  // Load current email communication profile
  const emailComm = await ProfileLoader.loadProfile(userId, 'email_communication');

  if (!emailComm) {
    console.error('Email communication profile not found');
    return;
  }

  // Extract learning from the edit
  const extractedSignature = extractSignature(editedDraft);
  const extractedTone = analyzeTone(editedDraft);

  // Update profile
  await ProfileLoader.updateProfile(
    userId,
    'email_communication',
    {
      ...emailComm,
      signature: extractedSignature || emailComm.signature,
      tone: (emailComm.tone * 0.9) + (extractedTone * 0.1), // Running average
    },
    undefined, // Don't override confidence (will be calculated)
    true // Increment signal count
  );

  console.log('✅ Email communication profile updated from edit');
}

// ============= EXAMPLE 4: Get User Profile Summary =============

async function getUserProfileSummary(userId: string) {
  const summary = await ProfileLoader.getAllProfilesSummary(userId);

  console.log('User profile summary:');
  summary.forEach(profile => {
    console.log(`  ${profile.profileType}: ${profile.confidence}% (${profile.signalCount} signals)`);
  });

  return summary;
}

// ============= EXAMPLE 5: Check if Profile is Ready =============

async function isEmailDraftingReady(userId: string): Promise<boolean> {
  const metadata = await Promise.all([
    ProfileLoader.getProfileMetadata(userId, 'identity'),
    ProfileLoader.getProfileMetadata(userId, 'email_communication'),
  ]);

  const [identity, emailComm] = metadata;

  // Need at least 30% confidence in email communication to draft
  const isReady =
    identity !== null &&
    emailComm !== null &&
    emailComm.confidence >= 30;

  console.log('Email drafting readiness:', {
    identity: identity?.confidence || 0,
    email_communication: emailComm?.confidence || 0,
    ready: isReady,
  });

  return isReady;
}

// ============= EXAMPLE 6: Skills Dashboard Data =============

async function getSkillsDashboardData(userId: string) {
  const summary = await ProfileLoader.getAllProfilesSummary(userId);

  // Map profiles to skills
  const skills = [
    {
      id: 'email_draft',
      name: 'Email Draft Assistant',
      description: 'Drafts email replies in your style',
      requiredProfiles: ['identity', 'email_communication', 'relationships'],
      status: 'active',
      confidence: calculateSkillConfidence(
        summary,
        ['identity', 'email_communication', 'relationships']
      ),
    },
    {
      id: 'slack_response',
      name: 'Slack Response Assistant',
      description: 'Drafts Slack messages (coming soon)',
      requiredProfiles: ['identity', 'slack_communication', 'relationships'],
      status: 'coming_soon',
      confidence: 0,
    },
  ];

  return skills;
}

function calculateSkillConfidence(
  summary: Awaited<ReturnType<typeof ProfileLoader.getAllProfilesSummary>>,
  requiredProfiles: string[]
): number {
  const profileConfidences = requiredProfiles
    .map(type => summary.find(s => s.profileType === type)?.confidence || 0);

  // Average confidence of required profiles
  return Math.round(
    profileConfidences.reduce((sum, c) => sum + c, 0) / profileConfidences.length
  );
}

// ============= HELPER FUNCTIONS =============

function extractSignature(text: string): string | null {
  // Simple signature extraction (can be improved)
  const lines = text.split('\n').reverse();
  const signatureLines: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (line.match(/^(Best|Regards|Thanks|Cheers|Sincerely)/i)) {
      signatureLines.unshift(line);
      // Get next line (name)
      const nextIndex = lines.indexOf(line) - 1;
      if (nextIndex >= 0 && lines[nextIndex]) {
        signatureLines.push(lines[nextIndex]);
      }
      break;
    }
  }

  return signatureLines.length > 0 ? signatureLines.join('\n') : null;
}

function analyzeTone(text: string): number {
  // Simple tone analysis (0=casual, 1=formal)
  const formalWords = ['regarding', 'pursuant', 'hereby', 'therefore', 'sincerely'];
  const casualWords = ['hey', 'cool', 'awesome', 'thanks!', 'lol'];

  const lowerText = text.toLowerCase();
  const formalCount = formalWords.filter(w => lowerText.includes(w)).length;
  const casualCount = casualWords.filter(w => lowerText.includes(w)).length;

  if (formalCount + casualCount === 0) return 0.5; // Neutral

  return formalCount / (formalCount + casualCount);
}

// ============= EXPORTS =============

export {
  draftEmailReply,
  handleOnboarding,
  learnFromDraftEdit,
  getUserProfileSummary,
  isEmailDraftingReady,
  getSkillsDashboardData,
};
