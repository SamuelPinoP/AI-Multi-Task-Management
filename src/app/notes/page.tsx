"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Project = {
  id: string;
  name: string;
  color: string | null;
};

type Note = {
  id: string;
  title: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  project: Project | null;
};

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const visibleNotes = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return notes.filter((note) => {
      const matchesProject = !projectFilter || note.projectId === projectFilter;
      if (!matchesProject) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const titleMatches = note.title.toLowerCase().includes(normalizedQuery);
      const contentMatches = (note.content ?? "")
        .toLowerCase()
        .includes(normalizedQuery);
      return titleMatches || contentMatches;
    });
  }, [notes, projectFilter, searchQuery]);

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

  async function fetchProjects() {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        throw new Error("Failed to fetch projects");
      }

      const data = await res.json();
      setProjects(data);
    } catch {
      setError("Could not load projects.");
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      await Promise.all([fetchNotes(), fetchProjects()]);
    }

    void loadInitialData();
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
          projectId,
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
      const message =
        err instanceof Error ? err.message : "Could not create note.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function startEditing(note: Note) {
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content ?? "");
    setEditProjectId(note.projectId ?? "");
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
          projectId: editProjectId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update note");
      }

      const updatedNote = (await res.json()) as Note;

      setNotes((prevNotes) =>
        prevNotes.map((note) => (note.id === noteId ? updatedNote : note)),
      );
      cancelEditing();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not update note.";
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
      const message =
        err instanceof Error ? err.message : "Could not delete note.";
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

          <section className="mb-10 rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
            <h2 className="mb-4 text-2xl font-semibold">Create a Note</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter a note title"
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Content (optional)
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your note here..."
                  rows={6}
                  className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Project (optional)
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
                >
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
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
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes by title or content..."
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
              />
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            {fetching ? (
              <p className="text-zinc-600 dark:text-zinc-300">
                Loading notes...
              </p>
            ) : notes.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/70 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <h3 className="text-lg font-semibold">No notes yet.</h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  Capture a meeting recap, class takeaway, research source, or
                  project decision using the form above. You can optionally
                  attach it to a project for easier review later.
                </p>
              </div>
            ) : visibleNotes.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                No notes match your filters. Try clearing the search text or
                selecting All projects.
              </p>
            ) : (
              <div className="space-y-4">
                {visibleNotes.map((note) => {
                  const isDeleting = deletingNoteId === note.id;
                  const isEditing = editingNoteId === note.id;

                  return (
                    <article
                      key={note.id}
                      className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800"
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full rounded-xl border border-zinc-300 px-4 py-2 outline-none focus:border-black dark:border-zinc-700"
                          />
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={5}
                            placeholder="Content (optional)"
                            className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
                          />
                          <select
                            value={editProjectId}
                            onChange={(e) => setEditProjectId(e.target.value)}
                            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
                          >
                            <option value="">No project</option>
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
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
                              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-xl font-semibold">
                                {note.title}
                              </h3>
                              {note.project ? (
                                <span className="mt-2 inline-flex rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                                  {note.project.name}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => startEditing(note)}
                                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-zinc-700"
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
                            <p className="mt-2 whitespace-pre-wrap text-gray-700">
                              {note.content}
                            </p>
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
      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="Confirm delete"
        message="This will move the item to Trash."
        loading={Boolean(deletingNoteId)}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) void handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </>
  );
}
