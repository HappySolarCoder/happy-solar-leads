import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMobileBundle } from './check-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const derivedData = path.join(root, 'ios/DerivedData/RaydarSimulator');
const targetFile = path.join(derivedData, 'selected-device.json');
const bundleId = 'com.happyslr.raydar.next';
const runtimeHelp = 'Open Xcode > Settings > Components (Platforms in some versions) and install an iOS Simulator runtime. In Xcode 27, manage iPhones through Xcode > Open Developer Tool > Device Hub; older Xcode versions use Window > Devices and Simulators. Then run the command again.';

export function chooseIPhone(inventory, requestedId = '') {
  const availableRuntimes = new Map((inventory.runtimes || [])
    .filter(r => r.isAvailable && /\.iOS-/.test(r.identifier) && Number(r.version.split('.')[0]) >= 15)
    .map(r => [r.identifier, r]));
  const phones = Object.entries(inventory.devices || {}).flatMap(([runtimeId, devices]) => {
    const runtime = availableRuntimes.get(runtimeId);
    if (!runtime) return [];
    return devices.filter(d => d.isAvailable && (d.deviceTypeIdentifier?.includes('.iPhone-') || /^iPhone\b/.test(d.name)))
      .map(d => ({ ...d, runtime: runtime.version }));
  });
  if (requestedId) {
    const requested = phones.find(d => d.udid === requestedId);
    if (!requested) throw Error('The selected simulator is not an available iPhone. ' + runtimeHelp);
    return requested;
  }
  // Reuse a running phone to avoid booting a second device and using extra RAM.
  phones.sort((a, b) => Number(b.state === 'Booted') - Number(a.state === 'Booted') ||
    b.runtime.localeCompare(a.runtime, 'en', { numeric: true }) || a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!phones.length) throw Error('No available iPhone simulator was found. ' + runtimeHelp);
  return phones[0];
}

export function simulatorLocation(input) {
  const presets = { rochester: '43.1566,-77.6088', buffalo: '42.8864,-78.8784' };
  if (input === 'clear') return 'clear';
  const value = presets[input] || input;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value))
    throw Error('Use rochester, buffalo, clear, or latitude,longitude (for example 43.1566,-77.6088).');
  const [lat, lng] = value.split(',').map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw Error('Latitude must be -90 to 90 and longitude -180 to 180.');
  return value;
}

function command(program, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(program, args, {
    cwd: root, env: process.env, encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if (allowFailure) return '';
    throw Error(`${program} failed${result.error ? ': ' + result.error.message : ''}. ${capture ? (result.stderr || result.stdout || '').trim() : 'See the output above.'}`);
  }
  return (result.stdout || '').trim();
}

export function openSimulatorWindow(developerDir, udid, { run = command, exists = existsSync, warn = console.warn } = {}) {
  // Xcode 27 uses Device Hub. Keep supporting Simulator in older Xcode installs.
  // Try apps in the selected Xcode first, then let Launch Services find them.
  const apps = ['DeviceHub.app', 'Device Hub.app', 'Simulator.app']
    .map(name => ({ name, appPath: path.join(developerDir, 'Applications', name) }))
    .filter(app => exists(app.appPath))
    .map(app => ['-a', app.appPath, ...(app.name === 'Simulator.app' ? ['--args', '-CurrentDeviceUDID', udid] : [])]);
  apps.push(['-a', 'Device Hub'], ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid]);
  for (const args of apps) {
    try {
      run('open', args, { capture: true });
      return true;
    } catch { /* Opening a window must never prevent install, launch, or GPS setup. */ }
  }
  warn('Could not open the simulator window automatically. In Xcode choose Xcode > Open Developer Tool > Device Hub (Simulator in older versions), then select the iPhone shown above.');
  return false;
}

