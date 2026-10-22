"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { DeleteNodeDialog, DeleteTreePageDialog, NewTreePageDialog } from "./tree-dialogs";
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
import { TreeNodeRow } from "./tree-node-card";
import { TreePageSwitcher } from "./tree-page-switcher";
import { ZoomControls } from "./tree-zoom-controls";
import type { CreateIntent, DeleteIntent, TreeNode, TreeNodeColor, TreePage } from "./types";

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
        className={`${isFullScreen ? "h-[calc(100vh-7rem)] p-3 sm:p-4" : "p-4 sm:p-5"} overflow-hidden rounded-2xl border border-line bg-surface shadow-sm shadow-zinc-200/70 dark:shadow-none`}
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
                          createIntent={createIntent}
                          onCreateIntent={setCreateIntent}
                          onCreateNode={addNode}
                          onRename={(item, title) => patchNode(item.id, { title })}
                          onColorChange={(item, color) => patchNodeColor(item.id, color)}
                          onDescriptionChange={(item, description) => patchNode(item.id, { description })}
                          onResize={(item, width, height) => patchNode(item.id, { width, height })}
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
