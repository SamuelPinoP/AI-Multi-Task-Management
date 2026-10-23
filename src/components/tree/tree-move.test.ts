import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, currentIndex, dropZoneFor, isDescendant, moveFor, moveParentOptions, movePositions } from "./tree-move";

// root ─┬─ a ── a1 ── a1x
//       ├─ b
//       └─ c
function node(id: string, parentId: string | null, sortOrder: number) {
  return { id, parentId, sortOrder, createdAt: "2026-10-22T10:00:00.000Z" };
}
const nodes = [
  node("root", null, 0),
  node("a", "root", 0),
  node("b", "root", 1),
  node("c", "root", 2),
  node("a1", "a", 0),
  node("a1x", "a1", 0),
];
const order = (list: typeof nodes, parentId: string) =>
  list
    .filter((item) => item.parentId === parentId)
    .sort((x, y) => x.sortOrder - y.sortOrder)
    .map((item) => item.id);

test("drop zones: the left and right quarters are beside the card, the middle is under it", () => {
  const rect = { left: 100, width: 200 };
  assert.equal(dropZoneFor(110, rect), "before");
  assert.equal(dropZoneFor(149, rect), "before");
  assert.equal(dropZoneFor(150, rect), "child");
  assert.equal(dropZoneFor(250, rect), "child");
  assert.equal(dropZoneFor(251, rect), "after");
  assert.equal(dropZoneFor(299, rect), "after");
});

test("isDescendant covers the node itself and everything beneath it", () => {
  assert.equal(isDescendant(nodes, "a", "a"), true);
  assert.equal(isDescendant(nodes, "a", "a1x"), true);
  assert.equal(isDescendant(nodes, "a", "b"), false);
  assert.equal(isDescendant(nodes, "a1", "a"), false);
  assert.equal(isDescendant([node("x", "y", 0), node("y", "x", 0)], "z", "x"), false, "a loop in bad data ends");
});

test("moves into a card, before it and after it", () => {
  assert.deepEqual(moveFor(nodes, "c", "a", "child"), { nodeId: "c", parentId: "a", index: 1 });
  assert.deepEqual(moveFor(nodes, "c", "a", "before"), { nodeId: "c", parentId: "root", index: 0 });
  assert.deepEqual(moveFor(nodes, "a", "b", "after"), { nodeId: "a", parentId: "root", index: 1 });
  assert.deepEqual(moveFor(nodes, "a1x", "b", "after"), { nodeId: "a1x", parentId: "root", index: 2 });
});

test("a drop on the root makes a child, whatever the zone", () => {
  assert.deepEqual(moveFor(nodes, "a1", "root", "before"), { nodeId: "a1", parentId: "root", index: 3 });
});

test("refuses the root, the node itself, its own subtree, and moves that change nothing", () => {
  assert.equal(moveFor(nodes, "root", "a", "child"), null);
  assert.equal(moveFor(nodes, "a", "a", "child"), null);
  assert.equal(moveFor(nodes, "a", "a1x", "child"), null);
  assert.equal(moveFor(nodes, "a1", "a", "child"), null, "already a's last child");
  assert.equal(moveFor(nodes, "b", "a", "after"), null, "already right after a");
  assert.equal(moveFor(nodes, "b", "c", "before"), null, "already right before c");
  assert.equal(moveFor(nodes, "missing", "a", "child"), null);
});

test("applyMove re-parents the node and numbers its new siblings in order", () => {
  const moved = applyMove(nodes, { nodeId: "c", parentId: "root", index: 0 });
  assert.deepEqual(order(moved, "root"), ["c", "a", "b"]);
  assert.deepEqual(moved.filter((item) => item.parentId === "root").map((item) => item.sortOrder).sort(), [0, 1, 2]);

  const nested = applyMove(nodes, { nodeId: "b", parentId: "a1", index: 0 });
  assert.deepEqual(order(nested, "root"), ["a", "c"]);
  assert.deepEqual(order(nested, "a1"), ["b", "a1x"]);
  assert.equal(nested.find((item) => item.id === "a1x")?.parentId, "a1", "the rest stays put");
});

test("every move moveFor proposes, applied, puts the node where the drop said", () => {
  for (const [nodeId, targetId, zone] of [
    ["c", "a", "before"],
    ["a", "c", "after"],
    ["b", "a1", "child"],
    ["a1", "b", "before"],
  ] as const) {
    const move = moveFor(nodes, nodeId, targetId, zone)!;
    const after = applyMove(nodes, move);
    const siblings = order(after, move.parentId);
    const at = siblings.indexOf(nodeId);
    if (zone === "child") assert.equal(after.find((item) => item.id === nodeId)?.parentId, targetId);
    if (zone === "before") assert.equal(siblings[at + 1], targetId);
    if (zone === "after") assert.equal(siblings[at - 1], targetId);
  }
});

const titled = nodes.map((item) => ({ ...item, title: item.id.toUpperCase() }));

test("Move to… offers every node outside the moved node's own subtree, in tree order", () => {
  assert.deepEqual(
    moveParentOptions(titled, "a").map((option) => `${option.depth}:${option.id}`),
    ["0:root", "1:b", "1:c"],
  );
  assert.deepEqual(
    moveParentOptions(titled, "b").map((option) => `${option.depth}:${option.id}`),
    ["0:root", "1:a", "2:a1", "3:a1x", "1:c"],
  );
});

test("Move to… positions are first, then after each other child", () => {
  assert.deepEqual(movePositions(titled, "b", "root"), [
    { index: 0, label: "First" },
    { index: 1, label: "After “A”" },
    { index: 2, label: "After “C”" },
  ]);
  assert.deepEqual(movePositions(titled, "b", "a1x"), [{ index: 0, label: "First" }]);
  assert.equal(currentIndex(nodes, "b"), 1);
  assert.equal(currentIndex(nodes, "a1x"), 0);
  assert.equal(currentIndex(nodes, "root"), 0);
  assert.equal(moveFor(nodes, "b", "a", "after"), null, "staying at the current index is no move");
});
