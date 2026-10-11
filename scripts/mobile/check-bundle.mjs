import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function verifyMobileBundle(directory) {
  const release = JSON.parse(await readFile(path.join(root, 'app/mobile/_lib/release.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(directory, 'raydar-build.json'), 'utf8'));
  if (manifest.version !== release.version || manifest.build !== release.build || !manifest.native)
    throw Error('The bundled app is from a different release. Run the installer from this release folder.');
  if (manifest.apiOrigin !== 'https://happy-solar-leads.vercel.app' || manifest.firebaseProject !== 'gen-lang-client-0395385938')
    throw Error('The bundled app is not configured for the production Raydar backend.');
  const login = await readFile(path.join(directory, 'login/index.html'), 'utf8');
  if (!login.includes('data-raydar-native="true"') || !login.includes('/brand/raydar-v5/raydar-primary-v5.svg') ||
      !login.includes(`Raydar v${release.version}`))
    throw Error('The bundled login is missing the current native brand/version. Rebuild before installing.');
  const logo = await readFile(path.join(directory, 'brand/raydar-v5/raydar-primary-v5.svg'));
  if (createHash('sha256').update(logo).digest('hex') !== manifest.brandSha256)
    throw Error('The bundled logo does not match this build.');
  for (const route of ['mobile', 'mobile/knocking', 'mobile/follow-ups', 'mobile/stats', 'mobile/more',
    'mobile/territories', 'mobile/workspace/users', 'mobile/team-map', 'mobile/field-tools']) {
    const html = await readFile(path.join(directory, route, 'index.html'), 'utf8');
    if (!html.includes('data-raydar-native="true"')) throw Error(`Missing native screen: ${route}`);
  }
  console.log(`Verified bundled Raydar ${release.version}/${release.build}: current mobile screens, Signal R brand, production backend.`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void verifyMobileBundle(path.resolve(root, process.argv[2] || 'out')).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
