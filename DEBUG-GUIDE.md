# Happy Solar Leads - Debug & Logging Guide

## Restart Script

```powershell
cd "C:\Users\evanr\.openclaw\workspace\happy-solar-leads"
npm run dev
```

## Logging Levels

| Level | When Used | Color |
|-------|-----------|-------|
| ERROR | Failures that stop execution | Red |
| WARN | Issues that don't stop work | Yellow |
| INFO | Key actions (upload, assign, route) | Blue |
| DEBUG | Detailed tracing (dev only) | Gray |

## Where to Find Logs

### 1. Browser Console (F12)
- Frontend logs: `[INFO] [UploadModal]`, `[WARN] [RouteBuilder]`
- API calls and responses
- Geocoding/solar fetch progress

### 2. Server Console
- Backend API logs
- Cron job execution
- Database queries (when integrated)

### 3. Log API Endpoint
```
GET /api/log?level=ERROR&hours=24
```

## Key Log Points

### Upload
```
[INFO] [UploadModal] Starting geocode batch
[INFO] [UploadModal] Geocode complete: X success, Y failed
[INFO] [UploadModal] Skipping duplicate: address
[INFO] [UploadModal] Saving leads: X new, Y poor solar
```

### Auto-Assignment
```
[INFO] [Assignment] Starting auto-assignment for X leads
[INFO] [Assignment] Assigning to setter: name (Y leads total)
[INFO] [Assignment] Reassigning stale lead: address
[WARN] [Assignment] No setter within 50mi of: address
```

### Route
```
[INFO] [Route API] Computing route with X waypoints
[INFO] [Route API] Google response: Y legs, Z miles
[ERROR] [Route API] Google error: ...
```

### Cron Jobs
```
[INFO] [Cron] Daily job starting
[INFO] [Cron] Found X stale leads (>5 days)
[INFO] [Cron] Reassigned Y leads
[INFO] [Cron] Daily job complete
```

## Debug Commands

### View Recent Errors
```powershell
# In browser console:
fetch('/api/log?level=ERROR&hours=24')
  .then(r => r.json())
  .then(console.log)
```

### Clear Logs
```powershell
# Add to any API call:
?clearLogs=true
```

### Verbose Debug Mode
Add to localStorage:
```javascript
localStorage.setItem('debugMode', 'true')
```

## Common Issues & Fixes

| Issue | Check |
|-------|-------|
| Route failing | Check Google API key has Routes API enabled |
| No geocoding | Check address format, API key |
| Assignment not working | Verify setters have home addresses set |
| Stale leads not reassigning | Check cron job is enabled in Vercel |

## Vercel Cron Debug

1. Go to Vercel Dashboard → Deployments
2. Check Function Logs tab
3. Look for `[Cron]` entries
4. Verify schedule: `0 6 * * 1-5` (6 AM MST, Mon-Fri)
