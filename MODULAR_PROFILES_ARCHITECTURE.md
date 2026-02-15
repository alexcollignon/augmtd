# Modular Context Profiles Architecture

**Status:** ✅ Implemented (Feb 14, 2026)
**Version:** 1.0

---

## Table of Contents

1. [Overview](#overview)
2. [Why Modular Profiles?](#why-modular-profiles)
3. [Architecture](#architecture)
4. [Profile Types](#profile-types)
5. [ProfileLoader API](#profileloader-api)
6. [Skills Compose Profiles](#skills-compose-profiles)
7. [Learning Pipeline](#learning-pipeline)
8. [Migration from Monolithic](#migration-from-monolithic)
9. [Future Roadmap](#future-roadmap)

---

## Overview

AUGMTD uses a **modular profile architecture** where each aspect of your work behavior is learned and stored independently. Instead of one large "user context" blob, we maintain separate profiles for:

- **identity** - Who you are (name, role, responsibilities)
- **email_communication** - How you write emails
- **domain_knowledge** - What you know (industry terms, workflows)
- **relationships** - Who you work with (contacts, importance levels)
- **slack_communication** - How you message on Slack (future)
- **meeting_behavior** - How you participate in meetings (future)
- **work_patterns** - When and how you work (future)

This enables **skills to compose exactly the profiles they need**, learning to happen **independently per domain**, and the system to **scale as we add new integrations**.

---

## Why Modular Profiles?

### Problem with Monolithic Approach

**Before (v1.0):**
```sql
user_context_profiles
├── user_id: abc-123
└── context_data: {
      communicationStyle: {...},
      workPatterns: {...},
      relationshipGraph: {...},
      domainKnowledge: {...},
      learningMetrics: {...}
    }
```

**Issues:**
- ❌ Updating email style affected Slack confidence
- ❌ Skills had to parse entire blob
- ❌ No clear confidence per domain
- ❌ Hard to add new integrations
- ❌ Cross-contamination between unrelated behaviors

### Solution: Modular Profiles

**After (v2.0):**
```sql
context_profiles
├── (user_id: abc-123, profile_type: 'identity', confidence: 95, data: {...})
├── (user_id: abc-123, profile_type: 'email_communication', confidence: 42, data: {...})
├── (user_id: abc-123, profile_type: 'relationships', confidence: 30, data: {...})
└── (user_id: abc-123, profile_type: 'domain_knowledge', confidence: 20, data: {...})
```

**Benefits:**
- ✅ Independent learning per profile
- ✅ Skills load only what they need
- ✅ Clear confidence per domain
- ✅ Easy to add new profile types
- ✅ No cross-contamination

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       SKILL LAYER                            │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Email Draft    │  │ Slack Reply    │  │ Meeting Prep │  │
│  │                │  │                │  │              │  │
│  │ Requires:      │  │ Requires:      │  │ Requires:    │  │
│  │ • identity     │  │ • identity     │  │ • identity   │  │
│  │ • email_comm   │  │ • slack_comm   │  │ • meeting    │  │
│  │ • relationships│  │ • relationships│  │ • calendar   │  │
│  └────────────────┘  └────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    PROFILE LOADER API                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ProfileLoader.loadProfiles(userId, ['identity',      │  │
│  │                'email_communication', 'relationships'])  │
│  │                                                         │  │
│  │ Returns: { identity: {...}, email_communication: {...},│
│  │           relationships: {...} }                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  DATABASE (Supabase)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ context_profiles                                      │  │
│  │ ┌──────────┬──────────────┬────────┬─────────────┐  │  │
│  │ │ user_id  │ profile_type │ conf.  │ profile_data│  │  │
│  │ ├──────────┼──────────────┼────────┼─────────────┤  │  │
│  │ │ abc-123  │ identity     │ 95     │ {...}       │  │  │
│  │ │ abc-123  │ email_comm   │ 42     │ {...}       │  │  │
│  │ │ abc-123  │ relationships│ 30     │ {...}       │  │  │
│  │ └──────────┴──────────────┴────────┴─────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Profile Types

### 1. Identity Profile

**Purpose:** Who you are (role, name, responsibilities)

**Structure:**
```typescript
{
  fullName: "Alex Johnson",
  email: "alex@company.com",
  role: "Senior Consultant",
  responsibilities: ["client management", "reporting"],
  authority: "senior"  // junior | senior | lead | executive
}
```

**Used By:** All skills (for signature, context, authority checks)

**Confidence:** High (95%) - mostly static, set during onboarding

---

### 2. Email Communication Profile

**Purpose:** How you write emails (tone, style, patterns)

**Structure:**
```typescript
{
  signature: "Best,\nAlex",
  greetingPatterns: ["Hey", "Hi"],
  tone: 0.65,  // 0 = casual, 1 = formal
  formalityScore: 0.65,
  avgLength: 147,  // characters
  emojiUsage: 0.1,  // 0-1 frequency
  commonPhrases: ["Let me know", "Happy to help"],
  responsePatterns: {
    avgResponseTime: 7200,  // seconds
    priorityAdjustments: { "vip": -3600 }
  }
}
```

**Used By:** EmailDraftSkill, EmailReplyAgent

**Confidence:** Grows with use (20% baseline → +2% per sent email analyzed)

**Learning Signals:**
- `reply_sent` - User sends email (we extract style)
- `draft_modified` - User edits AI draft (we learn preferences)

---

### 3. Domain Knowledge Profile

**Purpose:** Industry-specific knowledge (terms, workflows)

**Structure:**
```typescript
{
  industry: "Management Consulting",
  vocabulary: {
    "SOW": "Statement of Work",
    "OKR": "Objectives and Key Results"
  },
  commonTopics: ["client deliverables", "project status", "quarterly planning"],
  workflows: [
    {
      id: "client_report",
      name: "Monthly Client Report",
      steps: ["gather data", "analyze", "draft", "review", "send"],
      frequency: "monthly"
    }
  ]
}
```

**Used By:** DocumentDraftSkill, EmailDraftSkill (for context)

**Confidence:** Grows slowly (requires explicit extraction or imports)

---

### 4. Relationships Profile

**Purpose:** Who you work with and how important they are

**Structure:**
```typescript
{
  totalContacts: 47,
  vipContacts: ["sarah.johnson@client.com", "ceo@company.com"],
  frequentCollaborators: ["mike@company.com", "jane@company.com"]
}
```

**Note:** Detailed contact data stored in separate `relationship_graph` table for performance. This profile is a lightweight reference.

**Used By:** All communication skills (to adjust tone/priority)

**Confidence:** Grows with interactions (tracks frequency, importance)

---

### 5. Slack Communication Profile (Future)

**Purpose:** How you message on Slack

**Structure:**
```typescript
{
  tone: "casual",  // casual | professional
  useEmojis: true,
  avgLength: 42,  // characters
  commonReactions: ["👍", "✅", "🎉"]
}
```

**Why Separate from Email?**
- Slack is more casual than email
- Different greeting patterns ("hey" vs "Hi [Name],")
- Different length expectations (short vs detailed)

---

### 6. Meeting Behavior Profile (Future)

**Purpose:** How you participate in meetings

**Structure:**
```typescript
{
  preferredTimes: ["10:00-12:00", "14:00-16:00"],
  avgMeetingLength: 30,  // minutes
  participationStyle: "active"  // active | observant | balanced
}
```

---

### 7. Work Patterns Profile (Future)

**Purpose:** When and how you work

**Structure:**
```typescript
{
  typicalWorkHours: { start: "09:00", end: "18:00" },
  peakHours: ["10:00-12:00", "14:00-16:00"],
  taskPrioritization: "deadline",  // deadline | importance | quick-wins
  delegationThreshold: 5  // complexity 0-10
}
```

---

## ProfileLoader API

### Loading Profiles

```typescript
import { ProfileLoader } from '@/lib/context/profile-loader';

// Load specific profiles
const profiles = await ProfileLoader.loadProfiles(
  userId,
  ['identity', 'email_communication', 'relationships']
);

// profiles = {
//   identity: { fullName: "Alex", ... , _confidence: 95 },
//   email_communication: { signature: "Best,\nAlex", ..., _confidence: 42 },
//   relationships: { vipContacts: [...], _confidence: 30 }
// }

// Access profile data
console.log(profiles.identity.fullName);  // "Alex"
console.log(profiles.identity._confidence);  // 95
```

### Updating Profiles

```typescript
// Update email_communication after analyzing sent email
await ProfileLoader.updateProfile(
  userId,
  'email_communication',
  {
    signature: "Best,\nAlex",
    greetingPatterns: ["Hey", "Hi"],
    tone: 0.65
  },
  42,  // confidence score
  false  // don't increment signal count (already done)
);

// Increment signal count when logging new learning signal
await ProfileLoader.updateProfile(
  userId,
  'email_communication',
  { commonPhrases: [...existingPhrases, "Thanks for reaching out"] },
  undefined,  // keep existing confidence
  true  // increment learned_from_count
);
```

### Initializing New Users

```typescript
// Called during onboarding
await ProfileLoader.initializeUser(
  userId,
  "Alex Johnson",
  "Senior Consultant",
  "alex@company.com"
);

// Creates 3 profiles:
// - identity (confidence: 95, from onboarding)
// - email_communication (confidence: 20, domain heuristic)
// - relationships (confidence: 0, empty)
```

---

## Skills Compose Profiles

### Skill Interface

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  requiredProfiles: ProfileType[];
  capabilities: string[];

  execute(
    profiles: LoadedProfiles,
    input: SkillInput
  ): Promise<SkillResult>;
}
```

### Example: Email Draft Skill

```typescript
const EmailDraftSkill: Skill = {
  id: 'email_draft_v1',
  name: 'Email Draft Assistant',
  description: 'Drafts email replies matching your communication style',
  requiredProfiles: ['identity', 'email_communication', 'relationships'],
  capabilities: ['draft', 'email'],

  async execute(profiles, input) {
    const { identity, email_communication, relationships } = profiles;

    // Determine formality
    const isVIP = relationships.vipContacts.includes(input.recipientEmail);
    const baseTone = email_communication.tone;
    const adjustedTone = isVIP ? Math.min(1, baseTone + 0.2) : baseTone;

    // Generate draft
    const draft = await generateEmailDraft({
      senderName: identity.fullName,
      signature: email_communication.signature,
      greeting: email_communication.greetingPatterns[0],
      tone: adjustedTone,
      length: email_communication.avgLength,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      context: input.threadHistory
    });

    return {
      type: 'email_draft',
      content: draft,
      confidence: calculateConfidence(profiles),
      reasoning: `Drafted using your ${adjustedTone > 0.7 ? 'formal' : 'casual'} style. ${isVIP ? 'Increased formality for VIP contact.' : ''}`
    };
  }
};
```

### Why This Matters

**Before (Monolithic):**
```typescript
// Skill had to parse entire context blob
const context = await getUserContext(userId);
const tone = context.communicationStyle.emailResponsePatterns.tone;
const signature = context.communicationStyle.emailResponsePatterns.signatureStyle;
// ... dozens of lines of extraction
```

**After (Modular):**
```typescript
// Skill loads exactly what it needs
const profiles = await ProfileLoader.loadProfiles(userId, ['identity', 'email_communication']);
const tone = profiles.email_communication.tone;
const signature = profiles.email_communication.signature;
// Clean, typed, fast
```

---

## Learning Pipeline

### How Profiles Learn

```
1. User Action (sends email, edits draft, confirms suggestion)
   ↓
2. ContextService.logSignal(userId, 'reply_sent', metadata)
   - Stores signal in learning_signals table
   - Triggers UserContextEngine.updateFromSignal()
   ↓
3. UserContextEngine processes signal
   - Determines which profiles to update
   - Extracts relevant patterns:
     • Email: greeting, signature, tone, phrases
     • Relationships: contact interaction
   ↓
4. ProfileLoader.updateProfile() for each affected profile
   - email_communication: { signature: "Best,\nAlex", greetingPatterns: ["Hey"] }
   - relationships: { vipContacts: [...existing, newContact] }
   ↓
5. Confidence score recalculated
   - Per profile: confidence = min(95, baseline + (signalCount * 2))
   - Example: email_communication goes 20% → 22% → 24% ...
   ↓
6. Next skill execution uses updated profiles
   - EmailDraftSkill sees new signature immediately
   - SlackReplySkill unaffected (separate profile)
```

### Signal Flow Example

```typescript
// User sends an email
await ContextService.logReplySent(
  userId,
  {
    sender_email: "client@example.com",
    formality_score: 0.65,
    communication_patterns: {
      length: 147,
      greeting: "Hey",
      signature: "Best,\nAlex",
      emoji_count: 0,
      tone_indicators: ["casual:Hey", "formal:Best"]
    }
  }
  // No inbox_item_id for sent emails
);

// ↓ Triggers

// UserContextEngine.updateFromSignal()
await ProfileLoader.updateProfile(
  userId,
  'email_communication',
  {
    signature: "Best,\nAlex",
    greetingPatterns: ["Hey"],  // Update with new greeting
    tone: 0.65,
    formalityScore: 0.65,
    commonPhrases: [...existing, ...extracted]
  },
  22,  // confidence increased from 20
  false  // signal already counted
);

// ↓ Result

// context_profiles table updated:
// profile_type: 'email_communication'
// confidence_score: 22 (was 20)
// learned_from_count: 1 (was 0)
// profile_data: { signature: "Best,\nAlex", greetingPatterns: ["Hey"], ... }
```

---

## Migration from Monolithic

### The Challenge

**Old System:**
- 1 row per user in `user_context_profiles`
- All data in single JSONB blob `context_data`
- Existing code depended on this structure

**New System:**
- N rows per user in `context_profiles`
- 1 row per profile type
- Need to support both during transition

### Migration Strategy

#### 1. Database Migration

**File:** `supabase/migrations/20260214_migrate_to_modular_profiles.sql`

```sql
-- Create new table
CREATE TABLE context_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  profile_type TEXT NOT NULL,
  profile_data JSONB NOT NULL,
  confidence_score DECIMAL(5,2) DEFAULT 0.00,
  learned_from_count INTEGER DEFAULT 0,
  ...
  UNIQUE(user_id, profile_type)
);

-- Migrate existing data
INSERT INTO context_profiles (user_id, profile_type, profile_data, confidence_score)
SELECT
  user_id,
  'identity',
  jsonb_build_object(
    'fullName', context_data->'rolePatterns'->>'primaryRole',
    'role', context_data->'rolePatterns'->>'primaryRole',
    ...
  ),
  (context_data->'dimensionConfidence'->>'rolePatterns')::decimal * 100
FROM user_context_profiles;

-- Repeat for email_communication, domain_knowledge, relationships
```

#### 2. ProfileLoader API

**File:** `lib/context/profile-loader.ts`

Provides unified interface for loading/updating profiles.

#### 3. Backward Compatibility Layer

**File:** `lib/context/profile-adapter.ts`

Bridges old and new:
```typescript
export async function getUserContextLegacy(
  userId: string
): Promise<UserContextProfile> {
  // Load modular profiles
  const profiles = await ProfileLoader.loadProfiles(userId, [
    'identity', 'email_communication', 'domain_knowledge', 'relationships'
  ]);

  // Assemble into old format
  const legacy: UserContextProfile = {
    communicationStyle: {
      avgLength: profiles.email_communication?.avgLength || 0,
      toneVector: { formal: profiles.email_communication?.tone || 0.5 },
      formalityScore: profiles.email_communication?.formalityScore || 0.5,
      greetingPatterns: profiles.email_communication?.greetingPatterns || [],
      signatureStyle: profiles.email_communication?.signature || null,
      ...
    },
    rolePatterns: {
      primaryRole: profiles.identity?.role || '',
      ...
    },
    relationshipGraph: { /* from relationships */ },
    confidenceMetrics: { overallScore: calculateOverallConfidence(profiles) }
  };

  return legacy;
}
```

**Usage in existing code:**
```typescript
// Old code continues working
const context = await getUserContextLegacy(userId);
console.log(context.communicationStyle.signatureStyle);  // "Best,\nAlex"
```

#### 4. Dual-Write During Transition

**File:** `lib/context/user-context-engine.ts`

```typescript
private static async saveContext(userId: string, context: UserContextProfile) {
  // Write to new modular profiles
  await ProfileLoader.updateProfile(userId, 'email_communication', {...});
  await ProfileLoader.updateProfile(userId, 'identity', {...});

  // TEMPORARY: Also write to old table for safety
  const supabase = await createClient();
  await supabase.from('user_context_profiles').upsert({
    user_id: userId,
    context_data: context
  });
  // TODO: Remove after 1-2 weeks of validation
}
```

#### 5. Validation Period

**Timeline:** 1-2 weeks

**Checklist:**
- ✅ All profiles created successfully
- ✅ Confidence scores migrating correctly
- ✅ Learning signals being logged
- ✅ Sent emails analyzed and profiles updated
- ✅ Email drafts using updated patterns
- ✅ No data loss (verify old table matches new)

#### 6. Cleanup (After Validation)

```typescript
// Remove dual-write
// Delete this section from saveContext():
await supabase.from('user_context_profiles').upsert({...});

// Backup and drop old table
// ALTER TABLE user_context_profiles RENAME TO user_context_profiles_backup;
// (After another week)
// DROP TABLE user_context_profiles_backup;

// Remove profile-adapter.ts
// Update code to use ProfileLoader directly
```

---

## Future Roadmap

### Phase 1: Skills UI (Next 2-4 weeks)

**Goal:** Visualize available skills and which profiles they use

**Features:**
- Skills dashboard showing all available skills
- See which profiles each skill requires
- View confidence scores per profile
- Understand what the system knows about you

**Mockup:**
```
Skills Dashboard
├── Email Draft Assistant (enabled)
│   Requires: identity (95%), email_communication (42%), relationships (30%)
│   Status: Ready to use
│
├── Slack Reply Assistant (disabled)
│   Requires: identity (95%), slack_communication (not set up)
│   Status: Connect Slack to enable
│
└── Meeting Prep Assistant (coming soon)
    Requires: identity, calendar, meeting_behavior
    Status: Under development
```

### Phase 2: New Profile Types (2-3 months)

**Add:**
- `slack_communication` - Messaging style, emoji usage
- `meeting_behavior` - Scheduling preferences, participation style
- `work_patterns` - Peak hours, task prioritization

**Enables:**
- SlackReplySkill
- MeetingPrepSkill
- OptimalSchedulingSkill

### Phase 3: Cross-User Learning (6-12 months)

**Goal:** Learn from organizational patterns

**Features:**
- Aggregate anonymized `domain_knowledge` across team
- New employees benefit from company vocabulary
- Identify best practices automatically

**Privacy:**
- Only aggregate anonymized data
- Users opt-in per profile type
- Clear controls on what's shared

### Phase 4: Organizational Twin (12-24 months)

**Goal:** Visualize how work flows through organization

**Features:**
- Workflow maps showing information flow
- Bottleneck detection
- Predictive analytics for project timelines
- ROI measurement per process

---

## FAQs

### Q: Why not just use one big profile?

**A:** Monolithic profiles cause:
- Cross-contamination (email learning affects Slack confidence)
- Slow updates (must rewrite entire blob)
- Hard to extend (adding Slack requires redesigning entire structure)
- No granular confidence (one score for everything)

Modular profiles solve all these issues.

### Q: How does confidence work per profile?

**A:** Each profile has its own confidence score:
- Starts at baseline (20% for email_communication, 0% for relationships)
- Increases with signals: `confidence = min(95, baseline + (signalCount * 2))`
- Example: 20% → 22% → 24% → ... → 95% (cap)
- Never reaches 100% (always room for improvement)

### Q: Can I see which profiles a skill uses?

**A:** Yes! (Coming in Skills UI)
```typescript
EmailDraftSkill.requiredProfiles
// ['identity', 'email_communication', 'relationships']
```

### Q: What happens if a required profile doesn't exist?

**A:** ProfileLoader returns undefined for missing profiles:
```typescript
const profiles = await ProfileLoader.loadProfiles(userId, ['identity', 'slack_communication']);
// profiles = { identity: {...}, slack_communication: undefined }

// Skill checks:
if (!profiles.slack_communication) {
  return { error: 'Please connect Slack to use this skill' };
}
```

### Q: How is this different from ChatGPT custom instructions?

**A:**
| Feature | AUGMTD Modular Profiles | ChatGPT Custom Instructions |
|---------|------------------------|----------------------------|
| Learns from behavior | ✅ Yes (automatic) | ❌ No (manual) |
| Independent domains | ✅ Yes (per profile) | ❌ No (one blob) |
| Confidence scores | ✅ Per profile | ❌ No |
| Skill composition | ✅ Load what's needed | ❌ All or nothing |
| Cross-platform | ✅ Email, Slack, etc. | ❌ Chat only |

### Q: When will the old user_context_profiles be removed?

**A:** Timeline:
- Now: Dual-write to both tables (safety)
- Week 2-3: Validate modular profiles working correctly
- Week 3-4: Remove dual-write
- Week 4-6: Rename old table to _backup
- Week 8+: Drop backup table

---

## Summary

**What We Built:**
- ✅ Modular profile architecture
- ✅ ProfileLoader API
- ✅ Backward compatibility layer
- ✅ Migration from monolithic to modular
- ✅ Learning pipeline updates
- ✅ Sent email analysis

**What's Next:**
- Skills UI (visualize and manage skills)
- New profile types (Slack, meetings, work patterns)
- Cross-user learning (organizational intelligence)

**Key Insight:**

> "By separating user context into independent, composable profiles, we've built a foundation that scales from individual digital twins to organizational intelligence - all while maintaining privacy, transparency, and user control."

---

**Questions?** See `README.md`, `TECHNICAL_SPEC.md`, or `IMPLEMENTATION_PLAN.md` for more details.
