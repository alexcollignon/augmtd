# User Context Engine

**Status:** ✅ Core engine built, ready for integration
**Last Updated:** 2026-02-10

## Overview

The User Context Engine is the learning brain of AUGMTD. It automatically learns user behavior patterns from micro-corrections during workflow, without requiring any manual input or questionnaires.

## Philosophy

**Learn from behavior, not questionnaires.**

Instead of asking users "How formal are you?" or "Who do you respond to?", we:
- Watch what they accept vs. reject
- Analyze their draft edits
- Track response patterns
- Learn from every interaction

## Architecture

### 1. Type Definitions (`lib/types/user-context.ts`)

Defines the complete structure of what we learn:

```typescript
export interface UserContextProfile {
  communicationStyle: CommunicationStyle;
  rolePatterns: RolePatterns;
  urgencySensitivity: UrgencySensitivity;
  relationshipGraph: Record<string, ContactContext>;
  delegationBehavior: DelegationBehavior;
  confidenceMetrics: ConfidenceMetrics;
}
```

**Communication Style:**
- Average email length
- Tone preferences (formal, casual, technical, friendly, direct)
- Formality score (0-1)
- Common greetings and phrases
- Signature style
- Emoji usage frequency

**Role Patterns:**
- Response rate when in To line
- Response rate when in CC
- Mention sensitivity (@name)
- Explicit assignment acceptance rate
- Position sensitivity (primary vs secondary in To/CC)

**Urgency Sensitivity:**
- Urgency threshold (minimum score to respond)
- Average response time
- Deadline adherence rate
- Personal urgency keywords

**Relationship Graph:**
- Per-contact importance scores
- Typical tone per contact
- Response rates per person
- Average response times
- Interaction counts
- Common discussion topics

**Delegation Behavior:**
- Delegation rate
- Typical delegation targets
- Patterns that trigger delegation
- Topics never delegated

**Confidence Metrics:**
- Overall learning confidence (0-1)
- Total signal count processed
- Per-dimension confidence scores
- Last updated timestamp

### 2. Analytics Engine (`lib/context/user-context-engine.ts`)

The main learning engine with 400+ lines of sophisticated analysis:

**Core Functions:**
- `getContext(userId)` - Fetch current profile from database
- `updateFromSignal(userId, signal)` - Main dispatcher for all signals
- `saveContext(userId, context)` - Persist updated profile

**Learning Functions:**
- `updateCommunicationStyle()` - Extract tone deltas from draft edits
- `updateRolePatterns()` - Learn from confirmations/rejections
- `updateUrgencySensitivity()` - Track response time patterns
- `updateRelationshipGraph()` - Build contact importance scores
- `updateConfidenceScores()` - Calculate learning progress

**Helper Functions:**
- `extractToneDelta()` - Compare AI draft vs user edit
- `extractGreeting()` - Learn greeting patterns
- `extractSignature()` - Learn signature style
- `extractUrgencyKeywords()` - Learn personal urgency markers
- `runningAverage()` - Calculate weighted averages over time

**Key Algorithms:**
- **Tone Delta Extraction:** Compares original AI draft vs user edit to learn:
  - Formality changes (formal patterns added/removed)
  - Length preferences
  - Added/removed phrases
  - Emoji additions

- **Confidence Scoring:** Uses asymptotic growth curve
  ```typescript
  confidence = 1 - e^(-signalCount / growthRate)
  ```
  This means:
  - Confidence grows with each signal
  - Approaches 1.0 asymptotically
  - Different growth rates per dimension
  - Overall score is weighted average

- **Running Averages:** Smoothly updates metrics over time
  ```typescript
  newAvg = (currentAvg * count + newValue) / (count + 1)
  ```

### 3. Service Layer (`lib/context/context-service.ts`)

Convenient functions for triggering context updates from anywhere in the app:

```typescript
// Log a confirmation/rejection
await ContextService.logConfirmation(userId, itemId, action, metadata);

// Log a draft edit
await ContextService.logDraftEdit(userId, itemId, originalDraft, editedDraft);

// Log a reply sent
await ContextService.logReplySent(userId, itemId, metadata);

// Log item completion
await ContextService.logItemCompleted(userId, itemId, metadata);

// Log item dismissal
await ContextService.logItemDismissed(userId, itemId, metadata);

// Get current context
const context = await ContextService.getContext(userId);

// Process all historical signals (backfill)
await ContextService.processAllSignals(userId);
```

All functions automatically:
1. Insert learning signal into database
2. Trigger context update asynchronously
3. Handle errors gracefully (non-blocking)

### 4. API Endpoints (`app/api/context/route.ts`)

**GET /api/context**
- Returns current user context profile
- Useful for debugging and dashboard display

**POST /api/context**
- Action: `process_all_signals`
- Processes all historical signals for user
- Useful for backfilling context from past data

## Integration Points

### ✅ Integrated
- `/api/inbox/[id]/confirm` - Logs confirmations/rejections
  - Tracks role, position, confidence
  - Records has_mention and has_explicit_assignment
  - Updates RolePatterns automatically

### 🔄 To Integrate
- `/api/inbox/[id]/send-reply` - Should log:
  - Draft edits (original vs modified)
  - Response time
  - Sender email for relationship graph

- `/api/inbox/[id]/complete` - Should log:
  - Urgency score
  - Response time
  - Deadline met/missed

- `/api/inbox/[id]/dismiss` - Should use ContextService
  - Role and position data
  - Confidence score
  - Dismissal reason

## Learning Flow

