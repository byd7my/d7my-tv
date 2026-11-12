/** Generate the Android TV brand assets from the shared D7T artwork. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const icons = new URL('../../apps/web/src/assets/icons/', import.meta.url);
const resources = new URL('../android/app/src/main/res/', import.meta.url);
const launcher = await readFile(new URL('android-chrome-512x512.png', icons));
const mark = await sharp(await readFile(new URL('icon-tv-256.png', icons)))
    .trim()
    .png()
    .toBuffer();

const sizes = { mdpi: 80, hdpi: 120, xhdpi: 160, xxhdpi: 240, xxxhdpi: 320 };
for (const [density, size] of Object.entries(sizes)) {
    const dir = new URL(`mipmap-${density}/`, resources);
    const square = await sharp(launcher).resize(size, size).png().toBuffer();
    const circle = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);
    const round = await sharp(square).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
    await writeFile(new URL('ic_launcher.png', dir), square);
    await writeFile(new URL('ic_launcher_round.png', dir), round);
}

const drawables = new URL('drawable-nodpi/', resources);
await mkdir(drawables, { recursive: true });
await writeFile(new URL('iptvnator_mark.png', drawables), mark);
// 108 dp layers at 4x density (432 px). The adaptive foreground is the D7T
// lettering alone, sized to sit inside the central 66 dp (264 px) safe zone;
// the tile and its rounded corners come from the background layer's gradient.
const lettering = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="95 192 312 128" width="232" height="95">
    <defs><linearGradient id="ink" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9C9CE"/></linearGradient></defs>
    <path transform="translate(95.56 318.71) scale(0.08418 -0.08418)" d="M627 0C1083 0 1356 286 1356 747C1356 1205 1081 1490 638 1490H124V0ZM388 226V1264H621C935 1264 1089 1075 1089 747C1089 416 937 226 613 226Z" fill="url(#ink)"/>
    <path transform="translate(212.40 318.71) scale(0.08418 -0.08418)" d="M149 0H420L1056 1265V1490H46V1266H789V1265Z" fill="#1FD16B"/>
    <path transform="translate(301.88 318.71) scale(0.08418 -0.08418)" d="M46 1261H510V0H775V1261H1237V1490H46Z" fill="url(#ink)"/>
</svg>`;
const foreground = await sharp(Buffer.from(lettering), { density: 288 })
    .resize(232, 95)
    .extend({ top: 169, bottom: 168, left: 100, right: 100, background: '#00000000' })
    .png()
    .toBuffer();
await writeFile(new URL('iptvnator_launcher_foreground.png', drawables), foreground);

const bannerIcon = await readFile(new URL('android-chrome-192x192.png', icons));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2A2D"/><stop offset="1" stop-color="#050505"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#bg)"/>
    <image href="data:image/png;base64,${bannerIcon.toString('base64')}" x="18" y="42" width="96" height="96"/>
    <text x="128" y="92" fill="#f5f5f5" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700">D7my-TV</text>
    <text x="129" y="115" fill="#1FD16B" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600">Android TV · Fire TV</text>
</svg>`;
const banner = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(
    new URL('drawable/banner.png', resources),
    banner
);
