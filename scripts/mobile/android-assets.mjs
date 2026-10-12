// Use the same pinned Sharp runtime as the iPhone generator; capacitor-assets'
// nested legacy Sharp needs a separate install-script download on clean machines.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const res=path.join(root,'android/app/src/main/res');
const logo=await readFile(path.join(root,'resources/raydar-v5/logo.svg'));
for(const [density,scale] of Object.entries({ldpi:.75,mdpi:1,hdpi:1.5,xhdpi:2,xxhdpi:3,xxxhdpi:4})) {
  const dir=path.join(res,`mipmap-${density}`);await mkdir(dir,{recursive:true});
  const size=Math.round(48*scale), adaptive=Math.round(108*scale);
  const icon=await sharp(logo).resize(size,size).flatten({background:'#F0BC18'}).removeAlpha().png().toBuffer();
  await writeFile(path.join(dir,'ic_launcher.png'),icon);
  const circle=Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`);
  await sharp(icon).ensureAlpha().composite([{input:circle,blend:'dest-in'}]).png().toFile(path.join(dir,'ic_launcher_round.png'));
  // The approved SVG's mark occupies <66dp within the 108dp adaptive layer.
  await sharp(logo).resize(adaptive,adaptive).png().toFile(path.join(dir,'ic_launcher_foreground.png'));
}
const adaptiveXml=`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
await mkdir(path.join(res,'mipmap-anydpi-v26'),{recursive:true});
for(const name of ['ic_launcher.xml','ic_launcher_round.xml'])await writeFile(path.join(res,'mipmap-anydpi-v26',name),adaptiveXml);
await writeFile(path.join(res,'values/ic_launcher_background.xml'),'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F0BC18</color>\n</resources>\n');
await mkdir(path.join(res,'drawable-nodpi'),{recursive:true});
const mark=await sharp(logo).resize(204,204).png().toBuffer();
await sharp({create:{width:2732,height:2732,channels:3,background:'#FFFCF5'}})
  .composite([{input:mark,gravity:'center'}]).png().toFile(path.join(res,'drawable-nodpi/splash.png'));
console.log('Android icons and launch asset generated from the approved Raydar Signal R.');
