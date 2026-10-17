import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("iOS and Android stay on release 14.12 build 152 together", () => {
  const release = JSON.parse(readFileSync(path.join(root, "app/mobile/_lib/release.json"), "utf8"));
  assert.equal(release.version, "14.12");
  assert.equal(release.build, 152);
  const project = readFileSync(path.join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
  const versions = [...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]);
  const builds = [...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]);
  assert.deepEqual(versions, ["14.12", "14.12"]);
  assert.deepEqual(builds, ["152", "152"]);
  const gradle = readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
  assert.match(gradle, /versionName "14\.12"/);
  assert.match(gradle, /versionCode 152\b/);
});

test("iOS declares that the app does not use non-exempt encryption", () => {
  const plist = readFileSync(path.join(root, "ios/App/App/Info.plist"), "utf8");
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.doesNotMatch(plist, /NSAllowsArbitraryLoads/);
});
