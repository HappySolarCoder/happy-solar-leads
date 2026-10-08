import { cp, mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stage = path.join(root, '.mobile-build');
nextEnv.loadEnvConfig(root, false);
const required = [
  'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_API_BASE_URL',
];
const missing = required.filter(key => !process.env[key]);
if (missing.length) throw new Error(`Missing mobile configuration: ${missing.join(', ')}. See MOBILE-APP.md.`);
const origin = new URL(process.env.NEXT_PUBLIC_API_BASE_URL);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('NEXT_PUBLIC_API_BASE_URL must be an HTTPS origin without a path.');
}

// A separate staging tree lets web API routes stay server-side. Never move/delete
// source routes, copy .env files, or put service-account keys in the app bundle.
await rm(stage, { recursive: true, force: true });
await rm(path.join(root, 'out'), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(root, 'app'), path.join(stage, 'app'), {
  recursive: true,
  filter: source => source !== path.join(root, 'app/api'),
});
await cp(path.join(root, 'public'), path.join(stage, 'public'), { recursive: true });
await rm(path.join(stage, 'public/sw.js'), { force: true });
for (const name of ['package.json', 'postcss.config.mjs']) {
  await cp(path.join(root, name), path.join(stage, name));
}
const tsconfig = JSON.parse(await readFile(path.join(root, 'tsconfig.json'), 'utf8'));
tsconfig.include = ['next-env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', '.next/types/**/*.ts'];
await writeFile(path.join(stage, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
await symlink(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'junction');
await writeFile(path.join(stage, 'next.config.mjs'), `export default {
  output: 'export', trailingSlash: true, images: { unoptimized: true },
  experimental: { cpus: 2 },
};\n`);

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_NATIVE_BUILD: '1' };
// The legacy AI page expects a browser Gemini key. Do not ship such a key to staff devices.
delete env.NEXT_PUBLIC_GEMINI_API_KEY;
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
  cwd: stage, env, stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);
await cp(path.join(stage, 'out'), path.join(root, 'out'), { recursive: true });
console.log('Mobile screens exported to out/. Run npm run mobile:sync next.');
