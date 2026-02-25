# Raydar (Happy Solar Leads) - Release Notes
**Date:** February 19, 2026  
**App:** https://happy-solar-leads.vercel.app  
**Version:** Today's Deployment

---

## 🚀 New Features

### 1. GPS Location + Red Person Icon
**Description:** Sales/manager accounts now default to their current GPS location. A red person icon appears on the map showing their exact position.

**How to Use:**
- When user logs in, map centers on their current GPS position
- Red person icon shows where they are on the map
- Easily see where each team member is located

**Permissions Impact:** All user roles (Admin, Manager, Sales)

---

### 2. Satellite Imagery
**Description:** Default map view is now satellite imagery (was street view). Toggle button allows switching between satellite and street view.

**How to Use:**
- Map loads in satellite view by default
- Click toggle button in map controls to switch to street view
- Labels overlay on satellite for readability

**Permissions Impact:** All user roles

---

### 3. Territory Assignment System
**Description:** Changed from individual lead assignment to territory-based assignment. Draw a polygon area on the map to assign it as a territory to a user. All leads within that territory automatically assign to that user.

**How to Use:**
1. Go to Lead Management page
2. Click "Draw Territory" button
3. Draw polygon around desired area on map
4. Select user to assign territory to
5. All leads in that area automatically belong to that user
6. View/manage territories on new Assignments page

**Permissions Impact:** Admin, Manager (can create/manage territories)

---

### 4. Team Activity Map
**Description:** New activity map page shows daily door knock trails with GPS tracking. See what each team member did throughout the day on the map.

**How to Use:**
- Navigate to /activity-map
- See route lines showing each user's door knocks
- Timeline shows order of stops
- Different colors for different team members
- View historical activity by date

**Permissions Impact:** Admin, Manager (view all), Sales (view own)

---

### 5. Distance Control (GPS Verification)
**Description:** GPS verification prevents dispositioning leads when user is too far from the address. Shows distance from door and GPS accuracy.

**How to Use:**
- When attempting to disposition a lead, system checks GPS distance
- If user is too far from address, disposition is blocked
- Popup shows:
  - Distance from door (in feet)
  - GPS accuracy (in meters)
  - Visual line from person position to door (if >10 feet)

**Permissions Impact:** All user roles

---

## 🐛 Bug Fixes

### 1. Admin User Edit Fix
**Description:** Fixed issue where admin couldn't update user information from the Manage Users page. Added proper error handling and field validation.

---

### 2. Manual Pin Drop Fix
**Description:** Fixed bug where manually adding leads via pin drop on the map wasn't saving/sticking. Also added territory auto-assignment for manually dropped pins.

---

### 3. API Key Rotation
**Description:** Rotated leaked Google API key. All Google APIs (Solar, Geocoding, Routes) now working correctly after redeployment.

---

## 🔧 Technical Details

**Tech Stack:**
- Frontend: React/Vite
- Backend: Vercel serverless functions
- Database: Firestore
- APIs: Google Solar, Geocoding, Routes

**Debug Endpoints:**
- `/api/debug-territories` - View territories in Firestore
- `/api/debug-leads` - View sample leads
- `/api/debug-assigned` - View assigned leads
