# Sales Rabbit Feature Gap Analysis & Implementation Plan
**Date:** February 9, 2026  
**Current Version:** v0.1-pre-migration  
**Target:** Match or exceed Sales Rabbit Team/Pro features at $29/user/month

---

## 📊 Executive Summary

### Sales Rabbit Pricing
| Plan | Monthly | Annual | Features |
|------|---------|--------|----------|
| **Lite** | $0 | $0 | Basic canvassing only (1 user) |
| **Team** | $59 | $49/user | + Analytics, Territory, Tracking |
| **Pro** | $75 | $65/user | + Gamification, Scheduler, Custom Fields |
| **Enterprise** | Custom | Custom | + API, SSO, SLA, IP Security |

**Add-ons:**
- DataGrid AI (buyer scores): +$19/user
- Digital Contracts: +$13/user
- Weather: +$19/user
- Movers: +$13/user

### Our Competitive Advantage
✅ **Solar scoring built-in** (no extra cost)  
✅ **AI auto-assignment** (unique to us)  
✅ **Better pricing:** $29/user vs $49-75  
✅ **Solar-specific features**

---

## 🎯 Feature Comparison Matrix

### ✅ COMPLETE (We Already Have)

| Feature | Sales Rabbit | Happy Solar | Notes |
|---------|--------------|-------------|-------|
| Track Leads on Map | ✅ All Plans | ✅ | Leaflet maps with color pins |
| Filter Leads by Status | ✅ All Plans | ✅ | 7 status types |
| Take Notes | ✅ All Plans | ✅ | Per-lead notes field |
| Set Appointments | ✅ All Plans | ✅ | Appointment status tracking |
| Get Reminders | ✅ All Plans | ⚠️ Partial | No calendar integration yet |
| Plan Routes | ✅ All Plans | ✅ | Route optimization algorithm |
| Import/Export | ✅ Team+ | ✅ | CSV upload with geocoding |
| **Solar Scoring** | ❌ | ✅ | **Our unique advantage!** |
| **AI Auto-Assignment** | ❌ | ✅ | **Our unique advantage!** |

---

## 🚨 CRITICAL GAPS (P0 - Blockers)

### 1. **Database & Multi-Device Sync** 
**Status:** ❌ Missing (localStorage only)  
**Sales Rabbit:** ✅ All plans  
**Impact:** HIGH - Can't use across devices, no team collaboration  
**Effort:** HIGH (1-2 weeks)

**Implementation:**
```
Phase 1: Supabase Setup
├── Create Supabase project
├── Design PostgreSQL schema (users, leads, territories)
├── Set up Row Level Security (RLS)
└── Migration script from localStorage

Phase 2: Replace Storage Layer
├── Replace app/utils/storage.ts with Supabase client
├── Implement real-time subscriptions
├── Add offline sync support (future)
└── Testing & data migration
```

**Files to Create/Modify:**
- `supabase/schema.sql`
- `supabase/seed.sql`
- `app/utils/supabase.ts`
- `app/utils/storage.ts` (refactor)
- `.env.local` (Supabase credentials)

---

### 2. **Authentication System**
**Status:** ❌ Missing (user switcher only)  
**Sales Rabbit:** ✅ All plans (+ 2FA on Enterprise)  
**Impact:** CRITICAL - No login/logout, no security  
**Effort:** MEDIUM (1 week)

**Implementation:**
```
Authentication Flow
├── Email/Password signup
├── Email verification
├── Login with JWT tokens
├── Password reset
├── Session management
└── Role-based access control (RBAC)

User Roles:
├── Admin (full access)
├── Manager (view all, assign territories)
├── Setter (own leads only)
└── Viewer (read-only, future)
```

**Files to Create:**
- `app/api/auth/signup/route.ts`
- `app/api/auth/login/route.ts`
- `app/api/auth/logout/route.ts`
- `app/api/auth/reset-password/route.ts`
- `app/components/LoginForm.tsx`
- `app/components/SignupForm.tsx`
- `app/middleware.ts` (route protection)
- `app/utils/auth.ts`

---

### 3. **Rep Location Tracking**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Team+  
**Impact:** HIGH - Can't verify setters are in the field  
**Effort:** MEDIUM (1 week)

