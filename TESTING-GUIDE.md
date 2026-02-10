# Benedict's Testing Environment

## Quick Start

### 1. Start the App
```powershell
cd "C:\Users\evanr\.openclaw\workspace\happy-solar-leads"
npm run dev
```

### 2. Open in Browser
- **App:** http://localhost:3000
- **Project Manager:** http://localhost:3001/project-manager

---

## Quick Setup (One Command)

```powershell
cd "C:\Users\evanr\.openclaw\workspace\happy-solar-leads"
npm run setup-test
```

This generates test data files. Then copy the import commands to your browser console.

## Individual Commands

```powershell
npm run dev           # Start the app
npm run setup-test    # Generate test data files
npm run test-assign  # Preview assignments
npm run reset        # Clear test data files
npm run gen-leads    # Generate test leads
npm run gen-users    # Generate test users
```

## How to Import Test Data

1. Run the scripts:
```powershell
node scripts/generate-test-users.js
node scripts/generate-test-leads.js
```

2. Open browser DevTools (F12) → Console

3. Copy/paste the import commands shown (they look like `localStorage.setItem(...)`)

4. Refresh the page

---

## Console Commands (Browser DevTools)

### Check Users
```javascript
const users = JSON.parse(localStorage.getItem('happysolar_users') || '[]');
users.map(u => ({ id: u.id, name: u.name, homeLat: u.homeLat, homeLng: u.homeLng }))
```

### Check Leads
```javascript
const leads = JSON.parse(localStorage.getItem('happysolar_leads') || '[]');
console.log('Total leads:', leads.length);
console.log('With coordinates:', leads.filter(l => l.lat && l.lng).length);
console.log('Claimed:', leads.filter(l => l.claimedBy).length);
```

### Unclaim All Leads
```javascript
const leads = JSON.parse(localStorage.getItem('happysolar_leads') || '[]');
const reset = leads.map(l => ({ ...l, claimedBy: undefined, claimedAt: undefined, status: 'unclaimed' }));
localStorage.setItem('happysolar_leads', JSON.stringify(reset));
location.reload();
```

### Clear All Data
```javascript
localStorage.clear();
location.reload();
```

---

## Test Scenarios

### Scenario 1: Auto-Assignment
1. Run `generate-test-users.js` - Creates setters with home addresses
2. Run `generate-test-leads.js` - Creates leads
3. In app, click "Auto-Assign" button
4. Check console for assignment logs
5. Filter by setter to see their leads

### Scenario 2: Navigate Button
1. Click a pin on the map
2. Click "Navigate" button
3. Verify Google Maps opens

### Scenario 3: User Switching
1. Click user avatar in top-right
2. Switch between users
3. Verify different leads shown (filtered by claimedBy)

---

## Debug Logging

### Enable Verbose Logging
```javascript
localStorage.setItem('debugMode', 'true');
```

### View Assignment Logs
```javascript
// Check console for [INFO] [Assignment] logs
// Or fetch logs:
fetch('/api/log?level=INFO&hours=1').then(r => r.json()).then(console.log)
```

---

## File Structure

```
happy-solar-leads/
├── scripts/
│   ├── generate-test-leads.js   # Create test leads
│   ├── generate-test-users.js  # Create test setters
│   ├── test-autoassign.js      # Test assignment algo
│   └── reset-data.js           # Clear all data
├── app/
│   ├── api/
│   │   ├── autoassign/route.ts
│   │   └── geocode/route.ts
│   ├── utils/
│   │   └── assignment.ts       # Auto-assignment logic
│   └── components/
│       ├── AutoAssignPanel.tsx
│       └── UserSwitcher.tsx
└── DEBUG-GUIDE.md
```

---

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| No users with home addresses | Run `generate-test-users.js` |
| Leads not assigning | Check console for `[Assignment]` logs |
| Geocoding fails | Verify Google API key has Geocoding API enabled |
| Route optimization fails | Check Google Routes API enabled |
| Old data persists | Run `reset-data.js` or `localStorage.clear()` |
