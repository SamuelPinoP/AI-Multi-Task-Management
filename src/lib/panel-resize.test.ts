import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_LIST_LIMITS, clampWidth, dragTo, keyTo, parseWidth, roundRem, shownWidth, SIDEBAR_LIMITS, snapPoint, type PanelLimits } from "./panel-resize";

const limits: PanelLimits = { min: 11, max: 22.5, initial: 14, collapsed: 3.5 };

test("the sidebar opens at 224 px and goes from 176 to 360 px, or a 56 px rail", () => {
  assert.deepEqual(
    [SIDEBAR_LIMITS.initial, SIDEBAR_LIMITS.min, SIDEBAR_LIMITS.max, SIDEBAR_LIMITS.collapsed].map((rem) => rem * 16),
    [224, 176, 360, 56],
  );
});

test("the Chats list opens at 310 px and goes from 240 to 480 px, or a 72 px column of photos", () => {
  assert.deepEqual(
    [CHAT_LIST_LIMITS.initial, CHAT_LIST_LIMITS.min, CHAT_LIST_LIMITS.max, CHAT_LIST_LIMITS.collapsed].map((rem) => rem * 16),
    [310, 240, 480, 72],
  );
  // It snaps to the photos halfway between the column and its narrowest width.
  assert.equal(snapPoint(CHAT_LIST_LIMITS) * 16, 156);
});

test("widths round to a pixel and stay between the narrowest and the widest", () => {
  assert.equal(roundRem(14.04), 14.0625);
  assert.equal(clampWidth(5, limits), 11);
  assert.equal(clampWidth(40, limits), 22.5);
  assert.equal(clampWidth(15.51, limits), 15.5);
});

test("dragging follows the pointer, holds at the narrowest, then snaps to the collapsed width", () => {
  assert.equal(snapPoint(limits), 7.25);
  assert.deepEqual(dragTo(18, limits, 14), { width: 18, collapsed: false });
  assert.deepEqual(dragTo(30, limits, 14), { width: 22.5, collapsed: false });
  // Between the snap point and the narrowest width it holds at the narrowest.
  assert.deepEqual(dragTo(9, limits, 14), { width: 11, collapsed: false });
  // Past the snap point it collapses and keeps the width it started from, for when it opens again.
  assert.deepEqual(dragTo(7, limits, 14), { width: 14, collapsed: true });
  assert.deepEqual(dragTo(-3, limits, 16), { width: 16, collapsed: true });
});

test("the keys step, collapse at the narrowest and open again", () => {
  const open = { width: 14, collapsed: false };
  assert.deepEqual(keyTo("ArrowLeft", open, limits), { width: 13, collapsed: false });
  assert.deepEqual(keyTo("ArrowRight", open, limits), { width: 15, collapsed: false });
  assert.deepEqual(keyTo("ArrowRight", { width: 22.5, collapsed: false }, limits), { width: 22.5, collapsed: false });
  assert.deepEqual(keyTo("ArrowLeft", { width: 11, collapsed: false }, limits), { width: 11, collapsed: true });
  assert.equal(keyTo("ArrowLeft", { width: 14, collapsed: true }, limits), null);
  assert.deepEqual(keyTo("ArrowRight", { width: 14, collapsed: true }, limits), { width: 11, collapsed: false });
  assert.deepEqual(keyTo("Home", open, limits), { width: 14, collapsed: true });
  assert.deepEqual(keyTo("End", open, limits), { width: 22.5, collapsed: false });
  assert.deepEqual(keyTo("Enter", open, limits), { width: 14, collapsed: true });
  assert.deepEqual(keyTo("Enter", { width: 14, collapsed: true }, limits), { width: 14, collapsed: false });
  assert.equal(keyTo("a", open, limits), null);
});

test("a width cookie is read back within the limits, and anything else opens at the default", () => {
  assert.equal(parseWidth("16.5", limits), 16.5);
  assert.equal(parseWidth("100", limits), 22.5);
  assert.equal(parseWidth("2", limits), 11);
  assert.equal(parseWidth(undefined, limits), 14);
  assert.equal(parseWidth("", limits), 14);
  assert.equal(parseWidth("wide", limits), 14);
  assert.equal(parseWidth("Infinity", limits), 14);
});

test("a collapsed panel shows its collapsed width and keeps its open one", () => {
  assert.equal(shownWidth({ width: 16, collapsed: true }, limits), 3.5);
  assert.equal(shownWidth({ width: 16, collapsed: false }, limits), 16);
});
