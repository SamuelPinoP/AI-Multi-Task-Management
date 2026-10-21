// Draws the installable app's icons (SMART-10) into public/icons.
// Run `node scripts/generate-app-icons.mjs` after changing the artwork; the
// PNGs are committed. sharp comes with Next.js.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outDir = path.join(process.cwd(), "public", "icons");
const accent = "#0a6f68";

// A checked item over two list lines. Everything stays inside the central
// circle (80% of the width) that maskable icons keep on every platform.
const glyph = `
  <g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="36">
    <path d="M132 176l36 36 64-68" />
    <path d="M280 180h100" />
    <path d="M132 290h248" />
    <path d="M132 378h168" />
  </g>`;

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${accent}" />${glyph}</svg>`;
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${accent}" />${glyph}</svg>`;

const outputs = [
  { file: "icon-192.png", svg: rounded, size: 192 },
  { file: "icon-512.png", svg: rounded, size: 512 },
  { file: "maskable-512.png", svg: fullBleed, size: 512 },
  // iOS rounds the corners itself and shows transparency as black.
  { file: "apple-touch-icon.png", svg: fullBleed, size: 180 },
];

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "icon.svg"), `${rounded}\n`);
for (const { file, svg, size } of outputs) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(outDir, file));
  console.log(`public/icons/${file}`);
}
