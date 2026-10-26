"use client";

/**
 * Notes: the list first, the editor second (DES-02).
 *
 * - Quick add takes a title and opens the new note for writing.
 * - Search and a project filter above a grid of note cards.
 * - Notes open in a side sheet editor that autosaves while you type
 *   (debounced), on blur, on Done and when the page is hidden. It can
 *   expand to the full width.
 * - `/notes?openNote=<id>&focus=title|content` opens a note directly.
 */

import { ListPlus, Maximize2, Minimize2, Search, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QUICK_ADD_INPUT_ID, QuickAdd } from "@/components/home/quick-add";
import { NoteLinksPanel } from "@/components/notes/note-links-panel";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/home-summary";
import { taskFromSelection } from "@/lib/note-links";
import { projectColor } from "@/lib/project-color";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

type Project = { id: string; name: string; color: string | null };

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
type Draft = { noteId: string; title: string; content: string; projectId: string };

const emptyDraft: Draft = { noteId: "", title: "", content: "", projectId: "" };

/** Reads /notes?openNote=<id> so a link opens the right note. */
function getInitialOpenNoteId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("openNote");
}

/** Reads /notes?focus=title|content. */
function getInitialFocusTarget(): FocusTarget {
  if (typeof window === "undefined") return "content";
  return new URLSearchParams(window.location.search).get("focus") === "title" ? "title" : "content";
}

function draftsMatch(a: Draft, b: Draft) {
  return a.noteId === b.noteId && a.title === b.title && a.content === b.content && a.projectId === b.projectId;
}

