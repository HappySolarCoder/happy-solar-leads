# Raydar Storage & Performance Analysis
**Date:** February 14, 2026  
**Current Status:** 3,400 leads in production  
**Target Capacity:** 50,000 - 100,000 leads

---

## Storage Capacity

### Data Size Calculations
**Single lead with all fields:** ~1,286 bytes (1.26 KB)

| Lead Count | Storage Size | % of Free Tier (1 GB) |
|------------|--------------|----------------------|
| 3,400      | 4.16 MB      | 0.4%                 |
| 10,000     | 12.26 MB     | 1.2%                 |
| 50,000     | 61.32 MB     | 6.1%                 |
| 100,000    | 122.64 MB    | 12.3%                |

**Additional collections:**
- Users: ~50 users × 500 bytes = 25 KB
- Dispositions: ~20 dispositions × 200 bytes = 4 KB
- Easter Eggs: ~10 eggs × 500 bytes = 5 KB
- Admin Settings: ~1 KB

**Total storage at 100K leads:** ~123 MB

✅ **VERDICT:** Storage is NOT a concern. Well under 1 GB free tier limit.

---

## Firebase Firestore Limits

### Free Tier (Spark Plan)
- ✅ Storage: 1 GB (we'll use ~123 MB max)
- ⚠️ Reads: 50,000/day
- ⚠️ Writes: 20,000/day
- ⚠️ Deletes: 20,000/day

### Blaze Plan (Pay-as-you-go)
- Storage: $0.18/GB/month
- Reads: $0.06 per 100,000 documents
- Writes: $0.18 per 100,000 documents
- Deletes: $0.02 per 100,000 documents
- **Free tier included:** Same as Spark (50K reads, 20K writes/day)

---

## Read/Write Analysis

### Current Usage Patterns

#### **Page Loads (CRITICAL BOTTLENECK)**
**Desktop main page:**
- Reads ALL leads from Firestore
- 50K leads = 50,000 reads per page load
- If 10 users load page once/day = 500,000 reads/day
- **FREE TIER LIMIT: 50K reads/day** ❌

**Mobile knocking:**
- Reads ALL leads from Firestore
- Same problem as desktop

**Team map:**
- Reads ALL leads + user positions
- Even worse

**PROBLEM:** Current implementation reads entire leads collection on every page load!

#### **Writes (Under Control)**
- CSV upload 3.4K leads: 3,400 writes (within limits)
- Disposition changes: ~100-500/day typical
- Lead claims: ~50-200/day typical
- User updates: ~10-50/day typical
- GPS tracking: ~100-500/day typical

**Total daily writes (estimated):** 4,000 - 5,000 writes/day  
**FREE TIER LIMIT:** 20,000 writes/day ✅

---

## Performance Issues at 50K+ Leads

### 1. **Query Performance**
**Current:** `getLeadsAsync()` reads ALL leads every time
- 50K leads × 1.3 KB = 61 MB transferred per page load
- Over mobile network: 10-30 seconds load time
- Desktop: 3-5 seconds
- **User experience:** TERRIBLE

### 2. **Client-Side Processing**
- Clustering 50K markers: Slow but manageable (leaflet.markercluster)
- Filtering 50K leads: Fast (JavaScript arrays)
- React re-renders with 50K items: Can be sluggish

### 3. **Firestore Read Costs**
**Scenario:** 20 active users, each loads page 5 times/day
- 20 users × 5 loads × 50,000 reads = 5,000,000 reads/day
- Over free tier by 4,950,000 reads
- Cost: 4,950,000 / 100,000 × $0.06 = **$2.97/day = $89/month**

**With caching (realistic):**
- First load: 50K reads
- Subsequent loads: Only changed documents (~100-500)
- 20 users × 1 full load × 50K = 1,000,000 reads
- 20 users × 4 cached loads × 500 = 40,000 reads
- Total: 1,040,000 reads/day
- Cost: ~$0.62/day = **$19/month**

---

## Solutions & Recommendations

### **IMMEDIATE (Required for 50K+ leads)**

#### **1. Implement Pagination & Lazy Loading**
**Instead of:** Load all 50K leads at once  
**Do this:** Load leads in chunks as needed

**Desktop Map:**
```typescript
// Load only leads visible in current map bounds
async function loadLeadsInBounds(bounds: LatLngBounds) {
  // Firestore GeoPoint queries
  const leads = await db.collection('leads')
    .where('lat', '>=', bounds.south)
    .where('lat', '<=', bounds.north)
    .where('lng', '>=', bounds.west)
    .where('lng', '<=', bounds.east)
    .limit(1000)
    .get();
}
```

**Benefits:**
- Initial load: ~500-1000 leads (visible area)
- Pan/zoom: Load more as needed
- Reads: ~1,000 per session instead of 50,000
- **50x reduction in read operations**

**Complexity:** Medium (requires map bounds tracking, GeoPoint indexing)

#### **2. Enable Firestore Caching**
**Already partially implemented, but optimize:**

```typescript
// Enable persistent cache
enableIndexedDbPersistence(db)
  .catch((err) => {
    if (err.code == 'failed-precondition') {
      // Multiple tabs open
    } else if (err.code == 'unimplemented') {
      // Browser doesn't support
    }
  });
```

**Benefits:**
- Offline support
- Faster subsequent loads
- Reduced read costs (only sync changes)
- **80% reduction in repeat reads**

**Current status:** Cache is enabled but not optimized

#### **3. Add Firestore Indexes**
**Required for geo-queries:**

```json
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "lat", "order": "ASCENDING" },
        { "fieldPath": "lng", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "solarCategory", "order": "ASCENDING" }
      ]
    }
  ]
}
```

**Benefits:**
- Faster filtered queries
- Enable complex WHERE clauses
- Required for geo-queries

### **MEDIUM PRIORITY (Nice to Have)**

#### **4. Virtual Scrolling for Lists**
**Current:** Render all leads in list view  
**Better:** Only render visible rows (react-window or react-virtualized)

**Benefits:**
- Smooth scrolling with 50K items
- Lower memory usage
- Better mobile performance

#### **5. Server-Side API Routes**
**For heavy operations:**
- CSV upload processing (currently client-side)
- Bulk updates
- Analytics calculations

**Benefits:**
- Offload processing from client
- Better error handling
- Progress tracking

### **LOW PRIORITY (Future Optimization)**

#### **6. Switch to Firestore Bundles**
**Pre-package common queries:**
- "All unclaimed leads in Rochester"
- "Top 1000 solar leads"

**Benefits:**
- Faster initial loads
- Reduced read costs
- Better caching

---

## Cost Projections

### Current Setup (No Optimization)
**50K leads, 20 active users:**
- Storage: $0.02/month (123 MB)
- Reads: ~$90/month (5M reads/day)
- Writes: ~$1/month (within free tier)
- **Total: ~$91/month**

### With Lazy Loading + Caching
**50K leads, 20 active users:**
- Storage: $0.02/month
- Reads: ~$6/month (300K reads/day from bounds queries)
- Writes: ~$1/month
- **Total: ~$7/month**

### With Full Optimization
**100K leads, 50 active users:**
- Storage: $0.02/month
- Reads: ~$10/month (500K reads/day)
- Writes: ~$2/month
- **Total: ~$12/month**

**Still cheaper than Sales Rabbit:** $29/user = $1,450/month for 50 users

---

## Action Plan

### **Phase 1: CRITICAL (This Week)**
1. ✅ Analyze storage capacity (DONE - you're safe)
2. 🔨 Implement map bounds-based loading
3. 🔨 Add Firestore geo indexes
4. 🔨 Optimize caching strategy
5. 🔨 Test with 10K+ leads

**Impact:** 50x reduction in reads, $85/month savings

### **Phase 2: OPTIMIZATION (Next 2 Weeks)**
1. Virtual scrolling for list view
2. Server-side upload processing
3. Analytics pre-aggregation
4. Mobile performance tuning

**Impact:** Better UX, handles 100K+ leads smoothly

### **Phase 3: SCALE (Future)**
1. Firestore bundles
2. CDN for static data
3. Redis caching layer
4. Sharding by territory

**Impact:** Handle 500K+ leads, enterprise-scale

---

## Monitoring & Alerts

**Set up Firebase Usage Alerts:**
1. Storage > 500 MB
2. Daily reads > 40K (approaching limit)
3. Daily writes > 15K
4. Monthly costs > $20

**Firebase Console:** https://console.firebase.google.com/project/gen-lang-client-0395385938/usage

---

## Summary

### ✅ **Storage: NO PROBLEM**
- 100K leads = 123 MB
- Free tier = 1 GB
- You're at 12% capacity

### ⚠️ **Reads: BIG PROBLEM** (Without Optimization)
- Current: Load all leads every page load
- 50K leads × 10 page loads = 500K reads/day
- Free tier: 50K reads/day
- **You'll hit limits at ~5K leads with current approach**

### ✅ **Writes: NO PROBLEM**
- Daily writes: ~5K/day
- Free tier: 20K/day
- You're at 25% capacity

### 💰 **Costs:**
- Without optimization: ~$90/month at 50K leads
- With lazy loading: ~$7/month at 50K leads
- **MUST optimize before scaling to 50K**

---

## Recommendation

**BUILD LAZY LOADING NOW** before you hit 10K leads!

The good news: Storage is fine. The bad news: Read patterns need fixing urgently. Current implementation won't scale past 5K-10K leads without hitting free tier limits or racking up costs.

**Want me to implement map bounds-based loading today?** 🗺️
