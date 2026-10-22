// Pure helpers for the tree view: ordering, nesting, deletes, zoom and its routes.
import type { NestedNode, TreeNode } from "./types";

export const DEFAULT_ZOOM_LIMITS = { min: 0.5, max: 1.75 } as const;
export const FULL_SCREEN_ZOOM_LIMITS = { min: 0, max: 3.25 } as const;

type NodeOrder = Pick<TreeNode, "sortOrder" | "createdAt">;

export function compareNode(a: NodeOrder, b: NodeOrder) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/** Nests a page's flat node list under its roots, each level sorted by compareNode. */
export function buildTree(nodes: TreeNode[]) {
  // Keyed by parentId, with null for the roots, so no node id can collide with the root key.
  const byParent = new Map<string | null, TreeNode[]>();
  for (const node of nodes) {
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  }
  for (const siblings of byParent.values()) siblings.sort(compareNode);
  const visit = (parentId: string | null, depth: number): NestedNode[] =>
    (byParent.get(parentId) ?? []).map((node) => ({
      ...node,
      depth,
      children: visit(node.id, depth + 1),
    }));
  return visit(null, 0);
}

/** The ids a delete removes: the node and everything beneath it. */
export function subtreeIds(nodes: Pick<TreeNode, "id" | "parentId">[], nodeId: string) {
  const remove = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of nodes)
      if (item.parentId && remove.has(item.parentId) && !remove.has(item.id)) {
        remove.add(item.id);
        changed = true;
      }
  }
  return remove;
}

export function clampZoom(value: number, limits: { min: number; max: number }) {
  return Math.min(Math.max(value, limits.min), limits.max);
}

export const TREE_PATH = "/tree";

export function treePageHref(pageId: string) {
  return `${TREE_PATH}/${encodeURIComponent(pageId)}`;
}

/** The page id in /tree/<id>, or null on /tree itself and anywhere else. */
export function treePageIdFromPath(pathname: string | null) {
  const match = pathname?.match(/^\/tree\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}
