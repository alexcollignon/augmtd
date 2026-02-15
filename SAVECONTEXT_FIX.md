# saveContext() Fix - Learning Now Uses Modular Profiles

## What Was Fixed

Updated `lib/context/user-context-engine.ts` to save learning updates to modular `context_profiles` table instead of the old `user_context_profiles` table.

---

## Changes Made

### 1. Added ProfileLoader Import
```typescript
import { ProfileLoader } from './profile-loader';
```

### 2. Completely Rewrote saveContext()

**Before:**
```typescript
// Wrote to old table
await supabase.from('user_context_profiles').upsert({
  user_id: userId,
  context_data: context, // Entire blob
});
```

**After:**
```typescript
// Writes to modular profiles
await ProfileLoader.updateProfile(
  userId,
  'email_communication',
  {
    signature: context.communicationStyle.signatureStyle,
    greetingPatterns: context.communicationStyle.greetingPatterns,
    tone: context.communicationStyle.toneVector.formal,
    // ... all communication patterns
  },
  emailCommConfidence,
  false
);

// Also updates identity profile if needed
await ProfileLoader.updateProfile(userId, 'identity', {...});
```

---

## Field Mapping

### UserContextProfile → Modular Profiles

**communicationStyle → email_communication:**
- `avgLength` → `avgLength`
- `toneVector.formal` → `tone` (0-1 value)
- `formalityScore` → `formalityScore`
- `greetingPatterns` → `greetingPatterns`
- `signatureStyle` → `signature`
- `emojiUsage` → `emojiUsage`
- `commonPhrases` → `commonPhrases`
- `urgencySensitivity.avgResponseTime` → `responsePatterns.avgResponseTime`

**rolePatterns → identity:**
- `primaryRole` → `role`
- `responsibilities` → `responsibilities`
- `decisionMakingLevel` → `authority`
- Preserves existing `fullName` and `email`

**relationshipGraph:**
- Not updated here (managed separately via `relationship_graph` table)

---

## Confidence Score Calculation

**email_communication:**
```typescript
confidence = min(95, 20 + (signalCount * 2))
```

- Starts at 20% (domain heuristic from onboarding)
- Increases by 2% per learning signal
- Caps at 95% (always leave room for improvement)

**identity:**
```typescript
confidence = dimensionConfidence.rolePatterns * 100
```

- Uses existing confidence calculation from context

---

## Dual-Write Strategy (Temporary)

For safety during transition, the code now writes to **BOTH**:
1. ✅ New modular profiles (primary)
2. ✅ Old table (backup, will be removed)

```typescript
// TEMPORARY: Also write to old table for backward compatibility
// TODO: Remove after 1-2 weeks of validation
await supabase.from('user_context_profiles').upsert({...})
```

**Why dual-write?**
- Safety net during transition
- Can rollback if needed
- Old code paths still work
- Easy to remove later

**When to remove:**
- After 1-2 weeks of production validation
- After verifying modular profiles work correctly
- After confirming learning persists properly

---

## How Learning Works Now

### Full Flow (Fixed):

```
1. User sends email
   ↓
2. sent-email-analyzer extracts:
   - greeting: "Hey"
   - signature: "Best,\nAlex"
   - formality: 0.65
   - emoji usage: 0.1
   ↓
3. ContextService.logReplySent() logs signal
   ↓
4. UserContextEngine.updateFromSignal() updates in-memory context
   ↓
5. saveContext() writes to:
   ✅ context_profiles (email_communication) ← NEW!
   ✅ context_profiles (identity if changed) ← NEW!
   ✅ user_context_profiles (backup) ← TEMP
   ↓
6. Next email draft loads from:
   ✅ context_profiles (via ProfileLoader)
   ✅ Gets updated patterns!
```

---

## Verification Steps

