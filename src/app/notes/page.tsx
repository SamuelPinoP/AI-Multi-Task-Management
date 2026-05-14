"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Note = {
  id: string;
  title: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string } | null;
};
type Project = { id: string; name: string };

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [projectFilter, setProjectFilter] = useState("ALL");

  const visibleNotes = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return notes;
    }

    return notes.filter((note) => {
      const titleMatches = note.title.toLowerCase().includes(normalizedQuery);
      const contentMatches = (note.content ?? "").toLowerCase().includes(normalizedQuery);
      const filterMatches =
        projectFilter === "ALL"
          ? true
          : projectFilter === "NONE"
            ? note.project === null
            : note.project?.id === projectFilter;
      return (titleMatches || contentMatches) && filterMatches;
    });
  }, [notes, searchQuery, projectFilter]);

  async function fetchProjects() {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const data = (await res.json()) as Project[];
      setProjects(data);
    }
  }

  async function fetchNotes(showLoading = true) {
    try {
      if (showLoading) {
        setFetching(true);
      }
      setError("");

      const res = await fetch("/api/notes");
      if (!res.ok) {
        throw new Error("Failed to fetch notes");
      }

      const data = await res.json();
      setNotes(data);
    } catch {
      setError("Could not load notes.");
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    async function loadInitialNotes() {
      try {
        const res = await fetch("/api/notes");
        if (!res.ok) {
          throw new Error("Failed to fetch notes");
        }

        const data = await res.json();
        setNotes(data);
      } catch {
        setError("Could not load notes.");
      } finally {
        setFetching(false);
      }
    }

    void loadInitialNotes();
    void (async () => {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = (await res.json()) as Project[];
        setProjects(data);
      }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          content,
          projectId: projectId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create note");
      }

      setTitle("");
      setContent("");
      setProjectId("");
      await fetchNotes();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create note.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function startEditing(note: Note) {
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content ?? "");
    setEditProjectId(note.project?.id ?? "");
    setError("");
  }

  function cancelEditing() {
    setEditingNoteId(null);
    setEditTitle("");
    setEditContent("");
    setEditProjectId("");
  }

  async function handleSaveEdit(noteId: string) {
    if (!editTitle.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      setSavingEdit(true);
      setError("");

      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: editTitle,
          content: editContent,
          projectId: editProjectId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update note");
      }

      const updatedNote = (await res.json()) as Note;

      setNotes((prevNotes) =>
        prevNotes.map((note) => (note.id === noteId ? updatedNote : note))
      );
      cancelEditing();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update note.";
      setError(message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(noteId: string) {
    try {
      setDeletingNoteId(noteId);
      setError("");

      const res = await fetch(`/api/notes/${noteId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete note");
      }

      setNotes((prevNotes) => prevNotes.filter((note) => note.id !== noteId));
      if (editingNoteId === noteId) {
        cancelEditing();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete note.";
      setError(message);
    } finally {
      setDeletingNoteId(null);
    }
  }

  return (
    <>
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-4xl font-bold">Notes</h1>
        <p className="mb-8 text-zinc-600 dark:text-zinc-300">
          Create and manage your notes for AI-Multi Task-Management.
        </p>

        <section className="mb-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold">Create a Note</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a note title"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Project (optional)</label>
              <div className="flex gap-2">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3">
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <button type="button" onClick={async () => { const name = window.prompt("New project name"); if (!name?.trim()) return; await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); await fetchProjects(); }} className="rounded-xl border border-zinc-300 px-4 py-3 text-sm">+ Project</button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Content (optional)</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your note here..."
                rows={6}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-black px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Note"}
            </button>
          </form>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Your Notes</h2>
          <div className="mb-4">
            <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes by title or content..."
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
            />
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3">
              <option value="ALL">All projects</option>
              <option value="NONE">No project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            </div>
          </div>

          {fetching ? (
            <p className="text-zinc-600 dark:text-zinc-300">Loading notes...</p>
          ) : notes.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-300">No notes yet.</p>
          ) : visibleNotes.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-300">No notes match your search.</p>
          ) : (
            <div className="space-y-4">
              {visibleNotes.map((note) => {
                const isDeleting = deletingNoteId === note.id;
                const isEditing = editingNoteId === note.id;

                return (
                  <article
                    key={note.id}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm"
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2 outline-none focus:border-black"
                        />
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={5}
                          placeholder="Content (optional)"
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                        />
                        <select value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2">
                          <option value="">No project</option>
                          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(note.id)}
                            disabled={savingEdit}
                            className="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingEdit ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            disabled={savingEdit}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <h3 className="text-xl font-semibold">{note.title}</h3>
                          {note.project && <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs">{note.project.name}</span>}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => startEditing(note)}
                              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(note.id)}
                              disabled={isDeleting}
                              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </div>

                        {note.content ? (
                          <p className="mt-2 whitespace-pre-wrap text-gray-700">{note.content}</p>
                        ) : (
                          <p className="mt-2 text-gray-400">No content.</p>
                        )}
                        <p className="mt-4 text-sm text-gray-500">
                          Created: {new Date(note.createdAt).toLocaleString()}
                        </p>
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
    <ConfirmDialog open={Boolean(confirmDeleteId)} title="Confirm delete" message="This will move the item to Trash." loading={Boolean(deletingNoteId)} onCancel={() => setConfirmDeleteId(null)} onConfirm={() => { if (confirmDeleteId) void handleDelete(confirmDeleteId); setConfirmDeleteId(null); }} />
    </>
  );
}
