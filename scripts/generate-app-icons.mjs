// Draws the app's icons from the AI Multi mark (DES-07, #292): the installable
// app's icons and the browser tab's icon.svg in public/icons (linked from
// src/app/layout.tsx), and src/app/favicon.ico for browsers without SVG icons.
// Run `node scripts/generate-app-icons.mjs` after changing the artwork; the
// files are committed. sharp comes with Next.js.
//
// The paths are the mark's from src/lib/brand.ts, copied because a script
// can't import TypeScript; src/lib/brand.test.ts checks that they still match.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const teal = "#0a6f68";
const letters = "M8 35 L15.5 13 L23 35 M26.5 35 V13 L33.25 25 L40 13 V35";
const spark = "M15.5 23.2 Q16.1 27 19.8 27.6 Q16.1 28.2 15.5 32 Q14.9 28.2 11.2 27.6 Q14.9 27 15.5 23.2 Z";

/** The letters and the spark on the 48 x 48 grid, scaled around the center. */
function glyph(scale = 1) {
  return (
    `<g transform="translate(24 24) scale(${scale}) translate(-24 -24)">` +
    `<path d="${letters}" fill="none" stroke="#ffffff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round" />` +
    `<path d="${spark}" fill="#ffffff" /></g>`
  );
}

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`;

// The rounded tile, as the app draws it (src/components/brand/logo-mark.tsx).
const rounded = svg(`<rect width="48" height="48" rx="12" fill="${teal}" />${glyph()}`);
// Maskable icons are cropped to a shape of the platform's choosing and must keep
// everything inside the central circle (80% of the width), so the glyph shrinks.
const maskable = svg(`<rect width="48" height="48" fill="${teal}" />${glyph(0.8)}`);
// iOS rounds the corners itself and shows transparency as black.
const square = svg(`<rect width="48" height="48" fill="${teal}" />${glyph()}`);

const png = (source, size) => sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** A .ico file holding PNG images, which every current browser reads. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const outputs = [
  ["public/icons/icon.svg", `${rounded}\n`],
  ["public/icons/icon-192.png", await png(rounded, 192)],
  ["public/icons/icon-512.png", await png(rounded, 512)],
  ["public/icons/maskable-512.png", await png(maskable, 512)],
  ["public/icons/apple-touch-icon.png", await png(square, 180)],
  // Next.js links app/favicon.ico from every page. (The sign-in redirect in
  // src/proxy.ts skips /favicon.ico and /icons/, so both load when signed out.)
  ["src/app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) }))))],
];

await mkdir(path.join(root, "public", "icons"), { recursive: true });
for (const [file, data] of outputs) {
  await writeFile(path.join(root, file), data);
  console.log(file);
}
