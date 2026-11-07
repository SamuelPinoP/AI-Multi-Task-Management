import assert from "node:assert/strict";
import test from "node:test";
import { matchPickerOption } from "./picker-match";

test("an empty search keeps every option", () => {
  assert.equal(matchPickerOption("", ["Urgent"]), 1);
  assert.equal(matchPickerOption("   ", []), 1);
});

test("a match at the start ranks above one inside a word", () => {
  assert.equal(matchPickerOption("in", ["In progress"]), 1);
  assert.equal(matchPickerOption("prog", ["In progress"]), 0.8);
  assert.equal(matchPickerOption("gress", ["In progress"]), 0.5);
});

test("case and surrounding spaces don't matter", () => {
  assert.equal(matchPickerOption("  HIGH ", ["High"]), 1);
  assert.equal(matchPickerOption("dana", ["Dana Lee"]), 1);
});

test("any of the option's words can match", () => {
  assert.equal(matchPickerOption("lee", ["Dana Lee", "dana"]), 0.8);
  assert.equal(matchPickerOption("dlee", ["Dana Lee", "dlee"]), 1);
});

test("letters out of order or missing don't match", () => {
  assert.equal(matchPickerOption("hgih", ["High"]), 0);
  assert.equal(matchPickerOption("urgent!", ["Urgent"]), 0);
  assert.equal(matchPickerOption("x", []), 0);
});
