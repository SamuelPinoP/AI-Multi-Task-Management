import assert from "node:assert/strict";
import test from "node:test";
import { createActivityTracker, IDLE_AFTER_MS, MIN_RETURN_GAP_MS, RETURN_AFTER_MS } from "./page-activity-core";

function fakeClock() {
  let time = 1_000_000;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

test("activity right after the page loads isn't a return", () => {
  const clock = fakeClock();
  const tracker = createActivityTracker(clock.now);
  clock.advance(1_000);
  assert.equal(tracker.activity(), false);
  assert.equal(tracker.returned(), false);
});

test("the first activity after half a minute away is a return, once", () => {
  const clock = fakeClock();
  const tracker = createActivityTracker(clock.now);
  clock.advance(RETURN_AFTER_MS);
  assert.equal(tracker.activity(), true);
  clock.advance(500);
  assert.equal(tracker.activity(), false);
});

test("steady use never counts as coming back", () => {
  const clock = fakeClock();
  const tracker = createActivityTracker(clock.now);
  for (let step = 0; step < 100; step += 1) {
    clock.advance(RETURN_AFTER_MS - 1);
    assert.equal(tracker.activity(), false, `step ${step}`);
  }
});

test("focus and the click that gave it make one return", () => {
  const clock = fakeClock();
  const tracker = createActivityTracker(clock.now);
  clock.advance(RETURN_AFTER_MS);
  assert.equal(tracker.returned(), true);
  assert.equal(tracker.activity(), false);
  clock.advance(MIN_RETURN_GAP_MS - 1);
  assert.equal(tracker.returned(), false);
  clock.advance(1);
  assert.equal(tracker.returned(), true);
});

test("idle after ten minutes without activity, and active again on the next", () => {
  const clock = fakeClock();
  const tracker = createActivityTracker(clock.now);
  clock.advance(IDLE_AFTER_MS - 1);
  assert.equal(tracker.isIdle(), false);
  clock.advance(1);
  assert.equal(tracker.isIdle(), true);
  assert.equal(tracker.activity(), true);
  assert.equal(tracker.isIdle(), false);
});