**Implementation:**
```
Location Features
├── GPS check-in (must be within 500ft of lead)
├── Live location tracking (admin view)
├── Location history & breadcrumbs
├── Geofence alerts (setter left territory)
└── Anti-fraud detection (teleporting, impossible speeds)

Location Verification Flow:
1. Setter arrives at lead
2. Clicks "Arrived" button
3. App gets GPS coordinates
4. Validates distance (<500ft from lead)
5. Enables disposition buttons
6. Logs timestamp & accuracy
```

**Files to Create:**
- `app/api/location/checkin/route.ts`
- `app/api/location/track/route.ts`
- `app/components/LocationVerification.tsx`
- `app/components/LiveLocationMap.tsx` (admin)
- `app/utils/geolocation.ts`

---

### 4. **Territory & Area Management**
**Status:** ⚠️ Basic (user assignment only)  
**Sales Rabbit:** ✅ Team+  
**Impact:** HIGH - Can't organize teams efficiently  
**Effort:** MEDIUM (1 week)

**Implementation:**
```
Territory Features
├── Create territories (draw on map)
├── Assign setters to territories
├── Territory-based lead filtering
├── Quota tracking per territory
├── Heat maps (lead density)
└── Overlap detection

Territory Schema:
- id, name, bounds (GeoJSON polygon)
- assignedSetters (array of user IDs)
- leadCount, appointmentGoal
- color (for map visualization)
```

**Files to Create:**
- `app/api/territories/route.ts`
- `app/components/TerritoryManager.tsx`
- `app/components/TerritoryDrawer.tsx` (map drawing tool)
- `app/utils/territories.ts`

---

## 📊 HIGH PRIORITY (P1 - Core Features)

### 5. **Dashboards & Analytics**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Team+  
**Impact:** HIGH - Can't track team performance  
**Effort:** MEDIUM (1 week)

**Metrics to Track:**
```
Per Setter (Daily/Weekly/Monthly):
├── Knocks (total dispositions)
├── Conversations (interested + appointment + sale)
├── Appointments Set
├── Sales Closed
├── Conversion Rates
│   ├── Conversation Rate (conversations / knocks)
│   ├── Appointment Rate (appointments / conversations)
│   └── Close Rate (sales / appointments)
├── Average Door Time
├── Peak Performance Hours
└── Territory Coverage (% of assigned leads touched)

Team-Wide:
├── Total leads in system
├── Unclaimed leads
├── Stale leads (>7 days)
├── Appointments this week
├── Sales this month
└── Top performers (by metric)
```

**Files to Create:**
- `app/api/analytics/route.ts`
- `app/components/AnalyticsDashboard.tsx`
- `app/components/SetterStatsCard.tsx`
- `app/components/TeamMetrics.tsx`
- `app/utils/analytics.ts`

---

### 6. **Leaderboards**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Team+  
**Impact:** MEDIUM - No gamification/motivation  
**Effort:** EASY (3 days)

**Implementation:**
```
Leaderboard Types:
├── Daily Knocks
├── Weekly Appointments
├── Monthly Sales
├── Conversion Rate (best closer)
├── Consistency (most days active)
└── Territory Coverage

Display Modes:
├── Real-time (live updates)
├── Weekly reset (Monday)
├── Monthly champions
└── All-time records
```

**Files to Create:**
- `app/components/Leaderboard.tsx`
- `app/api/leaderboard/route.ts`

---

### 7. **Custom Fields**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Pro  
**Impact:** MEDIUM - Can't customize for solar specifics  
**Effort:** MEDIUM (1 week)

**Solar-Specific Custom Fields:**
```
Lead Custom Fields:
├── Roof Age (years)
├── Roof Condition (1-5)
├── Primary Objection (dropdown)
├── Electric Bill ($)
├── Credit Score Range
├── Homeowner Name
├── Best Time to Contact
└── Go-Back Date (calendar)

User-Configurable:
- Field name
- Field type (text, number, date, dropdown, checkbox)
- Required/optional
- Default value
```

**Files to Create:**
- `app/api/custom-fields/route.ts`
- `app/components/CustomFieldEditor.tsx`
- `app/components/CustomFieldInput.tsx`

---

