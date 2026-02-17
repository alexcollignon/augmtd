# Recent Changes - Work Decomposition & Workflows

## Summary (Feb 17, 2026)

Major improvements to work decomposition system with complete workflow structure including inputs, outputs, and skills for future execution.

---

## Key Changes

### 1. Work Decomposition - Complete Structure

**AI now generates complete, executable workflows:**
- ✅ **Inputs** - What data/documents/context needed before starting
- ✅ **Steps** - Actions with tools, skills, time estimates, dependencies
- ✅ **Outputs** - Expected artifacts/deliverables produced

**Type System:**
```typescript
// Input types
'data_source' | 'document' | 'context' | 'approval' | 'meeting_notes' | 'user_input'

// Output types
'draft' | 'final_document' | 'data_export' | 'visualization' | 'summary' | 'decision' | 'notification'

// Skills assigned to steps
'data_pull' | 'excel_generator' | 'powerpoint_generator' | 'email_drafter' | 'data_analyzer' | 'chart_generator'
```

### 2. Work Page UI Enhancements

**New sections display complete workflow:**
- **Inputs Section** (Blue) - Required data sources, documents, context with examples
- **Steps Section** (Gray) - Actions with tools needed, time estimates, skills
- **Outputs Section** (Green) - Expected artifacts with types and descriptions
- **Save as Workflow** - Checkbox to save for reuse

### 3. Workflow Persistence

**Database Schema:**
- `user_workflows` table stores reusable workflows
- Includes inputs, steps, outputs, metadata
- Tracks usage count and last used
- Links to user and department

**API:**
- `POST /api/workflows/save` - Save workflow for reuse
- Simple endpoint focused on persistence

### 4. Onboarding Improvements

**Simplified onboarding:**
- Removed seniority field
- Job role now free text (not dropdown)
- Department first, then role
- Workflows filtered by department only

**Main onboarding modal:**
- Added department field (14 options)
- Integrated with work patterns system
- Saves to both profiles table and context_profiles

**Fixed identity preservation:**
- `ProfileLoader.initializeUser()` now merges with existing data
- Preserves `department` and `jobRole` during email sync
- Prevents onboarding modal from re-appearing after sync

### 5. Blueprint System Updates

**Removed unused code:**
- Deleted `defaultSteps` from blueprints (were never used)
- Removed `BlueprintStep` interface
- Simplified `WorkBlueprint` to template only
- AI generates actual steps dynamically

**Blueprint filtering:**
- Now filters by department only
- Shows only blueprints for user's department
- Removed frequency and time pills from cards

### 6. Database Migrations

**Created:**
- `20260217_create_workflows_table.sql` - user_workflows schema
- `20260217_add_department_to_profiles.sql` - (created but not used)
- `20260217_remove_workflow_executions.sql` - Cleanup unused table

**Tables:**
```sql
user_workflows - Stores reusable workflows with inputs/steps/outputs
  - inputs JSONB (WorkflowInput[])
  - steps JSONB (ExecutionStep[])
  - outputs JSONB (WorkflowOutput[])
  - usage tracking and metadata
```

---

## Files Changed

### Core Logic
- `lib/execution/work-decomposition.ts` - AI prompt with complete structure
- `lib/context/work-patterns-service.ts` - Removed seniority, updated validation
- `lib/context/profile-loader.ts` - **Fixed: Preserve department/jobRole during sync**

### Type Definitions
- `lib/types/inbox.ts` - Added WorkflowInput, WorkflowOutput, updated ExecutionStep
- `lib/types/workflows.ts` - Complete Workflow type system
- `lib/types/work-blueprints.ts` - Removed defaultSteps, simplified

### UI Components
- `app/work/work-page-client.tsx` - Display inputs/outputs, workflow saving
- `components/onboarding-modal.tsx` - Added department field
- `components/onboarding/work-patterns-onboarding.tsx` - Simplified (no longer used in main flow)
- `app/inbox/inbox-page-client.tsx` - Updated onboarding trigger logic
- `components/sidebar-nav.tsx` - Cleaned up (removed workflows link)

