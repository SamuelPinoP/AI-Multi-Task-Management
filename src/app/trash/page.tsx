"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

type TrashItem = { id: string; title: string; deletedAt: string | null; projectName: string | null; deletedByName: string | null; ownedByYou: boolean };

/** "In Launch plan · Deleted by Ana": where a shared item lives and who removed it. */
function itemDetails(item: TrashItem) {
  return [item.projectName && `In ${item.projectName}`, item.deletedByName && `Deleted by ${item.deletedByName}`].filter(Boolean).join(" · ");
}

export default function TrashPage() {
  const [notes, setNotes] = useState<TrashItem[]>([]);
  const [tasks, setTasks] = useState<TrashItem[]>([]);
  const [events, setEvents] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadTrash() { const res = await fetch("/api/trash"); if (!res.ok) throw new Error("Failed to load trash"); const data = await res.json(); setNotes(data.notes); setTasks(data.tasks); setEvents(data.events); }
  useEffect(() => { void (async () => { try { await loadTrash(); } catch { setError("Could not load trash."); } finally { setLoading(false); } })(); }, []);
  // Items a teammate deleted or restored show up on coming back; a failed refresh keeps the list.
  useRefreshOnReturn(() => { void loadTrash().catch(() => undefined); });
  async function restore(type: "note" | "task" | "event", id: string) { try { setRestoringId(id); setError(""); setMessage(""); const res = await fetch("/api/trash", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, id }) }); if (!res.ok) throw new Error("Failed to restore item"); setMessage("Item restored."); notifyWorkspaceChanged(); await loadTrash(); } catch { setError("Could not restore item."); } finally { setRestoringId(null); } }
  async function emptyTrash() { try { setEmptying(true); setError(""); setMessage(""); const res = await fetch('/api/trash', { method: 'DELETE' }); if (!res.ok) throw new Error('Failed to empty trash'); setMessage('Trash emptied successfully.'); await loadTrash(); } catch { setError('Could not empty trash.'); } finally { setEmptying(false); setShowConfirm(false); } }
  const renderSection = (title: string, type: "note" | "task" | "event", items: TrashItem[]) => (<section className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"><h2 className="mb-4 text-2xl font-semibold">{title}</h2>{items.length === 0 ? (<p className="text-zinc-600 dark:text-zinc-300">No deleted {title.toLowerCase()}.</p>) : (<div className="space-y-3">{items.map((item) => (<article key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"><div className="min-w-0"><p className="font-medium">{item.title}</p>{itemDetails(item) && <p className="text-sm text-zinc-500 dark:text-zinc-400">{itemDetails(item)}</p>}</div><button onClick={() => void restore(type, item.id)} disabled={restoringId === item.id} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 disabled:opacity-60">{restoringId === item.id ? "Restoring..." : "Restore"}</button></article>))}</div>)}</section>);

  return <><main className="min-h-screen px-6 py-10"><div className="mx-auto max-w-4xl"><div className="mb-4 flex items-center justify-between gap-4"><div><h1 className="mb-2 text-title">Trash</h1><p className="text-zinc-600 dark:text-zinc-300">Restore deleted notes, tasks, and events, including ones deleted in projects you can edit.</p></div><button onClick={() => setShowConfirm(true)} disabled={emptying || ![...notes, ...tasks, ...events].some((item) => item.ownedByYou)} className="rounded-xl bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50">Empty Trash</button></div>{error && <p className="mb-4 text-sm text-red-600">{error}</p>}{message && <p className="mb-4 text-sm text-emerald-600">{message}</p>}{loading ? <p className="text-zinc-600 dark:text-zinc-300">Loading trash...</p> : <div className="space-y-6">{renderSection("Notes", "note", notes)}{renderSection("Tasks", "task", tasks)}{renderSection("Events", "event", events)}</div>}</div></main><ConfirmDialog open={showConfirm} title="Empty trash?" message="This permanently deletes the trashed notes, tasks, and events you own. Items teammates own stay here until they empty their trash." confirmLabel="Empty Trash" loading={emptying} onCancel={() => setShowConfirm(false)} onConfirm={() => void emptyTrash()} /></>;
}