```
User Action (confirm/edit/send/dismiss)
    ↓
Learning Signal Created (database)
    ↓
ContextService.log*() called
    ↓
UserContextEngine.updateFromSignal()
    ↓
Route to appropriate handler based on signal_type
    ↓
Extract patterns from signal data
    ↓
Update running averages and metrics
    ↓
Increment confidence scores
    ↓
Save updated context_data JSONB to database
```

## Example: Draft Edit Learning

```typescript
// User edits AI draft
Original: "Hello, I hope this email finds you well..."
Edited:   "Hey! Thanks for reaching out..."

// System extracts tone delta
{
  formalityChange: -0.1,           // More casual
  lengthChange: -25,               // Shorter
  toneVectorDelta: {
    formal: -0.1,                  // Less formal
    casual: +0.1,                  // More casual
    friendly: +0.1                 // More friendly
  },
  addedPhrases: ["hey thanks for"],
  removedPhrases: ["hope this email finds"]
}

// Updates context
communicationStyle.formalityScore: 0.5 → 0.49
communicationStyle.toneVector.casual: 0.5 → 0.51
communicationStyle.commonPhrases: [..., "hey thanks for"]
```

## Example: Confirmation Learning

```typescript
// User confirms suggested item
Signal: {
  action: 'confirm_as_mine',
  role: 'cc_recipient',
  position_in_to: null,
  confidence_score: 65,
  has_mention: true
}

// Updates context
rolePatterns.respondsWhenInCC: 0.5 → 0.52 (running average)
rolePatterns.mentionSensitivity: 0.5 → 0.51 (responds to @mentions)
confidenceMetrics.signalCount: 10 → 11
confidenceMetrics.rolePatterns: 0.18 → 0.20 (asymptotic growth)
```

## Database Storage

All context data is stored in `user_context_profiles.context_data` as JSONB:

```sql
SELECT context_data FROM user_context_profiles WHERE user_id = '...';

-- Returns:
{
  "communicationStyle": {
    "avgLength": 150,
    "toneVector": {
      "formal": 0.4,
      "casual": 0.7,
      "technical": 0.5,
      "friendly": 0.8,
      "direct": 0.6
    },
    "formalityScore": 0.45,
    "greetingPatterns": ["Hey", "Hi there"],
    "signatureStyle": "Thanks,\nAlex",
    "emojiUsage": 0.2,
    "commonPhrases": ["thanks for", "let me know", "sounds good"]
  },
  "rolePatterns": {
    "respondsWhenInTo": 0.85,
    "respondsWhenInCC": 0.30,
    "mentionSensitivity": 0.75,
    "explicitAssignmentRate": 0.95,
    "positionSensitivity": {
      "primary": 0.90,
      "secondary": 0.70,
      "cc": 0.30
    }
  },
  "urgencySensitivity": {
    "thresholdScore": 0.4,
    "avgResponseTime": 3600,
    "deadlineAdherence": 0.88,
    "urgencyKeywords": ["urgent", "asap", "deadline"]
  },
  "relationshipGraph": {
    "john@company.com": {
      "email": "john@company.com",
      "importance": 0.85,
      "typicalTone": "formal",
      "responseRate": 0.95,
      "avgResponseTime": 1800,
      "lastInteraction": "2026-02-10T10:30:00Z",
      "interactionCount": 42,
      "topics": ["project updates", "budget", "deadlines"]
    }
  },
  "delegationBehavior": {
    "delegationRate": 0.15,
    "typicalTargets": ["assistant@company.com"],
    "delegationTriggers": ["calendar", "scheduling"],
    "neverDelegates": ["confidential", "HR"]
  },
  "confidenceMetrics": {
    "overallScore": 0.65,
    "signalCount": 50,
    "lastUpdated": "2026-02-10T14:22:00Z",
    "dimensionConfidence": {
      "communicationStyle": 0.70,
      "rolePatterns": 0.65,
      "urgencySensitivity": 0.60,
      "relationshipGraph": 0.75,
      "delegationBehavior": 0.40
    }
  }
}
```

## Next Steps

### 1. Complete Integration
- Update remaining action endpoints to use ContextService
- Ensure all user actions trigger context updates
- Test end-to-end learning flow

### 2. AI Prompt Integration
- Include context_data in email processing prompts
- Reference learned communication style
- Adjust confidence based on role patterns
- Match user's tone preferences
- Personalize draft generation

### 3. Testing & Validation
- Monitor context updates in production
- Validate confidence scoring curves
- Test with real user behavior
- Measure improvement in approval rates

### 4. Optional: Context Dashboard
- Display learned patterns to users
- Show confidence scores per dimension
- Visualize relationship graph
- Allow manual adjustments (rare)

## Success Metrics

**After 10 interactions:**
- Confidence score > 50%
- Basic patterns detected
- Tone preferences identified

**After 50 interactions:**
- Confidence score > 80%
- Strong personalization
- High approval rates

**After 100+ interactions:**
- Confidence score > 90%
- Deep personalization
- Minimal edits needed
- High user satisfaction

## Technical Notes

- **Non-blocking:** Context updates happen asynchronously to avoid slowing down user actions
- **Fault-tolerant:** Errors in context updates don't break user workflows
- **Incremental:** Every signal improves the model slightly
- **Privacy-preserving:** All context data is per-user, never shared
- **Transparent:** Users can inspect their learned patterns via API
- **Self-improving:** The more users interact, the smarter it gets

---

**Built with:** TypeScript, Supabase, JSONB storage
**Approach:** Behavior-driven learning from micro-corrections
**Philosophy:** No questionnaires, only observation
