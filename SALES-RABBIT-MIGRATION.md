# Sales Rabbit Replacement Plan - Happy Solar Leads

## Pricing Context
Sales Rabbit costs **$49-75/user/month** depending on billing

Our app could be **free** or **$19-29/user/month** with better solar features

---

## Feature Gap Analysis

### ✅ COMPLETED (Already Have)
| Feature | Priority |
|---------|----------|
| Lead management with status | ✅ |
| Map with color-coded pins | ✅ |
| CSV upload with geocoding | ✅ |
| Solar scoring (Google API) | ✅ |
| Smart routing | ✅ |
| Disposition tracking | ✅ |
| Claim system | ✅ |
| User management | ✅ |

### 🚧 IN PROGRESS
| Feature | Status |
|---------|--------|
| AI Auto-Assignment | 🚧 Building |
| Territory Management | ⏳ Next |

### 📋 MVP (Priority 1 - Replace Basic Sales Rabbit)
| Feature | Effort | Sales Rabbit Plan |
|---------|--------|-------------------|
| Territory/Zone Management | Medium | Pro ($49) |
| Rep Location Tracking | Medium | Team ($59) |
| Performance Leaderboards | Easy | Pro ($49) |
| Dashboards & Reports | Easy | Pro ($49) |
| Custom Fields | Medium | Team ($59) |
| Auto-Reassign Stale Leads | Easy | - |

### 📋 MVP+ (Priority 1b - Enhanced Features)
| Feature | Effort | Sales Rabbit Plan |
|---------|--------|-------------------|
| **Database Integration** | Hard | - |
| **AI Setter Analytics** | Medium | Enterprise |
| **Location Verification** | Medium | Enterprise |
| **Multi-Device Sync** | Hard | Included |

### 🔮 FUTURE (Priority 2 - Premium Features)
| Feature | Effort | Sales Rabbit Plan |
|---------|--------|-------------------|
| Mobile App (PWA) | Hard | Included |
| Weather Integration | Easy | $19 addon |
| Gamification (XP, Battles) | Medium | Enterprise |
| Digital Contracts | Hard | $13 addon |
| AI Buyer Predictions | Medium | $19 addon |

---

## MVP+ Enhanced Features

### 1. Database Integration
```
Current: localStorage (single device, no sync)
Target: Supabase/PostgreSQL

Benefits:
- Multi-device login
- Real-time sync across team
- Better data integrity
- Scale to thousands of leads
- Backup & recovery
```

### 2. AI Setter Analytics
```
Per Setter Metrics:
├── Appointment Rate = appointments / knock
├── Conversation Rate = conversations / knock
├── Conversion Rate = sales / appointment
├── Avg Door Time = total time / knock
├── Best Hours = peak performance times
├── Best Days = peak performance days
└── Solar Score Correlation = conversion by lead quality

AI Suggestions:
- "Your appointment rate drops after 2 PM - try morning shifts"
- "You convert better on leads with solar scores > 75"
- "Your conversation rate is 15% below team average"
```

### 3. Location Verification
```
Anti-Fraud Measures:
├── GPS Check-in Required
│   - Within 500ft of lead address
│   - Timestamp verified
│   - Accuracy score logged
├── Distance Anomaly Detection
│   - If location jumps >5 miles between knocks
│   - Flag for review
└── Time Anomaly Detection
    - If knocks <30 seconds apart (impossible)
    - Flag for review

Verification Flow:
1. Click "Arrived" button
2. Get GPS coordinates
3. Calculate distance to lead
4. If >500ft → Block + "Move closer"
5. If OK → Enable disposition buttons
```

### 1. Territory Management
```
Territories:
├── Rochester West
├── Rochester East
├── Buffalo
├── Syracuse
└── Albany

Each territory:
- Bounding box (lat/lng bounds)
- Assigned setters
- Lead count quota
- Solar score requirements
```

### 2. Rep Location Tracking
```
- Setters enable location sharing
- Dashboard shows live locations
- Geofence territories
- Check-in/check-out tracking
```

### 3. Performance Dashboard
```
Per Setter Stats (daily/weekly):
- Knock count
- Conversations
- Appointments set
- Sales
- Conversion rate
- Avg door time

Team Leaderboard:
- Ranks by appointments
- Ranks by sales
- Ranks by conversion
```

---

## Migration Timeline

### Phase 1: AI Auto-Assignment (Complete ✅)
1. Territory management setup
2. Territory-based lead assignment
3. Rep location tracking
4. Auto-Reassign Stale Leads

### Phase 2.5: Account System (CRITICAL)

### User Roles & Permissions

| Role | Permissions |
|------|-------------|
| **Admin** | Full access: manage users, territories, settings, all leads, analytics |
| **Manager** | View all leads, assign territories, analytics, manage setters |
| **Setter** | View assigned leads, claim/unclaim, dispositions, route navigation |
| **Viewer** (future) | View-only access for sales staff |

### User Schema
```
User {
  id: string (UUID)
  email: string (unique)
  passwordHash: string
  name: string
  role: 'admin' | 'manager' | 'setter' | 'viewer'
  status: 'active' | 'inactive'
  
  // Profile
  phone?: string
  color: string (for map pins)
  
  // Home Address (for AI assignment)
  homeAddress?: string
  homeLat?: number
  homeLng?: number
  
  // Performance (populated automatically)
  assignedLeadCount: number
  totalKnocks: number
  appointmentsSet: number
  salesClosed: number
  
  // Timestamps
  createdAt: Date
  lastLogin: Date
}
```

