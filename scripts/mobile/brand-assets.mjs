// Raydar Signal R: editable geometric vector masters, derived from the approved
// slate/yellow concept. No embedded bitmap or external font dependencies.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dest = path.join(root, 'public/brand/raydar-v5');
const blue = '#587E98', yellow = '#F0BC18', ivory = '#FFFCF5';
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Raydar Signal R">${body}</svg>\n`;
const mark = (ink, signal, dot = signal) => `<g fill="${ink}"><path d="M0 78Q0 64 24 64H48V234H0Z"/><path d="M103 195Q125 192 139 177L173 211Q186 223 189 234H140Z"/></g><g fill="${signal}"><path d="M84 0A126 126 0 0 1 193.12 189L155.01 167A82 82 0 0 0 84 44Z"/><path d="M84 54A72 72 0 0 1 146.35 162L115.18 144A36 36 0 0 0 84 90H80Q64 90 64 72Q64 54 80 54Z"/></g><circle cx="84" cy="126" r="20" fill="${dot}"/>`;
const ring = (cx,cy,ro,ri) => `<path fill-rule="evenodd" d="M${cx-ro} ${cy}a${ro} ${ro} 0 1 0 ${2*ro} 0a${ro} ${ro} 0 1 0 ${-2*ro} 0M${cx-ri} ${cy}a${ri} ${ri} 0 1 0 ${2*ri} 0a${ri} ${ri} 0 1 0 ${-2*ri} 0Z"/>`;
const a = x => `<g transform="translate(${x})">${ring(80,159,66,33)}<path d="M113 158h33v66h-33Z"/></g>`;
const r = x => `<path d="M${x} 224V157Q${x} 94 ${x+68} 94H${x+72}V126H${x+66}Q${x+34} 126 ${x+34} 158V224Z"/>`;
const word = ink => `<g fill="${ink}" transform="translate(230 10)">${r(0)}${a(65)}<path d="M211 94H248L279 157L309 94H346L263 272H226L260 199Z"/><g transform="translate(337)">${ring(80,159,66,33)}<path d="M113 40h33v119h-33Z"/></g>${a(482)}${r(636)}</g>`;
const lockup = (ink, signal, background) => svg(1000,320,`${background ? `<path fill="${background}" d="M0 0h1000v320H0Z"/>` : ''}<g transform="translate(30 22)">${mark(ink,signal)}${word(ink)}</g>`);
const icon = (background, mono=false) => svg(1024,1024,`${background ? `<path fill="${background}" d="M0 0h1024v1024H0Z"/>` : ''}<g transform="translate(242 211) scale(2.57)">${mark(blue,blue,mono?blue:ivory)}</g>`);
await mkdir(dest,{recursive:true});
const assets = {
  'raydar-primary-v5.svg': lockup(blue,yellow),
  'raydar-reversed-v5.svg': lockup('#FFFFFF',yellow),
  'raydar-slate-v5.svg': lockup(blue,blue),
  'raydar-white-v5.svg': lockup('#FFFFFF','#FFFFFF'),
  'raydar-on-ivory-v5.svg': lockup(blue,yellow,ivory),
  'raydar-on-slate-v5.svg': lockup('#FFFFFF',yellow,blue),
  'raydar-mark-v5.svg': svg(256,280,`<g transform="translate(23 23)">${mark(blue,yellow)}</g>`),
  'raydar-app-icon-v5.svg': icon(yellow),
  'raydar-icon-foreground-v5.svg': icon(),
};
for (const [name, content] of Object.entries(assets)) await writeFile(path.join(dest,name),content);
// Native launcher input: the asset generator handles OS-specific sizing/masks.
const native = path.join(root,'resources/raydar-v5');
await mkdir(native,{recursive:true});
await writeFile(path.join(native,'logo.svg'),icon());
if (process.env.RAYDAR_LOGO_PACK_DIR) {
  const pack=path.resolve(process.env.RAYDAR_LOGO_PACK_DIR);
  await mkdir(pack,{recursive:true});
  for (const [name,content] of Object.entries(assets)) {
    await copyFile(path.join(dest,name),path.join(pack,name));
    await sharp(Buffer.from(content)).resize({width:name.includes('icon')?1024:name.includes('mark')?1024:3000}).png().toFile(path.join(pack,name.replace('.svg','.png')));
  }
  for (const size of [512,192,48,32]) await sharp(Buffer.from(assets['raydar-app-icon-v5.svg'])).resize(size,size).png().toFile(path.join(pack,`raydar-app-icon-${size}-v5.png`));
  console.log(`Logo pack assets written to ${pack}`);
}
console.log('Raydar v5 vector masters ready.');
