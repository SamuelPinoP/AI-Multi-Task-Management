import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_SIZE, CHAT_SIZE_STEP, clampChatSize, dragChatSize, keyChatSize, parseChatSize } from "./chat-size";

const px = (rem: number) => rem * 16;

test("the open chat starts at 760 × 560 px, and resizes from 600 to 960 wide and 400 to 720 tall", () => {
  assert.deepEqual([px(CHAT_SIZE.initial.width), px(CHAT_SIZE.initial.height)], [760, 560]);
  assert.deepEqual([px(CHAT_SIZE.minWidth), px(CHAT_SIZE.maxWidth)], [600, 960]);
  assert.deepEqual([px(CHAT_SIZE.minHeight), px(CHAT_SIZE.maxHeight)], [400, 720]);
  assert.equal(px(CHAT_SIZE_STEP), 24);
});

test("sizes stay within the limits and round to a pixel", () => {
  assert.deepEqual(clampChatSize({ width: 10, height: 100 }), { width: 37.5, height: 45 });
  assert.deepEqual(clampChatSize({ width: 99, height: 1 }), { width: 60, height: 25 });
  assert.deepEqual(clampChatSize({ width: 50.04, height: 30.51 }), { width: 50.0625, height: 30.5 });
});

test("the top edge changes only the height: up makes it taller", () => {
  const start = { width: 47.5, height: 35 };
  assert.deepEqual(dragChatSize("top", start, 7, -5), { width: 47.5, height: 40 });
  assert.deepEqual(dragChatSize("top", start, 0, 4), { width: 47.5, height: 31 });
  assert.deepEqual(dragChatSize("top", start, 0, -100), { width: 47.5, height: 45 });
});

test("a top corner changes the width by twice its move, since the chat stays centered", () => {
  const start = { width: 47.5, height: 35 };
  // The left corner dragged 2 rem to the left: 4 rem wider. Up 1 rem: 1 rem taller.
  assert.deepEqual(dragChatSize("top-left", start, -2, -1), { width: 51.5, height: 36 });
  assert.deepEqual(dragChatSize("top-left", start, 3, 0), { width: 41.5, height: 35 });
  assert.deepEqual(dragChatSize("top-right", start, 2, 0), { width: 51.5, height: 35 });
  assert.deepEqual(dragChatSize("top-right", start, -20, 20), { width: 37.5, height: 25 });
});

test("the top edge's keys step the height, go to either end, and Enter brings back the start size", () => {
  const size = { width: 52, height: 35 };
  assert.deepEqual(keyChatSize("ArrowUp", size), { width: 52, height: 36.5 });
  assert.deepEqual(keyChatSize("ArrowDown", size), { width: 52, height: 33.5 });
  assert.deepEqual(keyChatSize("ArrowDown", { width: 52, height: 25 }), { width: 52, height: 25 });
  assert.deepEqual(keyChatSize("Home", size), { width: 52, height: 25 });
  assert.deepEqual(keyChatSize("End", size), { width: 52, height: 45 });
  assert.deepEqual(keyChatSize("Enter", size), { width: 47.5, height: 35 });
  assert.equal(keyChatSize("a", size), null);
});

test("a saved size is read back within the limits, and anything else opens at the start size", () => {
  assert.deepEqual(parseChatSize('{"width":55,"height":40}'), { width: 55, height: 40 });
  assert.deepEqual(parseChatSize('{"width":500,"height":-3}'), { width: 60, height: 25 });
  for (const saved of [null, undefined, "", "big", "null", "[]", '{"width":"55","height":40}', '{"width":55}']) {
    assert.deepEqual(parseChatSize(saved), { width: 47.5, height: 35 }, String(saved));
  }
});
