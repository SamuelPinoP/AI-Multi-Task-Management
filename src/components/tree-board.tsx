"use client";

import { uiButtonClass, uiDangerButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { useMemo, useState } from "react";

type TreeNode = { id: string; pageId: string; parentId: string | null; title: string; sortOrder: number; createdAt: string; updatedAt: string };
type TreePage = { id: string; userId: string; title: string; createdAt: string; updatedAt: string; nodes: TreeNode[] };
type NestedNode = TreeNode & { children: NestedNode[]; depth: number };

export function TreeBoard({ initialPages }: { initialPages: TreePage[] }) {
  const [pages, setPages] = useState(initialPages);
  const [activePageId, setActivePageId] = useState(initialPages[0]?.id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0] ?? null;

  const tree = useMemo(() => buildTree(activePage?.nodes ?? []), [activePage]);

  async function request<T>(url: string, init: RequestInit): Promise<T> {
    setLoading(true); setError("");
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Tree action failed.");
      return data as T;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tree action failed.");
      throw err;
    } finally { setLoading(false); }
  }

  async function createPage() {
    const title = window.prompt("Tree page title", "New Tree Page");
    if (!title?.trim()) return;
    const page = await request<TreePage>("/api/tree-pages", { method: "POST", body: JSON.stringify({ title }) });
    setPages((current) => [page, ...current]); setActivePageId(page.id);
  }
  async function renamePage() {
    if (!activePage) return;
    const title = window.prompt("Rename tree page", activePage.title);
    if (!title?.trim()) return;
    const page = await request<TreePage>(`/api/tree-pages/${activePage.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    setPages((current) => current.map((item) => item.id === page.id ? page : item));
  }
  async function deletePage() {
    if (!activePage || !window.confirm(`Delete “${activePage.title}” and all of its nodes?`)) return;
    await request(`/api/tree-pages/${activePage.id}`, { method: "DELETE" });
    setPages((current) => current.filter((item) => item.id !== activePage.id)); setActivePageId("");
  }
  async function addNode(parentId: string | null, fallback = "New node") {
    if (!activePage) return;
    const title = window.prompt("Node title", fallback);
    if (!title?.trim()) return;
    const node = await request<TreeNode>(`/api/tree-pages/${activePage.id}/nodes`, { method: "POST", body: JSON.stringify({ title, parentId }) });
    setPages((current) => current.map((page) => page.id === activePage.id ? { ...page, nodes: [...page.nodes, node] } : page));
  }
  async function patchNode(nodeId: string, body: Record<string, unknown>) {
    if (!activePage) return;
    const node = await request<TreeNode>(`/api/tree-pages/${activePage.id}/nodes/${nodeId}`, { method: "PATCH", body: JSON.stringify(body) });
    setPages((current) => current.map((page) => page.id === activePage.id ? { ...page, nodes: page.nodes.map((item) => item.id === node.id ? node : item) } : page));
  }
  async function deleteNode(node: TreeNode) {
    if (!activePage || !window.confirm(`Delete “${node.title}” and its child nodes?`)) return;
    await request(`/api/tree-pages/${activePage.id}/nodes/${node.id}`, { method: "DELETE" });
    const remove = new Set([node.id]);
    let changed = true;
    while (changed) { changed = false; for (const item of activePage.nodes) if (item.parentId && remove.has(item.parentId) && !remove.has(item.id)) { remove.add(item.id); changed = true; } }
    setPages((current) => current.map((page) => page.id === activePage.id ? { ...page, nodes: page.nodes.filter((item) => !remove.has(item.id)) } : page));
  }
  async function renameNode(node: TreeNode) { const title = window.prompt("Rename node", node.title); if (title?.trim()) await patchNode(node.id, { title }); }
  async function changeParent(node: TreeNode) { const parentId = window.prompt("New parent node id (blank for root)", node.parentId ?? ""); if (parentId !== null) await patchNode(node.id, { parentId: parentId.trim() || null }); }
  async function move(node: TreeNode, direction: -1 | 1) {
    if (!activePage) return;
    const siblings = activePage.nodes.filter((item) => item.parentId === node.parentId).sort(compareNode);
    const index = siblings.findIndex((item) => item.id === node.id); const swap = siblings[index + direction];
    if (!swap) return;
    await Promise.all([patchNode(node.id, { sortOrder: swap.sortOrder }), patchNode(swap.id, { sortOrder: node.sortOrder })]);
  }

  return <section className="grid gap-5 lg:grid-cols-[18rem_1fr]">
    <aside className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Tree pages</h2><button onClick={() => void createPage()} className={`${uiPrimaryButtonClass} px-3 py-1.5 text-xs`}>New</button></div>
      <div className="mt-4 space-y-2">{pages.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">No tree pages yet. Create Warrior, Mage, Study Plan, or any hierarchy you need.</p> : pages.map((page) => <button key={page.id} onClick={() => setActivePageId(page.id)} className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${activePage?.id === page.id ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"}`}>{page.title}<span className="block text-xs opacity-70">{page.nodes.length} nodes</span></button>)}</div>
    </aside>
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/70">
      {!activePage ? <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700"><h2 className="text-xl font-semibold">Create your first Tree View page</h2><p className="mt-2 text-sm text-zinc-500">Tree pages are private to your account and can hold editable parent, child, and sibling nodes.</p><button onClick={() => void createPage()} className={`${uiPrimaryButtonClass} mt-4`}>Create tree page</button></div> : <>
        <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-zinc-500">Tree View</p><h2 className="text-2xl font-bold">{activePage.title}</h2></div><div className="flex flex-wrap gap-2"><button onClick={() => void renamePage()} className={uiButtonClass}>Edit title</button><button onClick={() => void addNode(null, activePage.title)} className={uiPrimaryButtonClass}>Add root node</button><button onClick={() => void deletePage()} className={uiDangerButtonClass}>Delete page</button></div></div>
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {loading && <p className="mt-4 text-sm text-zinc-500">Saving tree changes…</p>}
        <div className="mt-5 space-y-3">{tree.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">This page has no nodes. Add a root node to begin.</p> : tree.map((node) => <TreeNodeRow key={node.id} node={node} nodes={activePage.nodes} onAddChild={addNode} onAddSibling={(item) => addNode(item.parentId, "Sibling node")} onRename={renameNode} onDelete={deleteNode} onMove={move} onParent={changeParent} />)}</div>
      </>}
    </div>
  </section>;
}

