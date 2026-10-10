#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ ! -f .env.local ]; then
  for version in 12 11 10 9 8 7 6 5 4 3; do
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
