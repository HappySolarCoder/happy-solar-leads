import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOW_SAVE_MESSAGE,
  SLOW_SAVE_MS,
  createSlowSaveAlert,
} from '../app/utils/slowSaveAlert';

type Scheduled = { fn: () => void; ms: number };

function harness() {
  const alerts: string[] = [];
  const notices: Array<string | null> = [];
  const scheduled: Scheduled[] = [];
  let nextId = 1;
  const timers = new Map<number, Scheduled>();
  const save = createSlowSaveAlert({
    alert: (message) => {
      alerts.push(message);
    },
    setTimer: (fn, ms) => {
      const id = nextId++;
      const entry = { fn, ms };
      timers.set(id, entry);
      scheduled.push(entry);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id) => {
      timers.delete(id as unknown as number);
    },
    onNotice: (message) => {
      notices.push(message);
    },
  });

  const fire = (ms: number) => {
    const match = [...timers.entries()].find(([, entry]) => entry.ms === ms);
    assert.ok(match, `no timer scheduled for ${ms}ms`);
    timers.delete(match[0]);
    match[1].fn();
  };

  return { save, alerts, notices, scheduled, fire };
}

describe('slow save alert', () => {
  it('does not start a second timer while one is running', () => {
    const { save, scheduled } = harness();
    assert.equal(save.arm(), true);
    assert.equal(save.arm(), false);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].ms, SLOW_SAVE_MS);
  });

  it('clears the 15s timer on dispose', () => {
    const { save, alerts, fire } = harness();
    save.arm();
    save.dispose();
    assert.throws(() => fire(SLOW_SAVE_MS));
    assert.deepEqual(alerts, []);
  });

  it('shows the failure instead of a pending still-saving alert', () => {
    const { save, alerts, notices, fire } = harness();
    save.arm();
    fire(SLOW_SAVE_MS);
    save.fail('Could not save these changes.');
    assert.throws(() => fire(0), /no timer scheduled/);
    assert.deepEqual(alerts, ['Could not save these changes.']);
    assert.equal(notices.at(-1), 'Could not save these changes.');
  });

  it('replaces a shown still-saving alert with the failure and does not alert twice', () => {
    const { save, alerts, notices, fire } = harness();
    save.arm();
    fire(SLOW_SAVE_MS);
    fire(0);
    save.fail('Could not save these changes.');
    assert.deepEqual(alerts, [SLOW_SAVE_MESSAGE]);
    assert.equal(notices.at(-1), 'Could not save these changes.');
  });

  it('alerts still saving once when the save is still running', () => {
    const { save, alerts, fire } = harness();
    save.arm();
    fire(SLOW_SAVE_MS);
    fire(0);
    assert.deepEqual(alerts, [SLOW_SAVE_MESSAGE]);
    save.finish();
    assert.equal(save.notice(), null);
  });
});