function TreeNodeRow({ node, nodes, onAddChild, onAddSibling, onRename, onDelete, onMove, onParent }: { node: NestedNode; nodes: TreeNode[]; onAddChild: (parentId: string | null, fallback?: string) => Promise<void>; onAddSibling: (node: TreeNode) => Promise<void>; onRename: (node: TreeNode) => Promise<void>; onDelete: (node: TreeNode) => Promise<void>; onMove: (node: TreeNode, direction: -1 | 1) => Promise<void>; onParent: (node: TreeNode) => Promise<void>; }) {
  return <div className="space-y-3"><article className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/70" style={{ marginLeft: `${Math.min(node.depth, 6) * 1.25}rem` }}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-800">Level {node.depth + 1}</span><code className="text-[10px] text-zinc-400">{node.id}</code></div><h3 className="mt-2 text-lg font-semibold">{node.title}</h3><p className="text-xs text-zinc-500">Parent: {node.parentId ? nodes.find((item) => item.id === node.parentId)?.title ?? "Unknown" : "Root"}</p></div><div className="flex flex-wrap gap-2"><button className={`${uiButtonClass} px-2.5 py-1.5 text-xs`} onClick={() => void onAddChild(node.id, "Child node")}>Add child</button><button className={`${uiButtonClass} px-2.5 py-1.5 text-xs`} onClick={() => void onAddSibling(node)}>Add sibling</button><button className={`${uiButtonClass} px-2.5 py-1.5 text-xs`} onClick={() => void onRename(node)}>Rename</button><button className={`${uiButtonClass} px-2.5 py-1.5 text-xs`} onClick={() => void onMove(node, -1)}>Move up</button><button className={`${uiButtonClass} px-2.5 py-1.5 text-xs`} onClick={() => void onMove(node, 1)}>Move down</button><button className={`${uiButtonClass} px-2.5 py-1.5 text-xs`} onClick={() => void onParent(node)}>Change parent</button><button className={`${uiDangerButtonClass} px-2.5 py-1.5 text-xs`} onClick={() => void onDelete(node)}>Delete</button></div></div></article>{node.children.map((child) => <TreeNodeRow key={child.id} node={child} nodes={nodes} onAddChild={onAddChild} onAddSibling={onAddSibling} onRename={onRename} onDelete={onDelete} onMove={onMove} onParent={onParent} />)}</div>;
}
function compareNode(a: TreeNode, b: TreeNode) { return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt); }
function buildTree(nodes: TreeNode[]) { const byParent = new Map<string, TreeNode[]>(); for (const node of nodes) { const key = node.parentId ?? "root"; byParent.set(key, [...(byParent.get(key) ?? []), node]); } for (const siblings of byParent.values()) siblings.sort(compareNode); const visit = (parentId: string | null, depth: number): NestedNode[] => (byParent.get(parentId ?? "root") ?? []).map((node) => ({ ...node, depth, children: visit(node.id, depth + 1) })); return visit(null, 0); }
