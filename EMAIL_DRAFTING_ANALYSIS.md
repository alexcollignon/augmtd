# Email Drafting & Learning Analysis

## Summary

**Email drafting DOES use modular profiles** ✅ (via profile-adapter)
**BUT learning is BROKEN** ❌ (saves to old table, not modular profiles)

---

## Current Flow (Step-by-Step)

### 📧 When Email Drafting Happens

```
1. Email arrives
   ↓
2. sync-emails.ts loads user context (line 143)
   getUserContext() → getUserContextLegacy() → ProfileLoader.loadProfiles()
   ↓
3. Modular profiles are loaded:
   - identity (95% confidence)
   - email_communication (20% confidence - defaults!)
   - relationships (from relationship_graph table)
   ↓
4. profile-adapter.ts assembles them into UserContextProfile format
   ↓
5. processEmail() receives user_context (line 427)
   ↓
6. formatUserContext() extracts patterns (lines 154-218):
   - communicationStyle.greetingPatterns
   - communicationStyle.signature
   - communicationStyle.formalityScore
   - relationshipGraph[sender]
   ↓
7. AI prompt includes learned style (lines 486-495):
   "MATCH USER'S STYLE: Use their greetings, tone, signature..."
   ↓
8. AI generates draft matching user's style ✅
```

**Result:** Email drafting WORKS with modular profiles!

---

### 🧠 When Learning Happens

```
1. User sends email (is_from_user = true)
   ↓
2. sent-email-analyzer.ts extracts patterns:
   - Greeting: "Hey" vs "Dear"
   - Signature: "Best,\nAlex"
   - Formality: 0.65 (somewhat formal)
   - Emoji usage: 0.1 (rare)
   - Common phrases: ["happy to help", ...]
   ↓
3. ContextService.logReplySent() logs to learning_signals table ✅
   ↓
4. UserContextEngine.updateFromSignal() processes signal:
   - Gets context via getContext() (loads modular profiles)
   - Updates communicationStyle object in memory
   - Updates relationshipGraph
   - Increments signalCount
   ↓
5. saveContext() saves... TO OLD TABLE ❌ ❌ ❌
   → user_context_profiles.context_data
   → NOT context_profiles table!
```

**Result:** Learning happens but is saved to WRONG TABLE!

---

## The Problem (Critical Bug)

### What SHOULD Happen:
```
Onboarding → Creates modular profiles
Learning → Updates modular profiles
Drafting → Uses modular profiles
```

### What ACTUALLY Happens:
```
Onboarding → Creates modular profiles (identity: 95%, email_communication: 20%)
Learning → Updates OLD table (user_context_profiles)
Drafting → Loads modular profiles (still at 20% - never updated!)
```

### Visual Diagram:
```
┌─────────────────────────────────────────────────────┐
│  OLD TABLE: user_context_profiles                   │
│  ↓ Learning writes HERE (via saveContext)           │
│  ↓ Gets updated with every sent email               │
│  ↓ But NEVER read!                                  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  NEW TABLE: context_profiles                        │
│  ✓ Created during onboarding                        │
│  ✓ Read for email drafting                          │
│  ✗ NEVER UPDATED (stays at defaults forever!)       │
└─────────────────────────────────────────────────────┘
```

---

## Evidence from Logs

```
✓ Loaded user context (confidence: 58%, 0 signals)
```

**What this means:**
- 58% confidence came from OLD migrated data
- 0 signals means NEW modular profiles have never been updated
- The 58% is: (95 identity + 20 email_communication + 0 domain) / 3 / 100 = 0.38... wait that's wrong

Actually, the 58% is coming from the OLD table because saveContext is writing to it!

---

## Code References

### ✅ Loading (Uses Modular Profiles)
**File:** `lib/email-sync/sync-emails.ts`
```typescript
// Line 143: Load user context
const userContext = await getUserContext(connection.user_id, adminSupabase);

// Line 427: Pass to email processor
const processed = await processEmail({
  ...emailData,
  user_context: userContext, // ← Uses modular profiles!
});
```

**File:** `lib/context/profile-adapter.ts`
```typescript
// Lines 24-30: Load modular profiles
const profiles = await ProfileLoader.loadProfiles(userId, [
  'identity',
  'email_communication',
  'domain_knowledge',
  'relationships',
]);

// Lines 38-118: Assemble into old format
const legacy: UserContextProfile = {
  communicationStyle: { /* from email_communication */ },
  relationshipGraph: { /* from relationships */ },
  // ...
};
```

