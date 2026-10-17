import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const HOST = /discord(?:app)?\.com/i;
const WEBHOOK_FIELD = 'notificationWebhook';

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (statSync(full).isFile()) {
      out.push(full);
    }
  }
}

function isClientSource(rel: string): boolean {
  const normalized = rel.split('\\').join('/');
  if (normalized.startsWith('public/')) return /\.(tsx?|jsx?|css|json|html|txt|webmanifest)$/.test(normalized);
  if (!normalized.startsWith('app/')) return false;
  if (normalized.startsWith('app/api/')) return false;
  if (normalized.startsWith('app/utils/server/')) return false;
  return /\.(tsx?|jsx?|css|json|html)$/.test(normalized);
}

function hitsIn(files: string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (pattern.test(text)) found.push(relative(ROOT, file));
  }
  return found;
}

describe('discord webhook stays off the client', () => {
  it('client source does not reference discord.com or the webhook field', () => {
    const files: string[] = [];
    walk(join(ROOT, 'app'), files);
    walk(join(ROOT, 'public'), files);
    const clientFiles = files.filter((file) => isClientSource(relative(ROOT, file)));

    assert.deepEqual(hitsIn(clientFiles, HOST), []);
    assert.deepEqual(hitsIn(clientFiles, new RegExp(WEBHOOK_FIELD)), []);
  });

  it('the built client bundle does not reference discord.com', () => {
    const staticDir = join(ROOT, '.next', 'static');
    if (!existsSync(staticDir)) {
      assert.fail('Build .next/static before this test so the client bundle can be scanned.');
    }

    const files: string[] = [];
    walk(staticDir, files);
    const bundleFiles = files.filter((file) => /\.(js|css|html|json)$/.test(file) && !file.endsWith('.map'));
    assert.ok(bundleFiles.length > 0, 'expected client bundle files in .next/static');
    assert.deepEqual(hitsIn(bundleFiles, HOST), []);
    assert.deepEqual(hitsIn(bundleFiles, new RegExp(WEBHOOK_FIELD)), []);
  });
});
