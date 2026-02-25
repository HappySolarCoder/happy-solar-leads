# Team Dashboard Metrics Update - Scope

## Current Issue
The Team Dashboard (setter-stats) calculates "knocks" using a hardcoded list instead of using the `countsAsDoorKnock` flag from disposition settings. This makes the metrics inaccurate.

## Required Changes

### 1. Fix Total Knocks Calculation
**Problem:** Currently hardcoded to `['not-home', 'interested', 'not-interested', 'appointment', 'sale']` - missing 'go-back' and doesn't use dynamic disposition settings.

**Fix:** Load dispositions from Firestore and count leads where disposition has `countsAsDoorKnock = true`.

### 2. Add New Metrics to Team Dashboard

Add these 4 metrics to the team totals section:

| Metric | Formula |
|--------|---------|
| **Total Knocks** | Leads with dispositions where `countsAsDoorKnock = true` |
| **Conversation %** | (Interested + Appointment + Sale) / Total Knocks × 100 |
| **Appointment % (from conversations)** | Appointments / (Interested + Appointment + Sale) × 100 |
| **Appointment % (from total knocks)** | Appointments / Total Knocks × 100 |

### 3. Update Per-User Metrics
Add the same percentage calculations to each user's row in the leaderboard.

### 4. Display Format
- Show percentages with 1 decimal place (e.g., "23.5%")
- Show these prominently in the team totals section at the top

## Technical Notes
- Load dispositions from Firestore via `getDispositionsAsync()` 
- Filter leads where disposition.countsAsDoorKnock === true
- "Conversations" = leads with status: interested, appointment, or sale (meaningful interactions)
- Use consistent calculation across all time filters (today/week/month/all)

## File to Modify
- `/app/setter-stats/page.tsx`
- Possibly `/app/utils/dispositions.ts` if needed for helper functions
