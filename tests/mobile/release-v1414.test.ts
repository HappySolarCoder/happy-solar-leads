import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("iOS and Android stay on release 14.14 build 154 together", () => {
  const release = JSON.parse(readFileSync(path.join(root, "app/mobile/_lib/release.json"), "utf8"));
  assert.equal(release.version, "14.14");
  assert.equal(release.build, 154);
  const project = readFileSync(path.join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
  const versions = [...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]);
  const builds = [...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]);
  assert.deepEqual(versions, ["14.14", "14.14"]);
  assert.deepEqual(builds, ["154", "154"]);
  const gradle = readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
  assert.match(gradle, /versionName "14\.14"/);
  assert.match(gradle, /versionCode 154\b/);
});

test("iOS declares that the app does not use non-exempt encryption", () => {
  const plist = readFileSync(path.join(root, "ios/App/App/Info.plist"), "utf8");
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.doesNotMatch(plist, /NSAllowsArbitraryLoads/);
});

test("the native shell is named Raydar and keeps the existing bundle id", () => {
  const plist = readFileSync(path.join(root, "ios/App/App/Info.plist"), "utf8");
  const strings = readFileSync(path.join(root, "android/app/src/main/res/values/strings.xml"), "utf8");
  const capacitor = readFileSync(path.join(root, "capacitor.config.ts"), "utf8");
  const project = readFileSync(path.join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
  const gradle = readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Raydar<\/string>/);
  assert.match(plist, /<key>CFBundleName<\/key>\s*<string>Raydar<\/string>/);
  assert.match(strings, /<string name="app_name">Raydar<\/string>/);
  assert.match(strings, /<string name="title_activity_main">Raydar<\/string>/);
  assert.match(capacitor, /appName: 'Raydar'/);
  assert.match(capacitor, /appId: 'com\.happyslr\.raydar\.next'/);
  for (const source of [plist, strings, capacitor]) assert.doesNotMatch(source, /Raydar Next/);
  const bundleIds = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((match) => match[1]);
  assert.deepEqual(bundleIds, ["com.happyslr.raydar.next", "com.happyslr.raydar.next"]);
  assert.match(gradle, /applicationId "com\.happyslr\.raydar\.next"/);
  assert.match(gradle, /namespace = "com\.happyslr\.raydar"/);
  assert.match(strings, /<string name="package_name">com\.happyslr\.raydar\.next<\/string>/);
  assert.match(strings, /<string name="custom_url_scheme">com\.happyslr\.raydar\.next<\/string>/);
});

test("iPhone-only submission drops the untested iPad target and the leftover armv7 requirement", () => {
  const project = readFileSync(path.join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
  const families = [...project.matchAll(/TARGETED_DEVICE_FAMILY = "([^"]+)";/g)].map((match) => match[1]);
  assert.deepEqual(families, ["1", "1"]);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/);
  assert.doesNotMatch(project, /armv7/);
  const plist = readFileSync(path.join(root, "ios/App/App/Info.plist"), "utf8");
  assert.doesNotMatch(plist, /armv7/);
  assert.doesNotMatch(plist, /UIRequiredDeviceCapabilities/);
});

test("installers look for the 14.14 configuration before older folders", () => {
  for (const script of ["scripts/mobile/install-ios.sh", "scripts/mobile/install-android.sh"]) {
    const source = readFileSync(path.join(root, script), "utf8");
    assert.match(source, /14\.14-ios 14\.14-android 14\.13-ios/);
  }
});