### 8. **Mobile App (PWA)**
**Status:** ⚠️ Partial (responsive but not installable)  
**Sales Rabbit:** ✅ All plans  
**Impact:** HIGH - Setters work from phones  
**Effort:** MEDIUM (1 week)

**PWA Features:**
```
Progressive Web App
├── Installable (Add to Home Screen)
├── Offline support (Service Worker)
├── Push notifications
├── Camera access (photo attachments)
├── Geolocation access
└── Quick actions (shortcuts)

Mobile-Optimized UI:
├── Touch-friendly buttons (min 44px)
├── Swipe gestures (swipe to disposition)
├── Bottom nav bar (thumb-friendly)
├── Fast disposition (one tap)
└── Voice notes (future)
```

**Files to Create:**
- `public/manifest.json`
- `public/service-worker.js`
- `app/components/MobileLayout.tsx`
- `app/components/QuickDisposition.tsx`

---

## 🎮 MEDIUM PRIORITY (P2 - Nice to Have)

### 9. **Scheduler / Calendar Integration**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Pro  
**Impact:** MEDIUM - Manual appointment tracking  
**Effort:** MEDIUM (1 week)

**Implementation:**
```
Scheduler Features
├── Google Calendar sync
├── Outlook Calendar sync
├── In-app calendar view
├── Appointment conflicts detection
├── Reminder notifications
├── Multi-setter scheduling (avoid double-booking)
└── Appointment follow-up automation

Go-Back Calendaring:
├── Set "go back" date on lead
├── Daily go-back list widget
├── Morning reminder notifications
└── Highlight on map (special pin)
```

**Files to Create:**
- `app/api/calendar/sync/route.ts`
- `app/components/CalendarView.tsx`
- `app/components/GoBackScheduler.tsx`

---

### 10. **Sketch Board / Drawing Tools**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Team+  
**Impact:** LOW - Nice for roof sketches  
**Effort:** MEDIUM (4 days)

**Implementation:**
```
Drawing Features
├── Freehand sketching
├── Roof measurements
├── Panel layout visualization
├── Photo annotation
├── Attach to lead
└── Export as image
```

---

### 11. **Lead File Attachments**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Pro  
**Impact:** MEDIUM - Can't attach photos/docs  
**Effort:** EASY (3 days)

**Implementation:**
```
File Attachments
├── Photos (roof, electric bill, etc.)
├── Documents (contracts, quotes)
├── Store in Supabase Storage
├── Thumbnail previews
├── Max file size (10MB)
└── MIME type validation
```

**Files to Create:**
- `app/api/attachments/route.ts`
- `app/components/FileUploader.tsx`
- `supabase/storage-policies.sql`

---

### 12. **Social Feed / Activity Stream**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Team+  
**Impact:** LOW - Team morale feature  
**Effort:** EASY (2 days)

**Implementation:**
```
Activity Feed
├── "John set 3 appointments today! 🎉"
├── "Sarah closed a $25k deal! 💰"
├── "Mike reached 100 knocks this week!"
├── Photos from the field
├── Emoji reactions
└── Comments & encouragement
```

---

## 🔮 LOW PRIORITY (P3 - Premium Features)

### 13. **Gamification (Battles, XP, Achievements)**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Pro (extra $10/user)  
**Impact:** LOW - Engagement/motivation  
**Effort:** HIGH (2 weeks)

**Features:**
```
Gamification Elements
├── XP & Levels (gain XP per knock/appointment/sale)
├── Achievements & Badges
│   ├── "First Sale" 🏆
│   ├── "10-Day Streak" 🔥
│   └── "100 Knocks" 💯
├── Battles (1v1 competitions)
├── Competitions (team challenges)
├── Rewards Store (redeem points)
└── Scorecards (visual progress)
```

---

### 14. **Weather Integration**
**Status:** ❌ Missing  
**Sales Rabbit:** +$19/user addon  
**Impact:** LOW - Nice for storm damage leads  
**Effort:** EASY (2 days)

**Implementation:**
```
Weather Features
├── Map overlays (hail, wind, storm history)
├── Storm Finder (recent weather events)
├── Lead generation from storm zones
└── Best canvassing weather alerts
```

---

