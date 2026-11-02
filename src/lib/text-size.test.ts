import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_TEXT_SIZE, isTextSize, TEXT_SIZES, textSizeName } from "./text-size";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("only the four text sizes are valid, so an old or edited saved value falls back to Default", () => {
  assert.deepEqual(
    TEXT_SIZES.map((size) => size.id),
    ["small", "default", "large", "larger"],
  );
  for (const size of TEXT_SIZES) assert.equal(isTextSize(size.id), true);
  for (const value of ["huge", "Default", "", null, undefined, 1.125]) assert.equal(isTextSize(value), false);
  assert.equal(DEFAULT_TEXT_SIZE, "default");
});

test("each text size has its name for the account menu", () => {
  assert.deepEqual(
    TEXT_SIZES.map((size) => textSizeName(size.id)),
    ["Small", "Default", "Large", "Larger"],
  );
});

test("globals.css sets the root font size of every size but Default, as a share of the browser's own size", () => {
  for (const size of TEXT_SIZES) {
    const rule = new RegExp(`html\\[data-text-size="${size.id}"\\]\\s*\\{\\s*font-size:\\s*([^;]+);`).exec(css);
    if (size.id === DEFAULT_TEXT_SIZE) {
      assert.equal(rule, null, "Default keeps the browser's size, so it needs no rule");
    } else {
      assert.ok(rule, `globals.css has no rule for ${size.id}`);
      assert.equal(rule[1].trim(), size.rootSize);
      assert.match(size.rootSize, /%$/, "a percentage keeps a bigger browser font in the sum");
    }
  }
});

test("the smallest text keeps an 11px floor, so the Small size can't shrink it further", () => {
  assert.match(css, /--text-2xs:\s*max\(0\.6875rem,\s*11px\);/);
});
