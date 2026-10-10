# Raydar Next v5 — Signal R / slate blue + yellow

Final palette selected by the user: slate blue (not cobalt), with sunny yellow.

- Brand slate: `#587E98`; yellow: `#F0BC18`; ivory: `#FFFCF5`.
- Accessible action slate: `#476E88`; body ink: `#304B5E`.
- Vector masters: `public/brand/raydar-v5/`. All shapes and wordmark letters are SVG paths; no runtime fonts or bitmap downloads.
- Native launcher/splash source: `resources/raydar-v5/logo.svg`. `npm run mobile:assets` rebuilds the Android and iOS resources with yellow icon backgrounds and ivory launch backgrounds.
- Header/loading logo, navigation, cards, charts, filters, doorstep memory and coach controls match the brand. The Knock toolbar remains 60px tall, with no added logo header above the map.
- Pin status/outcome semantics and real street/satellite imagery are unchanged.
- Login/signup branding and shared legacy accent overrides are gated by `NEXT_PUBLIC_NATIVE_BUILD=1` on the exported native build. Existing web branding assets are untouched.
- No Firebase reads, writes, indexes, collections, background sync or API behavior were added or changed.

## Reproduce assets and preview screenshots

The checked-in SVGs are ready to use; regular app builds do not need a brand-generation step. To regenerate the same SVGs and PNG logo pack, run:

```sh
RAYDAR_LOGO_PACK_DIR=/absolute/path/to/Raydar-Signal-R-Logo-Pack-v5 node scripts/mobile/brand-assets.mjs
```

After a mobile export, run `node scripts/mobile/check-brand-v5.mjs`. It uses the fictional preview route with external requests blocked. Set `CHROMIUM_EXECUTABLE` if the Playwright browser is installed elsewhere; set `RAYDAR_SCREENSHOTS_DIR` for the output location. The sample map is illustrative; real map/satellite tiles remain in the installed app.

## v5 install

Download the `codex/raydar-mobile-redesign-v5` branch archive. Copy your existing mobile `.env.local` into the unzipped folder, run `npm ci`, then `npm run mobile:android`. Run from Android Studio on the connected phone. App ID remains `com.happyslr.raydar.next`, so the new build updates Raydar Next rather than creating another separate install. The original Raydar app and production web deployment are unaffected.