export async function main(args = process.argv.slice(2)) {
  const mode = args[0] || 'run';
  if (!['check', 'run', 'launch', 'location'].includes(mode)) throw Error('Use check, run, launch, or location.');
  const location = mode === 'location' ? simulatorLocation(args[1]) : null;
  if (process.platform !== 'darwin') throw Error('Run this command on your Mac mini. Apple Simulator requires macOS and Xcode.');
  if (!process.env.DEVELOPER_DIR) {
    const selected = command('xcode-select', ['-p'], { capture: true, allowFailure: true });
    if (existsSync(path.join(selected, 'Platforms/iPhoneOS.platform'))) process.env.DEVELOPER_DIR = selected;
    else if (existsSync('/Applications/Xcode.app/Contents/Developer')) process.env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
  }
  const xcodeVersion = command('xcodebuild', ['-version'], { capture: true });
  if (Number(xcodeVersion.match(/^Xcode (\d+)/m)?.[1] || 0) < 26) throw Error('Xcode 26 or newer is required. Open Xcode and finish setup first.');
  const inventory = JSON.parse(command('xcrun', ['simctl', 'list', '--json'], { capture: true }));
  let savedId = '';
  try { savedId = JSON.parse(readFileSync(targetFile, 'utf8')).udid || ''; } catch { /* First run. */ }
  let phone;
  if (process.env.RAYDAR_SIMULATOR_UDID) phone = chooseIPhone(inventory, process.env.RAYDAR_SIMULATOR_UDID);
  else {
    try { phone = savedId ? chooseIPhone(inventory, savedId) : chooseIPhone(inventory); }
    catch { phone = chooseIPhone(inventory); }
  }
  console.log(`Using ${phone.name} (iOS ${phone.runtime}) — virtual iPhone on this Mac.`);
  if (mode === 'check') return;

  mkdirSync(derivedData, { recursive: true });
  writeFileSync(targetFile, JSON.stringify({ udid: phone.udid, name: phone.name }));
  if (mode === 'run') {
    await verifyMobileBundle(path.join(root, 'ios/App/App/public'));
    if (!existsSync(path.join(root, 'ios/App/App/public/index.html')) ||
        !existsSync(path.join(root, 'ios/App/App/capacitor.config.json')))
      throw Error('Prepare the bundled screens first: bash scripts/mobile/install-ios.sh simulator');
    command('xcodebuild', [
      '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
      '-destination', `platform=iOS Simulator,id=${phone.udid}`, '-derivedDataPath', derivedData,
      'CODE_SIGNING_ALLOWED=NO', 'build',
    ]);
  }
  command('xcrun', ['simctl', 'bootstatus', phone.udid, '-b']);
  const developerDir = process.env.DEVELOPER_DIR || command('xcode-select', ['-p'], { capture: true });
  if (mode === 'location') {
    command('xcrun', ['simctl', 'location', phone.udid, ...(location === 'clear' ? ['clear'] : ['set', location])]);
    console.log(location === 'clear' ? 'Cleared the simulated location.' : `Simulated GPS set to ${location}. Knocks saved in the simulator will use this simulated location.`);
    openSimulatorWindow(developerDir, phone.udid);
    return;
  }
  if (mode === 'run') {
    const appPath = path.join(derivedData, 'Build/Products/Debug-iphonesimulator/App.app');
    if (!existsSync(appPath)) throw Error('Xcode did not produce the simulator app. Review the build output above.');
    // Updating in place preserves login and any unsynced knocks; never uninstall.
    command('xcrun', ['simctl', 'terminate', phone.udid, bundleId], { capture: true, allowFailure: true });
    command('xcrun', ['simctl', 'install', phone.udid, appPath]);
  }
  console.log('This is the production-connected app. Use a designated test lead: saved knocks and Scheduling Manager requests are real.');
  command('xcrun', ['simctl', 'launch', phone.udid, bundleId]);
  openSimulatorWindow(developerDir, phone.udid);
  console.log(`Raydar started on ${phone.name}. Select that iPhone in Device Hub if its screen is not visible. Click to tap; drag to swipe. To set map GPS: npm run mobile:ios:location -- rochester`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(`\n${error.message}`); process.exitCode = 1; });
}
