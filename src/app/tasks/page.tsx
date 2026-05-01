"use client";

import { FormEvent, useEffect, useState } from "react";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("TODO");
  const [editPriority, setEditPriority] = useState<Priority>("MEDIUM");
  const [editDueDate, setEditDueDate] = useState("");

  async function fetchTasks(showLoading = true) {
    try {
      if (showLoading) setFetching(true);
      setError("");

      const res = await fetch("/api/tasks");
      if (!res.ok) {
        throw new Error("Failed to fetch tasks");
      }

      const data = (await res.json()) as Task[];
      setTasks(data);
    } catch {
      setError("Could not load tasks.");
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    async function loadInitialTasks() {
      await fetchTasks();
    }

    void loadInitialTasks();
  }, []);

  async function handleCreateTask(e: FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          status,
          priority,
          dueDate: dueDate || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create task");
      }

      setTitle("");
      setDescription("");
      setStatus("TODO");
      setPriority("MEDIUM");
      setDueDate("");
      await fetchTasks(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create task.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function startEditing(task: Task) {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description ?? "");
    setEditStatus(task.status);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "");
    setError("");
  }

  function cancelEditing() {
    setEditingTaskId(null);
    setEditTitle("");
    setEditDescription("");
    setEditStatus("TODO");
    setEditPriority("MEDIUM");
    setEditDueDate("");
  }

  async function handleSaveEdit(taskId: string) {
    if (!editTitle.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      setSavingEdit(true);
      setError("");

      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          status: editStatus,
          priority: editPriority,
          dueDate: editDueDate || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task");
      }

      const updatedTask = (await res.json()) as Task;
      setTasks((prev) => prev.map((task) => (task.id === taskId ? updatedTask : task)));
      cancelEditing();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update task.";
      setError(message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleComplete(task: Task) {
    const nextStatus: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";

    try {
      setTogglingTaskId(task.id);
      setError("");

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description ?? "",
          status: nextStatus,
          priority: task.priority,
          dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task status");
      }

      const updatedTask = (await res.json()) as Task;
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updatedTask : item)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update task status.";
      setError(message);
    } finally {
      setTogglingTaskId(null);
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (!window.confirm("Are you sure you want to delete this task?")) return;

    try {
      setDeletingTaskId(taskId);
      setError("");

      const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete task");
      }

      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      if (editingTaskId === taskId) {
        cancelEditing();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete task.";
      setError(message);
    } finally {
      setDeletingTaskId(null);
    }
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-4xl font-bold">Tasks</h1>
        <p className="mb-8 text-gray-600">Create and manage your tasks for AI-Multi Task-Management.</p>

        <section className="mb-10 rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold">Create Task</h2>
          <form onSubmit={handleCreateTask} className="space-y-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={4} className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black" />
            <div className="grid gap-3 sm:grid-cols-3">
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black">
                <option value="TODO">To Do</option><option value="IN_PROGRESS">In Progress</option><option value="DONE">Done</option>
              </select>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black">
                <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
              </select>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black" />
            </div>
            <button type="submit" disabled={loading} className="rounded-xl bg-black px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-50">{loading ? "Creating..." : "Create Task"}</button>
          </form>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Your Tasks</h2>
          {fetching ? <p className="text-gray-600">Loading tasks...</p> : tasks.length === 0 ? <p className="text-gray-600">No tasks yet.</p> : (
            <div className="space-y-4">
              {tasks.map((task) => {
                const isEditing = editingTaskId === task.id;
                const isDeleting = deletingTaskId === task.id;
                const isToggling = togglingTaskId === task.id;

                return (
                  <article key={task.id} className="rounded-2xl border border-gray-200 p-5 shadow-sm">
                    {isEditing ? (
                      <div className="space-y-3">
                        <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-2 outline-none focus:border-black" />
                        <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black" />
                        <div className="grid gap-3 sm:grid-cols-3">
                          <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as TaskStatus)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"><option value="TODO">To Do</option><option value="IN_PROGRESS">In Progress</option><option value="DONE">Done</option></select>
                          <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as Priority)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select>
                          <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black" />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void handleSaveEdit(task.id)} disabled={savingEdit} className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">{savingEdit ? "Saving..." : "Save"}</button>
                          <button type="button" onClick={cancelEditing} disabled={savingEdit} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <h3 className="text-xl font-semibold">{task.title}</h3>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => startEditing(task)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">Edit</button>
                            <button type="button" onClick={() => void handleToggleComplete(task)} disabled={isToggling} className="rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 disabled:opacity-60">{isToggling ? "Updating..." : task.status === "DONE" ? "Mark Incomplete" : "Mark Done"}</button>
                            <button type="button" onClick={() => void handleDeleteTask(task.id)} disabled={isDeleting} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 disabled:opacity-60">{isDeleting ? "Deleting..." : "Delete"}</button>
                          </div>
                        </div>
                        <p className="mt-2 text-gray-700">{task.description || "No description."}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-600">
                          <span>Status: <strong>{task.status}</strong></span>
                          <span>Priority: <strong>{task.priority}</strong></span>
                          <span>Due: <strong>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}</strong></span>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
