# Raydar

**Solar lead management system for door-knocking sales teams.**

Raydar replaces expensive tools like Sales Rabbit with a modern, affordable solution built specifically for solar sales teams.

## Features

- 📍 **Interactive Map** - Visualize leads with color-coded status markers
- 🎯 **Territory Management** - Assign and organize team regions
- 📊 **Solar Analytics** - Google Solar API integration for roof analysis
- 👥 **Role-Based Permissions** - Setter, Closer, Manager, Admin roles
- 🚀 **Auto-Assignment** - AI-powered lead distribution
- 💬 **Objection Tracking** - Track and analyze common objections
- 📈 **Real-time Stats** - Monitor team performance
- 📱 **Mobile Responsive** - Works on any device

## Tech Stack

- **Framework:** Next.js 16 (React, TypeScript)
- **Database:** Firebase/Firestore
- **Maps:** Leaflet (OpenStreetMap)
- **APIs:** Google Solar API, Google Geocoding API
- **Styling:** Tailwind CSS
- **Deployment:** Vercel

## Getting Started

### Prerequisites

```bash
npm install
```

### Environment Variables

Create `.env.local`:

```env
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Google APIs
NEXT_PUBLIC_GOOGLE_API_KEY=your_google_api_key
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Production Build

```bash
npm run build
npm start
```

## Deployment

Automatically deploys to Vercel on push to `main`:

**Live URL:** https://happy-solar-leads.vercel.app/

## Project Structure

```
app/
├── components/          # React components
│   ├── LeadMap.tsx     # Interactive map
│   ├── LeadDetail.tsx  # Lead detail panel
│   ├── AppMenu.tsx     # Navigation menu
│   └── ...
├── types/              # TypeScript types
├── utils/              # Helper functions
│   ├── storage.ts      # Firestore operations
│   └── firebase.ts     # Firebase config
├── admin/              # Admin panel
├── territories/        # Territory management
└── page.tsx            # Main app

```

## Role Permissions

- **Setter:** View own leads + unclaimed, track dispositions
- **Closer:** Same as Setter (for tracking)
- **Manager:** Setter + assign leads + view all team data
- **Admin:** Full access (upload, manage users, permissions)

## GPS Proximity Enforcement

Door-knock dispositions and manual map pins require the setter/manager to be within **~50 meters** of the address. Admins and closers are not gated.

A per-user override lives on the Firestore user doc:

```
users/{uid}.features.proximityEnforcement
```

- **Missing or `true` (default):** keep the 50m check
- **`false`:** skip the distance gate for that user only

### Toggle from Admin

1. Sign in as an admin and open **Admin → Users** (`/admin/users`).
2. In the **Proximity** column, click **Required** / **Waived**, or Edit the user and uncheck **Require 50m**.
3. The user must refresh / re-login so their session reloads the flag.

### Toggle from Firestore

1. Open the Firebase console → Firestore → `users`.
2. Find the person by `name` or `email` (the document ID is their Firebase Auth UID).
3. Set `features.proximityEnforcement` to `false` (or delete the field / set `true` to restore the gate).

**William Breen:** after this ships, waive proximity for his user (search Admin → Users or Firestore `users` for `William Breen`). This environment could not write his Firestore doc without admin credentials.

### Test plan

1. **Exempt user:** as William Breen (or any user with `features.proximityEnforcement: false`), open a lead far from your GPS and mark a door-knock disposition / drop a pin. It should save — no “not close enough” alert.
2. **Gated user:** as a normal setter/manager with the flag missing or `true`, do the same from far away. Disposition / pin create should be blocked with the existing distance alert.
3. Confirm other setters are unchanged after toggling only Breen.

## Brand Assets

All logo files and brand guidelines are documented in:
- **Logo Files:** `/public/raydar-*.png` (3 variations)
- **Brand Guide:** `BRAND-ASSETS.md` - Complete usage guidelines
- **Design System:** `DESIGN-SYSTEM.md` - Colors, typography, components

### Quick Reference:
- **Primary Color:** #FF6B5A (Coral Red)
- **Header Logo:** `/public/raydar-horizontal.png`
- **Favicon:** `/public/raydar-icon.png`
- **Theme:** Dark slate with coral accents

## License

Proprietary - Raydar (Happy Solar)
Deploy trigger Fri Feb 20 18:22:06 MST 2026
Deploy test 2 Fri Feb 20 21:34:11 MST 2026
