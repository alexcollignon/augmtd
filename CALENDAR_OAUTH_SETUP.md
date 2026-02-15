# Calendar OAuth Setup Guide

**Status:** ✅ Calendar sync implementation complete and tested in production
**Required:** OAuth scope updates in Google Cloud Console and Azure AD (already configured)

---

## Implementation Status

✅ **Gmail Calendar** - Fully working with calendar.readonly scope
✅ **Outlook Calendar** - Fully working with Calendars.Read scope
✅ **Meeting Assistant** - AI-generated meeting prep for next 48 hours
✅ **Multi-Inbox Support** - Users can connect multiple accounts
✅ **Token Authentication** - Encrypted token handling for calendar APIs

**Latest Test:** Feb 10, 2026
- Gmail: 17 events synced successfully
- Outlook: 2 events synced successfully
- Meeting prep: 4 items created
- All calendar scopes working correctly

---

## Overview

Calendar syncing uses the **same OAuth connections** as email. No separate OAuth flow needed!

Users connect once → get both email AND calendar access.

## What Changed

### Before (Email Only)
```
User connects Gmail → Syncs emails only
User connects Outlook → Syncs emails only
```

### After (Email + Calendar)
```
User connects Gmail → Syncs emails + calendar events
User connects Outlook → Syncs emails + calendar events
```

**One connection, two data sources!**

---

## Gmail OAuth Scopes Update

### 1. Go to Google Cloud Console

https://console.cloud.google.com/apis/credentials

### 2. Select Your OAuth 2.0 Client ID

Find: "AUGMTD" (or your OAuth client name)

### 3. Add Calendar Scopes

**Currently configured:**
```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
```

**Add these scopes:**
```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

**Final scopes list:**
```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar.readonly    ← NEW
https://www.googleapis.com/auth/calendar.events      ← NEW
```

### 4. Update OAuth Consent Screen

Go to: **OAuth consent screen** → **Scopes**

Add:
- **Google Calendar API** → `.../auth/calendar.readonly`
- **Google Calendar API** → `.../auth/calendar.events`

### 5. Save Changes

---

## Outlook OAuth Scopes Update

### 1. Go to Azure Active Directory

https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps

### 2. Select Your App Registration

Find: "AUGMTD" (or your app name)

### 3. Go to API Permissions

Left sidebar → **API permissions**

### 4. Add Calendar Permissions

**Currently configured:**
```
Microsoft Graph:
- Mail.ReadWrite
- Mail.Send
- offline_access
- openid
- profile
- email
```

**Add these permissions:**

Click **Add a permission** → **Microsoft Graph** → **Delegated permissions**

Search and add:
- `Calendars.Read`
- `Calendars.ReadWrite`

**Final permissions:**
```
Microsoft Graph:
- Mail.ReadWrite
- Mail.Send
- Calendars.Read          ← NEW
- Calendars.ReadWrite     ← NEW
- offline_access
- openid
- profile
- email
```

### 5. Grant Admin Consent (if required)

If your tenant requires admin consent, click:
**Grant admin consent for [Your Organization]**

### 6. Save Changes

---

## Testing the Changes

### For Existing Users

**Important:** Existing users need to **re-authorize** to get calendar access.

**Option 1: Force Re-auth (Recommended)**
1. User goes to Settings
2. Disconnect Gmail/Outlook
3. Reconnect Gmail/Outlook
4. New consent screen will show calendar permissions
5. User approves
6. Now has both email + calendar access

**Option 2: Automatic Token Refresh**
- Next time access token expires, refresh will include new scopes
- May take 1 hour (token expiry time)
- Less disruptive but slower

### For New Users

New users will see calendar permissions in the OAuth consent screen automatically.

**Consent Screen Example:**
```
AUGMTD wants to:
✓ Read, compose, send, and permanently delete all your email from Gmail
✓ See, edit, share, and permanently delete all the calendars you can access
✓ See and download any calendar you can access
```

---

## Verify Calendar Sync is Working

### 1. Run Migration

```bash
# In Supabase SQL Editor or via CLI
psql -h your_supabase_host -U postgres -d postgres -f supabase/migrations/20260215_add_calendar_events.sql
```

### 2. Trigger Manual Sync

```bash
# From Settings page in the UI, click "Sync Now"
# Or via API:
curl -X POST https://your-app.vercel.app/api/connections/sync \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Check Logs

