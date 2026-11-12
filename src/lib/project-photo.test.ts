import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_PHOTO_MAX_BYTES,
  projectPhotoProblem,
  projectPhotoUrl,
  sniffProjectPhotoType,
  squareCrop,
} from "./project-photo";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);
const text = (value: string) => new TextEncoder().encode(value);

test("photos are recognized by their bytes", () => {
  assert.equal(sniffProjectPhotoType(png), "image/png");
  assert.equal(sniffProjectPhotoType(jpeg), "image/jpeg");
  assert.equal(sniffProjectPhotoType(webp), "image/webp");
});

test("anything that isn't PNG, JPEG or WebP is refused, whatever it claims to be", () => {
  assert.equal(sniffProjectPhotoType(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffProjectPhotoType(text("<!doctype html><html></html>")), null);
  assert.equal(sniffProjectPhotoType(text("GIF89a")), null);
  // RIFF alone is a WAV or AVI, not a WebP.
  assert.equal(sniffProjectPhotoType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])), null);
  // Too short to hold a signature.
  assert.equal(sniffProjectPhotoType(Uint8Array.from([0x89, 0x50])), null);
  assert.equal(sniffProjectPhotoType(new Uint8Array()), null);
});

test("the server says why it refuses a photo", () => {
  assert.equal(projectPhotoProblem(png), null);
  assert.equal(projectPhotoProblem(new Uint8Array()), "Choose an image.");
  assert.equal(projectPhotoProblem(text("<svg></svg>")), "Use a PNG, JPEG or WebP image.");

  const tooBig = new Uint8Array(PROJECT_PHOTO_MAX_BYTES + 1);
  tooBig.set(jpeg);
  assert.equal(projectPhotoProblem(tooBig), "That image is too large. Try a smaller one.");
  const justRight = new Uint8Array(PROJECT_PHOTO_MAX_BYTES);
  justRight.set(jpeg);
  assert.equal(projectPhotoProblem(justRight), null);
});

test("the crop is the centered square of the shorter side", () => {
  assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, side: 300 });
  assert.deepEqual(squareCrop(300, 400), { sx: 0, sy: 50, side: 300 });
  assert.deepEqual(squareCrop(256, 256), { sx: 0, sy: 0, side: 256 });
  // Odd leftovers round down, so the square stays inside the image.
  assert.deepEqual(squareCrop(101, 100), { sx: 0, sy: 0, side: 100 });
  assert.deepEqual(squareCrop(103, 100), { sx: 1, sy: 0, side: 100 });
});

test("each new photo gets a new address, so caches never show an old one", () => {
  const first = projectPhotoUrl("cm1", "2026-11-12T20:00:00.000Z");
  const second = projectPhotoUrl("cm1", new Date("2026-11-12T20:00:01.000Z"));
  assert.equal(first, "/api/projects/cm1/photo?v=1794513600000");
  assert.notEqual(first, second);
  assert.equal(projectPhotoUrl("a/b", "2026-11-12T20:00:00.000Z"), "/api/projects/a%2Fb/photo?v=1794513600000");
});
