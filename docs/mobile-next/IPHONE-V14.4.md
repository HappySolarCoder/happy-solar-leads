# Raydar v14.4 / build 144 — iPhone Firestore transport

This is a targeted update to v14.3. It removes forced iOS long polling and lets Firebase detect when long polling is necessary. Authentication repairs, the shared lead listener, retry/reconnect recovery, branding, map tools, homeowner pins, dispositions and offline outbox are retained.

The supplied v14.3 native log contains 1,482 completed Firestore HTTP transactions, all HTTP 200, totaling 26,795,242 response body bytes. Most data responses complete in about 80 ms, but there are many serial responses. The app console reports `deadline-exceeded` after 130,171 ms. This supports excessive transport overhead as a contributor, not a proven permissions failure. The admin listener still requests all leads; this release does not solve that broader query-volume limitation or claim measured native performance improvement.

## Install on the Mac mini

Download `raydar-v14.4-ios.zip` to Downloads, then paste:

```bash
ditto -x -k "$HOME/Downloads/raydar-v14.4-ios.zip" "$HOME/Downloads" &&
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.4" &&
bash scripts/mobile/install-ios.sh simulator &&
npm run mobile:ios:location -- rochester &&
npm run mobile:ios:debug
```

The installer copies `.env.local` from the newest available prior download, starting with v14.3, builds the bundled app, and installs it in place. Login and unsynced knocks are preserved. It does not deploy Vercel, modify Firestore rules, or upload to Apple. Keep the existing production Firebase configuration; no Grokbot permission or index change is required for this patch.

The debug command relaunches the installed app and saves `console.log` and `native.log` in a new `Raydar-debug-...` folder on the Desktop. Open Today, then Knock. Wait for the map data to finish or report an error, then press Control+C. Native logs can be large; one reproduction is enough. The command does not enable Firebase payload logging or CFNETWORK_DIAGNOSTICS. Console output from existing native plugins can still include GPS and API responses, so share logs privately.

To debug again without rebuilding:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.4" &&
npm run mobile:ios:debug
```

Expect `[Raydar 14.4/144] firestore-transport-auto`. This means automatic transport selection is configured, not that the SDK can never fall back to long polling. Success requires `leads-server-ready` and usable pins; `profile-ready` alone is not a successful lead load. Compare elapsed time with v14.3's 130-second failure. If it still fails, preserve both logs; do not repeatedly press Retry or erase the simulator.

For normal launch without logging, run `npm run mobile:ios:launch`. Simulator GPS and production data behavior are unchanged: use a designated test lead for any saved knock or Scheduling Manager request.

## Physical iPhone distribution

This ZIP is source for Xcode, not a signed IPA or TestFlight link. The signing and TestFlight steps in [IPHONE-V14.3.md](IPHONE-V14.3.md) still apply, using the **v14.4 folder, version 14.4, build 144**. Prepare Xcode with:

```bash
cd "$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v14.4" &&
bash scripts/mobile/install-ios.sh xcode
```

Read [IPHONE-REVIEW-V14.4.md](IPHONE-REVIEW-V14.4.md) for the evidence and verification limits before rollout.
