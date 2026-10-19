import assert from "node:assert/strict";
import test from "node:test";
import { parseByteRange } from "./http-range";

test("sends the whole body without a usable Range header", () => {
  assert.equal(parseByteRange(null, 100), null);
  assert.equal(parseByteRange("", 100), null);
  assert.equal(parseByteRange("items=0-1", 100), null);
  assert.equal(parseByteRange("bytes=0-1,5-6", 100), null);
  assert.equal(parseByteRange("bytes=-", 100), null);
});

test("parses closed, open and suffix ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-500", 100), { start: 0, end: 99 });
});

test("clamps the end to the body size", () => {
  assert.deepEqual(parseByteRange("bytes=50-1000", 100), { start: 50, end: 99 });
});

test("reports unsatisfiable ranges", () => {
  assert.equal(parseByteRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseByteRange("bytes=20-10", 100), "unsatisfiable");
  assert.equal(parseByteRange("bytes=-0", 100), "unsatisfiable");
  assert.equal(parseByteRange("bytes=0-", 0), "unsatisfiable");
});
