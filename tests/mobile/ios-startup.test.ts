import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeFirestoreSettings } from '../../app/utils/firestoreTransport';
import { withDeadline } from '../../app/utils/withDeadline';

test('iOS detects buffered connections without forcing slow long polling for every query', () => {
  assert.deepEqual(nativeFirestoreSettings(true, 'ios'), { experimentalAutoDetectLongPolling: true });
  for (const [native, platform] of [[false, 'ios'], [true, 'android'], [true, 'web'], [false, 'web']] as const)
    assert.equal(nativeFirestoreSettings(native, platform), null);
});

test('a timed-out sign-in is not reported as success; its late completion remains handled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let complete!: (value: string) => void;
  const work = new Promise<string>(resolve => { complete = resolve; });
  const result = withDeadline(work, 15_000, 'Connection timed out');
  const rejected = assert.rejects(result, { code: 'raydar/timeout' });
  t.mock.timers.tick(15_000);
  await rejected;
  complete('signed in');
  assert.equal(await work, 'signed in');
});

test('normal sign-in completion and failure clear the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await withDeadline(Promise.resolve('ok'), 15_000, 'timeout'), 'ok');
  await assert.rejects(withDeadline(Promise.reject(new Error('invalid credential')), 15_000, 'timeout'), /invalid credential/);
  t.mock.timers.tick(15_000);
});
