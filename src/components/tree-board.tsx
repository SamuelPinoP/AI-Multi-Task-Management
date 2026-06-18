"use client";

import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
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
  async function renamePage(pageId: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const page = await request<TreePage>(`/api/tree-pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: nextTitle }),
    });
    setPages((current) =>
      current.map((item) => (item.id === page.id ? page : item)),
    );
  }
  async function addNode(
    parentId: string | null,
    fallback = "New node",
    sortOrder?: number,
  ) {
    if (!activePage) return;
    const title = window.prompt("Node title", fallback);
    if (!title?.trim()) return;
    const node = await request<TreeNode>(
      `/api/tree-pages/${activePage.id}/nodes`,
      { method: "POST", body: JSON.stringify({ title, parentId, sortOrder }) },
    );
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? { ...page, nodes: [...page.nodes, node].sort(compareNode) }
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
    if (nextParentId === null && draggedNode.parentId !== null) {
      setError(
        "Nodes can be reordered within the tree, but only the page title can be the root node.",
      );
      return;
    }
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
    if (!activePage) return;
    if (node.parentId === null) {
      setError(
        "The root node stays linked to the Tree Page title and cannot be deleted.",
      );
      return;
    }
    const hasChildren = activePage.nodes.some(
      (item) => item.parentId === node.id,
    );
    const hasSiblings = activePage.nodes.some(
      (item) => item.id !== node.id && item.parentId === node.parentId,
    );
    const message = hasChildren
      ? "This node has children. Deleting it will also remove its child nodes. Do you want to continue?"
      : hasSiblings
        ? "This node has sibling nodes. Do you want to delete it?"
        : null;
    if (message && !window.confirm(message)) return;
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
        onRename={renamePage}
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
            <div className="flex justify-end border-b border-zinc-200 pb-4 dark:border-zinc-800">
              {!isFullScreen && (
                <button
                  onClick={() => setIsFullScreen(true)}
                  className={uiButtonClass}
                >
                  Full screen
                </button>
              )}
            </div>
            {error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </p>
            )}
            {loading && (
              <p className="mt-4 text-sm text-zinc-500">Saving tree changes…</p>
            )}
            <div className="mt-6 overflow-x-auto overflow-y-visible rounded-[1.35rem] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_32%),linear-gradient(rgba(148,163,184,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.10)_1px,transparent_1px)] bg-[length:auto,32px_32px,32px_32px] p-4 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_34%),linear-gradient(rgba(71,85,105,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(71,85,105,0.22)_1px,transparent_1px)] sm:p-6">
              {tree.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/40">
                  This page is preparing its root node.
                </p>
              ) : (
                <div className="inline-flex min-w-full justify-center pb-4">
                  <div className="flex min-w-max items-start justify-center gap-8">
                    {tree.map((node) => (
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
                        onAddSibling={(item, position) =>
                          addNode(
                            item.parentId,
                            "Sibling node",
                            item.sortOrder + (position === "after" ? 1 : 0),
                          )
                        }
                        onRename={(item, title) =>
                          patchNode(item.id, { title })
                        }
                        onDelete={deleteNode}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );

  if (isFullScreen) {
    return (
      <section className="fixed inset-0 z-50 overflow-y-auto bg-zinc-50 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_38%)] p-4 text-zinc-900 dark:bg-zinc-950 dark:bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.18),transparent_42%)] dark:text-zinc-100 sm:p-6">
        <button
          type="button"
          aria-label="Exit full screen"
          onClick={() => setIsFullScreen(false)}
          className="fixed right-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 text-lg font-bold leading-none text-white shadow-lg shadow-red-950/20 ring-1 ring-red-500/40 transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-300 dark:bg-red-500 dark:hover:bg-red-400"
        >
          ×
        </button>
        <div className="mx-auto max-w-7xl space-y-4 pr-10">{content}</div>
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
  onRename,
}: {
  pages: TreePage[];
  activePage: TreePage | null;
  onSelect: (id: string) => void;
  onCreate: () => Promise<void>;
  onRename: (pageId: string, title: string) => Promise<void>;
}) {
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function beginEdit(page: TreePage) {
    setEditingPageId(page.id);
    setDraft(page.title);
  }

  async function save(page: TreePage) {
    const title = draft.trim();
    setEditingPageId(null);
    if (title && title !== page.title) await onRename(page.id, title);
    else setDraft(page.title);
  }

  return (
    <div className="rounded-[1.5rem] border border-zinc-200/80 bg-white/85 p-3 shadow-sm shadow-zinc-200/60 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/75 dark:shadow-none">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:overflow-x-auto sm:pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => void onCreate()}
          className={`${uiPrimaryButtonClass} shrink-0 shadow-sm`}
        >
          New Tree Page
        </button>
        {pages.map((page) => {
          const selected = activePage?.id === page.id;
          const pillClass = `max-w-full shrink-0 truncate rounded-full border px-4 py-2 text-sm font-semibold transition sm:max-w-56 ${selected ? "border-zinc-950 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-200 bg-white/90 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-900"}`;
          return editingPageId === page.id ? (
            <input
              key={page.id}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void save(page)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save(page);
                if (event.key === "Escape") {
                  setDraft(page.title);
                  setEditingPageId(null);
                }
              }}
              className={`${pillClass} outline-none ring-2 ring-blue-300 dark:ring-blue-700`}
            />
          ) : (
            <button
              key={page.id}
              onClick={() => onSelect(page.id)}
              onDoubleClick={() => beginEdit(page)}
              title="Click to switch. Double-click to rename."
              className={pillClass}
            >
              {page.title}
            </button>
          );
        })}
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
  onAddChild: (
    parentId: string | null,
    fallback?: string,
    sortOrder?: number,
  ) => Promise<void>;
  onAddSibling: (node: TreeNode, position: "before" | "after") => Promise<void>;
  onRename: (node: TreeNode, title: string) => Promise<void>;
  onDelete: (node: TreeNode) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const isDragging = draggedNodeId === node.id;
  const isRoot = node.parentId === null;
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

  const cardTone = isRoot
    ? "border-blue-300/80 bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-900 text-white shadow-blue-950/20 ring-blue-200/70 dark:border-blue-400/60 dark:from-blue-500 dark:via-indigo-500 dark:to-slate-800 dark:ring-blue-300/20"
    : "border-slate-200/90 bg-white/95 text-slate-950 shadow-slate-200/80 ring-white/80 hover:border-blue-200 hover:shadow-blue-100/80 dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-50 dark:shadow-none dark:ring-slate-700/40 dark:hover:border-blue-500/50";
  const accentTone = isRoot
    ? "bg-white/80"
    : "bg-gradient-to-b from-blue-500 to-indigo-500";

  return (
    <div
      className={`relative flex shrink-0 flex-col items-center ${isDragging ? "opacity-45" : ""}`}
    >
      {dropPosition === "before" && (
        <div className="mb-3 h-1 w-48 rounded-full bg-blue-500 shadow-sm shadow-blue-500/40" />
      )}
      <article
        draggable={!editing && !isRoot}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
          onDragStart(node.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`group relative flex min-h-28 w-56 flex-col overflow-hidden rounded-[1.35rem] border p-4 shadow-lg ring-1 transition duration-200 sm:w-60 ${cardTone} ${dropPosition === "inside" ? "scale-[1.02] border-blue-400 ring-4 ring-blue-300/45 dark:ring-blue-500/30" : ""}`}
      >
        <span
          className={`absolute inset-x-0 top-0 h-1.5 ${accentTone}`}
          aria-hidden="true"
        />
        <div className="flex items-start justify-between gap-3">
          <span
            className={`mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border text-xs shadow-sm ${isRoot ? "cursor-default border-white/25 bg-white/15 text-white/85" : "cursor-grab border-slate-200 bg-slate-50 text-slate-400 group-hover:text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"}`}
            title={isRoot ? "Root node" : "Drag to move"}
          >
            ⋮⋮
          </span>
          <div className="min-w-0 flex-1 text-center">
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
                className="w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-center text-base font-semibold text-slate-950 outline-none ring-blue-300 focus:ring-2 dark:border-blue-800 dark:bg-slate-950 dark:text-slate-50 dark:ring-blue-700"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(node.title);
                  setEditing(true);
                }}
                className={`line-clamp-2 min-h-12 w-full rounded-xl px-2 py-1 text-center text-base font-bold leading-snug tracking-tight transition focus:outline-none focus:ring-2 ${isRoot ? "text-white hover:bg-white/10 focus:ring-white/40" : "text-slate-950 hover:bg-slate-100 focus:ring-blue-200 dark:text-slate-50 dark:hover:bg-slate-800 dark:focus:ring-blue-900"}`}
                title="Click to edit"
              >
                {node.title}
              </button>
            )}
          </div>
          <span
            className={`mt-1 h-7 min-w-7 rounded-xl px-2 text-center text-xs font-bold leading-7 ${isRoot ? "bg-white/15 text-white/90" : "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"}`}
          >
            {node.children.length}
          </span>
        </div>
        <div className="mt-auto flex justify-center gap-1.5 pt-4 opacity-90 transition group-hover:opacity-100 focus-within:opacity-100">
          {!isRoot && (
            <button
              type="button"
              className={iconButtonClass}
              title="Add sibling before"
              aria-label="Add sibling before"
              onClick={() => void onAddSibling(node, "before")}
            >
              ←
            </button>
          )}
          <button
            type="button"
            className={iconButtonClass}
            title="Add child"
            aria-label="Add child"
            onClick={() => void onAddChild(node.id, "Child node")}
          >
            +
          </button>
          {!isRoot && (
            <button
              type="button"
              className={iconButtonClass}
              title="Add sibling after"
              aria-label="Add sibling after"
              onClick={() => void onAddSibling(node, "after")}
            >
              →
            </button>
          )}
          <button
            type="button"
            className={`${iconButtonClass} text-red-600 hover:border-red-200 hover:bg-red-50 dark:text-red-300 dark:hover:border-red-900/70 dark:hover:bg-red-950/30`}
            title={isRoot ? "Root node cannot be deleted" : "Delete node"}
            aria-label="Delete node"
            onClick={() => void onDelete(node)}
          >
            −
          </button>
        </div>
      </article>
      {dropPosition === "after" && (
        <div className="mt-3 h-1 w-48 rounded-full bg-blue-500 shadow-sm shadow-blue-500/40" />
      )}
      {node.children.length > 0 && (
        <div className="relative mt-12 flex items-start justify-center gap-6 pt-6 sm:gap-8">
          <span
            className="absolute -top-12 left-1/2 h-12 w-px -translate-x-1/2 bg-slate-300 dark:bg-slate-700"
            aria-hidden="true"
          />
          <span
            className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-slate-300 dark:border-slate-700"
            aria-hidden="true"
          />
          {node.children.length > 1 && (
            <span
              className="absolute left-[calc(7.5rem)] right-[calc(7.5rem)] top-0 h-px bg-slate-300 dark:bg-slate-700"
              aria-hidden="true"
            />
          )}
          {node.children.map((child) => (
            <div key={child.id} className="relative flex justify-center">
              <span
                className="absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-slate-300 dark:bg-slate-700"
                aria-hidden="true"
              />
              <TreeNodeRow
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white/80 text-sm font-bold text-zinc-600 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:focus:ring-blue-900";

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
