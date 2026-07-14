"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

type FocusTarget = "title" | "content";

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function getInitialOpenNoteId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("openNote");
}

function getInitialFocusTarget(): FocusTarget {
  if (typeof window === "undefined") return "content";
  return new URLSearchParams(window.location.search).get("focus") === "title"
    ? "title"
    : "content";
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(() =>
    getInitialOpenNoteId(),
  );
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [openedNoteId, setOpenedNoteId] = useState<string | null>(() =>
    getInitialOpenNoteId(),
  );
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(() =>
    getInitialFocusTarget(),
  );
  const [focusRequest, setFocusRequest] = useState(0);
  const [fullscreenNoteId, setFullscreenNoteId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionStartWordCountRef = useRef(0);
  const autoFullscreenTriggeredRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const latestDraftRef = useRef({
    noteId: "",
    title: "",
    content: "",
    projectId: "",
  });
  const lastSavedDraftRef = useRef({
    noteId: "",
    title: "",
    content: "",
    projectId: "",
  });

  const visibleNotes = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return notes.filter((note) => {
      const matchesProject = !projectFilter || note.projectId === projectFilter;
      if (!matchesProject) return false;
      if (!normalizedQuery) return true;

      const titleMatches = note.title.toLowerCase().includes(normalizedQuery);
      const contentMatches = (note.content ?? "")
        .toLowerCase()
        .includes(normalizedQuery);
      return titleMatches || contentMatches;
    });
  }, [notes, projectFilter, searchQuery]);

  async function fetchNotes(showLoading = true) {
    try {
      if (showLoading) setFetching(true);
      setError("");
      const res = await fetch("/api/notes");
      if (!res.ok) throw new Error("Failed to fetch notes");
      const data = (await res.json()) as Note[];
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
      if (!res.ok) throw new Error("Failed to fetch projects");
      const data = (await res.json()) as Project[];
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

  useEffect(() => {
    if (!openedNoteId) return;
    void markNoteOpened(openedNoteId);
  }, [openedNoteId]);

  useEffect(() => {
    if (!editingNoteId || editTitle || editContent || editProjectId) return;
    const note = notes.find((item) => item.id === editingNoteId);
    if (!note) return;
    const timer = window.setTimeout(() => {
      setEditTitle(note.title);
      setEditContent(note.content ?? "");
      setEditProjectId(note.projectId ?? "");
      latestDraftRef.current = {
        noteId: note.id,
        title: note.title,
        content: note.content ?? "",
        projectId: note.projectId ?? "",
      };
      lastSavedDraftRef.current = latestDraftRef.current;
      setSaveStatus("saved");
      sessionStartWordCountRef.current = wordCount(note.content ?? "");
      autoFullscreenTriggeredRef.current = null;
      setFocusRequest((count) => count + 1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editContent, editProjectId, editTitle, editingNoteId, notes]);

  useEffect(() => {
    if (!editingNoteId) return;
    const frame = window.requestAnimationFrame(() => {
      const target =
        focusTarget === "title"
          ? titleInputRef.current
          : contentTextareaRef.current;
      target?.focus();
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement
      ) {
        const end = target.value.length;
        target.setSelectionRange(end, end);
      }
      document
        .getElementById(`note-${editingNoteId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingNoteId, focusRequest, focusTarget]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreenNoteId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!editingNoteId) return;
    latestDraftRef.current = {
      noteId: editingNoteId,
      title: editTitle,
      content: editContent,
      projectId: editProjectId,
    };
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(
      () => void saveDraft(editingNoteId),
      250,
    );
    return () => {
      if (autosaveTimerRef.current)
        window.clearTimeout(autosaveTimerRef.current);
    };
    // saveDraft reads refs for the latest draft; including it would reschedule on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent, editProjectId, editTitle, editingNoteId]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flushAutosave();
    }
    window.addEventListener("beforeunload", flushAutosave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushAutosave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });

  async function markNoteOpened(noteId: string) {
    try {
      await fetch("/api/recent-shortcuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", id: noteId }),
      });
    } catch {}
  }

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, projectId }),
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
      setError(err instanceof Error ? err.message : "Could not create note.");
    } finally {
      setLoading(false);
    }
  }

  function openNote(note: Note, target: FocusTarget) {
    setOpenedNoteId(note.id);
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content ?? "");
    setEditProjectId(note.projectId ?? "");
    latestDraftRef.current = {
      noteId: note.id,
      title: note.title,
      content: note.content ?? "",
      projectId: note.projectId ?? "",
    };
    lastSavedDraftRef.current = latestDraftRef.current;
    setSaveStatus("saved");
    sessionStartWordCountRef.current = wordCount(note.content ?? "");
    autoFullscreenTriggeredRef.current = null;
    setFocusTarget(target);
    setFocusRequest((count) => count + 1);
    setError("");
    void markNoteOpened(note.id);
    const params = new URLSearchParams({ openNote: note.id, focus: target });
    window.history.replaceState(null, "", `/notes?${params.toString()}`);
  }

  function draftsMatch(
    a: typeof latestDraftRef.current,
    b: typeof latestDraftRef.current,
  ) {
    return (
      a.noteId === b.noteId &&
      a.title === b.title &&
      a.content === b.content &&
      a.projectId === b.projectId
    );
  }

  async function saveDraft(
    noteId: string,
    mode: "debounced" | "flush" = "debounced",
  ) {
    const draft = latestDraftRef.current;
    if (
      draft.noteId !== noteId ||
      draftsMatch(draft, lastSavedDraftRef.current)
    )
      return;
    if (!draft.title.trim()) {
      setSaveStatus("error");
      setError("Title is required before this note can autosave.");
      return;
    }
    try {
      setSavingEdit(true);
      setSaveStatus("saving");
      setError("");
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: mode === "flush",
        body: JSON.stringify({
          title: draft.title,
          content: draft.content,
          projectId: draft.projectId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update note");
      }
      const updatedNote = (await res.json()) as Note;
      lastSavedDraftRef.current = draft;
      setNotes((prevNotes) =>
        prevNotes.map((note) =>
          note.id === noteId
            ? {
                ...updatedNote,
                title:
                  latestDraftRef.current.noteId === noteId
                    ? latestDraftRef.current.title
                    : updatedNote.title,
                content:
                  latestDraftRef.current.noteId === noteId
                    ? latestDraftRef.current.content
                    : updatedNote.content,
                projectId:
                  latestDraftRef.current.noteId === noteId
                    ? latestDraftRef.current.projectId || null
                    : updatedNote.projectId,
              }
            : note,
        ),
      );
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Could not autosave note. Offline / retrying.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  function flushAutosave() {
    if (!editingNoteId) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    void saveDraft(editingNoteId, "flush");
  }

  async function handleDoneWriting(noteId: string) {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    await saveDraft(noteId, "flush");
    setFullscreenNoteId(null);
    setEditingNoteId(null);
    window.history.replaceState(null, "", "/notes");
  }

  function handleContentChange(value: string) {
    setEditContent(value);
    if (!editingNoteId || autoFullscreenTriggeredRef.current === editingNoteId)
      return;
    if (wordCount(value) - sessionStartWordCountRef.current >= 10) {
      autoFullscreenTriggeredRef.current = editingNoteId;
      setFullscreenNoteId(editingNoteId);
    }
  }

  async function handleDelete(noteId: string) {
    try {
      setDeletingNoteId(noteId);
      setError("");
      const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete note");
      }
      setNotes((prevNotes) => prevNotes.filter((note) => note.id !== noteId));
      if (editingNoteId === noteId) setEditingNoteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete note.");
    } finally {
      setDeletingNoteId(null);
    }
  }

  const activeNote = editingNoteId
    ? notes.find((note) => note.id === editingNoteId)
    : null;

  function renderEditor(note: Note, compact = false) {
    const isFullscreen = fullscreenNoteId === note.id;
    return (
      <div className={compact ? "space-y-4" : "space-y-5"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            Writing mode
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFullscreenNoteId(note.id)}
              className="rounded-full border border-zinc-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Full screen
            </button>
            <button
              type="button"
              onClick={() => void handleDoneWriting(note.id)}
              className="rounded-full bg-zinc-950 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white dark:focus:ring-offset-zinc-950"
            >
              Done
            </button>
          </div>
        </div>
        <input
          ref={titleInputRef}
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={flushAutosave}
          className="w-full rounded-2xl border border-zinc-200 bg-white/90 px-5 py-4 text-2xl font-semibold outline-none shadow-sm transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-zinc-800 dark:bg-zinc-950/80 dark:focus:ring-blue-950/60"
        />
        <textarea
          ref={contentTextareaRef}
          value={editContent}
          onChange={(e) => handleContentChange(e.target.value)}
          onBlur={flushAutosave}
          rows={isFullscreen ? 18 : 10}
          placeholder="Start writing..."
          className="min-h-80 w-full resize-y rounded-2xl border border-zinc-200 bg-white/90 px-5 py-4 text-base leading-8 outline-none shadow-sm transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-zinc-800 dark:bg-zinc-950/80 dark:focus:ring-blue-950/60 sm:text-lg"
        />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <select
            value={editProjectId}
            onChange={(e) => setEditProjectId(e.target.value)}
            onBlur={flushAutosave}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-blue-950/60"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <span
            className={`justify-self-start rounded-full border px-3 py-1.5 text-xs font-semibold sm:justify-self-end ${saveStatus === "error" ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"}`}
          >
            {saveStatus === "saving" || savingEdit
              ? "Saving…"
              : saveStatus === "error"
                ? "Offline / retrying"
                : "Saved"}
          </span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Last updated {new Date(note.updatedAt).toLocaleString()}. Press Escape
          to exit full-screen.
        </p>
      </div>
    );
  }

  return (
    <>
      <main className="min-h-screen px-6 py-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-2 text-4xl font-bold">Notes</h1>
          <p className="mb-8 text-zinc-600 dark:text-zinc-300">
            Create and manage your notes for AI-Multi Task-Management.
          </p>

          <section className="mb-10 rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
            <h2 className="mb-4 text-2xl font-semibold">Create a Note</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a note title"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your note here..."
                rows={6}
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-black dark:border-zinc-700"
              />
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-black dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
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
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-black dark:border-zinc-700 dark:bg-zinc-950"
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
                  project decision using the form above.
                </p>
              </div>
            ) : visibleNotes.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                No notes match your filters.
              </p>
            ) : (
              <div className="space-y-5">
                {visibleNotes.map((note) => {
                  const isDeleting = deletingNoteId === note.id;
                  const isEditing = editingNoteId === note.id;
                  return (
                    <article
                      key={note.id}
                      id={`note-${note.id}`}
                      className={`rounded-3xl border p-5 shadow-sm transition ${openedNoteId === note.id ? "border-blue-300 bg-blue-50/60 ring-2 ring-blue-200 dark:border-blue-800 dark:bg-blue-950/20 dark:ring-blue-900/60" : "border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-950/40"}`}
                    >
                      {isEditing ? (
                        renderEditor(note)
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                          <button
                            type="button"
                            onClick={() => openNote(note, "title")}
                            className="min-w-0 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-2xl"
                          >
                            <h3 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
                              {note.title}
                            </h3>
                            {note.project ? (
                              <span className="mt-2 inline-flex rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                                {note.project.name}
                              </span>
                            ) : null}
                          </button>
                          <div className="flex gap-2 sm:justify-end">
                            <button
                              type="button"
                              onClick={() => openNote(note, "content")}
                              className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                            >
                              Open & write
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
                          <button
                            type="button"
                            onClick={() => openNote(note, "content")}
                            className="text-left sm:col-span-2 rounded-2xl p-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {note.content ? (
                              <p className="whitespace-pre-wrap text-gray-700 dark:text-zinc-300">
                                {note.content}
                              </p>
                            ) : (
                              <p className="text-gray-400">
                                No content. Click here to start writing.
                              </p>
                            )}
                            <p className="mt-4 text-sm text-gray-500">
                              Updated:{" "}
                              {new Date(note.updatedAt).toLocaleString()}
                            </p>
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {fullscreenNoteId && activeNote ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-white/95 px-4 py-5 backdrop-blur-xl transition dark:bg-zinc-950/95 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                Focused note
              </p>
              <button
                type="button"
                onClick={() => setFullscreenNoteId(null)}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                × Close
              </button>
            </div>
            <div className="rounded-[2rem] border border-zinc-200 bg-zinc-50/80 p-4 shadow-2xl shadow-zinc-300/30 dark:border-zinc-800 dark:bg-zinc-900/70 dark:shadow-none sm:p-7">
              {renderEditor(activeNote, true)}
            </div>
          </div>
        </div>
      ) : null}

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
