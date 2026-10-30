import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(path)) out.push(path);
  }
  return out;
}

const ALLOWED = new Set([
  'app/utils/server/fieldDispo.ts',
  'app/utils/server/hotLeads.ts',
  'app/api/hot-leads/route.ts',
  'app/api/hot-leads/claim/route.ts',
]);

describe('hot lead isolation', () => {
  it('only the hot-lead server files and field dispo name the collection', () => {
    const roots = [join(ROOT, 'app/api'), join(ROOT, 'app/utils/server'), join(ROOT, 'functions')];
    const leaks: string[] = [];
    for (const root of roots) {
      for (const path of filesUnder(root)) {
        const rel = path.slice(ROOT.length);
        if (ALLOWED.has(rel)) continue;
        const text = readFileSync(path, 'utf8');
        if (text.includes('hotLeads')) leaks.push(rel);
      }
    }
    assert.deepEqual(leaks, []);
  });

  it('map, stats, sync, and territory readers do not reference hotLeads', () => {
    const closed = [
      'app/api/admin/sync-appointments/route.ts',
      'app/utils/server/territoryManagement.ts',
      'app/utils/server/mobileLeads.ts',
      'app/api/historical-territory-pins/route.ts',
    ];
    for (const rel of closed) {
      assert.equal(readFileSync(join(ROOT, rel), 'utf8').includes('hotLeads'), false, rel);
    }
    for (const path of filesUnder(join(ROOT, 'app/api/stats'))) {
      assert.equal(readFileSync(path, 'utf8').includes('hotLeads'), false, path);
    }
  });
});