### API Endpoints
- `app/api/workflows/save/route.ts` - **New:** Simple workflow save endpoint
- `app/api/work/create/route.ts` - Updated with workflow saving
- `app/api/work/onboarding/route.ts` - Removed seniority validation
- `app/api/context/onboarding/route.ts` - Added department saving

### Database
- `supabase/migrations/20260217_create_workflows_table.sql`
- `supabase/migrations/20260217_remove_workflow_executions.sql`

### Documentation
- `WORK_DECOMPOSITION_COMPLETE.md` - Comprehensive guide
- `RECENT_CHANGES.md` - This file

---

## What Was Removed

**Workflow Library UI (intentionally excluded):**
- ❌ `/app/workflows` pages - Not needed yet
- ❌ `/app/api/workflows` full CRUD - Simplified to save-only
- ❌ Sidebar "Workflows" link - Keeping it simple

**Unused Blueprint Code:**
- ❌ `defaultSteps` field from all blueprints
- ❌ `BlueprintStep` interface
- ❌ `typicalRoles` references

**Database:**
- ❌ `workflow_executions` table - Will recreate when building execution engine

---

## Current State

### ✅ Working
- AI generates complete workflows (inputs → steps → outputs)
- Work page displays all three sections
- Workflows can be saved and reused
- Department-based blueprint filtering
- Onboarding captures department + job role
- Identity profile preserved during email sync

### ⏳ Not Built Yet
- Execution engine (actually running workflows)
- Skill implementations (data_pull, excel_generator, etc.)
- Input collection UI when executing saved workflows
- Artifact generation and storage
- Progress tracking during execution
- Workflow library UI (intentionally postponed)

---

## Bug Fixes

### Critical: Identity Profile Overwrite
**Issue:** Email sync was resetting onboarding data, causing modal to re-appear

**Root Cause:** `ProfileLoader.initializeUser()` was overwriting identity profile without preserving `department` and `jobRole`

**Fix:** Updated to merge with existing profile data:
```typescript
// Get existing profile
const { data: existing } = await supabase
  .from('context_profiles')
  .select('profile_data')
  .eq('user_id', userId)
  .eq('profile_type', 'identity')
  .single();

// Merge instead of overwrite
const mergedData = {
  ...(existing?.profile_data || {}),  // Preserves department, jobRole
  fullName,
  role,
  email,
  responsibilities: existing?.profile_data?.responsibilities || [],
  authority,
};
```

**File:** `lib/context/profile-loader.ts` (lines 360-378)

---

## Testing Recommendations

1. **Work Decomposition:**
   - Create work from blueprint → Check inputs/outputs generated
   - Create custom work → Verify complete structure
   - Save as workflow → Confirm saves to database

2. **Onboarding:**
   - Complete onboarding → Verify department + role saved
   - Sync emails → Confirm onboarding doesn't re-appear
   - Check context_profiles table → Verify department/jobRole preserved

3. **Blueprints:**
   - Check department filtering → Only see relevant templates
   - Verify no frequency/time pills on cards

---

## Migration Instructions

Run these migrations in Supabase:

```sql
-- Already run by user
-- CREATE TABLE user_workflows (...)

-- Run this to clean up
DROP TABLE IF EXISTS workflow_executions;
```

---

## Next Steps

When building execution engine:
1. Input collection UI for saved workflows
2. Step execution router (dispatch to skills)
3. Skill implementations (data_pull, excel_generator, etc.)
4. Artifact generation and storage
5. Progress tracking and status updates
6. Error handling and retries

---

## Developer Notes

- Work decomposition structure is now complete for execution
- All necessary metadata captured (inputs, outputs, tools, skills)
- Identity profile preservation critical - always merge, never overwrite
- Workflow library UI postponed - focus on decomposition quality first
- Blueprint templates are prompts only - AI generates actual workflows
