// App Store Connect helper for the iOS TestFlight workflow. No dependencies.
// Reads ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH from the environment and never prints them.
// Usage:
//   node asc-testflight.mjs team-id
//   node asc-testflight.mjs max-build
//   node asc-testflight.mjs wait <marketingVersion> <buildNumber> [timeoutMinutes]
import { readFileSync, appendFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

const BUNDLE_ID = process.env.ASC_BUNDLE_ID || 'com.happyslr.raydar.next';
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) throw new Error('ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH are required.');
const key = createPrivateKey(readFileSync(ASC_KEY_PATH, 'utf8'));
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })}.${b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  return `${body}.${sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

async function get(path, params = {}) {
  const url = new URL(`https://api.appstoreconnect.apple.com${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) throw new Error(`App Store Connect ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function appId() {
  const { data } = await get('/v1/apps', { 'filter[bundleId]': BUNDLE_ID, 'fields[apps]': 'bundleId' });
  const app = data.find(item => item.attributes.bundleId === BUNDLE_ID);
  if (!app) throw new Error(`No App Store Connect app for ${BUNDLE_ID}`);
  return app.id;
}

const summary = line => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`); };
const [command, ...args] = process.argv.slice(2);

if (command === 'team-id') {
  // The bundle ID's seed ID is the team's App ID prefix (the team ID for this account).
  const { data } = await get('/v1/bundleIds', { 'filter[identifier]': BUNDLE_ID, 'fields[bundleIds]': 'identifier,seedId' });
  const match = data.find(item => item.attributes.identifier === BUNDLE_ID);
  if (!match?.attributes.seedId) throw new Error(`No bundle ID record for ${BUNDLE_ID}`);
  process.stdout.write(match.attributes.seedId);
} else if (command === 'max-build') {
  // Highest numeric build number already uploaded for this app, across every version (bounded: 200).
  const { data } = await get('/v1/builds', { 'filter[app]': await appId(), sort: '-uploadedDate', limit: 200, 'fields[builds]': 'version' });
  const numbers = data.map(item => Number.parseInt(item.attributes.version, 10)).filter(Number.isFinite);
  process.stdout.write(String(numbers.length ? Math.max(...numbers) : 0));
} else if (command === 'wait') {
  const [version, build, minutes = '60'] = args;
  const id = await appId();
  const deadline = Date.now() + Number(minutes) * 60_000;
  for (;;) {
    const { data, included = [] } = await get('/v1/builds', {
      'filter[app]': id, 'filter[version]': build, 'filter[preReleaseVersion.version]': version,
      include: 'buildBetaDetail', limit: 5,
      'fields[builds]': 'version,processingState,uploadedDate,usesNonExemptEncryption,buildBetaDetail',
      'fields[buildBetaDetails]': 'internalBuildState,externalBuildState',
    });
    const found = data[0];
    if (found) {
      const state = found.attributes.processingState;
      const detail = included.find(item => item.type === 'buildBetaDetails' && item.id === found.relationships?.buildBetaDetail?.data?.id)?.attributes ?? {};
      const line = `TestFlight ${version} (${build}): processingState=${state} internal=${detail.internalBuildState ?? 'n/a'} external=${detail.externalBuildState ?? 'n/a'} usesNonExemptEncryption=${found.attributes.usesNonExemptEncryption}`;
      console.log(line);
      if (state !== 'PROCESSING') {
        summary(`### ${line}`);
        process.exit(state === 'VALID' ? 0 : 1);
      }
    } else {
      console.log(`TestFlight ${version} (${build}): not visible yet`);
    }
    if (Date.now() > deadline) {
      summary(`### TestFlight ${version} (${build}): still processing after ${minutes} minutes; check App Store Connect.`);
      process.exit(1);
    }
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
} else {
  throw new Error('Usage: asc-testflight.mjs team-id | max-build | wait <version> <build> [minutes]');
}
