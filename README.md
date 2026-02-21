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
