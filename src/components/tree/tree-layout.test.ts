import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTree,
  clampZoom,
  compareNode,
  DEFAULT_ZOOM_LIMITS,
  subtreeIds,
  treePageHref,
  treePageIdFromPath,
} from "./tree-layout";
import type { NestedNode, TreeNode } from "./types";

function node(id: string, parentId: string | null, sortOrder: number, createdAt = "2026-10-22T10:00:00.000Z"): TreeNode {
  return {
    id,
    pageId: "page",
    parentId,
    title: id,
    sortOrder,
    createdAt,
    updatedAt: createdAt,
    description: null,
    color: "blue",
    width: 240,
    height: 160,
  };
}

function shape(nodes: NestedNode[]): unknown[] {
  return nodes.map((item) => [item.id, item.depth, shape(item.children)]);
}

test("siblings sort by sortOrder, then by creation time", () => {
  assert.ok(compareNode(node("a", null, 0), node("b", null, 1)) < 0);
  assert.ok(compareNode(node("a", null, 1, "2026-10-22T11:00:00.000Z"), node("b", null, 1, "2026-10-22T10:00:00.000Z")) > 0);
});

test("buildTree nests children under their parents, in order, whatever the input order", () => {
  const nodes = [node("c2", "root", 1), node("g", "c1", 0), node("root", null, 0), node("c1", "root", 0)];
  assert.deepEqual(shape(buildTree(nodes)), [["root", 0, [["c1", 1, [["g", 2, []]]], ["c2", 1, []]]]]);
  assert.deepEqual(buildTree([]), []);
});

test("subtreeIds covers the node and every descendant, and nothing else", () => {
  const nodes = [node("root", null, 0), node("a", "root", 0), node("a1", "a", 0), node("a1x", "a1", 0), node("b", "root", 1)];
  assert.deepEqual([...subtreeIds(nodes, "a")].sort(), ["a", "a1", "a1x"]);
  assert.deepEqual([...subtreeIds(nodes, "b")], ["b"]);
});

test("clampZoom keeps the zoom inside the limits", () => {
  assert.equal(clampZoom(0.1, DEFAULT_ZOOM_LIMITS), 0.5);
  assert.equal(clampZoom(1.2, DEFAULT_ZOOM_LIMITS), 1.2);
  assert.equal(clampZoom(9, DEFAULT_ZOOM_LIMITS), 1.75);
});

test("tree page links round-trip through the path", () => {
  assert.equal(treePageHref("cmabc123"), "/tree/cmabc123");
  assert.equal(treePageIdFromPath("/tree/cmabc123"), "cmabc123");
  assert.equal(treePageIdFromPath("/tree/cmabc123/"), "cmabc123");
  assert.equal(treePageIdFromPath(treePageHref("a b")), "a b");
  assert.equal(treePageIdFromPath("/tree"), null);
  assert.equal(treePageIdFromPath("/tree/a/b"), null);
  assert.equal(treePageIdFromPath("/board"), null);
  assert.equal(treePageIdFromPath(null), null);
});