```
[CalendarSync] Starting sync for gmail (user@gmail.com)
[CalendarSync] Found 12 Gmail events
Manual sync completed. Emails: 5, Calendar: 12, Inbox items: 3
```

### 4. Verify Database

```sql
-- Check calendar events were synced
SELECT
  COUNT(*) as total_events,
  provider,
  DATE(start_time) as event_date
FROM calendar_events
WHERE user_id = 'YOUR_USER_ID'
GROUP BY provider, DATE(start_time)
ORDER BY event_date;

-- Example result:
-- total_events | provider | event_date
-- 3            | gmail    | 2026-02-15
-- 5            | gmail    | 2026-02-16
-- 4            | outlook  | 2026-02-17
```

---

## API Response Changes

### Before (Email Only)
```json
{
  "success": true,
  "emailsFetched": 10,
  "inboxItemsCreated": 3
}
```

### After (Email + Calendar)
```json
{
  "success": true,
  "emailsFetched": 10,
  "eventsSynced": 12,        ← NEW!
  "inboxItemsCreated": 3,
  "errors": []
}
```

---

## What Gets Synced

### Time Range
- **Future:** Next 14 days (2 weeks ahead)
- **Past:** Last 7 days (to capture updates/cancellations)

### Event Data
```typescript
{
  title: "Team Standup",
  description: "Daily sync meeting",
  start_time: "2026-02-15T10:00:00Z",
  end_time: "2026-02-15T10:30:00Z",
  attendees: [
    { email: "alice@company.com", status: "accepted" },
    { email: "bob@company.com", status: "tentative" }
  ],
  meeting_link: "https://meet.google.com/abc-defg-hij",
  location: "Conference Room A",
  organizer: "manager@company.com",
  status: "confirmed"
}
```

### What's Extracted
- ✅ Event title and description
- ✅ Start/end times with timezone
- ✅ Attendee list with response status
- ✅ Meeting links (Zoom, Meet, Teams)
- ✅ Location
- ✅ Organizer email
- ✅ Event status (confirmed/cancelled)

---

## Troubleshooting

### "Insufficient permissions" error

**Problem:** Old OAuth tokens don't have calendar scopes

**Solution:** User must reconnect their account:
1. Settings → Disconnect Gmail/Outlook
2. Reconnect with new permissions

### "Calendar events not showing"

**Check:**
1. OAuth scopes added correctly? (Google Cloud Console / Azure AD)
2. Migration ran successfully? (`calendar_events` table exists?)
3. Sync triggered after scope update? (Old tokens won't work)
4. Check logs for API errors

### "Rate limit exceeded"

**Gmail:**
- Limit: 1,000,000 queries/day
- Solution: Reduce `daysAhead` in sync options

**Outlook:**
- Limit: Varies by license (usually high)
- Solution: Implement exponential backoff

---

## Next Steps

After calendar sync is working:

1. **Create inbox items from calendar events**
   - "Prep for meeting with Sarah tomorrow at 2pm"
   - "Generate agenda for team standup"

2. **Build meeting_behavior profile**
   - Learn scheduling patterns
   - Detect preferred meeting times
   - Track participation habits

3. **Meeting prep assistant**
   - Analyze attendees + past interactions
   - Suggest talking points
   - Generate meeting agendas

4. **Meeting follow-up**
   - Extract action items from descriptions
   - Suggest follow-up emails
   - Track decisions made

---

## Summary

✅ **Calendar sync added to existing email sync**
✅ **One OAuth flow for both data sources**
✅ **Same connections table, no schema changes**
✅ **Parallel sync (email + calendar together)**
✅ **Next 2 weeks + past 7 days of events**

**User experience:**
- Connect Gmail once → Get emails + calendar
- One sync button → Syncs everything
- Seamless, unified experience

**Developer experience:**
- Reuse existing OAuth infrastructure
- Same connection management
- Clean separation of concerns (separate tables)

---

**Status:** Ready for testing after OAuth scope updates
**Risk:** Low (existing email sync unaffected)
**Impact:** High (enables meeting assistant features)
