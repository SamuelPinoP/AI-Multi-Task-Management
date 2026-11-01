import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import manifest from "../app/manifest";
import { BRAND_TEAL, LOGO_LETTERS_PATH, LOGO_SPARK_PATH } from "./brand";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's header. */
function pngSize(data: Buffer) {
  assert.ok(data.subarray(0, 8).equals(PNG_SIGNATURE), "not a PNG");
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

test("every manifest icon is a PNG of the size it declares", () => {
  const icons = manifest().icons ?? [];
  assert.ok(icons.length >= 3);
  for (const icon of icons) {
    assert.equal(pngSize(read(path.join("public", icon.src))), icon.sizes, icon.src);
  }
  assert.ok(icons.some((icon) => icon.purpose === "maskable"), "a maskable icon for Android");
});

test("the Apple touch icon is 180 x 180", () => {
  assert.equal(pngSize(read("public/icons/apple-touch-icon.png")), "180x180");
});

test("favicon.ico holds 16, 32 and 48 px PNGs", () => {
  const ico = read("src/app/favicon.ico");
  assert.equal(ico.readUInt16LE(2), 1, "an icon file");
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, index) => {
    const entry = 6 + 16 * index;
    const image = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
    assert.equal(pngSize(image), `${ico.readUInt8(entry)}x${ico.readUInt8(entry + 1)}`);
    return ico.readUInt8(entry);
  });
  assert.deepEqual(sizes, [16, 32, 48]);
});

test("the generated icons draw the same mark as the app", () => {
  for (const file of ["public/icons/icon.svg", "scripts/generate-app-icons.mjs"]) {
    const text = read(file).toString("utf8");
    assert.ok(text.includes(LOGO_LETTERS_PATH), `${file}: the letters`);
    assert.ok(text.includes(LOGO_SPARK_PATH), `${file}: the spark`);
    assert.ok(text.includes(BRAND_TEAL), `${file}: the teal`);
  }
});