### Auth Flow
```
1. Sign Up → Email verification → Admin approval → Active
2. Login → JWT token → Store in localStorage/cookies
3. Logout → Clear token → Redirect to login
4. Profile → Edit home address → Geocode on save
```

### Quick Fix (Before Full Auth)
For immediate testing:
- Add "Switch User" button to profile dropdown
- Show all users in dropdown to select
- Still uses localStorage but allows quick switching

### Migration Path
1. **Quick Fix**: Add user switcher for testing ✅
2. **Full Auth**: Email/password with Supabase Auth
3. **RBAC**: Middleware for route protection
1. Database integration (Supabase)
2. AI setter analytics dashboard
3. Location verification system
4. Leaderboards & dashboards

### Phase 3: Mobile (4-6 weeks)
1. PWA with offline support
2. GPS check-in
3. Quick disposition buttons
4. Route navigation

### Phase 4: Premium (ongoing)
1. Weather integration
2. Gamification
3. Digital contracts
4. AI predictions

---

## Revenue Potential

**Assumptions:**
- 10 setters
- 2 managers
- $29/user/month

**Monthly Revenue:** $348
**Annual Revenue:** $4,176

**Cost to run:**
- Google API: ~$50-100/month
- Hosting: ~$20/month
- **Net:** ~$4,000+/year profit

---

## Key Differentiators (Why We're Better)

1. ☀️ **Solar Scoring Built-in** - Know quality before knocking
2. 🎯 **AI Auto-Assignment** - No manual claiming
3. 📊 **Solar Hot Zones** - Prioritize high-potential areas
4. 🏠 **Homeowner Data** - Better lead quality
5. 💰 **Lower Cost** - $29 vs $49-75

---

## Files to Modify/Create

### Phase 1 (Complete ✅)
- `app/utils/assignment.ts` - AI assignment algorithm
- `app/api/autoassign/route.ts` - Auto-assignment API
- `app/api/cron/route.ts` - Daily cron handler
- `app/cron/daily.ts` - Stale lead logic
- `app/components/AutoAssignPanel.tsx` - Manual trigger UI

### Phase 2 (Analytics & Fraud Prevention)
- `supabase/schema.sql` - Database schema
- `app/utils/supabase.ts` - DB client
- `app/types/index.ts` - Update for DB models
- `app/api/db/analytics.ts` - Analytics calculations
- `app/components/AnalyticsDashboard.tsx` - Performance metrics
- `app/api/verify-location/route.ts` - GPS verification
- `app/components/LocationCheck.tsx` - Check-in component
- `app/components/Leaderboard.tsx` - Team rankings

### Phase 2.5 (Account System - CRITICAL)
- `app/types/index.ts` - Add User roles, permissions, auth fields
- `app/api/auth/signup/route.ts` - User registration
- `app/api/auth/login/route.ts` - Email/password login
- `app/api/auth/logout/route.ts` - Session management
- `app/api/auth/profile/route.ts` - Profile/home address
- `app/components/AuthLayout.tsx` - Login/signup pages
- `app/components/LoginForm.tsx` - Login UI
- `app/components/SignupForm.tsx` - Signup UI
- `app/components/ProfileManager.tsx` - Home address editing
- `app/components/UserManagement.tsx` - Admin user management
- `app/middleware.ts` - Route protection by role
- `app/utils/auth.ts` - Auth helper functions

### Phase 2.6 (Go-Back Calendaring)

```
Lead {
  ...
  goBackDate?: string;      // YYYY-MM-DD format
  goBackNotes?: string;     // "Ask about the roof"
  goBackSetBy?: string;     // User ID who set it
  goBackSetAt?: Date;
}

UI Flow:
1. Setter clicks "Go Back" on lead detail
2. Picks date from calendar
3. Adds notes (optional)
4. Lead shows in "Today's Go-Backs" widget
5. Morning cron sends reminder
6. On selected date, lead added to route
```

**UI Components:**
- Date picker in Lead Detail
- Calendar view (monthly)
- Daily go-backs list widget
- Highlight on map (special pin color)

### Phase 2.7 (Objection Tracking)
```
Lead {
  ...
  disposition: 'not-interested';
  objectionType?: string;     // Specific objection
  objectionNotes?: string;    // Free-form notes
}

Objection Categories:
├── "Too expensive"
├── "Bad credit"
├── "Roof issues"
├── "Moving soon"
├── "Not owner"
├── "Already have solar"
├── "Too complicated"
├── "Need to think about it"
├── "Not interested in solar"
└── "Other"

AI Analysis:
├── Objection frequency by setter
├── Objection frequency by area
├── Conversion rate by objection type
└── Script suggestions per objection
```

### Phase 3 (Mobile)
- `app/components/MobileLayout.tsx` - Responsive mobile-first
- `app/components/QuickDisposition.tsx` - Fast mobile actions
- `service-worker.js` - Offline support
- `manifest.json` - PWA manifest

### Phase 4 (Premium)
- `app/api/weather/route.ts` - Weather integration
- `app/components/Gamification.tsx` - XP, badges, battles
- `app/api/contracts/route.ts` - Digital signatures
