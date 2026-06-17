"use client";

import {
  uiButtonClass,
  uiDangerButtonClass,
  uiPrimaryButtonClass,
} from "@/components/ui";
import { type DragEvent, useMemo, useState } from "react";

type TreeNode = {
  id: string;
  pageId: string;
  parentId: string | null;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
type TreePage = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: TreeNode[];
};
type NestedNode = TreeNode & { children: NestedNode[]; depth: number };

export function TreeBoard({ initialPages }: { initialPages: TreePage[] }) {
  const [pages, setPages] = useState(initialPages);
  const [activePageId, setActivePageId] = useState(initialPages[0]?.id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    nodeId: string;
    position: "inside" | "before" | "after";
  } | null>(null);
  const activePage =
    pages.find((page) => page.id === activePageId) ?? pages[0] ?? null;

  const tree = useMemo(() => buildTree(activePage?.nodes ?? []), [activePage]);

  async function request<T>(url: string, init: RequestInit): Promise<T> {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Tree action failed.");
      return data as T;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tree action failed.");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function createPage() {
    const title = window.prompt("Tree page title", "New Tree Page");
    if (!title?.trim()) return;
    const page = await request<TreePage>("/api/tree-pages", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    setPages((current) => [page, ...current]);
    setActivePageId(page.id);
  }
  async function renamePage() {
    if (!activePage) return;
    const title = window.prompt("Rename tree page", activePage.title);
    if (!title?.trim()) return;
    const page = await request<TreePage>(`/api/tree-pages/${activePage.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    setPages((current) =>
      current.map((item) => (item.id === page.id ? page : item)),
    );
  }
  async function deletePage() {
    if (
      !activePage ||
      !window.confirm(`Delete “${activePage.title}” and all of its nodes?`)
    )
      return;
    await request(`/api/tree-pages/${activePage.id}`, { method: "DELETE" });
    setPages((current) => current.filter((item) => item.id !== activePage.id));
    setActivePageId("");
  }
  async function addNode(parentId: string | null, fallback = "New node") {
    if (!activePage) return;
    const title = window.prompt("Node title", fallback);
    if (!title?.trim()) return;
    const node = await request<TreeNode>(
      `/api/tree-pages/${activePage.id}/nodes`,
      { method: "POST", body: JSON.stringify({ title, parentId }) },
    );
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? { ...page, nodes: [...page.nodes, node] }
          : page,
      ),
    );
  }
  async function patchNode(nodeId: string, body: Record<string, unknown>) {
    if (!activePage) return;
    const node = await request<TreeNode>(
      `/api/tree-pages/${activePage.id}/nodes/${nodeId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? {
              ...page,
              nodes: page.nodes.map((item) =>
                item.id === node.id ? node : item,
              ),
            }
          : page,
      ),
    );
  }
  async function moveNode(
    nodeId: string,
    targetId: string,
    position: "inside" | "before" | "after",
  ) {
    if (!activePage || nodeId === targetId) return;
    const draggedNode = activePage.nodes.find((item) => item.id === nodeId);
    const targetNode = activePage.nodes.find((item) => item.id === targetId);
    if (!draggedNode || !targetNode) return;
    if (
      position === "inside" &&
      isDescendant(activePage.nodes, targetId, nodeId)
    ) {
      setError("A node cannot be moved inside one of its own child nodes.");
      return;
    }
    const nextParentId = position === "inside" ? targetId : targetNode.parentId;
    if (
      nextParentId === nodeId ||
      (nextParentId && isDescendant(activePage.nodes, nextParentId, nodeId))
    ) {
      setError("A node cannot be moved inside itself.");
      return;
    }
    const siblings = activePage.nodes
      .filter((item) => item.id !== nodeId && item.parentId === nextParentId)
      .sort(compareNode);
    const targetIndex = siblings.findIndex((item) => item.id === targetId);
    const nextIndex =
      position === "inside"
        ? siblings.length
        : position === "before"
          ? Math.max(targetIndex, 0)
          : Math.max(targetIndex + 1, 0);
    const previousPages = pages;
    setError("");
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? {
              ...page,
              nodes: page.nodes
                .map((item) =>
                  item.id === nodeId
                    ? { ...item, parentId: nextParentId, sortOrder: nextIndex }
                    : item,
                )
                .map((item) =>
                  item.parentId === nextParentId
                    ? {
                        ...item,
                        sortOrder:
                          reindexedOrder(
                            page.nodes,
                            nodeId,
                            nextParentId,
                            nextIndex,
                          ).get(item.id) ?? item.sortOrder,
                      }
                    : item,
                ),
            }
          : page,
      ),
    );
    try {
      const movedNodes = await request<TreeNode[]>(
        `/api/tree-pages/${activePage.id}/nodes/${nodeId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            parentId: nextParentId,
            sortOrder: nextIndex,
          }),
        },
      );
      setPages((current) =>
        current.map((page) =>
          page.id === activePage.id
            ? {
                ...page,
                nodes: page.nodes.map(
                  (item) =>
                    movedNodes.find((node) => node.id === item.id) ?? item,
                ),
              }
            : page,
        ),
      );
    } catch {
      setPages(previousPages);
    }
  }
  async function deleteNode(node: TreeNode) {
    if (
      !activePage ||
      !window.confirm(`Delete “${node.title}” and its child nodes?`)
    )
      return;
    await request(`/api/tree-pages/${activePage.id}/nodes/${node.id}`, {
      method: "DELETE",
    });
    const remove = new Set([node.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of activePage.nodes)
        if (
          item.parentId &&
          remove.has(item.parentId) &&
          !remove.has(item.id)
        ) {
          remove.add(item.id);
          changed = true;
        }
    }
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? {
              ...page,
              nodes: page.nodes.filter((item) => !remove.has(item.id)),
            }
          : page,
      ),
    );
  }

  const content = (
    <>
      <TreePageSwitcher
        pages={pages}
        activePage={activePage}
        onSelect={setActivePageId}
        onCreate={createPage}
      />
      <div className="overflow-hidden rounded-[1.75rem] border border-zinc-200/80 bg-white/95 p-4 shadow-sm shadow-zinc-200/70 ring-1 ring-white/70 dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-none dark:ring-zinc-800/40 sm:p-5">
        {!activePage ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
            <h2 className="text-xl font-semibold">
              Create your first Tree View page
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Tree pages are private to your account and can hold editable
              parent, child, and sibling nodes.
            </p>
            <button
              onClick={() => void createPage()}
              className={`${uiPrimaryButtonClass} mt-4`}
            >
              Create tree page
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  Tree View
                </p>
                <h2 className="mt-1 truncate text-2xl font-bold tracking-tight">
                  {activePage.title}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Drag nodes onto each other to nest them, or drop between
                  siblings to reorder.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setIsFullScreen((current) => !current)}
                  className={uiButtonClass}
                >
                  {isFullScreen ? "Exit full screen" : "Full screen"}
                </button>
                <button
                  onClick={() => void renamePage()}
                  className={`${uiButtonClass} px-3 text-xs`}
                >
                  Rename page
                </button>
                <button
                  onClick={() => void addNode(null, activePage.title)}
                  className={uiPrimaryButtonClass}
                >
                  Add root node
                </button>
                <button
                  onClick={() => void deletePage()}
                  className={`${uiDangerButtonClass} px-3 text-xs`}
                >
                  Delete
                </button>
              </div>
            </div>
            {error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </p>
            )}
            {loading && (
              <p className="mt-4 text-sm text-zinc-500">Saving tree changes…</p>
            )}
            <div className="mt-6 space-y-3">
              {tree.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/40">
                  This page has no nodes. Add a root node to begin.
                </p>
              ) : (
                tree.map((node) => (
                  <TreeNodeRow
                    key={node.id}
                    node={node}
                    draggedNodeId={draggedNodeId}
                    dropTarget={dropTarget}
                    onDragStart={setDraggedNodeId}
                    onDragEnd={() => {
                      setDraggedNodeId(null);
                      setDropTarget(null);
                    }}
                    onDropIntent={(nodeId, position) =>
                      setDropTarget({ nodeId, position })
                    }
                    onMove={(targetId, position) =>
                      draggedNodeId
                        ? moveNode(draggedNodeId, targetId, position)
                        : Promise.resolve()
                    }
                    onAddChild={addNode}
                    onAddSibling={(item) =>
                      addNode(item.parentId, "Sibling node")
                    }
                    onRename={(item, title) => patchNode(item.id, { title })}
                    onDelete={deleteNode}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );

  if (isFullScreen) {
    return (
      <section className="fixed inset-0 z-50 overflow-y-auto bg-zinc-50 p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-4">{content}</div>
      </section>
    );
  }

  return <section className="space-y-4">{content}</section>;
}

function TreePageSwitcher({
  pages,
  activePage,
  onSelect,
  onCreate,
}: {
  pages: TreePage[];
  activePage: TreePage | null;
  onSelect: (id: string) => void;
  onCreate: () => Promise<void>;
}) {
  return (
    <div className="rounded-[1.5rem] border border-zinc-200/80 bg-white/85 p-3 shadow-sm shadow-zinc-200/60 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/75 dark:shadow-none">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:overflow-x-auto sm:pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => void onCreate()}
          className={`${uiPrimaryButtonClass} shrink-0 shadow-sm`}
        >
          New Tree Page
        </button>
        {pages.map((page) => (
          <button
            key={page.id}
            onClick={() => onSelect(page.id)}
            title={page.title}
            className={`max-w-full shrink-0 truncate rounded-full border px-4 py-2 text-sm font-semibold transition sm:max-w-56 ${activePage?.id === page.id ? "border-zinc-950 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-200 bg-white/90 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-900"}`}
          >
            {page.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function TreeNodeRow({
  node,
  draggedNodeId,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDropIntent,
  onMove,
  onAddChild,
  onAddSibling,
  onRename,
  onDelete,
}: {
  node: NestedNode;
  draggedNodeId: string | null;
  dropTarget: {
    nodeId: string;
    position: "inside" | "before" | "after";
  } | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropIntent: (
    nodeId: string,
    position: "inside" | "before" | "after",
  ) => void;
  onMove: (
    targetId: string,
    position: "inside" | "before" | "after",
  ) => Promise<void>;
  onAddChild: (parentId: string | null, fallback?: string) => Promise<void>;
  onAddSibling: (node: TreeNode) => Promise<void>;
  onRename: (node: TreeNode, title: string) => Promise<void>;
  onDelete: (node: TreeNode) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const isDragging = draggedNodeId === node.id;
  const dropPosition =
    dropTarget?.nodeId === node.id ? dropTarget.position : null;
  async function save() {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== node.title) await onRename(node, title);
    else setDraft(node.title);
  }
  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!draggedNodeId || draggedNodeId === node.id) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const position =
      offset < rect.height * 0.25
        ? "before"
        : offset > rect.height * 0.75
          ? "after"
          : "inside";
    onDropIntent(node.id, position);
  }
  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (draggedNodeId && draggedNodeId !== node.id)
      void onMove(node.id, dropPosition ?? "inside");
    onDragEnd();
  }
  return (
    <div
      className={`relative pl-4 transition-opacity sm:pl-6 ${isDragging ? "opacity-45" : ""}`}
    >
      <div
        className="absolute left-1 top-0 h-full w-px bg-zinc-200 dark:bg-zinc-800"
        aria-hidden="true"
      />
      {dropPosition === "before" && (
        <div className="mb-2 h-1 rounded-full bg-blue-500 shadow-sm shadow-blue-500/40" />
      )}
      <article
        draggable={!editing}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
          onDragStart(node.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`relative rounded-2xl border bg-gradient-to-br p-4 shadow-sm transition ${dropPosition === "inside" ? "border-blue-400 from-blue-50 to-white ring-2 ring-blue-200 dark:border-blue-500 dark:from-blue-950/40 dark:to-zinc-950 dark:ring-blue-900/60" : "border-zinc-200 from-white to-zinc-50 hover:border-zinc-300 dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-950 dark:hover:border-zinc-700"}`}
      >
        <span
          className="absolute -left-3 top-7 h-px w-3 bg-zinc-200 dark:bg-zinc-800"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="cursor-grab rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                title="Drag to move"
              >
                ⋮⋮
              </span>
              {editing ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => void save()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void save();
                    if (event.key === "Escape") {
                      setDraft(node.title);
                      setEditing(false);
                    }
                  }}
                  className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-lg font-semibold outline-none ring-zinc-900 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:ring-zinc-100"
                />
              ) : (
                <button
                  onDoubleClick={() => setEditing(true)}
                  className="block max-w-full truncate text-left text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
                  title="Double-click to edit"
                >
                  {node.title}
                </button>
              )}
            </div>{" "}
            {node.children.length > 0 && (
              <p className="mt-1 pl-11 text-xs text-zinc-500">
                {node.children.length} child
                {node.children.length === 1 ? "" : "ren"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={`${uiButtonClass} px-2.5 py-1.5 text-xs`}
              onClick={() => void onAddChild(node.id, "Child node")}
            >
              Add child
            </button>
            <button
              className={`${uiButtonClass} px-2.5 py-1.5 text-xs`}
              onClick={() => void onAddSibling(node)}
            >
              Add sibling
            </button>
            <button
              className={`${uiDangerButtonClass} px-2.5 py-1.5 text-xs`}
              onClick={() => void onDelete(node)}
            >
              Delete
            </button>
          </div>
        </div>
      </article>
      {dropPosition === "after" && (
        <div className="mt-2 h-1 rounded-full bg-blue-500 shadow-sm shadow-blue-500/40" />
      )}
      {node.children.length > 0 && (
        <div className="mt-3 space-y-3">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              draggedNodeId={draggedNodeId}
              dropTarget={dropTarget}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropIntent={onDropIntent}
              onMove={onMove}
              onAddChild={onAddChild}
              onAddSibling={onAddSibling}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
function compareNode(a: TreeNode, b: TreeNode) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}
function buildTree(nodes: TreeNode[]) {
  const byParent = new Map<string, TreeNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? "root";
    byParent.set(key, [...(byParent.get(key) ?? []), node]);
  }
  for (const siblings of byParent.values()) siblings.sort(compareNode);
  const visit = (parentId: string | null, depth: number): NestedNode[] =>
    (byParent.get(parentId ?? "root") ?? []).map((node) => ({
      ...node,
      depth,
      children: visit(node.id, depth + 1),
    }));
  return visit(null, 0);
}

function isDescendant(
  nodes: TreeNode[],
  nodeId: string,
  possibleAncestorId: string,
) {
  let current = nodes.find((item) => item.id === nodeId)?.parentId ?? null;
  while (current) {
    if (current === possibleAncestorId) return true;
    current = nodes.find((item) => item.id === current)?.parentId ?? null;
  }
  return false;
}
function reindexedOrder(
  nodes: TreeNode[],
  nodeId: string,
  parentId: string | null,
  index: number,
) {
  const ordered = nodes
    .filter((item) => item.id !== nodeId && item.parentId === parentId)
    .sort(compareNode);
  const dragged = nodes.find((item) => item.id === nodeId);
  if (dragged)
    ordered.splice(Math.min(Math.max(index, 0), ordered.length), 0, {
      ...dragged,
      parentId,
    });
  return new Map(ordered.map((item, order) => [item.id, order]));
}
