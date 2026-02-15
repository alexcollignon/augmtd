# Context Profiles Migration Guide

## Overview

This document explains the migration from monolithic `user_context_profiles` to modular `context_profiles`.

## Why Migrate?

**Old Structure (Monolithic):**
```sql
user_context_profiles (user_id, context_data JSONB)
  - Everything in one blob
  - Can't separate identity from email style
  - Hard to add new skills (Slack, meetings)
```

**New Structure (Modular):**
```sql
context_profiles (user_id, profile_type, profile_data JSONB)
  - (user_1, 'identity', {...})
  - (user_1, 'email_communication', {...})
  - (user_1, 'relationships', {...})
```

**Benefits:**
- ✅ **Performance:** Only load what you need
- ✅ **Isolation:** Email learning doesn't affect Slack
- ✅ **Scalability:** Add Slack without touching email code
- ✅ **Transparency:** User sees what each skill learned
- ✅ **Skills = Composition:** Skills mix and match profiles

---

## Profile Types

### **Core Profiles (Foundation)**

**1. Identity Profile**
```typescript
{
  fullName: "Alex Smith",
  role: "Product Manager",
  email: "alex@company.com",
  responsibilities: [],
  authority: "manager"
}
```
- **Used by:** ALL skills
- **Learned from:** Onboarding (explicit)
- **Confidence:** High (95%)

**2. Email Communication Profile**
```typescript
{
  signature: "Best,\nAlex",
  greetingPatterns: ["Hi", "Hello"],
  tone: 0.65,
  formalityScore: 0.6,
  avgLength: 147,
  emojiUsage: 0.1,
  commonPhrases: ["Happy to help"]
}
```
- **Used by:** Email drafting
- **Learned from:** Sent emails, draft edits
- **Confidence:** Grows with usage (0-100%)

**3. Relationships Profile**
```typescript
{
  contacts: [
    {
      email: "sarah@client.com",
      name: "Sarah Johnson",
      importance: 95,
      topics: ["reports", "analytics"]
    }
  ]
}
```
- **Used by:** Email drafting, task detection
- **Learned from:** Email metadata, interactions
- **Storage:** Uses existing `relationship_graph` table

**4. Domain Knowledge Profile**
```typescript
{
  vocabulary: {"OKR": "Objectives and Key Results"},
  workflows: [],
  expertise: ["product management"]
}
```
- **Used by:** All skills (context understanding)
- **Learned from:** Email content, file references
- **Confidence:** Low initially

---

## Migration Steps

### **Step 1: Run the Migration SQL**

1. Go to Supabase Dashboard → SQL Editor
2. Run the migration file:
   ```
   supabase/migrations/20260214_migrate_to_modular_profiles.sql
   ```
3. Wait for completion (should be instant)

**What it does:**
- ✅ Creates `context_profiles` table
- ✅ Migrates existing data (3 profiles per user)
- ✅ Sets up RLS policies
- ✅ Creates helper functions
- ✅ Validates migration

### **Step 2: Validate Migration**

Run the validation script:
```bash
npx tsx scripts/run-profile-migration.ts
```

Expected output:
```
✅ Validating migration...
✓ context_profiles table exists
✓ Found 5 users in user_context_profiles
✓ Found 15 profiles in context_profiles
✅ Perfect! Expected 15 profiles, got 15

📊 Profile type breakdown:
   identity: 5
   email_communication: 5
   domain_knowledge: 5
```

### **Step 3: Test Profile Loading**

```typescript
import { ProfileLoader } from '@/lib/context/profile-loader';

// Load profiles for email drafting
const profiles = await ProfileLoader.loadProfiles(userId, [
  'identity',
  'email_communication',
  'relationships'
]);

console.log(profiles.identity.fullName); // "Alex Smith"
console.log(profiles.email_communication.signature); // "Best,\nAlex"
```

### **Step 4: Update Code to Use New Structure**

**Before (old):**
```typescript
const { data } = await supabase
  .from('user_context_profiles')
  .select('context_data')
  .eq('user_id', userId)
  .single();

const context = data.context_data;
const name = context.rolePatterns.primaryRole; // Messy
```

**After (new):**
```typescript
const profiles = await ProfileLoader.loadProfiles(userId, ['identity']);
const name = profiles.identity.fullName; // Clean!
```

### **Step 5: Cleanup (After Validation)**

