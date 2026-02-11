# Raydar Brand Assets

Official brand assets for the Raydar solar lead management platform.

## Logo Files

All logo files are stored in `/public/` directory for use throughout the app.

### 1. Horizontal Logo (Primary)
**File:** `/public/raydar-horizontal.png`  
**Description:** Icon + "RAYDAR" text side-by-side  
**Use cases:**
- Main app header (desktop)
- Email signatures
- Marketing materials
- Login/splash screens

**Dimensions:** ~1400x600px (horizontal lockup)  
**Background:** Transparent  
**Colors:** Coral icon (#FF6B5A) + Dark text (#2C3E50)

### 2. Icon Only (Secondary)
**File:** `/public/raydar-icon.png`  
**Description:** R with radar waves symbol only  
**Use cases:**
- Mobile app header (< 640px screens)
- Favicon (browser tab icon)
- App icons (iOS/Android)
- Social media profile pictures
- Loading spinners
- Compact UI elements

**Dimensions:** ~600x600px (square)  
**Background:** Transparent  
**Colors:** Coral (#FF6B5A)

### 3. Vertical Logo (Alternative)
**File:** `/public/raydar-logo.png`  
**Description:** Icon stacked above "RAYDAR" text  
**Use cases:**
- Splash screens
- Print materials
- Vertical layouts
- Alternative branding

**Dimensions:** ~800x1000px (vertical lockup)  
**Background:** Transparent  
**Colors:** Coral icon + Dark text

### 4. Logo with Background (Archive)
**File:** `/public/raydar-logo.jpg`  
**Description:** Original version with white background  
**Use cases:** Reference only, not for active use

## Brand Colors

### Primary
- **Coral Red:** `#FF6B5A` - Main brand color from logo
- **Coral Light:** `#FF8A7A` - Hover states, accents
- **Coral Dark:** `#E84A39` - Active states, emphasis

### Neutrals (Dark Theme)
- **Navy:** `#1A1D29` - Deepest backgrounds
- **Slate 900:** `#0F172A` - Main backgrounds
- **Slate 800:** `#1E293B` - Elevated surfaces (cards, modals)
- **Slate 700:** `#334155` - Borders, dividers
- **Slate 600:** `#475569` - Disabled states
- **Slate 500:** `#64748B` - Secondary text
- **Slate 400:** `#94A3B8` - Placeholder text
- **Slate 300:** `#CBD5E1` - Primary text on dark
- **White:** `#FFFFFF` - Pure white accents

### Accent Colors (Status)
- **Success:** `#10B981` (Green)
- **Warning:** `#F59E0B` (Amber)
- **Error:** `#EF4444` (Red)
- **Info:** `#3B82F6` (Blue)

## Typography

### Font Stack
```css
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
```

### Weights
- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700

## Logo Usage Guidelines

### DO:
✅ Use on dark backgrounds (slate 900/800)  
✅ Use on white/light backgrounds with proper spacing  
✅ Maintain aspect ratio when resizing  
✅ Use horizontal logo in headers (desktop)  
✅ Use icon only for small spaces (mobile, favicon)  
✅ Keep minimum 24px clear space around logo  
✅ Use coral color (#FF6B5A) for brand consistency  

### DON'T:
❌ Distort or stretch the logo  
❌ Change the logo colors (except approved variations)  
❌ Add effects (shadows, glows, outlines) to logo files  
❌ Place logo on busy backgrounds  
❌ Rotate the logo  
❌ Use low-resolution versions  
❌ Recreate the logo with different fonts  

## Current Implementation

### Header Component (`app/page.tsx`)
```tsx
{/* Mobile: Icon only */}
<img 
  src="/raydar-icon.png" 
  alt="Raydar" 
  className="h-9 w-auto object-contain sm:hidden"
/>

{/* Desktop: Horizontal logo */}
<img 
  src="/raydar-horizontal.png" 
  alt="Raydar" 
  className="h-10 w-auto object-contain hidden sm:block"
/>
```

### Favicon (`app/layout.tsx`)
```tsx
icons: {
  icon: '/raydar-icon.png',
  apple: '/raydar-icon.png',
}
```

## CSS Classes for Logo Styling

```css
/* Standard logo hover effect */
.logo-hover {
  transform: scale(1);
  transition: transform 300ms ease;
}

.logo-hover:hover {
  transform: scale(1.05);
}

/* Logo drop shadow */
.logo-shadow {
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
}

/* Coral glow effect (use sparingly) */
.logo-glow {
  filter: drop-shadow(0 0 20px rgba(255, 107, 90, 0.3));
}
```

## File Structure
```
/public/
├── raydar-horizontal.png  (Primary - header logo)
├── raydar-icon.png        (Mobile header, favicon)
├── raydar-logo.png        (Vertical alternative)
└── raydar-logo.jpg        (Archive - with background)
```

## Export Specifications

When creating new logo variations:

**For Web:**
- Format: PNG (transparent background)
- Resolution: 2x (@2x) for retina displays
- Compression: Optimize with TinyPNG or similar

**For Print:**
- Format: SVG (vector) or high-res PNG
- Resolution: 300 DPI minimum
- Color space: CMYK for print, RGB for digital

**For Social Media:**
- Square crop: 1200x1200px (icon only)
- Header: 1500x500px (horizontal logo)
- Profile: 400x400px (icon only)

## Brand Voice

**Tone:** Professional, confident, helpful  
**Style:** Modern SaaS, clean, straightforward  
**Personality:** Tech-forward, reliable, efficient  
**Not:** Flashy, overly casual, corporate-stuffy

## Questions?

For brand asset requests or questions:
- Check this file first
- All current logo files in `/public/`
- Reference `DESIGN-SYSTEM.md` for color/typography specs
