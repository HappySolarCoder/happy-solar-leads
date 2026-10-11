// Use the modern, pinned Sharp binary already used by Next. The older Sharp
// nested inside capacitor-assets depends on a separate legacy install download.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const logo = await readFile(path.join(root, 'resources/raydar-v5/logo.svg'));
const assets = path.join(root, 'ios/App/App/Assets.xcassets');
const iconDirectory = path.join(assets, 'AppIcon.appiconset');
const splashDirectory = path.join(assets, 'Splash.imageset');
await mkdir(iconDirectory, { recursive: true });
await mkdir(splashDirectory, { recursive: true });

// iOS requires an opaque 1024px app icon; preserve the approved yellow/slate R.
await sharp(logo).resize(1024, 1024).flatten({ background: '#F0BC18' }).removeAlpha()
  .png().toFile(path.join(iconDirectory, 'AppIcon-512@2x.png'));
await writeFile(path.join(iconDirectory, 'Contents.json'), JSON.stringify({
  images: [{ idiom: 'universal', size: '1024x1024', filename: 'AppIcon-512@2x.png', platform: 'ios' }],
  info: { author: 'xcode', version: 1 },
}, null, 2) + '\n');

// Match Capacitor's universal splash sizes and existing storyboard image name.
const mark = await sharp(logo).resize(204, 204).png().toBuffer();
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: '#FFFCF5' } })
  .composite([{ input: mark, gravity: 'center' }]).removeAlpha().png().toBuffer();
const images = [];
for (const dark of [false, true]) {
  for (const scale of [1, 2, 3]) {
    const filename = `Default@${scale}x~universal~anyany${dark ? '-dark' : ''}.png`;
    await writeFile(path.join(splashDirectory, filename), splash);
    images.push({ ...(dark ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] } : {}),
      idiom: 'universal', filename, scale: `${scale}x` });
  }
}
await writeFile(path.join(splashDirectory, 'Contents.json'), JSON.stringify({
  images, info: { version: 1, author: 'xcode' },
}, null, 2) + '\n');
console.log('iPhone icon and launch assets generated from the approved Raydar Signal R.');
