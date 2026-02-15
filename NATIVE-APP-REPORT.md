# Raydar Native App Investigation Report
**Date:** February 14, 2026  
**Current Status:** Progressive Web App (PWA)  
**Goal:** Evaluate native mobile app options

---

## Current State: What We Have

**Progressive Web App (PWA)**
- ✅ Works on any device with a browser
- ✅ No app store approval needed
- ✅ Instant updates (push to Vercel = live)
- ✅ One codebase for iOS, Android, desktop
- ⚠️ Can be installed to home screen, but feels less "native"
- ⚠️ Some limitations (background GPS, push notifications)

**What Works Well:**
- GPS tracking ✅
- Maps ✅
- Lead management ✅
- Offline mode (service workers) ✅
- Camera access ✅

**What Doesn't Work (PWA Limitations):**
- Background location tracking (app needs to be open)
- Rich push notifications
- App Store presence (discoverability)
- "Official app" feel

---

## Option 1: Keep PWA + Add Home Screen Install

**What:** Enhance current PWA with install prompts  
**Cost:** $0 (just code)  
**Time:** 2-3 hours  

**What You Get:**
- "Add to Home Screen" button
- App icon on phone
- Full-screen mode (no browser chrome)
- Splash screen

**What You Don't Get:**
- App Store listing
- Background features
- Apple/Google branding

**Verdict:** Best ROI - minimal work, 80% of native feel

---

## Option 2: React Native (True Native App)

**What:** Rebuild app in React Native  
**Cost:** $8,000 - $15,000 (or 3-4 weeks of your time)  
**Ongoing:** $99/year (Apple) + $25 one-time (Google)

**What's Involved:**
- Rebuild UI in React Native components
- Rewrite Firebase integration (different SDK)
- Implement native navigation
- Set up build pipelines (iOS + Android)
- App Store submissions (2-4 weeks approval)

**What You Get:**
- True native apps (App Store + Play Store)
- Background GPS tracking
- Push notifications
- Better performance on older phones
- "Official" presence

**What You Lose:**
- Instant updates (app store approval needed)
- Desktop access (unless you build web version too)
- Easier debugging (need simulators/devices)

**Verdict:** Only worth it if background GPS is critical

---

## Option 3: Capacitor (Hybrid - Best of Both Worlds)

**What:** Wrap existing PWA in native container  
**Cost:** $2,000 - $4,000 (or 1-2 weeks of your time)  
**Ongoing:** $99/year (Apple) + $25 one-time (Google)

**What's Involved:**
- Add Capacitor to existing Next.js app
- Configure iOS/Android builds
- Add native plugins (background GPS, push notifications)
- Submit to app stores

**What You Get:**
- Keep 95% of existing code
- App Store presence
- Background features via plugins
- Still have web version

**What Changes:**
- Some code for native features
- Build process (need Xcode/Android Studio)
- App store update cycle

**Verdict:** Sweet spot - native features without full rebuild

---

## Cost Breakdown

### Option 1: Enhanced PWA (FREE)
- Development: $0 (2-3 hours)
- Hosting: $0 (Vercel current plan)
- Maintenance: $0
- **Total Year 1:** $0

### Option 2: React Native (EXPENSIVE)
- Development: $12,000 (average, or DIY 3-4 weeks)
- Apple Developer: $99/year
- Google Play: $25 one-time
- Testing devices: $500 (optional)
- Maintenance: $3,000-5,000/year (updates, bug fixes)
- **Total Year 1:** $15,624 (then $3,000-5,000/year)

### Option 3: Capacitor (MIDDLE GROUND)
- Development: $3,000 (average, or DIY 1-2 weeks)
- Apple Developer: $99/year
- Google Play: $25 one-time
- Build tools: $0 (use free tier)
- Maintenance: $500-1,000/year (minimal)
- **Total Year 1:** $3,124 (then $600-1,100/year)

---

## Features Comparison

| Feature | PWA (Current) | Enhanced PWA | Capacitor | React Native |
|---------|---------------|--------------|-----------|--------------|
| Works on iPhone | ✅ | ✅ | ✅ | ✅ |
| Works on Android | ✅ | ✅ | ✅ | ✅ |
| Works on desktop | ✅ | ✅ | ✅ | ❌ (need web) |
| App Store presence | ❌ | ❌ | ✅ | ✅ |
| Instant updates | ✅ | ✅ | ❌ (app store) | ❌ (app store) |
| Background GPS | ⚠️ Limited | ⚠️ Limited | ✅ | ✅ |
| Push notifications | ⚠️ Limited | ⚠️ Limited | ✅ | ✅ |
| Offline mode | ✅ | ✅ | ✅ | ✅ |
| Camera access | ✅ | ✅ | ✅ | ✅ |
| GPS tracking | ✅ | ✅ | ✅ | ✅ |
| Development cost | $0 | $0 | $3,000 | $12,000 |
| Maintenance | Low | Low | Medium | High |

---

## Recommendation

### For Right Now: **Enhanced PWA (Option 1)**

**Why:**
- $0 cost, 2-3 hours work
- Current app already works great on mobile
- GPS tracking works (app just needs to be open)
- No app store headaches
- Keep instant updates

**Add These:**
1. "Install App" button on first visit
2. App icon + splash screen
3. Offline mode improvements
4. "Keep app open" reminder for GPS tracking

### If You Need Background GPS: **Capacitor (Option 3)**

**Why:**
- Keep 95% of existing code
- Get app store presence
- Add background GPS plugin
- Only $3K vs $12K for React Native

### When to Do React Native: **Never (for this project)**

**Why:**
- Current app is built in Next.js (web tech)
- Rebuilding from scratch = $12K+ cost
- Lose instant updates
- Capacitor gives you same benefits for 1/4 the cost

---

## Timeline

**Enhanced PWA:** 2-3 hours
- Add install prompts
- Configure manifest
- Test on iOS/Android
- Done!

**Capacitor Native:** 1-2 weeks
- Week 1: Setup, build process, test
- Week 2: App store submissions, approval wait
- Then: Ongoing updates as needed

**React Native:** 3-4 weeks (not recommended)
- Week 1-2: Rebuild core features
- Week 3: Testing, polish
- Week 4: App store submission
- Then: Maintain two codebases forever

---

## Bottom Line

**Current PWA is fine for 90% of use cases.**

**If you want:**
- App Store presence → Do Capacitor ($3K)
- Background GPS tracking → Do Capacitor ($3K)
- Save money → Enhance current PWA ($0)
- Waste money → Do React Native ($12K+)

**My Recommendation:**
1. Start with Enhanced PWA (free, 2-3 hours)
2. Test with real setters for 1-2 months
3. If background GPS becomes a blocker → Upgrade to Capacitor
4. Never do React Native (not worth it for this project)

**Want me to build the Enhanced PWA now?** It's free and makes the current app feel 90% native with zero downsides.
