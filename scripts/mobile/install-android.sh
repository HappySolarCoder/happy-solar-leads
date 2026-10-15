#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ ! -f .env.local ]; then
  for version in 14.11-ios 14.11-android 14.10-ios 14.10-android 14.9-ios 14.9-android 14.8-ios 14.8-android 14.7-ios 14.7-android 14.6-ios 14.6-android 14.5-ios 14.5-android 14.4 14.3 14.2 14.1 14 13 12.7 12.6 12.5 12.4 12.3 12.2 12.1 12 11 10 9 8 7 6 5 4 3; do
    previous="$HOME/Downloads/happy-solar-leads-codex-raydar-mobile-redesign-v$version/.env.local"
    if [ -f "$previous" ] && [ "$previous" != "$PWD/.env.local" ]; then
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
npm ci
if ! npm run mobile:check-backend; then
  echo "Some backend tools are not active yet. See the release guide in docs/mobile-next. The local mobile build can still be installed."
fi
npm run mobile:android
