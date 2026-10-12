import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseIPhone, simulatorLocation, openSimulatorWindow } from '../../scripts/mobile/ios-simulator.mjs';

const oldRuntime = 'com.apple.CoreSimulator.SimRuntime.iOS-18-6';
const newRuntime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-0';
function inventory() {
  return {
    runtimes: [
      { identifier: oldRuntime, version: '18.6', isAvailable: true },
      { identifier: newRuntime, version: '26.0', isAvailable: true },
      { identifier: 'com.apple.CoreSimulator.SimRuntime.tvOS-26-0', version: '26.0', isAvailable: true },
    ],
    devices: {
      [oldRuntime]: [{ udid: 'old-phone', name: 'iPhone 16', isAvailable: true, state: 'Shutdown' }],
      [newRuntime]: [
        { udid: 'ipad', name: 'iPad Pro', isAvailable: true, state: 'Booted' },
        { udid: 'phone', name: 'iPhone 17', isAvailable: true, state: 'Shutdown' },
        { udid: 'unavailable', name: 'iPhone 17 Pro', isAvailable: false, state: 'Shutdown' },
      ],
      'com.apple.CoreSimulator.SimRuntime.tvOS-26-0': [{ udid: 'tv', name: 'Apple TV', isAvailable: true, state: 'Booted' }],
    },
  };
}

test('simulator launcher targets an available iPhone, never iPad, TV, unavailable or physical devices', () => {
  assert.equal(chooseIPhone(inventory()).udid, 'phone');
  for (const id of ['ipad', 'tv', 'unavailable', 'real-phone-serial']) {
    assert.throws(() => chooseIPhone(inventory(), id), /not an available iPhone/);
  }
});
test('simulator launcher reuses a running or explicitly selected iPhone', () => {
  const devices = inventory();
  devices.devices[oldRuntime][0].state = 'Booted';
  assert.equal(chooseIPhone(devices).udid, 'old-phone');
  assert.equal(chooseIPhone(devices, 'phone').udid, 'phone');
});
test('missing and unsupported simulator runtimes explain setup rather than selecting a device', () => {
  assert.throws(() => chooseIPhone({}), /install an iOS Simulator runtime/);
  const devices = inventory();
  devices.runtimes.forEach(runtime => { runtime.isAvailable = false; });
  assert.throws(() => chooseIPhone(devices), /No available iPhone simulator/);
});
test('simulated GPS accepts only explicit presets, valid coordinates or clear', () => {
  assert.equal(simulatorLocation('rochester'), '43.1566,-77.6088');
  assert.equal(simulatorLocation('buffalo'), '42.8864,-78.8784');
  assert.equal(simulatorLocation('43.2,-77.5'), '43.2,-77.5');
  assert.equal(simulatorLocation('clear'), 'clear');
  for (const input of [undefined, '', '91,0', '0,-181', 'NaN,0', '1,2;anything', '1,2,3']) {
    assert.throws(() => simulatorLocation(input));
  }
});

test('Xcode 27 opens Device Hub without legacy Simulator-only arguments', () => {
  const calls: string[][] = [];
  assert.equal(openSimulatorWindow('/Xcode/Contents/Developer', 'phone', {
    exists: (name: any) => String(name).endsWith('/DeviceHub.app'),
    run: (program: string, args: string[]) => { calls.push([program, ...args]); return ''; },
  }), true);
  assert.deepEqual(calls, [['open', '-a', '/Xcode/Contents/Developer/Applications/DeviceHub.app']]);
});

test('older Xcode still opens its Simulator and selects the chosen phone', () => {
  const calls: string[][] = [];
  openSimulatorWindow('/Xcode/Contents/Developer', 'phone', {
    exists: (name: any) => String(name).endsWith('/Simulator.app'),
    run: (program: string, args: string[]) => { calls.push([program, ...args]); return ''; },
  });
  assert.deepEqual(calls, [['open', '-a', '/Xcode/Contents/Developer/Applications/Simulator.app', '--args', '-CurrentDeviceUDID', 'phone']]);
});

test('a missing simulator window is nonfatal and gives manual opening instructions', () => {
  const warnings: string[] = [];
  const calls: string[][] = [];
  assert.equal(openSimulatorWindow('/Xcode/Contents/Developer', 'phone', {
    exists: () => false,
    run: (program: string, args: string[]) => { calls.push([program, ...args]); throw Error('Application missing'); },
    warn: (message: string) => warnings.push(message),
  }), false);
  assert.equal(calls.length, 2);
  assert.match(warnings[0], /Xcode > Open Developer Tool > Device Hub/);
});
