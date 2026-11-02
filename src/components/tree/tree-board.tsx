"use client";

import {
  type Announcements,
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragMoveEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { DeleteNodeDialog, DeleteTreePageDialog, MoveNodeDialog, NewTreePageDialog } from "./tree-dialogs";
import {
  buildTree,
  clampZoom,
  compareNode,
  DEFAULT_ZOOM_LIMITS,
  FULL_SCREEN_ZOOM_LIMITS,
  subtreeIds,
  TREE_PATH,
  treePageHref,
  treePageIdFromPath,
} from "./tree-layout";
import { applyMove, currentIndex, type DropTarget, dropZoneFor, moveFor, type TreeMove } from "./tree-move";
import { DragPreview, TreeNodeRow } from "./tree-node-card";
import { TreePageSwitcher } from "./tree-page-switcher";
import { ZoomControls } from "./tree-zoom-controls";
import type { CreateIntent, DeleteIntent, TreeNode, TreeNodeColor, TreePage } from "./types";

// The card under the pointer; with the keyboard there's no pointer, so the nearest card.
const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

const screenReaderInstructions = {
  draggable:
    "To move a node, press Space or Enter on its handle, then use the arrow keys to move it over another node. Drop it with Space or Enter: near that node's left or right edge to place it beside it, in the middle to make it a child. Press Escape to cancel.",
};

const MOVE_TOAST_ID = "tree-move";

/** Where the drag is now: the pointer, or the dragged handle's center when using the keyboard. */
function dragX(event: DragMoveEvent) {
  const start = event.activatorEvent;
  if (start instanceof MouseEvent) return start.clientX + event.delta.x;
  const rect = event.active.rect.current.translated;
  return rect ? rect.left + rect.width / 2 : 0;
}

export function TreeBoard({ initialPages }: { initialPages: TreePage[] }) {
  const pathname = usePathname();
  const [pages, setPages] = useState(initialPages);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [deletePageIntent, setDeletePageIntent] = useState<TreePage | null>(null);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("New Tree Page");
  const [newPageError, setNewPageError] = useState("");
  const [zoom, setZoom] = useState(1);
  const zoomLimits = isFullScreen ? FULL_SCREEN_ZOOM_LIMITS : DEFAULT_ZOOM_LIMITS;
  // The URL picks the page (/tree/<id>); /tree shows the most recently changed one.
  const urlPageId = treePageIdFromPath(pathname);
  const activePage = pages.find((page) => page.id === urlPageId) ?? pages[0] ?? null;

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

  // Next.js keeps usePathname in step with the History API, so these switch pages without a reload.
  function selectPage(pageId: string) {
    if (pageId === activePage?.id && urlPageId === pageId) return;
    window.history.pushState(null, "", treePageHref(pageId));
  }

  function openNewPageDialog() {
    setNewPageTitle("New Tree Page");
    setNewPageError("");
    setNewPageOpen(true);
  }
  async function createPage(title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setNewPageError("Add a name before creating the tree page.");
      return;
    }
    const page = await request<TreePage>("/api/tree-pages", {
      method: "POST",
      body: JSON.stringify({ title: nextTitle }),
    });
    setPages((current) => [page, ...current]);
    window.history.pushState(null, "", treePageHref(page.id));
    setNewPageOpen(false);
    setNewPageTitle("New Tree Page");
  }
  async function renamePage(pageId: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const page = await request<TreePage>(`/api/tree-pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: nextTitle }),
    });
    setPages((current) => current.map((item) => (item.id === page.id ? page : item)));
  }
  async function addNode(intent: CreateIntent, title: string) {
    if (!activePage) return;
    const node = await request<TreeNode>(`/api/tree-pages/${activePage.id}/nodes`, {
      method: "POST",
      body: JSON.stringify({
        title,
        parentId: intent.parentId,
        sortOrder: intent.sortOrder,
        color: intent.inheritColor,
      }),
    });
    setCreateIntent(null);
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id ? { ...page, nodes: [...page.nodes, node].sort(compareNode) } : page,
      ),
    );
  }
  async function patchNode(nodeId: string, body: Record<string, unknown>) {
    if (!activePage) return;
    const node = await request<TreeNode>(`/api/tree-pages/${activePage.id}/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? { ...page, nodes: page.nodes.map((item) => (item.id === node.id ? node : item)) }
          : page,
      ),
    );
  }
  async function patchNodeColor(nodeId: string, color: TreeNodeColor) {
    if (!activePage) return;
    const nodes = await request<TreeNode[]>(`/api/tree-pages/${activePage.id}/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify({ color }),
    });
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id
          ? { ...page, nodes: page.nodes.map((item) => nodes.find((node) => node.id === item.id) ?? item) }
          : page,
      ),
    );
  }
  // Drag and drop (TREE-02): the tree moves at once, and goes back with a message if the server refuses.
  const [moveIntent, setMoveIntent] = useState<TreeNode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const sensors = useSensors(
    // A short travel before a drag starts, so a click on the handle stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const titleOf = (id: string | number) => activePage?.nodes.find((node) => node.id === String(id))?.title ?? "node";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} is over ${titleOf(over.id)}.` : `${titleOf(active.id)} is not over a node.`,
    onDragEnd: ({ active, over }) =>
      over ? `${titleOf(active.id)} was dropped on ${titleOf(over.id)}.` : `${titleOf(active.id)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  function showDropTarget(next: DropTarget | null) {
    const current = dropTargetRef.current;
    if (current?.nodeId === next?.nodeId && current?.zone === next?.zone) return;
    dropTargetRef.current = next;
    setDropTarget(next);
  }
  function updateDropTarget(event: DragMoveEvent) {
    const { active, over } = event;
    if (!activePage || !over) return showDropTarget(null);
    const target = activePage.nodes.find((node) => node.id === String(over.id));
    if (!target) return showDropTarget(null);
    // The root has no siblings, so it only takes children.
    const zone = target.parentId === null ? "child" : dropZoneFor(dragX(event), over.rect);
    const allowed = moveFor(activePage.nodes, String(active.id), target.id, zone) !== null;
    showDropTarget(allowed ? { nodeId: target.id, zone } : null);
  }
  function endDrag() {
    setDraggingId(null);
    showDropTarget(null);
  }
  async function dropNode(nodeId: string) {
    const target = dropTargetRef.current;
    endDrag();
    if (!activePage || !target) return;
    const move = moveFor(activePage.nodes, nodeId, target.nodeId, target.zone);
    if (move) await moveNode(activePage.id, move);
  }
  // The latest pages, for moves that start later from a toast or a key, when this render's state is old.
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  // The way back from the last move, for the Undo in its toast and for Ctrl+Z (TREE-03).
  const undoRef = useRef<{ pageId: string; move: TreeMove } | null>(null);

  async function moveNode(pageId: string, move: TreeMove, { undoable = true } = {}) {
    const before = pagesRef.current.find((page) => page.id === pageId)?.nodes ?? [];
    const node = before.find((item) => item.id === move.nodeId);
    const back = node?.parentId ? { nodeId: node.id, parentId: node.parentId, index: currentIndex(before, node.id) } : null;
    const setNodes = (update: (nodes: TreeNode[]) => TreeNode[]) =>
      setPages((current) => current.map((page) => (page.id === pageId ? { ...page, nodes: update(page.nodes) } : page)));
    setNodes((nodes) => applyMove(nodes, move));
    try {
      const res = await fetch(`/api/tree-pages/${pageId}/nodes/${move.nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: move.parentId, sortOrder: move.index }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "The node couldn't be moved.");
      // The server answers with the new siblings in their saved order.
      const saved = data as TreeNode[];
      setNodes((nodes) => nodes.map((item) => saved.find((savedNode) => savedNode.id === item.id) ?? item));
      if (undoable && node && back) {
        undoRef.current = { pageId, move: back };
        // One toast for the latest move: a new move replaces it, so no older Undo is left on screen.
        toast.success(`Moved “${node.title}”.`, { id: MOVE_TOAST_ID, action: { label: "Undo", onClick: undoLastMove } });
      }
    } catch (err) {
      setNodes(() => before);
      toast.error(err instanceof Error ? err.message : "The node couldn't be moved.");
    }
  }
  function undoLastMove() {
    const last = undoRef.current;
    undoRef.current = null;
    toast.dismiss(MOVE_TOAST_ID);
    if (last) void moveNode(last.pageId, last.move, { undoable: false });
  }
  // Ctrl+Z (Cmd+Z) undoes the last move, unless the key is meant for a text field.
  const onUndoKey = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!undoRef.current) return;
    event.preventDefault();
    undoLastMove();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onUndoKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const draggingNode = activePage?.nodes.find((node) => node.id === draggingId) ?? null;

  function updateZoom(delta: number) {
    setZoom((current) => clampZoom(Number((current + delta).toFixed(2)), zoomLimits));
  }
  function resetZoom() {
    setZoom(1);
  }

  function exitFullScreen() {
    setIsFullScreen(false);
    setZoom((current) => clampZoom(current, DEFAULT_ZOOM_LIMITS));
  }

  function requestDeleteNode(node: TreeNode) {
    if (!activePage) return;
    if (node.parentId === null) {
      setDeletePageIntent(activePage);
      return;
    }
    const hasChildren = activePage.nodes.some((item) => item.parentId === node.id);
    const hasSiblings = activePage.nodes.some((item) => item.id !== node.id && item.parentId === node.parentId);
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
    const remove = subtreeIds(activePage.nodes, node.id);
    setPages((current) =>
      current.map((page) =>
        page.id === activePage.id ? { ...page, nodes: page.nodes.filter((item) => !remove.has(item.id)) } : page,
      ),
    );
  }

  async function deletePage(page: TreePage) {
    await request(`/api/tree-pages/${page.id}`, { method: "DELETE" });
    setDeletePageIntent(null);
    const remaining = pages.filter((item) => item.id !== page.id);
    setPages(remaining);
    // The deleted page's URL no longer exists, so replace it rather than add to history.
    window.history.replaceState(null, "", remaining[0] ? treePageHref(remaining[0].id) : TREE_PATH);
  }

  const content = (
    <>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <TreePageSwitcher
            pages={pages}
            activePage={activePage}
            onSelect={selectPage}
            onCreate={openNewPageDialog}
            onRename={renamePage}
          />
        </div>
        {isFullScreen && (
          <button
            type="button"
            aria-label="Exit full screen"
            title="Exit full screen"
            onClick={exitFullScreen}
            className={`${uiButtonClass} h-10 w-10 shrink-0 px-0`}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        )}
      </div>
      <div
        className={`${isFullScreen ? "h-[calc(100vh-7rem)] p-3 sm:p-4" : "p-4 sm:p-5"} overflow-hidden rounded-2xl border border-line bg-surface shadow-card`}
      >
        {!activePage ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
            <h2 className="text-xl font-semibold">Create your first Tree View page</h2>
            <p className="mt-2 text-sm text-muted">
              Tree pages are private to your account and can hold editable parent, child, and sibling nodes.
            </p>
            <button type="button" onClick={openNewPageDialog} className={`${uiPrimaryButtonClass} mt-4`}>
              Create tree page
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="truncate px-1 text-lg font-semibold">{activePage.title}</h2>
              <p className="rounded-2xl border border-line bg-accent-soft px-3 py-2 text-xs font-medium leading-5 text-ink sm:hidden">
                Rotate your device or use full-screen mode for the best tree editing experience.
              </p>
              {!isFullScreen && (
                <button type="button" onClick={() => setIsFullScreen(true)} className={`${uiButtonClass} self-end sm:ml-auto`}>
                  Full screen
                </button>
              )}
            </div>
            {error && (
              <p className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
            )}
            {loading && <p className="mt-4 text-sm text-muted">Saving tree changes…</p>}
            <div
              onWheel={(event) => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                updateZoom(event.deltaY > 0 ? (isFullScreen ? -0.14 : -0.08) : isFullScreen ? 0.14 : 0.08);
              }}
              className={`${isFullScreen ? "mt-3 h-[calc(100%-4.25rem)]" : "mt-6"} relative rounded-2xl`}
            >
              <ZoomControls
                zoom={zoom}
                onZoomIn={() => updateZoom(isFullScreen ? 0.2 : 0.1)}
                onZoomOut={() => updateZoom(isFullScreen ? -0.2 : -0.1)}
                onReset={resetZoom}
              />
              <div
                className={`${isFullScreen ? "h-full" : "max-h-[72vh] sm:max-h-[70vh]"} tree-canvas overscroll-contain overflow-auto rounded-2xl p-3 pr-14 sm:p-6 sm:pr-20`}
              >
                {tree.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-zinc-300 bg-sunken/70 p-10 text-center text-sm text-muted dark:border-zinc-700">
                    This page is preparing its root node.
                  </p>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={collisionDetection}
                    // Scroll only near the very edge: the cards are large, and the default
                    // (a fifth of the view) scrolled them away from under the pointer.
                    autoScroll={{ threshold: { x: 0.1, y: 0.1 }, acceleration: 6 }}
                    accessibility={{ announcements, screenReaderInstructions }}
                    onDragStart={(event) => {
                      setCreateIntent(null);
                      setDraggingId(String(event.active.id));
                    }}
                    onDragMove={updateDropTarget}
                    onDragOver={updateDropTarget}
                    onDragEnd={(event) => void dropNode(String(event.active.id))}
                    onDragCancel={endDrag}
                  >
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
                            draggingId={draggingId}
                            dropTarget={dropTarget}
                            createIntent={createIntent}
                            onCreateIntent={setCreateIntent}
                            onCreateNode={addNode}
                            onRename={(item, title) => patchNode(item.id, { title })}
                            onColorChange={(item, color) => patchNodeColor(item.id, color)}
                            onDescriptionChange={(item, description) => patchNode(item.id, { description })}
                            onResize={(item, width, height) => patchNode(item.id, { width, height })}
                            onDelete={requestDeleteNode}
                            onMoveRequest={setMoveIntent}
                          />
                        ))}
                      </div>
                    </div>
                    {/* Outside the zoomed tree, so the preview keeps its size under the pointer. */}
                    <DragOverlay dropAnimation={null}>
                      {draggingNode ? (
                        <DragPreview
                          node={draggingNode}
                          carried={activePage ? subtreeIds(activePage.nodes, draggingNode.id).size - 1 : 0}
                        />
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {newPageOpen && (
        <NewTreePageDialog
          title={newPageTitle}
          error={newPageError}
          loading={loading}
          onTitleChange={(value) => {
            setNewPageTitle(value);
            if (value.trim()) setNewPageError("");
          }}
          onCancel={() => setNewPageOpen(false)}
          onCreate={() => void createPage(newPageTitle)}
        />
      )}
      {deletePageIntent && (
        <DeleteTreePageDialog
          page={deletePageIntent}
          loading={loading}
          onCancel={() => setDeletePageIntent(null)}
          onConfirm={() => void deletePage(deletePageIntent)}
        />
      )}
      {moveIntent && activePage && (
        <MoveNodeDialog
          node={moveIntent}
          nodes={activePage.nodes}
          onCancel={() => setMoveIntent(null)}
          onMove={(move) => {
            setMoveIntent(null);
            void moveNode(activePage.id, move);
          }}
        />
      )}
      {deleteIntent && (
        <DeleteNodeDialog
          intent={deleteIntent}
          loading={loading}
          onCancel={() => setDeleteIntent(null)}
          onConfirm={() => void deleteNode(deleteIntent.node)}
        />
      )}
    </>
  );

  if (isFullScreen) {
    return (
      <section aria-label="Tree view, full screen" className="fixed inset-0 z-50 overflow-hidden bg-canvas p-3 text-ink sm:p-4">
        <div className="h-full space-y-3">{content}</div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <TreeViewWorkInProgressBanner />
      {content}
    </section>
  );
}

function TreeViewWorkInProgressBanner() {
  return (
    <div className="rounded-2xl border border-line bg-accent-soft/60 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="mt-1 flex h-3 w-3 shrink-0 rounded-full bg-accent ring-4 ring-accent/15" />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Work In Progress</p>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Tree View is still being improved. More planning views will be added soon.
            </p>
          </div>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted shadow-sm">
          <span aria-hidden="true">🚧</span>
          <span>Polishing the experience</span>
        </div>
      </div>
    </div>
  );
}
