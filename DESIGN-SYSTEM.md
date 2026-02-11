# Raydar Design System - Official Brand

## Visual Philosophy
**"Professional SaaS. Modern. Clean. Bold."**

Inspired by the Raydar logo: coral-red radar waves with bold typography.

## Color Palette

### Primary (Coral-Red)
- `--raydar-coral`: #FF6B5A (brand primary - from logo)
- `--raydar-coral-light`: #FF8A7A
- `--raydar-coral-dark`: #E84A39

### Neutrals (Modern Dark)
- `--raydar-navy`: #1A1D29 (deepest backgrounds)
- `--raydar-slate-900`: #0F172A (backgrounds)
- `--raydar-slate-800`: #1E293B (elevated surfaces)
- `--raydar-slate-700`: #334155 (borders, dividers)
- `--raydar-slate-500`: #64748B (secondary text)
- `--raydar-slate-300`: #CBD5E1 (primary text on dark)
- `--raydar-white`: #FFFFFF

### Accent Colors
- `--raydar-success`: #10B981 (green)
- `--raydar-warning`: #F59E0B (amber)
- `--raydar-error`: #EF4444 (red)
- `--raydar-info`: #3B82F6 (blue)

## Typography

### Font Stack
```
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
```

### Scale
- **Display:** 3.5rem (56px) - bold - logo/hero only
- **H1:** 2.5rem (40px) - bold
- **H2:** 2rem (32px) - semibold
- **H3:** 1.5rem (24px) - semibold
- **H4:** 1.25rem (20px) - semibold
- **Body Large:** 1.125rem (18px) - regular
- **Body:** 1rem (16px) - regular
- **Small:** 0.875rem (14px) - medium
- **Tiny:** 0.75rem (12px) - medium

### Weights
- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700

## Spacing (8pt Grid)
- **xs:** 4px
- **sm:** 8px
- **md:** 16px
- **lg:** 24px
- **xl:** 32px
- **2xl:** 48px
- **3xl:** 64px

## Border Radius
- **sm:** 8px (buttons, inputs)
- **md:** 12px (cards)
- **lg:** 16px (modals)
- **xl:** 24px (hero cards)
- **full:** 9999px (pills, avatars)

## Shadows

### Light Shadows
```css
/* Card */
box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);

/* Card hover */
box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);

/* Modal */
box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
```

### Glow Effects (Coral)
```css
/* Button glow */
box-shadow: 0 0 20px rgba(255, 107, 90, 0.3);

/* Logo glow */
box-shadow: 0 0 40px rgba(255, 107, 90, 0.2);
```

## Components

### Primary Button
```tsx
className="
  px-6 py-3
  bg-[#FF6B5A] hover:bg-[#FF8A7A]
  text-white font-semibold rounded-xl
  shadow-lg shadow-[#FF6B5A]/30
  hover:shadow-xl hover:shadow-[#FF6B5A]/40
  transform hover:scale-105
  transition-all duration-200
"
```

### Secondary Button
```tsx
className="
  px-6 py-3
  bg-slate-800 hover:bg-slate-700
  text-white font-semibold rounded-xl
  border border-slate-700
  transition-all duration-200
"
```

### Card
```tsx
className="
  bg-slate-800 border border-slate-700
  rounded-xl p-6
  shadow-lg
  hover:shadow-xl
  transition-all duration-300
"
```

### Input
```tsx
className="
  px-4 py-3
  bg-slate-900 border-2 border-slate-700
  rounded-xl
  text-white placeholder-slate-500
  focus:outline-none focus:border-[#FF6B5A] focus:ring-4 focus:ring-[#FF6B5A]/20
  transition-all duration-200
"
```

## Layout Principles

1. **Clean hierarchy** - Clear visual structure
2. **Generous spacing** - Let content breathe
3. **Bold typography** - Strong, readable text
4. **Coral accents** - Use brand color purposefully
5. **Dark backgrounds** - Professional, modern feel
6. **Smooth interactions** - Subtle animations
7. **Consistent rounded corners** - Modern, friendly

## Logo Usage

### Primary Logo
- Use full-color logo on dark backgrounds
- Minimum size: 120px width
- Always include clear space around logo (24px minimum)
- Never distort or rotate logo

### Logo File
- Path: `/raydar-logo.jpg`
- Use in header, splash screens, emails

## Brand Voice

**Tone:** Professional, confident, helpful
**Style:** Modern SaaS, clean, straightforward
**Not:** Flashy, over-animated, cluttered

## Animation Principles

- **Duration:** 200-300ms for most interactions
- **Easing:** ease-out for natural feel
- **Subtle:** Enhance, don't distract
- **Purposeful:** Every animation has meaning

## Accessibility

- **Contrast:** WCAG AAA on dark backgrounds
- **Touch targets:** Minimum 44x44px on mobile
- **Focus states:** Always visible and clear
- **Keyboard nav:** All interactive elements accessible
