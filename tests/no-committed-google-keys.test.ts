import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// A Google API key was committed in scratch files in Feb 2026 and shipped in every source zip.
// No tracked file may contain an AIza... key, except the two legacy Firebase web-config scripts
// below (a Firebase web apiKey is a public client identifier, not a secret).
const ALLOWED_FIREBASE_WEB_KEY_FILES = new Set(['test-firestore.js', 'update-user-role.js']);
const KEY_PATTERN = /AIza[0-9A-Za-z_-]{35}/;

describe('no Google API keys in tracked files', () => {
  it('only the allowlisted Firebase web-config scripts contain an AIza key', () => {
    const root = new URL('..', import.meta.url);
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
    const offenders: string[] = [];
    for (const file of files) {
      if (file === 'package-lock.json' || /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|mp4|mov)$/i.test(file)) continue;
      if (ALLOWED_FIREBASE_WEB_KEY_FILES.has(file)) continue;
      let text: string;
      try { text = readFileSync(new URL(file, root), 'utf8'); } catch { continue; }
      if (KEY_PATTERN.test(text)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], 'Google API key found in tracked file(s); use an env var');
  });
});
