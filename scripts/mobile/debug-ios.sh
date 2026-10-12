#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "$(uname -s)" != Darwin ]; then
  echo "Run this command on your Mac mini. Apple Simulator requires macOS and Xcode."
  exit 1
fi
if [ -z "${DEVELOPER_DIR:-}" ]; then
  raydar_xcode="$(xcode-select -p 2>/dev/null || true)"
  if [ -d "$raydar_xcode/Platforms/iPhoneOS.platform" ]; then
    export DEVELOPER_DIR="$raydar_xcode"
  elif [ -d /Applications/Xcode.app/Contents/Developer ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  fi
fi

# Reuse the installer's selected iPhone. Never erase or uninstall the app.
raydar_sim="$(xcrun simctl list --json | node --input-type=module -e '
import { readFileSync } from "node:fs";
import { chooseIPhone } from "./scripts/mobile/ios-simulator.mjs";
const inventory = JSON.parse(readFileSync(0, "utf8"));
let saved = "";
try { saved = JSON.parse(readFileSync("ios/DerivedData/RaydarSimulator/selected-device.json", "utf8")).udid || ""; } catch {}
let phone;
if (process.env.RAYDAR_SIMULATOR_UDID) phone = chooseIPhone(inventory, process.env.RAYDAR_SIMULATOR_UDID);
else { try { phone = chooseIPhone(inventory, saved); } catch { phone = chooseIPhone(inventory); } }
console.log(phone.udid);
')"
xcrun simctl bootstatus "$raydar_sim" -b
xcrun simctl get_app_container "$raydar_sim" com.happyslr.raydar.next app >/dev/null
raydar_logs="$(mktemp -d "$HOME/Desktop/Raydar-debug-$(date +%Y%m%d-%H%M%S)-XXXXXX")"

# Full native timing plus app stage/error logs. Do not enable Firebase payload
# logging or CFNETWORK_DIAGNOSTICS; those can disclose credentials/lead data.
xcrun simctl terminate "$raydar_sim" com.happyslr.raydar.next 2>/dev/null || true
xcrun simctl spawn "$raydar_sim" log stream --style compact --level debug \
  --predicate 'process == "App" OR process BEGINSWITH "com.apple.WebKit"' \
  > "$raydar_logs/native.log" 2>&1 &
raydar_logger=$!
trap 'kill "$raydar_logger" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
open -a "Device Hub" 2>/dev/null || open -a Simulator 2>/dev/null || true
echo "Logs saved to: $raydar_logs"
echo "Open Today, then Knock. Press Control+C when finished."
xcrun simctl launch --console-pty "$raydar_sim" com.happyslr.raydar.next \
  2>&1 | tee "$raydar_logs/console.log"
