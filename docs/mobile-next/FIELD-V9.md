# Raydar v9 — full-map territory drawing

On phones and narrow screens, territory details are now a bottom sheet over the map:

- Swipe the handle down (or tap it) to collapse the form; swipe up or tap to reopen. The map keeps its dimensions and position throughout the gesture.
- New area opens directly into the full map with Rectangle, Corners and Draw controls above the collapsed handle.
- Rectangle: tap two opposite corners. The four-corner boundary completes and details reopen automatically.
- Draw: trace with a finger or mouse and lift to finish. A valid boundary reopens details automatically. Move map still allows repositioning while tracing is paused.
- Corners: tap at least four corners, then Done to finish. Undo remains available while drawing.
- Enter a territory name and select a rep, then Review pins and confirm the assignment. Redraw returns to the full map and preserves the name and selected rep.
- Invalid boundaries show feedback and cannot proceed to assignment. Completing or redrawing a boundary only changes local state; it never assigns leads or triggers a preview request.
- The desktop sidebar stays available. Hidden mobile form controls are removed from keyboard interaction. Reduced-motion preferences and native viewport insets are respected.

This release changes the mobile UI only. It uses the existing territory backend and introduces no new database queries/listeners.

## Install

Download and unzip:
https://github.com/HappySolarCoder/happy-solar-leads/archive/refs/heads/codex/raydar-mobile-redesign-v9.zip

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v9" &&
cp "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v8/.env.local" .env.local &&
npm ci &&
npm run mobile:android
```

Select the Galaxy S25 in Android Studio and press Run to install.

## Verification

TypeScript, focused lint and native static export are checked. The v9 browser check uses the real Leaflet territory UI with fictional data to cover touch swipes, keyboard toggle, stable map bounds, rectangle/freehand automatic reopening, Corners Done, preserved form values on redraw, review/create, invalid boundary feedback, phone/landscape/desktop sizes, town search and imagery. No live assignments are made during checks. Physical Android compilation and device testing require the Mac mini and phone.
