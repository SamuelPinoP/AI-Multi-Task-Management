"use client";

import { useEffect, useState } from "react";

type TrashItem = { id: string; title: string; deletedAt: string | null };

export default function TrashPage() {
  const [notes, setNotes] = useState<TrashItem[]>([]);
  const [tasks, setTasks] = useState<TrashItem[]>([]);
  const [events, setEvents] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function loadTrash() {
    const res = await fetch("/api/trash");
    if (!res.ok) throw new Error("Failed to load trash");
    const data = await res.json();
    setNotes(data.notes);
    setTasks(data.tasks);
    setEvents(data.events);
  }

  useEffect(() => {
    async function init() {
      try {
        await loadTrash();
      } catch {
        setError("Could not load trash.");
      } finally {
        setLoading(false);
      }
    }

    void init();
  }, []);

  async function restore(type: "note" | "task" | "event", id: string) {
    try {
      setRestoringId(id);
      setError("");
      const res = await fetch("/api/trash", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id }),
      });
      if (!res.ok) throw new Error("Failed to restore item");
      await loadTrash();
    } catch {
      setError("Could not restore item.");
    } finally {
      setRestoringId(null);
    }
  }

  const renderSection = (title: string, type: "note" | "task" | "event", items: TrashItem[]) => (
    <section className="rounded-2xl border border-gray-200 p-6 shadow-sm">
      <h2 className="mb-4 text-2xl font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-gray-600">No deleted {title.toLowerCase()}.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-4">
              <div>
                <p className="font-medium">{item.title}</p>
              </div>
              <button onClick={() => void restore(type, item.id)} disabled={restoringId === item.id} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm transition hover:bg-gray-50 disabled:opacity-60">
                {restoringId === item.id ? "Restoring..." : "Restore"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  return <main className="min-h-screen bg-white px-6 py-10 text-black"><div className="mx-auto max-w-4xl"><h1 className="mb-2 text-4xl font-bold">Trash</h1><p className="mb-8 text-gray-600">Restore deleted notes, tasks, and events.</p>{error && <p className="mb-4 text-sm text-red-600">{error}</p>}{loading ? <p className="text-gray-600">Loading trash...</p> : <div className="space-y-6">{renderSection("Notes", "note", notes)}{renderSection("Tasks", "task", tasks)}{renderSection("Events", "event", events)}</div>}</div></main>;
}
