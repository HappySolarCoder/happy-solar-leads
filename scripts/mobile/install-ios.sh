#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."

mode="${1:-simulator}"
case "$mode" in
  simulator|xcode) ;;
  *) echo "Usage: bash scripts/mobile/install-ios.sh [simulator|xcode]"; exit 1 ;;
esac

if [ "$(uname -s)" != Darwin ]; then
  echo "The iPhone build needs macOS and Xcode. Run this command on your Mac mini."
  exit 1
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Install Node.js 22 or newer, reopen Terminal, and run this command again."
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required."); process.exit(1); }'

# Use full Xcode for this process without changing the Mac's global settings.
if [ -z "${DEVELOPER_DIR:-}" ]; then
  selected_xcode="$(xcode-select -p 2>/dev/null || true)"
  if [ -d "$selected_xcode/Platforms/iPhoneOS.platform" ]; then
    export DEVELOPER_DIR="$selected_xcode"
  elif [ -d /Applications/Xcode.app/Contents/Developer ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  fi
fi
if ! xcodebuild -version; then
  echo "Open Xcode once and finish its setup/license prompts, then try again."
  exit 1
fi
xcode_major="$(xcodebuild -version | awk '/^Xcode / {split($2, v, "."); print v[1]}')"
if [ "${xcode_major:-0}" -lt 26 ]; then
  echo "This Capacitor project needs Xcode 26 or newer."
  exit 1
fi

if [ "$mode" = simulator ]; then
  # Check the runtime before spending time and disk space on a build.
  node scripts/mobile/ios-simulator.mjs check
fi

if [ ! -f .env.local ]; then
  for version in 14.2 14.1 14 13 12.7 12.6 12.5 12.4 12.3 12.2 12.1 12 11 10 9 8 7 6 5 4 3; do
    previous="$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v$version/.env.local"
    if [ -f "$previous" ]; then
      cp "$previous" .env.local
      echo "Copied your working configuration from v$version."
      break
    fi
  done
fi
if [ ! -f .env.local ]; then
  echo "Copy .env.local from your last working Raydar folder into this folder, then run this command again."
  exit 1
fi

echo "Preparing Raydar for iPhone. This does not upload or deploy the app."
npm ci
npm run mobile:build:ios
npx --no-install cap sync ios
node scripts/mobile/check-bundle.mjs ios/App/App/public
if [ "$mode" = simulator ]; then
  node scripts/mobile/ios-simulator.mjs run
else
  npx --no-install cap open ios
fi
