# User Session State Schema Design

## Problem
Door knockers using app for 6+ hours lose their map position and filters when:
- App refreshes or crashes
- Switching between leads
- Going back to map from other pages

## Solution: Persist User Session State

### Firestore Collection: `userSessions`

```typescript
interface UserSession {
  userId: string;
  
  // Map State
  mapCenter: {
    lat: number;
    lng: number;
  };
  mapZoom: number; // 1-20
  
  // Filters (persist across the day)
  filters: {
    status: string[];        // ['unclaimed', 'assigned']
    tags: string[];          // ['solar-data', 'homeowner']
    territories: string[];   // territory IDs
    solarCategory: string;   // 'all', 'great', 'good', 'solid', 'poor'
    assignedToMe: boolean;
  };
  
  // Sort Preference
  sortBy: 'distance' | 'solarScore' | 'createdAt';
  sortOrder: 'asc' | 'desc';
  
  // Last Active View
  lastView: 'map' | 'list' | 'route';
  
  // Session Tracking
  lastActiveAt: Date;
  lastPage: string;          // '/lead-management', '/activity-map', etc.
  
  // Active Route (for route builders)
  activeRouteId?: string;
  
  // Mobile-specific
  showSatellite: boolean;
}
```

### Implementation Strategy

**Auto-save triggers:**
- On map move/zoom (debounce 2 sec)
- On filter change
- On page change
- On app background/close
- Every 5 minutes as backup

**Restore on login:**
- Load session state on app init
- Apply map position + filters automatically
- Show "Welcome back to your last session" toast

### User Benefits
1. **Resume exactly where left off** - map position, zoom, filters all restored
2. **No re-filtering** - morning filters work all day
3. **Crash recovery** - can pick up right where stopped
4. **Multi-page flow** - switching tools doesn't lose context

### Priority for Door Knockers
1. **Map position + zoom** - most critical
2. **Filters** - second most important
3. **Last page** - quick return to work
4. **Sort preference** - tertiary

---

**Question for Evan:** Should we also save "recently viewed leads" or "last 10 leads worked" for quick access?
