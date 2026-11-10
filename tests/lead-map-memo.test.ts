import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// LeadMap rebuilds every pin when `users` changes identity (it is a marker-effect
// dependency). These guard the two ways a caller could make that happen every render,
// even with the field-ownership flag OFF. (No DOM renderer in this repo, so the check is on source.)
describe('LeadMap users prop stays referentially stable', () => {
  it('lead-management memoizes the colored users it passes to LeadMap', () => {
    const page = read('../app/lead-management/page.tsx');
    assert.match(page, /const coloredUsers = useMemo\(/);
    assert.match(page, /users=\{coloredUsers\}/);
    assert.doesNotMatch(page, /users=\{ensureUserColors\(/, 'no inline array per render');
  });

  it('every LeadMap caller passes a memoized or state users array', () => {
    for (const file of ['../app/page.tsx', '../app/mobile/knocking/page.tsx']) {
      const text = read(file);
      assert.match(text, /coloredUsers = useMemo\(\(\) => ensureUserColors\(users\), \[users\]\)/, file);
    }
    const activity = read('../app/activity-map/page.tsx');
    assert.doesNotMatch(activity, /users=\{ensureUserColors\(/);
  });

  it('LeadMap default users is a module constant, not a new [] per render', () => {
    const map = read('../app/components/LeadMap.tsx');
    assert.match(map, /const NO_USERS: User\[\] = \[\];/);
    assert.match(map, /users = NO_USERS,/);
    assert.doesNotMatch(map, /users = \[\],/);
  });
});