### Test 1: Send an Email
1. Start dev server: `npm run dev`
2. Connect Gmail/Outlook if not already connected
3. Send an email from your connected account
4. Check logs for:
   ```
   [SentEmailAnalyzer] Extracted learning signals from sent email: ...
   [UserContextEngine] Saved to modular profiles + old table (X signals)
   ```

### Test 2: Check Database
```sql
-- Check email_communication profile updated
SELECT
  profile_type,
  profile_data->>'signature' as signature,
  profile_data->>'greetingPatterns' as greetings,
  confidence_score,
  learned_from_count,
  last_updated
FROM context_profiles
WHERE user_id = 'YOUR_USER_ID'
  AND profile_type = 'email_communication';
```

Expected:
- `signature` should have your actual signature
- `greetingPatterns` should have your greetings
- `confidence_score` should increase with each sent email
- `learned_from_count` should increment
- `last_updated` should be recent

### Test 3: Verify Learning Persists
1. Send 2-3 emails with consistent patterns
2. Trigger email sync to fetch new emails
3. Check logs for:
   ```
   ✓ Loaded user context (confidence: XX%, Y signals)
   ```
4. Confidence should be higher than initial 20%
5. signalCount should match number of sent emails

### Test 4: Check Email Drafting
1. Receive an email that needs a reply
2. Open inbox item
3. Check prepared draft
4. Verify it uses:
   - Your learned greeting (not generic)
   - Your learned signature
   - Your tone/formality level

---

## Success Metrics

After sending 5 emails, you should see:

**In database:**
```sql
confidence_score: 30  -- Was 20, now 20 + (5 * 2)
learned_from_count: 5
profile_data: {
  "signature": "Best,\nAlex",
  "greetingPatterns": ["Hey", "Hi"],
  "tone": 0.65,
  "avgLength": 147,
  ...
}
```

**In logs:**
```
✓ Loaded user context (confidence: 30%, 5 signals)
[UserContextEngine] Saved to modular profiles + old table (5 signals)
```

**In email drafts:**
- Uses your actual greeting ("Hey" not "Hi there")
- Uses your actual signature ("Best,\nAlex" not generic)
- Matches your formality level

---

## Rollback Plan (If Needed)

If something breaks:

1. **Revert the saveContext() change:**
   ```bash
   git diff lib/context/user-context-engine.ts
   git checkout lib/context/user-context-engine.ts
   ```

2. **Old table still has all data** (dual-write ensures this)

3. **No data loss** - old system continues working

---

## Next Steps

After validation (1-2 weeks):

1. **Remove dual-write to old table:**
   ```typescript
   // Delete this section from saveContext():
   await supabase.from('user_context_profiles').upsert({...})
   ```

2. **Backup and drop old table:**
   ```sql
   ALTER TABLE user_context_profiles RENAME TO user_context_profiles_backup;
   -- After another week:
   DROP TABLE user_context_profiles_backup;
   ```

3. **Remove profile-adapter.ts** (no longer needed):
   - Update code to use ProfileLoader directly
   - Remove getUserContextLegacy() calls
   - Clean up imports

4. **Celebrate!** 🎉
   - Full modular profile system
   - Learning works correctly
   - Ready for skills dashboard
   - Ready for Slack integration

---

## Troubleshooting

### "Profile not found" error
- Check user has completed onboarding
- Verify context_profiles table has entries for user
- Run: `SELECT * FROM context_profiles WHERE user_id = 'YOUR_ID'`

### Confidence not increasing
- Check learning_signals table for entries
- Verify sent emails are marked with `is_from_user = true`
- Check logs for "Extracted learning signals" message

### Signature not updating
- Verify sent emails have consistent signature
- Check profile_data JSON in database
- May take 2-3 emails to learn pattern

### Type errors
- Run `npm run build` to check TypeScript
- Verify ProfileLoader types match
- Check profile-loader.ts for ProfileDataMap definitions

---

**Status:** ✅ Fixed and ready for testing
**Risk:** Low (dual-write provides safety net)
**Impact:** High (enables true modular learning)