Once everything works, cleanup old table:

```sql
-- Rename old table (keep as backup)
ALTER TABLE user_context_profiles RENAME TO user_context_profiles_backup;

-- After 1 week, if everything works:
DROP TABLE user_context_profiles_backup;

-- Remove deprecated table
DROP TABLE context_learning_events;
```

---

## How Skills Use Profiles

### **Email Draft Skill**
```typescript
const EmailDraftSkill = {
  requiredProfiles: ['identity', 'email_communication', 'relationships'],

  execute: async (email, profiles) => {
    const { identity, email_communication, relationships } = profiles;

    // Find sender
    const sender = relationships.contacts.find(c => c.email === email.from);

    // Draft email
    return {
      greeting: email_communication.greetingPatterns[0],
      recipientName: sender?.name || 'there',
      signature: email_communication.signature,
      tone: email_communication.tone + (sender?.importance > 80 ? 0.1 : 0)
    };
  }
};
```

### **Slack Response Skill (Future)**
```typescript
const SlackResponseSkill = {
  requiredProfiles: ['identity', 'slack_communication', 'relationships'],

  execute: async (message, profiles) => {
    // Reuses identity + relationships from email
    // Uses slack_communication (different style!)
  }
};
```

---

## API Reference

### **ProfileLoader.loadProfiles()**
```typescript
const profiles = await ProfileLoader.loadProfiles(userId, [
  'identity',
  'email_communication',
  'relationships'
]);
```

### **ProfileLoader.loadProfile()**
```typescript
const identity = await ProfileLoader.loadProfile(userId, 'identity');
console.log(identity.fullName);
```

### **ProfileLoader.updateProfile()**
```typescript
await ProfileLoader.updateProfile(
  userId,
  'email_communication',
  updatedData,
  65.0, // New confidence score
  true  // Increment signal count
);
```

### **ProfileLoader.getAllProfilesSummary()**
```typescript
const summary = await ProfileLoader.getAllProfilesSummary(userId);
// [
//   { profileType: 'identity', confidence: 95, signalCount: 1 },
//   { profileType: 'email_communication', confidence: 67, signalCount: 23 },
//   ...
// ]
```

### **ProfileLoader.initializeUser()**
```typescript
await ProfileLoader.initializeUser(
  userId,
  'Alex Smith',
  'Product Manager',
  'alex@company.com'
);
```

---

## Migration Validation Checklist

- [ ] Migration SQL ran without errors
- [ ] New `context_profiles` table exists
- [ ] Profile count = old users × 3
- [ ] Sample user has 3 profiles (identity, email_communication, domain_knowledge)
- [ ] ProfileLoader can load profiles
- [ ] Email drafting works with new structure
- [ ] Learning signals update profiles correctly
- [ ] Old table backed up before deletion

---

## Rollback (If Needed)

If something goes wrong:

```sql
-- Drop new table
DROP TABLE IF EXISTS context_profiles CASCADE;

-- Restore old table (if renamed)
ALTER TABLE user_context_profiles_backup RENAME TO user_context_profiles;
```

Then fix issues and re-run migration.

---

## Future: Adding New Skills

### **Example: Slack Integration**

**Step 1: Add profile type**
```typescript
// Already supported in schema, just use it:
await ProfileLoader.updateProfile(
  userId,
  'slack_communication',
  {
    tone: 0.3,  // More casual than email
    emojiUsage: 0.6,
    avgLength: 45,
    commonPhrases: ['👍', 'lgtm', 'sounds good']
  }
);
```

**Step 2: Create Slack skill**
```typescript
const SlackResponseSkill = {
  requiredProfiles: ['identity', 'slack_communication', 'relationships'],
  execute: async (message, profiles) => {
    // Identity + Relationships reused from email!
    // Slack communication is new
  }
};
```

**Step 3: Learn from Slack**
```typescript
// When user edits Slack response, update slack_communication profile
await ProfileLoader.updateProfile(
  userId,
  'slack_communication',
  updatedSlackStyle,
  undefined,
  true
);
```

**No changes needed to email drafting!** 🎉

---

## Support

Questions or issues? Check:
- `lib/context/profile-loader.ts` - Main API
- `lib/context/profile-usage-example.ts` - Usage examples
- `supabase/migrations/20260214_migrate_to_modular_profiles.sql` - Migration SQL

---

**Last Updated:** 2026-02-14
