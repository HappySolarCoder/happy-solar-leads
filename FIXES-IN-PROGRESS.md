# Fixes In Progress - Feb 11, 2026

## Issues to Fix

### 1. ✅ Auto-Assign Panel (FIXED)
**Problem:** Panel disappears on click - was rendering double modal wrapper  
**Fix:** Updated AutoAssignPanel to accept `isOpen`/`onClose` props instead of managing own state  
**Status:** Code updated, ready to test

### 2. 🔄 Territory Drawing Not Working
**Problem:** Map still drags instead of drawing territory  
**Root Cause:** Leaflet's drag handler might be capturing events before our custom handlers  
**Fix Needed:** Add event.stopPropagation() and use L.DomEvent.disableClickPropagation()  
**Status:** Investigating

### 3. 🔄 Manual Lead Assignment Not Working
**Problem:** Clicking leads doesn't select them  
**Root Cause:** Unknown - need to verify handleLeadSelect is being called  
**Status:** Needs investigation

### 4. ⚠️ Upload Leads - Solar API 404s
**Problem:** `/api/solar` returns 404 during upload  
**Analysis:** 
- Route file exists locally at `app/api/solar/route.ts`
- Might be deployment issue (not built/deployed)
- Or environment variable missing in production
**Fix Needed:**
1. Verify route is deployed
2. Check Vercel build logs
3. Add better error handling in UploadModal
**Status:** Needs production debugging

### 5. ⚠️ Upload Leads - Undefined Field Error
**Problem:** `estimatedBill` field is undefined, Firestore rejects it  
**Root Cause:** CSV might not have `estimatedBill` column  
**Analysis:** `cleanObject()` is already in place in `firestore.ts` saveLead function  
**Fix Needed:** Ensure UploadModal handles missing CSV columns gracefully  
**Status:** cleanObject should handle this, might need additional validation

### 6. 📋 Hierarchical Dispositions (NEW FEATURE)
**Request:** "Not Home" → sub-options, "Conversation" → sub-options, etc.  
**Design:**
- Add `parentId` field to Disposition type
- Update DispositionModal to show parent selection
- Update LeadDetail to show two-step UI (select parent, then child)
- Keep flat structure as option (parentId = null)
**Status:** Feature request, not a bug

### 7. ✅ Admin Routes 404 (EXPECTED BEHAVIOR)
**Routes:** /admin/roles, /admin/assignments, /admin/data-cleanup  
**Analysis:** These are placeholder routes marked "Coming Soon" in admin dashboard  
**Status:** Not bugs - features not built yet

## Priority Order

1. **CRITICAL:** Auto-Assign Panel rendering ✅ FIXED
2. **CRITICAL:** Territory drawing not working 🔄
3. **CRITICAL:** Manual assignment not working 🔄
4. **HIGH:** Upload Solar API 404s ⚠️
5. **MEDIUM:** Hierarchical dispositions (feature request)
6. **LOW:** Admin placeholder routes (not bugs)

## Next Steps

1. Test auto-assign panel fix locally
2. Debug territory drawing with console.logs
3. Debug manual assignment selection
4. Check Vercel deployment for Solar API route
5. Consider hierarchical disposition design

## Testing Commands

```bash
cd C:\Users\Evan\Projects\happy-solar-leads
npm run build          # Check for TypeScript errors
npm run dev            # Test locally
```

## Deployment

After fixes are confirmed working locally:
```bash
npm run build          # MUST pass
npx tsc --noEmit       # MUST pass
git add .
git commit -m "Fix: AutoAssign panel, territory drawing, manual assignment"
git push origin main   # Auto-deploys to Vercel
```
