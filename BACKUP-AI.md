# Git Backup Status

**Branch:** main
**Backup Point:** Before AI Auto-Assignment

**Status:** Manual backup needed - run:
```powershell
cd "C:\Users\evanr\.openclaw\workspace\happy-solar-leads"
git add -A
git commit -m "Backup before AI Auto-Assignment"
```

**Files to preserve:**
- Smart routing (working)
- Upload deduplication
- Project Manager app (separate)
- All existing features

---

## AI Auto-Assignment Feature Brief

### Requirements
1. Capture setter home address on login
2. Auto-assign leads based on proximity to setter
3. Balanced distribution across team
4. Auto-reassign stale leads (>5 days)
5. AI-powered matching algorithm

### Files to Modify
- `app/types/index.ts` - Add user.homeAddress, lead.autoAssigned, lead.assignedAt
- `app/utils/storage.ts` - Assignment functions
- `app/components/UserOnboarding.tsx` - Capture home address
- `app/components/UploadModal.tsx` - Trigger auto-assignment
- `app/api/autoassign/route.ts` - New API endpoint
- `app/cron/stale-leads.ts` - Daily stale lead check

### AI Algorithm
- Calculate distance from setter home to each lead
- Score leads by: distance, solar quality, current workload
- Optimize assignments for balanced distribution
