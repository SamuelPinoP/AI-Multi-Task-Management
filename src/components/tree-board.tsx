"use client";

import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import {
  type DragEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type TreeNode = {
  id: string;
  pageId: string;
  parentId: string | null;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  color: string;
  width: number;
  height: number;
};
type TreePage = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: TreeNode[];
};
type TreeNodeColor = "blue" | "purple" | "emerald" | "amber" | "rose" | "slate";
type NestedNode = TreeNode & { children: NestedNode[]; depth: number };
type DropPosition = "before" | "after" | "child";
type CreateIntent = {
  parentId: string | null;
  sortOrder?: number;
  fallback: string;
  inheritColor: TreeNodeColor;
  anchorNodeId: string;
  mode: "child" | "before" | "after";
};
type DeleteIntent = {
  node: TreeNode;
  message: string | null;
  hasChildren: boolean;
  hasSiblings: boolean;
};
const DEFAULT_ZOOM_LIMITS = { min: 0.5, max: 1.75 } as const;
const FULL_SCREEN_ZOOM_LIMITS = { min: 0, max: 3.25 } as const;

export function TreeBoard({ initialPages }: { initialPages: TreePage[] }) {
  const [pages, setPages] = useState(initialPages);
  const [activePageId, setActivePageId] = useState(initialPages[0]?.id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    nodeId: string;
    position: DropPosition;
  } | null>(null);
  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomLimits = isFullScreen
    ? FULL_SCREEN_ZOOM_LIMITS
    : DEFAULT_ZOOM_LIMITS;
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
  async function addNode(intent: CreateIntent, title: string) {
    if (!activePage) return;
    const node = await request<TreeNode>(
      `/api/tree-pages/${activePage.id}/nodes`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          parentId: intent.parentId,
          sortOrder: intent.sortOrder,
          color: intent.inheritColor,
        }),
      },
    );
    setCreateIntent(null);
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
  async function patchNodeColor(nodeId: string, color: TreeNodeColor) {
    if (!activePage) return;
    const nodes = await request<TreeNode[]>(
      `/api/tree-pages/${activePage.id}/nodes/${nodeId}`,
      { method: "PATCH", body: JSON.stringify({ color }) },
    );
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? {
              ...page,
              nodes: page.nodes.map(
                (item) => nodes.find((node) => node.id === item.id) ?? item,
              ),
            }
          : page,
      ),
    );
  }
  function updateZoom(delta: number) {
    setZoom((current) =>
      clampZoom(Number((current + delta).toFixed(2)), zoomLimits),
    );
  }
  function resetZoom() {
    setZoom(1);
  }

  function exitFullScreen() {
    setIsFullScreen(false);
    setZoom((current) => clampZoom(current, DEFAULT_ZOOM_LIMITS));
  }

  async function moveNode(
    nodeId: string,
    targetId: string,
    position: DropPosition,
  ) {
    if (!activePage || nodeId === targetId) return;
    const draggedNode = activePage.nodes.find((item) => item.id === nodeId);
    const targetNode = activePage.nodes.find((item) => item.id === targetId);
    if (!draggedNode || !targetNode) return;
    if (
      position === "child" &&
      isDescendant(activePage.nodes, targetId, nodeId)
    ) {
      setError("A node cannot be moved inside one of its own child nodes.");
      return;
    }
    const nextParentId = position === "child" ? targetId : targetNode.parentId;
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
      position === "child"
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
                .map((item) => {
                  const newOrder = reindexedOrder(
                    page.nodes,
                    nodeId,
                    nextParentId,
                    nextIndex,
                  );
                  const oldOrder = reindexedOrderWithoutNode(
                    page.nodes,
                    nodeId,
                    draggedNode.parentId,
                  );
                  if (item.parentId === nextParentId || item.id === nodeId)
                    return {
                      ...item,
                      sortOrder: newOrder.get(item.id) ?? item.sortOrder,
                    };
                  if (item.parentId === draggedNode.parentId)
                    return {
                      ...item,
                      sortOrder: oldOrder.get(item.id) ?? item.sortOrder,
                    };
                  return item;
                }),
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
            dropPosition: position,
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
  function requestDeleteNode(node: TreeNode) {
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
      ? "Deleting this node will also remove every child node beneath it."
      : hasSiblings
        ? "This node has sibling nodes. Delete only this branch?"
        : null;
    setDeleteIntent({ node, message, hasChildren, hasSiblings });
  }
  async function deleteNode(node: TreeNode) {
    if (!activePage) return;
    await request(`/api/tree-pages/${activePage.id}/nodes/${node.id}`, {
      method: "DELETE",
    });
    setDeleteIntent(null);
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
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <TreePageSwitcher
            pages={pages}
            activePage={activePage}
            onSelect={setActivePageId}
            onCreate={createPage}
            onRename={renamePage}
          />
        </div>
        {isFullScreen && (
          <button
            type="button"
            aria-label="Exit full screen"
            onClick={exitFullScreen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-lg font-bold leading-none text-white shadow-lg shadow-red-950/20 ring-1 ring-red-500/40 transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-300 dark:bg-red-500 dark:hover:bg-red-400"
          >
            ×
          </button>
        )}
      </div>
      <div
        className={`${isFullScreen ? "h-[calc(100vh-7rem)] p-3 sm:p-4" : "p-4 sm:p-5"} overflow-hidden rounded-[1.75rem] border border-zinc-200/80 bg-white/95 shadow-sm shadow-zinc-200/70 ring-1 ring-white/70 dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-none dark:ring-zinc-800/40`}
      >
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
            <div className="flex flex-col gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
              <p className="rounded-2xl border border-blue-200/80 bg-blue-50/80 px-3 py-2 text-xs font-medium leading-5 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200 sm:hidden">
                Rotate your device or use full-screen mode for the best tree
                editing experience.
              </p>
              {!isFullScreen && (
                <button
                  onClick={() => setIsFullScreen(true)}
                  className={`${uiButtonClass} self-end sm:ml-auto`}
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
            <div
              onWheel={(event) => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                updateZoom(
                  event.deltaY > 0
                    ? isFullScreen
                      ? -0.14
                      : -0.08
                    : isFullScreen
                      ? 0.14
                      : 0.08,
                );
              }}
              className={`${isFullScreen ? "mt-3 h-[calc(100%-4.25rem)]" : "mt-6"} relative rounded-[1.35rem]`}
            >
              <ZoomControls
                zoom={zoom}
                onZoomIn={() => updateZoom(isFullScreen ? 0.2 : 0.1)}
                onZoomOut={() => updateZoom(isFullScreen ? -0.2 : -0.1)}
                onReset={resetZoom}
              />
              <div
                className={`${isFullScreen ? "h-full" : "max-h-[72vh] sm:max-h-[70vh]"} overscroll-contain overflow-auto rounded-[1.35rem] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_32%),linear-gradient(rgba(148,163,184,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.10)_1px,transparent_1px)] bg-[length:auto,32px_32px,32px_32px] p-3 pr-14 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_34%),linear-gradient(rgba(71,85,105,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(71,85,105,0.22)_1px,transparent_1px)] sm:p-6 sm:pr-20`}
              >
                {tree.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/40">
                    This page is preparing its root node.
                  </p>
                ) : (
                  <div
                    className="inline-flex min-w-[max(100%,56rem)] origin-top justify-center pb-12 transition-transform sm:min-w-full"
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top center",
                    }}
                  >
                    <div className="flex min-w-max items-start justify-center gap-5 sm:gap-8">
                      {tree.map((node) => (
                        <TreeNodeRow
                          key={node.id}
                          node={node}
                          draggedNodeId={draggedNodeId}
                          dropTarget={dropTarget}
                          allNodes={activePage.nodes}
                          draggedNodeSize={getDraggedNodeSize(
                            activePage.nodes,
                            draggedNodeId,
                          )}
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
                          createIntent={createIntent}
                          onCreateIntent={setCreateIntent}
                          onCreateNode={addNode}
                          onRename={(item, title) =>
                            patchNode(item.id, { title })
                          }
                          onColorChange={(item, color) =>
                            patchNodeColor(item.id, color)
                          }
                          onDescriptionChange={(item, description) =>
                            patchNode(item.id, { description })
                          }
                          onResize={(item, width, height) =>
                            patchNode(item.id, { width, height })
                          }
                          onDelete={requestDeleteNode}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {deleteIntent && (
        <DeleteNodeDialog
          intent={deleteIntent}
          onCancel={() => setDeleteIntent(null)}
          onConfirm={() => void deleteNode(deleteIntent.node)}
        />
      )}
    </>
  );

  if (isFullScreen) {
    return (
      <section className="fixed inset-0 z-50 overflow-hidden bg-zinc-50 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_38%)] p-3 text-zinc-900 dark:bg-zinc-950 dark:bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.18),transparent_42%)] dark:text-zinc-100 sm:p-4">
        <div className="h-full space-y-3">{content}</div>
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
    <div className="rounded-[1.5rem] border border-zinc-200/80 bg-white/85 p-2.5 shadow-sm shadow-zinc-200/60 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/75 dark:shadow-none sm:p-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => void onCreate()}
          className={`${uiPrimaryButtonClass} shrink-0 shadow-sm`}
        >
          New Tree Page
        </button>
        {pages.map((page) => {
          const selected = activePage?.id === page.id;
          const pillClass = `max-w-[12rem] shrink-0 truncate rounded-full border px-3 py-2 text-sm font-semibold transition sm:max-w-56 sm:px-4 ${selected ? "border-zinc-950 bg-zinc-950 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-200 bg-white/90 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-900"}`;
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
  allNodes,
  draggedNodeSize,
  onDragStart,
  onDragEnd,
  onDropIntent,
  onMove,
  createIntent,
  onCreateIntent,
  onCreateNode,
  onRename,
  onColorChange,
  onDescriptionChange,
  onResize,
  onDelete,
}: {
  node: NestedNode;
  draggedNodeId: string | null;
  dropTarget: {
    nodeId: string;
    position: DropPosition;
  } | null;
  allNodes: TreeNode[];
  draggedNodeSize: { width: number; height: number } | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropIntent: (
    nodeId: string,
    position: DropPosition,
  ) => void;
  onMove: (
    targetId: string,
    position: DropPosition,
  ) => Promise<void>;
  createIntent: CreateIntent | null;
  onCreateIntent: (intent: CreateIntent | null) => void;
  onCreateNode: (intent: CreateIntent, title: string) => Promise<void>;
  onRename: (node: TreeNode, title: string) => Promise<void>;
  onColorChange: (node: TreeNode, color: TreeNodeColor) => Promise<void>;
  onDescriptionChange: (node: TreeNode, description: string) => Promise<void>;
  onResize: (node: TreeNode, width: number, height: number) => Promise<void>;
  onDelete: (node: TreeNode) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(
    node.description ?? "",
  );
  const [sizeDraft, setSizeDraft] = useState({
    width: node.width || 240,
    height: node.height || 160,
  });
  const isDragging = draggedNodeId === node.id;
  const isRoot = node.parentId === null;
  const dropPosition =
    dropTarget?.nodeId === node.id ? dropTarget.position : null;
  const isInvalidDropTarget =
    Boolean(draggedNodeId) &&
    (draggedNodeId === node.id ||
      Boolean(draggedNodeId && isDescendant(allNodes, node.id, draggedNodeId)));
  const showDropZones = Boolean(draggedNodeId) && !isDragging;
  const childDropActive = dropPosition === "child";
  const siblingDropActive =
    dropPosition === "before" || dropPosition === "after";
  const allowSiblingDrop = showDropZones && !isRoot && !isInvalidDropTarget;
  function handleDropIntent(
    event: DragEvent<HTMLElement>,
    position: DropPosition,
  ) {
    if (!draggedNodeId || draggedNodeId === node.id || isInvalidDropTarget) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    if ((position === "before" || position === "after") && isRoot) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    onDropIntent(node.id, position);
  }
  function handleDropOnZone(
    event: DragEvent<HTMLElement>,
    position: DropPosition,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (draggedNodeId && draggedNodeId !== node.id && !isInvalidDropTarget)
      void onMove(node.id, position);
    onDragEnd();
  }
  async function save() {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== node.title) await onRename(node, title);
    else setDraft(node.title);
  }
  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!draggedNodeId) return;
    if (draggedNodeId === node.id || isInvalidDropTarget) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDropIntent(node.id, "child");
  }
  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (draggedNodeId && draggedNodeId !== node.id && !isInvalidDropTarget)
      void onMove(node.id, dropPosition ?? "child");
    onDragEnd();
  }
  async function saveDescription() {
    setEditingDescription(false);
    if (descriptionDraft.trim() !== (node.description ?? "")) {
      await onDescriptionChange(node, descriptionDraft);
    }
  }
  function beginResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = sizeDraft.width;
    const startHeight = sizeDraft.height;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const width = Math.min(
        Math.max(startWidth + moveEvent.clientX - startX, 180),
        520,
      );
      const height = Math.min(
        Math.max(startHeight + moveEvent.clientY - startY, 140),
        420,
      );
      setSizeDraft({ width, height });
    };
    const handleUp = (upEvent: globalThis.PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const width = Math.min(
        Math.max(startWidth + upEvent.clientX - startX, 180),
        520,
      );
      const height = Math.min(
        Math.max(startHeight + upEvent.clientY - startY, 140),
        420,
      );
      setSizeDraft({ width, height });
      void onResize(node, width, height);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  const nodeColor = asTreeNodeColor(node.color);
  const tone = COLOR_TONES[nodeColor];
  const cardTone = isRoot
    ? `${tone.root} text-white shadow-blue-950/20 ring-blue-200/70 dark:ring-blue-300/20`
    : `bg-white/95 text-slate-950 shadow-slate-200/80 ring-white/80 hover:shadow-slate-200 dark:bg-slate-900/95 dark:text-slate-50 dark:shadow-none dark:ring-slate-700/40 ${tone.card}`;
  const accentTone = isRoot ? "bg-white/80" : tone.accent;
  const activeCreate =
    createIntent?.anchorNodeId === node.id ? createIntent : null;

  return (
    <div
      className={`relative flex shrink-0 flex-col items-center ${isDragging ? "opacity-45" : ""}`}
    >
      <div className="flex items-stretch justify-center gap-3 sm:gap-4">
        {allowSiblingDrop && (
          <SiblingDropZone
            active={dropPosition === "before"}
            label="Drop before"
            side="left"
            size={draggedNodeSize}
            onDragOver={(event) => handleDropIntent(event, "before")}
            onDrop={(event) => handleDropOnZone(event, "before")}
          />
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
        style={{
          width: `clamp(220px, calc(100vw - 3rem), ${sizeDraft.width}px)`,
          minHeight: sizeDraft.height,
        }}
        className={`group relative flex flex-col overflow-visible rounded-[1.35rem] border p-3 shadow-lg ring-1 transition-[border,box-shadow,transform] duration-200 sm:p-4 ${cardTone} ${isInvalidDropTarget ? "cursor-no-drop border-red-300 ring-4 ring-red-200/70 dark:border-red-700 dark:ring-red-950/50" : ""} ${dropPosition === "child" ? "scale-[1.02] border-blue-400 ring-4 ring-blue-300/45 dark:ring-blue-500/30" : ""}`}
      >
        {showDropZones && (
          <div
            className={`pointer-events-none absolute inset-2 z-20 rounded-2xl border-2 border-dashed transition ${
              childDropActive
                ? "border-emerald-400 bg-emerald-500/10 ring-4 ring-emerald-200/70 dark:ring-emerald-950/50"
                : siblingDropActive
                  ? "border-blue-300/60 bg-blue-500/5"
                  : "border-emerald-300/70 bg-emerald-500/5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            {!isInvalidDropTarget && childDropActive && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.16em] text-white shadow-sm">
                Drop as child
              </span>
            )}
            {isInvalidDropTarget && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-dashed border-red-300 bg-red-50/80 text-xs font-bold uppercase tracking-[0.16em] text-red-700 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200">
                Cannot drop here
              </div>
            )}
          </div>
        )}

        <span
          className={`absolute inset-x-0 top-0 h-1.5 rounded-t-[1.35rem] ${accentTone}`}
          aria-hidden="true"
        />
        {!isRoot && (
          <button
            type="button"
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-xl border border-red-200 bg-white/90 text-sm font-bold text-red-600 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 dark:border-red-900/60 dark:bg-slate-950/90 dark:text-red-300 dark:hover:bg-red-950/40"
            title="Delete node"
            aria-label="Delete node"
            onClick={() => onDelete(node)}
          >
            ×
          </button>
        )}
        <div className="flex items-start justify-between gap-3 pr-6">
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
        </div>
        <div className="mt-3 flex-1">
          {editingDescription ? (
            <textarea
              autoFocus
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onBlur={() => void saveDescription()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDescriptionDraft(node.description ?? "");
                  setEditingDescription(false);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                  void saveDescription();
              }}
              className="min-h-16 w-full resize-none rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm leading-5 text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-blue-700 dark:focus:ring-blue-900/50"
              placeholder="Description..."
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDescriptionDraft(node.description ?? "");
                setEditingDescription(true);
              }}
              className={`min-h-10 w-full rounded-xl px-3 py-2 text-left text-sm leading-5 transition focus:outline-none focus:ring-2 ${isRoot ? "text-white/75 hover:bg-white/10 focus:ring-white/30" : "text-slate-500 hover:bg-slate-100 focus:ring-blue-200 dark:text-slate-400 dark:hover:bg-slate-800 dark:focus:ring-blue-900"}`}
            >
              {node.description?.trim() ? node.description : "Description..."}
            </button>
          )}
        </div>
        <div className="mt-auto flex justify-center gap-1.5 pt-4 opacity-95 transition group-hover:opacity-100 focus-within:opacity-100">
          {!isRoot && (
            <button
              type="button"
              className={iconButtonClass}
              title="Add sibling before"
              aria-label="Add sibling before"
              onClick={() =>
                onCreateIntent({
                  parentId: node.parentId,
                  fallback: "Sibling node",
                  sortOrder: node.sortOrder,
                  inheritColor: nodeColor,
                  anchorNodeId: node.id,
                  mode: "before",
                })
              }
            >
              ←
            </button>
          )}
          <button
            type="button"
            className={iconButtonClass}
            title="Add child"
            aria-label="Add child"
            onClick={() =>
              onCreateIntent({
                parentId: node.id,
                fallback: "Child node",
                inheritColor: nodeColor,
                anchorNodeId: node.id,
                mode: "child",
              })
            }
          >
            +
          </button>
          {!isRoot && (
            <button
              type="button"
              className={iconButtonClass}
              title="Add sibling after"
              aria-label="Add sibling after"
              onClick={() =>
                onCreateIntent({
                  parentId: node.parentId,
                  fallback: "Sibling node",
                  sortOrder: node.sortOrder + 1,
                  inheritColor: nodeColor,
                  anchorNodeId: node.id,
                  mode: "after",
                })
              }
            >
              →
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPaletteOpen((open) => !open)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900 ${isRoot ? "border-white/30 bg-white/10" : "border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-900/80"}`}
              title="Change node color"
              aria-label="Change node color"
            >
              <span className={`h-4 w-4 rounded-full ${tone.swatch}`} />
            </button>
            {paletteOpen && (
              <ColorPalette
                selected={nodeColor}
                onSelect={(color) => {
                  setPaletteOpen(false);
                  void onColorChange(node, color);
                }}
              />
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Resize node"
          title="Resize node"
          onPointerDown={beginResize}
          className="absolute bottom-1.5 right-1.5 h-4 w-4 rounded-br-[0.9rem] border-b-2 border-r-2 border-slate-300/80 opacity-70 transition hover:border-slate-500 hover:opacity-100 dark:border-slate-600 dark:hover:border-slate-300"
        />
        {activeCreate && (
          <CreateNodePopover
            key={`${activeCreate.anchorNodeId}-${activeCreate.mode}-${activeCreate.sortOrder ?? "child"}`}
            intent={activeCreate}
            onCreate={onCreateNode}
            onCancel={() => onCreateIntent(null)}
          />
        )}
        </article>
        {allowSiblingDrop && (
          <SiblingDropZone
            active={dropPosition === "after"}
            label="Drop after"
            side="right"
            size={draggedNodeSize}
            onDragOver={(event) => handleDropIntent(event, "after")}
            onDrop={(event) => handleDropOnZone(event, "after")}
          />
        )}
      </div>
      {showDropZones && !isInvalidDropTarget && (
        <ChildDropZone
          active={childDropActive}
          label="Drop as child"
          size={draggedNodeSize}
          onDragOver={(event) => handleDropIntent(event, "child")}
          onDrop={(event) => handleDropOnZone(event, "child")}
        />
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
              {dropTarget?.nodeId === child.id &&
                dropTarget.position === "before" && (
                  <DropPlaceholder
                    label="Drop before"
                    size={draggedNodeSize}
                    sibling
                  />
                )}
              <span
                className="absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-slate-300 dark:bg-slate-700"
                aria-hidden="true"
              />
              <TreeNodeRow
                node={child}
                draggedNodeId={draggedNodeId}
                dropTarget={dropTarget}
                allNodes={allNodes}
                draggedNodeSize={draggedNodeSize}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDropIntent={onDropIntent}
                onMove={onMove}
                createIntent={createIntent}
                onCreateIntent={onCreateIntent}
                onCreateNode={onCreateNode}
                onRename={onRename}
                onColorChange={onColorChange}
                onDescriptionChange={onDescriptionChange}
                onResize={onResize}
                onDelete={onDelete}
              />
              {dropTarget?.nodeId === child.id &&
                dropTarget.position === "after" && (
                  <DropPlaceholder
                    label="Drop after"
                    size={draggedNodeSize}
                    sibling
                  />
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SiblingDropZone({
  active,
  label,
  side,
  size,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  label: string;
  side: "left" | "right";
  size: { width: number; height: number } | null;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const width = Math.max(Math.min(size?.width ?? 240, 320), 180);
  const height = Math.max(size?.height ?? 160, 140);
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative z-30 flex shrink-0 items-center justify-center rounded-[1.25rem] border-2 border-dashed px-3 text-center transition ${
        active
          ? "border-blue-500 bg-blue-100/95 text-blue-800 shadow-xl shadow-blue-500/20 ring-4 ring-blue-200/80 dark:bg-blue-950/75 dark:text-blue-100 dark:ring-blue-900/60"
          : "border-blue-300/80 bg-blue-50/75 text-blue-700 shadow-sm shadow-blue-500/10 hover:bg-blue-100/80 dark:border-blue-700/80 dark:bg-blue-950/35 dark:text-blue-200 dark:hover:bg-blue-950/55"
      }`}
      style={{ width, minHeight: height }}
      aria-label={label}
      data-drop-position={side === "left" ? "before" : "after"}
    >
      <span className="whitespace-nowrap text-[0.65rem] font-black uppercase tracking-[0.18em]">
        {label}
      </span>
    </div>
  );
}

function ChildDropZone({
  active,
  label,
  size,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  label: string;
  size: { width: number; height: number } | null;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const width = Math.max(Math.min(size?.width ?? 240, 360), 200);
  const height = Math.max(size?.height ?? 160, 140);
  return (
    <div className="mt-4 flex w-full justify-center">
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`flex shrink-0 items-center justify-center rounded-[1.25rem] border-2 border-dashed px-4 text-center text-[0.68rem] font-black uppercase tracking-[0.18em] transition ${
          active
            ? "border-emerald-500 bg-emerald-100/95 text-emerald-800 shadow-xl shadow-emerald-500/20 ring-4 ring-emerald-200/80 dark:bg-emerald-950/75 dark:text-emerald-100 dark:ring-emerald-900/60"
            : "border-emerald-300/80 bg-emerald-50/75 text-emerald-700 shadow-sm shadow-emerald-500/10 hover:bg-emerald-100/80 dark:border-emerald-700/80 dark:bg-emerald-950/35 dark:text-emerald-200 dark:hover:bg-emerald-950/55"
        }`}
        style={{ width, minHeight: height }}
        aria-label={label}
        data-drop-position="child"
      >
        {label}
      </div>
    </div>
  );
}

function DropPlaceholder({
  label,
  size,
  sibling = false,
}: {
  label: string;
  size: { width: number; height: number } | null;
  sibling?: boolean;
}) {
  const width = size?.width ?? 240;
  const height = size?.height ?? 160;
  return (
    <div
      className={`${sibling ? "mx-2" : ""} flex shrink-0 items-center justify-center rounded-[1.15rem] border-2 border-dashed border-blue-300/90 bg-blue-50/80 px-4 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-blue-700 shadow-sm shadow-blue-500/10 ring-4 ring-blue-100/70 transition-all dark:border-blue-700/80 dark:bg-blue-950/35 dark:text-blue-200 dark:ring-blue-950/40`}
      style={{
        width: `clamp(220px, calc(100vw - 3rem), ${width}px)`,
        minHeight: Math.max(height, 140),
      }}
      aria-hidden="true"
    >
      {label}
    </div>
  );
}


const TREE_NODE_COLORS = [
  "blue",
  "purple",
  "emerald",
  "amber",
  "rose",
  "slate",
] as const;
const COLOR_LABELS: Record<TreeNodeColor, string> = {
  blue: "Blue",
  purple: "Purple",
  emerald: "Emerald",
  amber: "Amber",
  rose: "Rose",
  slate: "Slate",
};
const COLOR_TONES: Record<
  TreeNodeColor,
  { root: string; card: string; accent: string; swatch: string; count: string }
> = {
  blue: {
    root: "border-blue-300/80 bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-900 dark:border-blue-400/60 dark:from-blue-500 dark:via-indigo-500 dark:to-slate-800",
    card: "border-blue-200/90 hover:border-blue-300 dark:border-blue-800/70 dark:hover:border-blue-500/60",
    accent: "bg-gradient-to-r from-blue-500 to-indigo-500",
    swatch: "bg-blue-500",
    count: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  },
  purple: {
    root: "border-purple-300/80 bg-gradient-to-br from-purple-600 via-fuchsia-600 to-slate-900 dark:border-purple-400/60 dark:from-purple-500 dark:via-fuchsia-500 dark:to-slate-800",
    card: "border-purple-200/90 hover:border-purple-300 dark:border-purple-800/70 dark:hover:border-purple-500/60",
    accent: "bg-gradient-to-r from-purple-500 to-fuchsia-500",
    swatch: "bg-purple-500",
    count:
      "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  },
  emerald: {
    root: "border-emerald-300/80 bg-gradient-to-br from-emerald-600 via-teal-600 to-slate-900 dark:border-emerald-400/60 dark:from-emerald-500 dark:via-teal-500 dark:to-slate-800",
    card: "border-emerald-200/90 hover:border-emerald-300 dark:border-emerald-800/70 dark:hover:border-emerald-500/60",
    accent: "bg-gradient-to-r from-emerald-500 to-teal-500",
    swatch: "bg-emerald-500",
    count:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  amber: {
    root: "border-amber-300/80 bg-gradient-to-br from-amber-500 via-orange-600 to-slate-900 dark:border-amber-400/60 dark:from-amber-500 dark:via-orange-500 dark:to-slate-800",
    card: "border-amber-200/90 hover:border-amber-300 dark:border-amber-800/70 dark:hover:border-amber-500/60",
    accent: "bg-gradient-to-r from-amber-400 to-orange-500",
    swatch: "bg-amber-400",
    count:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  rose: {
    root: "border-rose-300/80 bg-gradient-to-br from-rose-600 via-red-600 to-slate-900 dark:border-rose-400/60 dark:from-rose-500 dark:via-red-500 dark:to-slate-800",
    card: "border-rose-200/90 hover:border-rose-300 dark:border-rose-800/70 dark:hover:border-rose-500/60",
    accent: "bg-gradient-to-r from-rose-500 to-red-500",
    swatch: "bg-rose-500",
    count: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  },
  slate: {
    root: "border-slate-300/80 bg-gradient-to-br from-slate-600 via-zinc-700 to-slate-950 dark:border-slate-400/60 dark:from-slate-500 dark:via-zinc-600 dark:to-slate-900",
    card: "border-slate-200/90 hover:border-slate-300 dark:border-slate-700/80 dark:hover:border-slate-500/60",
    accent: "bg-gradient-to-r from-slate-500 to-zinc-500",
    swatch: "bg-slate-500",
    count: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
};

function asTreeNodeColor(color: string): TreeNodeColor {
  return TREE_NODE_COLORS.includes(color as TreeNodeColor)
    ? (color as TreeNodeColor)
    : "blue";
}

function CreateNodePopover({
  intent,
  onCreate,
  onCancel,
}: {
  intent: CreateIntent;
  onCreate: (intent: CreateIntent, title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(intent.fallback);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);
  async function submit() {
    const next = title.trim();
    if (next) await onCreate(intent, next);
  }
  return (
    <div className="absolute left-1/2 top-[calc(100%+0.75rem)] z-30 w-64 -translate-x-1/2 rounded-2xl border border-zinc-200 bg-white p-3 text-left shadow-2xl shadow-zinc-950/10 ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-black/40">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Create {intent.mode === "child" ? "child" : "sibling"}
      </p>
      <input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") onCancel();
        }}
        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-950 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-blue-600 dark:focus:ring-blue-900/60"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          className="rounded-lg bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-2 right-2 z-40 flex items-center gap-1 rounded-2xl border border-zinc-200/80 bg-white/90 p-1 text-zinc-700 shadow-lg shadow-zinc-950/10 backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/85 dark:text-zinc-200 sm:bottom-auto sm:right-3 sm:top-3 sm:flex-col sm:p-1.5">
      <button
        type="button"
        onClick={onZoomIn}
        className={zoomButtonClass}
        aria-label="Zoom in"
      >
        +
      </button>
      <div className="rounded-lg px-1 py-1 text-[0.65rem] font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
        {Math.round(zoom * 100)}%
      </div>
      <button
        type="button"
        onClick={onZoomOut}
        className={zoomButtonClass}
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg px-2 py-1 text-[0.65rem] font-bold uppercase tracking-wide text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 sm:mt-1"
        aria-label="Reset zoom"
      >
        Reset
      </button>
    </div>
  );
}

const zoomButtonClass =
  "flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm font-black shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-300 sm:h-8 sm:w-8 sm:text-base";

function ColorPalette({
  selected,
  onSelect,
}: {
  selected: TreeNodeColor;
  onSelect: (color: TreeNodeColor) => void;
}) {
  return (
    <div className="absolute right-0 top-9 z-40 grid w-44 grid-cols-3 gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-950/10 ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-black/40">
      {TREE_NODE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onSelect(color)}
          title={COLOR_LABELS[color]}
          className={`flex h-9 items-center justify-center rounded-xl border transition hover:scale-105 ${selected === color ? "border-zinc-950 ring-2 ring-zinc-300 dark:border-white dark:ring-zinc-600" : "border-zinc-200 dark:border-zinc-700"}`}
        >
          <span
            className={`h-5 w-5 rounded-full ${COLOR_TONES[color].swatch}`}
          />
        </button>
      ))}
    </div>
  );
}

function DeleteNodeDialog({
  intent,
  onCancel,
  onConfirm,
}: {
  intent: DeleteIntent;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[1.5rem] border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/20 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/50">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-xl text-red-600 dark:bg-red-950/40 dark:text-red-300">
          −
        </div>
        <h3 className="mt-4 text-lg font-bold text-zinc-950 dark:text-zinc-50">
          Delete “{intent.node.title}”?
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          {intent.message ?? "This node will be removed from the tree."}
        </p>
        {(intent.hasChildren || intent.hasSiblings) && (
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
            This action cannot be undone.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500"
          >
            Delete node
          </button>
        </div>
      </div>
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

function reindexedOrderWithoutNode(
  nodes: TreeNode[],
  nodeId: string,
  parentId: string | null,
) {
  return new Map(
    nodes
      .filter((item) => item.id !== nodeId && item.parentId === parentId)
      .sort(compareNode)
      .map((item, order) => [item.id, order]),
  );
}

function clampZoom(value: number, limits: { min: number; max: number }) {
  return Math.min(Math.max(value, limits.min), limits.max);
}

function getDraggedNodeSize(nodes: TreeNode[], draggedNodeId: string | null) {
  if (!draggedNodeId) return null;
  const node = nodes.find((item) => item.id === draggedNodeId);
  if (!node) return null;
  return { width: node.width || 240, height: node.height || 160 };
}