### 15. **Digital Contracts / E-Signatures**
**Status:** ❌ Missing  
**Sales Rabbit:** +$13/user addon  
**Impact:** MEDIUM - Streamline deal processing  
**Effort:** HIGH (2 weeks)

**Implementation:**
```
Digital Contracts
├── Form builder (drag & drop)
├── E-signature capture
├── Auto-fill lead data
├── Contract templates
├── PDF generation
├── Email delivery
└── Signed contract storage
```

---

### 16. **AI Buyer Scores (DataGrid AI)**
**Status:** ⚠️ Partial (we have solar scores)  
**Sales Rabbit:** +$19/user addon  
**Impact:** MEDIUM - Better lead prioritization  
**Effort:** MEDIUM (1 week)

**Our Advantage:**
- We already have **Solar API scores** (0-100)
- Sales Rabbit charges **+$19/user** for this

**Enhancement:**
```
AI Scoring Factors
├── Solar score (existing)
├── Estimated bill (existing)
├── Homeowner demographic data
├── Historical conversion data
├── Time of day / season
└── Composite "likelihood to buy" score
```

---

### 17. **Integrations & API**
**Status:** ❌ Missing  
**Sales Rabbit:** ✅ Pro (60+ integrations)  
**Impact:** LOW - Power users only  
**Effort:** HIGH (ongoing)

**Popular Integrations:**
```
CRM Integrations
├── Salesforce
├── HubSpot
├── Zoho
└── Pipedrive

Communication
├── Twilio (SMS)
├── Email (SendGrid)
└── Slack notifications

Payments
├── Stripe
└── Square
```

---

### 18. **Objection Tracking**
**Status:** ❌ Missing  
**Sales Rabbit:** ⚠️ (via custom fields)  
**Impact:** MEDIUM - Better coaching  
**Effort:** EASY (2 days)

**Implementation:**
```
Objection Categories
├── "Too expensive"
├── "Bad credit"
├── "Roof issues"
├── "Moving soon"
├── "Not owner"
├── "Already have solar"
├── "Need to think about it"
└── Custom objections

Analytics
├── Objection frequency by setter
├── Objection frequency by territory
├── Conversion rate by objection type
└── Script suggestions per objection
```

**Files to Create:**
- `app/components/ObjectionTracker.tsx`
- `app/api/objections/route.ts`

---

## 📅 Implementation Roadmap

### **Phase 1: Foundation (Weeks 1-3) - CRITICAL**
**Goal:** Match Sales Rabbit Team plan ($49/user)

- [ ] Week 1: Database Migration (Supabase)
  - [ ] Schema design
  - [ ] Supabase setup
  - [ ] Replace storage.ts
  - [ ] Migration script
  - [ ] Testing
  
- [ ] Week 2: Authentication System
  - [ ] Email/password signup/login
  - [ ] JWT session management
  - [ ] Role-based access control
  - [ ] Profile management
  - [ ] Password reset
  
- [ ] Week 3: Location Tracking & Territory Management
  - [ ] GPS check-in validation
  - [ ] Live location tracking
  - [ ] Territory creation/management
  - [ ] Territory-based assignment

**Deliverable:** Functional multi-user system with auth, database, and basic tracking

---

### **Phase 2: Analytics & Mobile (Weeks 4-6)**
**Goal:** Match Sales Rabbit Pro plan ($65/user)

- [ ] Week 4: Dashboards & Analytics
  - [ ] Setter performance metrics
  - [ ] Team-wide analytics
  - [ ] Conversion funnel tracking
  - [ ] Time-based reports
  
- [ ] Week 5: Leaderboards & Custom Fields
  - [ ] Real-time leaderboards
  - [ ] Custom field system
  - [ ] Solar-specific fields
  
- [ ] Week 6: PWA & Mobile Optimization
  - [ ] Service worker
  - [ ] Offline support
  - [ ] Mobile-first UI
  - [ ] Quick disposition

**Deliverable:** Full-featured app matching Pro plan features

---

### **Phase 3: Premium Features (Weeks 7-10)**
**Goal:** Exceed Sales Rabbit with solar-specific features

- [ ] Week 7-8: Scheduler & Calendar
  - [ ] Google/Outlook sync
  - [ ] Go-back calendaring
  - [ ] Appointment management
  