### ❌ Learning (Uses OLD Table)
**File:** `lib/context/user-context-engine.ts`
```typescript
// Lines 378-401: saveContext() - THE BUG
private static async saveContext(
  userId: string,
  context: UserContextProfile
): Promise<void> {
  // TODO: Split context and save to modular profiles:
  // - Update email_communication profile
  // - Update relationships from relationshipGraph
  // - Update identity if rolePatterns changed

  // For now, keep using old structure
  const { error } = await supabase
    .from('user_context_profiles')  // ← WRONG TABLE!
    .upsert({
      user_id: userId,
      context_data: context,
    });
}
```

---

## The Fix Required

### Update `saveContext()` to write to modular profiles:

```typescript
private static async saveContext(
  userId: string,
  context: UserContextProfile
): Promise<void> {
  const supabase = await createClient();

  // Update email_communication profile
  await ProfileLoader.updateProfile(
    userId,
    'email_communication',
    {
      signature: context.communicationStyle.signatureStyle,
      greetingPatterns: context.communicationStyle.greetingPatterns,
      tone: context.communicationStyle.toneVector.formal,
      formalityScore: context.communicationStyle.formalityScore,
      avgLength: context.communicationStyle.avgLength,
      emojiUsage: context.communicationStyle.emojiUsage,
      commonPhrases: context.communicationStyle.commonPhrases,
      responsePatterns: {
        avgResponseTime: context.urgencySensitivity.avgResponseTime,
        priorityAdjustments: {},
      },
    },
    undefined, // Keep existing confidence calculation
    true // Increment signal count
  );

  // Update identity profile if role changed
  if (context.rolePatterns.primaryRole) {
    await ProfileLoader.updateProfile(
      userId,
      'identity',
      {
        fullName: '...', // Would need to track this
        role: context.rolePatterns.primaryRole,
        email: '...', // Would need to track this
        responsibilities: context.rolePatterns.responsibilities,
        authority: context.rolePatterns.decisionMakingLevel,
      },
      undefined,
      false // Don't increment for identity
    );
  }

  // Update relationship graph (store in relationship_graph table)
  // This is more complex - would need separate handling
}
```

---

## Impact Assessment

### What Works Now:
✅ Email drafting uses learned patterns (from OLD table migration)
✅ Sent email analysis extracts patterns correctly
✅ Learning signals are logged
✅ Updates are applied to context object in memory
✅ Profile adapter bridges old/new formats

### What's Broken:
❌ Learning updates go to old table, not modular profiles
❌ Modular profiles never improve (stay at default 20% confidence)
❌ New users after old table deletion will have NO learning
❌ The whole point of modular profiles is lost

### Urgency:
**HIGH** - This needs to be fixed before:
1. Deleting the old `user_context_profiles` table
2. New users onboard (they won't benefit from learning)
3. Users send many emails (learning is lost!)

---

## Recommendation

### Option 1: Fix saveContext() Now (Proper Fix)
- Update `saveContext()` to write to modular profiles
- Map UserContextProfile fields to correct profile types
- Handle confidence score updates properly
- Test that learning persists correctly

**Pros:** Proper fix, enables modular system
**Cons:** Requires careful mapping, more complex

**Effort:** 2-3 hours

### Option 2: Keep Old Table Temporarily (Workaround)
- Don't delete old table yet
- Let learning continue writing to old table
- Loading still works from old table via migration data
- Fix saveContext() later when ready

**Pros:** No immediate work needed
**Cons:** Defeats purpose of migration, technical debt

**Effort:** 0 hours (but blocks cleanup)

### Option 3: Dual Write (Transition Strategy)
- Write to BOTH old and new tables
- Gradually migrate reads to new table
- Remove old table write after validation

**Pros:** Safe transition, no data loss
**Cons:** More complex, more code

**Effort:** 3-4 hours

---

## My Recommendation

**Fix Option 1 (saveContext) BEFORE deleting old table.**

Why:
1. We already did the migration work
2. New modular profiles are created for new users
3. But learning is completely broken
4. This will bite us later when we delete old table
5. Better to fix now while we understand the codebase

**What to build:**
1. Update `saveContext()` to use `ProfileLoader.updateProfile()`
2. Map fields from UserContextProfile to modular profiles:
   - `communicationStyle` → `email_communication` profile
   - `rolePatterns` → `identity` profile
   - `relationshipGraph` → `relationship_graph` table (separate handling)
3. Test with a sent email to verify learning persists
4. Check confidence scores increase properly

This unblocks:
- Deleting old table
- True modular learning
- Skills dashboard (can show what each profile learned)
- Future Slack integration (won't touch email profile)

---

**Next Step:** Should we fix saveContext() now or build something else first?