const controlClass =
  "min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export default function NotesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  // The note open in the editor sheet, and its fields.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(() => getInitialOpenNoteId());
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(() => getInitialFocusTarget());
  const [focusRequest, setFocusRequest] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  // In-app links (a task's note, meeting notes) change ?openNote= without reloading
  // the page, and window.location can still show the old URL on the first render.
  const linkedNoteId = searchParams.get("openNote");
  const [seenLinkedNoteId, setSeenLinkedNoteId] = useState(() => getInitialOpenNoteId());
  if (linkedNoteId !== seenLinkedNoteId) {
    setSeenLinkedNoteId(linkedNoteId);
    if (linkedNoteId && linkedNoteId !== editingNoteId) {
      setEditingNoteId(linkedNoteId);
      setFocusTarget(searchParams.get("focus") === "title" ? "title" : "content");
    }
  }
  // SMART-05: the text selected in the editor, and a counter that refreshes the links panel.
  const [selection, setSelection] = useState("");
  const [linksVersion, setLinksVersion] = useState(0);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  // The newest editor values, and the last version the server accepted.
  // Comparing them avoids saving when nothing changed.
  const latestDraftRef = useRef<Draft>(emptyDraft);
  const lastSavedDraftRef = useRef<Draft>(emptyDraft);

  const visibleNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return notes.filter(
      (note) =>
        (!projectFilter || note.projectId === projectFilter) &&
        (!query || note.title.toLowerCase().includes(query) || (note.content ?? "").toLowerCase().includes(query)),
    );
  }, [notes, projectFilter, searchQuery]);

  async function fetchNotes() {
    try {
      const response = await fetch("/api/notes");
      if (!response.ok) throw new Error();
      setNotes((await response.json()) as Note[]);
      setLoadError("");
    } catch {
      setLoadError("Could not load notes.");
    } finally {
      setFetching(false);
    }
  }

  async function fetchProjects() {
    try {
      const response = await fetch("/api/projects");
      if (response.ok) setProjects((await response.json()) as Project[]);
    } catch {
      // The project selects stay empty; notes still load.
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      await Promise.all([fetchNotes(), fetchProjects()]);
    }
    void loadInitialData();
  }, []);

  // Notes changed on another device show up on coming back. The note open in the
  // editor keeps the copy here, so a refresh never undoes what was just typed.
  useRefreshOnReturn(() => {
    void fetchProjects();
    void (async () => {
      try {
        const response = await fetch("/api/notes");
        if (!response.ok) return;
        const fresh = (await response.json()) as Note[];
        setNotes((current) =>
          fresh.map((note) => (note.id === editingNoteId ? (current.find((item) => item.id === note.id) ?? note) : note)),
        );
      } catch {
        // Offline or a hiccup: keep the list; the next return tries again.
      }
    })();
  });

  // A linked note (?openNote=) fills the editor once the notes have loaded.
  const fillLinkedNote = useEffectEvent((note: Note) => loadIntoEditor(note));
  useEffect(() => {
    if (!editingNoteId || latestDraftRef.current.noteId === editingNoteId) return;
    const note = notes.find((item) => item.id === editingNoteId);
    if (!note) return;
    const timer = window.setTimeout(() => fillLinkedNote(note), 0);
    return () => window.clearTimeout(timer);
  }, [editingNoteId, notes]);

  useEffect(() => {
    if (!editingNoteId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = focusTarget === "title" ? titleInputRef.current : contentTextareaRef.current;
      target?.focus();
      if (target) target.setSelectionRange(target.value.length, target.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingNoteId, focusRequest, focusTarget]);

  // Debounced autosave while typing.
  useEffect(() => {
    if (!editingNoteId || latestDraftRef.current.noteId !== editingNoteId) return;
    latestDraftRef.current = { noteId: editingNoteId, title: editTitle, content: editContent, projectId: editProjectId };
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => void saveDraft(editingNoteId), 250);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [editContent, editProjectId, editTitle, editingNoteId]);

  // Save right away when the tab is hidden or the page unloads.
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

  /** Marks a note as recently opened so Home's "Jump back in" can continue from it. */
  async function markNoteOpened(noteId: string) {
    try {
      await fetch("/api/recent-shortcuts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", id: noteId }),
      });
    } catch {}
  }

  function loadIntoEditor(note: Note) {
    setEditTitle(note.title);
    setEditContent(note.content ?? "");
    setEditProjectId(note.projectId ?? "");
    latestDraftRef.current = { noteId: note.id, title: note.title, content: note.content ?? "", projectId: note.projectId ?? "" };
    lastSavedDraftRef.current = latestDraftRef.current;
    setSaveStatus("saved");
    setSaveError("");
    setFocusRequest((count) => count + 1);
    void markNoteOpened(note.id);
  }

  function openNote(note: Note, target: FocusTarget) {
    setEditingNoteId(note.id);
    setFocusTarget(target);
    loadIntoEditor(note);
    window.history.replaceState(null, "", `/notes?${new URLSearchParams({ openNote: note.id, focus: target })}`);
  }

  async function saveDraft(noteId: string, mode: "debounced" | "flush" = "debounced") {
    const draft = latestDraftRef.current;
    if (draft.noteId !== noteId || draftsMatch(draft, lastSavedDraftRef.current)) return;
    if (!draft.title.trim() && !draft.content.trim()) {
      setSaveStatus("error");
      setSaveError("Add a title or some text before saving.");
      return;
    }
    try {
      setSaveStatus("saving");
      setSaveError("");
      const response = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: mode === "flush",
        body: JSON.stringify({ title: draft.title, content: draft.content, projectId: draft.projectId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Could not save the note.");
      }
      const updated = (await response.json()) as Note;
      lastSavedDraftRef.current = draft;
      // Keep what is in the editor now, in case the user typed during the request.
      const latest = latestDraftRef.current;
      setNotes((current) =>
        current.map((note) =>
          note.id === noteId
            ? latest.noteId === noteId
              ? { ...updated, title: latest.title, content: latest.content, projectId: latest.projectId || null }
              : updated
            : note,
        ),
      );
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Could not save. Retrying when you type again.");
    }
  }

  function flushAutosave() {
    if (!editingNoteId) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    void saveDraft(editingNoteId, "flush");
  }

  /**
   * Closes the editor right away and saves the latest draft in the
   * background (saveDraft reads the draft before its first await, and the
   * keepalive request outlives a navigation).
   */
  function closeEditor() {
    const noteId = editingNoteId;
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (noteId) void saveDraft(noteId, "flush");
    setEditingNoteId(null);
    setExpanded(false);
    window.history.replaceState(null, "", "/notes");
  }

  async function deleteNote(note: Note) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Could not delete the note.");
      }
      if (editingNoteId === note.id) {
        if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
        setEditingNoteId(null);
        setExpanded(false);
        latestDraftRef.current = emptyDraft;
        lastSavedDraftRef.current = emptyDraft;
        window.history.replaceState(null, "", "/notes");
      }
      setNotes((current) => current.filter((item) => item.id !== note.id));
      notifyWorkspaceChanged();
      toast.success("Moved to Trash", { description: note.title || "Untitled note" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the note.");
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const activeNote = editingNoteId ? notes.find((note) => note.id === editingNoteId) ?? null : null;
  const selectedTask = taskFromSelection(selection);

  /** "Turn selection into task": the selected text becomes a task that points back to this note. */
  async function turnSelectionIntoTask() {
    if (!editingNoteId || !selectedTask.title) return;
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selectedTask, noteId: editingNoteId }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) throw new Error(body?.error ?? "Could not create the task.");
      const taskId = body.id;
      setLinksVersion((value) => value + 1);
      notifyWorkspaceChanged();
      toast.success("Task created", {
        description: selectedTask.title,
        action: { label: "View", onClick: () => router.push(`/tasks?task=${taskId}`) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the task.");
    }
  }

  /** Opens another note from a [[link]] or a backlink, saving this one first. */
  async function openNoteById(id: string) {
    flushAutosave();
    let note = notes.find((item) => item.id === id);
    if (!note) {
      const response = await fetch("/api/notes");
      if (!response.ok) return;
      const fresh = (await response.json()) as Note[];
      setNotes(fresh);
      note = fresh.find((item) => item.id === id);
    }
    if (note) openNote(note, "content");
  }

  /** Creates the note a [[link]] names, in this note's project, and opens it. */
  async function createLinkedNote(title: string) {
    flushAutosave();
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: "", projectId: editProjectId || null }),
      });
      if (!response.ok) throw new Error();
      const note = (await response.json()) as Note;
      setNotes((current) => [note, ...current]);
      notifyWorkspaceChanged();
      openNote(note, "content");
    } catch {
      toast.error("Could not create the note.");
    }
  }
  const realNow = new Date();

  return (
    <div className="mx-auto grid w-full grid-cols-1 max-w-5xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Notes</h1>
          <p className="mt-0.5 text-sm text-muted">{fetching ? "Loading..." : `${notes.length} note${notes.length === 1 ? "" : "s"}`}</p>
        </div>
      </header>

      <QuickAdd
        label="New note title"
        placeholder="Name a new note and press Enter"
        endpoint="/api/notes"
        field="title"
        quiet
        onAdded={(id, title) => {
          // Open the new note for writing right away; the refetch brings the server's copy.
          const now = new Date().toISOString();
          const note: Note = { id, title, content: "", createdAt: now, updatedAt: now, projectId: null, project: null };
          setNotes((current) => [note, ...current]);
          openNote(note, "content");
          void fetchNotes();
        }}
      />

      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter notes">
        <label className="relative flex min-w-48 flex-1 items-center">
          <span className="sr-only">Search notes</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search notes"
            className={cn(controlClass, "w-full pl-8")}
          />
        </label>
        <select aria-label="Project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={controlClass}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}{" "}
          <button type="button" onClick={() => void fetchNotes()} className="font-semibold underline">Try again</button>
        </p>
      ) : null}

      {fetching ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading notes">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : visibleNotes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
          <h2 className="text-base font-semibold">{notes.length === 0 ? "No notes yet." : "No notes match these filters."}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {notes.length === 0
              ? "Capture meeting takeaways, research and ideas. Link a note to a project to share it with the team."
              : "Clear the search or switch back to all projects."}
          </p>
          {notes.length === 0 ? (
            <label htmlFor={QUICK_ADD_INPUT_ID} className={cn(uiButtonClass, "mt-4 cursor-pointer px-3 py-1.5")}>
              Write your first note
            </label>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleNotes.map((note) => {
            const title = note.title.trim();
            const body = (note.content ?? "").trim();
            return (
              <li key={note.id} id={`note-${note.id}`}>
                <div
                  className={cn(
                    "relative flex h-full w-full flex-col rounded-xl border bg-surface p-4 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700",
                    editingNoteId === note.id ? "border-accent" : "border-line",
                  )}
                >
                  {/* The title is the button's whole label; its ::after covers the card, so the whole card opens the note. */}
                  <button
                    type="button"
                    onClick={() => openNote(note, "content")}
                    className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
                  >
                    <span className={cn("line-clamp-2 text-[15px] font-semibold", !title && "text-muted")}>{title || "Untitled note"}</span>
                    {!title && body ? <span className="sr-only">: {body.slice(0, 60)}</span> : null}
                  </button>
                  {body ? <span className="mt-1.5 line-clamp-4 whitespace-pre-line text-sm text-muted">{body}</span> : null}
                  <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted">
                    {note.project ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: projectColor(note.project) }} />
                        {note.project.name}
                      </span>
                    ) : null}
                    <span>Edited {relativeTime(new Date(note.updatedAt), realNow) === "now" ? "just now" : `${relativeTime(new Date(note.updatedAt), realNow)} ago`}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={Boolean(editingNoteId)} onOpenChange={(open) => {
          if (!open) closeEditor();
        }}>
        <SheetContent hideClose className={cn("gap-3 p-4 sm:p-6", expanded ? "max-w-none" : "max-w-2xl")}>
          <SheetTitle className="sr-only">{activeNote?.title || "Note"}</SheetTitle>
          <SheetDescription className="sr-only">Changes save as you type.</SheetDescription>
          <div className="flex items-center gap-2">
            <span
              role="status"
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                saveStatus === "error" ? "bg-warning-soft text-warning" : "bg-canvas text-muted",
              )}
            >
              {saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Not saved" : "Saved"}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-label={expanded ? "Exit full width" : "Full width"}
                title={expanded ? "Exit full width" : "Full width"}
                className="hidden h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink sm:grid"
              >
                {expanded ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}
              </button>
              {activeNote ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(activeNote)}
                  aria-label="Delete note"
                  title="Delete note"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
              <button type="button" onClick={closeEditor} className={cn(uiPrimaryButtonClass, "ml-1 px-3 py-1.5")}>
                Done
              </button>
            </span>
          </div>
          {saveError ? <p role="alert" className="text-sm text-warning">{saveError}</p> : null}
          <label className="sr-only" htmlFor="note-title">Title</label>
          <input
            id="note-title"
            ref={titleInputRef}
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            onBlur={flushAutosave}
            placeholder="Untitled note"
            className="w-full bg-transparent text-2xl font-bold tracking-tight text-ink outline-none placeholder:text-muted/70"
          />
          <label className="sr-only" htmlFor="note-content">Note</label>
          <textarea
            id="note-content"
            ref={contentTextareaRef}
            value={editContent}
            onChange={(event) => setEditContent(event.target.value)}
            onSelect={(event) => setSelection(event.currentTarget.value.slice(event.currentTarget.selectionStart, event.currentTarget.selectionEnd))}
            onBlur={flushAutosave}
            placeholder="Start writing..."
            className="min-h-64 w-full flex-1 resize-none bg-transparent text-base leading-7 text-ink outline-none placeholder:text-muted/70"
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
            <label className="flex items-center gap-2">
              Project
              <select value={editProjectId} onChange={(event) => setEditProjectId(event.target.value)} onBlur={flushAutosave} className={controlClass}>
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              // Keep the textarea's selection when the button is pressed.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void turnSelectionIntoTask()}
              disabled={!selectedTask.title}
              title={selectedTask.title ? undefined : "Select text in the note first"}
              className={cn(uiButtonClass, "px-2.5 py-1 text-xs")}
            >
              <ListPlus aria-hidden="true" className="h-3.5 w-3.5" />
              Turn selection into task
            </button>
            {activeNote ? <span className="ml-auto">Last updated {new Date(activeNote.updatedAt).toLocaleString()}</span> : null}
          </div>
          {activeNote ? (
            <NoteLinksPanel
              noteId={activeNote.id}
              version={`${activeNote.updatedAt}:${linksVersion}`}
              onOpenNote={(id) => void openNoteById(id)}
              onCreateNote={(title) => void createLinkedNote(title)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this note?"
        message={confirmDelete ? `“${confirmDelete.title || "Untitled note"}” moves to Trash, where you can restore it.` : ""}
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void deleteNote(confirmDelete);
        }}
      />
    </div>
  );
}