- [ ] Week 9: File Attachments & Objection Tracking
  - [ ] Photo/doc uploads
  - [ ] Objection categorization
  - [ ] Analytics
  
- [ ] Week 10: Polish & Testing
  - [ ] Bug fixes
  - [ ] Performance optimization
  - [ ] User testing
  - [ ] Documentation

**Deliverable:** Production-ready v1.0

---

### **Phase 4: Advanced Features (Weeks 11+)**
**Goal:** Unique differentiators

- [ ] Gamification system
- [ ] Weather integration
- [ ] Digital contracts
- [ ] Advanced AI scoring
- [ ] Integrations (CRM, communication)

**Deliverable:** Feature-rich enterprise platform

---

## 💰 Business Case

### Cost Comparison (10 setters + 2 managers)

**Sales Rabbit Team Plan:**
- 12 users × $49/month = **$588/month** = **$7,056/year**

**Sales Rabbit Pro Plan:**
- 12 users × $65/month = **$780/month** = **$9,360/year**

**Happy Solar Leads (Proposed):**
- 12 users × $29/month = **$348/month** = **$4,176/year**

**Savings vs Team:** $2,880/year (41% cheaper)  
**Savings vs Pro:** $5,184/year (55% cheaper)

### Operating Costs
- Supabase (Pro): ~$25/month
- Google Solar API: ~$50-100/month
- Vercel hosting: $20/month
- **Total:** ~$95-145/month

**Net Revenue:** $348 - $145 = **$203/month** = **$2,436/year profit**

---

## 🎯 Success Metrics

### MVP Success (Phase 1 Complete)
- ✅ 12 active users (team deployed)
- ✅ 500+ leads in database
- ✅ 95%+ uptime
- ✅ <2 second page load
- ✅ Zero data loss incidents

### Feature Parity (Phase 2 Complete)
- ✅ Match all Sales Rabbit Team features
- ✅ 90%+ user satisfaction
- ✅ 50+ appointments set per week
- ✅ 10+ sales closed per month

### Competitive Edge (Phase 3+)
- ✅ Solar score integration (unique)
- ✅ AI auto-assignment (unique)
- ✅ Lower cost ($29 vs $49-75)
- ✅ 100% user retention

---

## 🚀 Quick Wins (Ship in 1-2 Days Each)

Before starting Phase 1, knock out these easy features:

1. **Objection Tracking** (2 days)
2. **Leaderboard UI** (with mock data, 1 day)
3. **Go-Back Calendar Widget** (2 days)
4. **Lead Photo Attachments** (localStorage, 1 day)
5. **Social Activity Feed** (1 day)

**Total:** ~1 week of quick wins while planning database migration

---

## 📋 Summary for Benedict's PM Board

### Epic 1: Database & Auth (3 weeks) - CRITICAL PATH
- Story 1.1: Supabase schema design & setup
- Story 1.2: Migrate storage.ts to Supabase
- Story 1.3: Email/password authentication
- Story 1.4: Role-based access control
- Story 1.5: Location tracking infrastructure

### Epic 2: Territory & Analytics (3 weeks)
- Story 2.1: Territory drawing & management
- Story 2.2: Performance dashboards
- Story 2.3: Leaderboards
- Story 2.4: Custom fields system
- Story 2.5: PWA conversion

### Epic 3: Premium Features (4 weeks)
- Story 3.1: Calendar integration
- Story 3.2: File attachments
- Story 3.3: Objection tracking
- Story 3.4: Mobile optimization
- Story 3.5: Testing & polish

### Epic 4: Differentiators (Ongoing)
- Story 4.1: Gamification
- Story 4.2: Weather overlays
- Story 4.3: Digital contracts
- Story 4.4: Advanced AI scoring
- Story 4.5: CRM integrations

---

## 🏁 Next Steps

1. **Review with team** - Validate priorities
2. **Set up Supabase** - Create project, configure
3. **Database schema** - Design & approve
4. **Kickoff Phase 1** - Start database migration
5. **Weekly check-ins** - Track progress

---

**Document Version:** 1.0  
**Last Updated:** February 9, 2026  
**Maintained By:** Boris (AI Agent)
