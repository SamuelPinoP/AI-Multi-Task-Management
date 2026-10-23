// Pure helpers for moving nodes by drag and drop (TREE-02). The server does the same
// move in PATCH /api/tree-pages/[pageId]/nodes/[nodeId] and refuses the same cycles.
import { compareNode } from "./tree-layout";
import type { TreeNode } from "./types";

/** Where a drop lands on a card: beside it (siblings sit left to right) or under it. */
export type DropZone = "before" | "after" | "child";

/** The card and zone a drag is over, when dropping there is allowed. */
export type DropTarget = { nodeId: string; zone: DropZone };

/** A move as the API takes it: the new parent and the index among its other children. */
export type TreeMove = { nodeId: string; parentId: string; index: number };

type Node = Pick<TreeNode, "id" | "parentId" | "sortOrder" | "createdAt">;

/** The left quarter of a card means "before", the right quarter "after", the middle "child". */
export function dropZoneFor(pointerX: number, rect: { left: number; width: number }): DropZone {
  const edge = rect.width / 4;
  if (pointerX < rect.left + edge) return "before";
  if (pointerX > rect.left + rect.width - edge) return "after";
  return "child";
}

/** True when nodeId is ancestorId itself or sits anywhere beneath it. */
export function isDescendant(nodes: Pick<Node, "id" | "parentId">[], ancestorId: string, nodeId: string) {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  const seen = new Set<string>();
  let current: string | null | undefined = nodeId;
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parents.get(current);
  }
  return false;
}

function childrenOf(nodes: Node[], parentId: string, without: string) {
  return nodes.filter((node) => node.parentId === parentId && node.id !== without).sort(compareNode);
}

/**
 * The move a drop on targetId's zone asks for, or null when it isn't allowed (the root,
 * a drop on the node itself or its own subtree) or wouldn't change anything.
 */
export function moveFor(nodes: Node[], nodeId: string, targetId: string, zone: DropZone): TreeMove | null {
  const node = nodes.find((item) => item.id === nodeId);
  const target = nodes.find((item) => item.id === targetId);
  if (!node || !target || node.parentId === null) return null;
  if (isDescendant(nodes, nodeId, targetId)) return null;

  // The root has no siblings, so anything dropped on it becomes its child.
  const asChild = zone === "child" || target.parentId === null;
  const parentId = asChild ? target.id : target.parentId!;
  const others = childrenOf(nodes, parentId, nodeId);
  const index = asChild ? others.length : others.findIndex((item) => item.id === target.id) + (zone === "after" ? 1 : 0);

  if (node.parentId === parentId) {
    const current = childrenOf(nodes, parentId, "").findIndex((item) => item.id === nodeId);
    if (current === index) return null;
  }
  return { nodeId, parentId, index };
}

/** For "Move to…" (TREE-03): every node outside nodeId's own subtree, in tree order with its depth. */
export function moveParentOptions<T extends Node & { title: string }>(nodes: T[], nodeId: string) {
  const options: { id: string; title: string; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const node of nodes.filter((item) => item.parentId === parentId).sort(compareNode)) {
      if (node.id === nodeId) continue;
      options.push({ id: node.id, title: node.title, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return options;
}

/** The places under parentId the node can take: first, or after each of its other children. */
export function movePositions<T extends Node & { title: string }>(nodes: T[], nodeId: string, parentId: string) {
  const others = childrenOf(nodes, parentId, nodeId) as T[];
  return [
    { index: 0, label: "First" },
    ...others.map((child, i) => ({ index: i + 1, label: `After “${child.title}”` })),
  ];
}

/** Where the node sits now among its siblings, as a move index. */
export function currentIndex(nodes: Node[], nodeId: string) {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node?.parentId) return 0;
  return childrenOf(nodes, node.parentId, "").findIndex((item) => item.id === nodeId);
}

/** The node list after a move, numbering the new siblings 0, 1, 2… as the server does. */
export function applyMove<T extends Node>(nodes: T[], move: TreeMove): T[] {
  const node = nodes.find((item) => item.id === move.nodeId);
  if (!node) return nodes;
  const others = nodes.filter((item) => item.parentId === move.parentId && item.id !== move.nodeId).sort(compareNode);
  const index = Math.min(Math.max(move.index, 0), others.length);
  const ordered = [...others.slice(0, index), { ...node, parentId: move.parentId }, ...others.slice(index)];
  const placed = new Map(ordered.map((item, sortOrder) => [item.id, { ...item, sortOrder }]));
  return nodes.map((item) => placed.get(item.id) ?? item);
}
