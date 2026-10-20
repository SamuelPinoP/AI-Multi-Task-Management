"use client";

import {
  CalendarDays,
  CalendarClock,
  SquareCheckBig,
  FolderKanban,
  House,
  Keyboard,
  Map as MapIcon,
  Moon,
  NotebookPen,
  Plus,
  Sparkles,
  SquareKanban,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { projectColor } from "@/lib/project-color";
import { formatTaskDueDate } from "@/lib/task-date-buckets";

type ProjectRef = { id: string; name: string; color: string | null };
type SearchData = {
  projects: ProjectRef[];
  notes: Array<{ id: string; title: string; createdAt: string; project: ProjectRef | null }>;
  tasks: Array<{ id: string; title: string; dueDate: string | null; status: string; project: ProjectRef | null }>;
  events: Array<{ id: string; title: string; startTime: string; project: ProjectRef | null }>;
};

const emptyResults: SearchData = { projects: [], notes: [], tasks: [], events: [] };

const pages: Array<{ href: string; label: string; icon: LucideIcon; keywords?: string }> = [
  { href: "/", label: "Home", icon: House, keywords: "dashboard" },
  { href: "/today", label: "My day", icon: Sun, keywords: "today focus" },
  { href: "/tasks", label: "Tasks", icon: SquareCheckBig },
  { href: "/events", label: "Events", icon: CalendarClock },
  { href: "/events/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/board", label: "Boards", icon: SquareKanban, keywords: "kanban tree task board" },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/planner", label: "Planner", icon: Sparkles, keywords: "smart plan" },
  { href: "/roadmap", label: "Roadmap", icon: MapIcon },
  { href: "/trash", label: "Trash", icon: Trash2, keywords: "deleted restore" },
];

function matches(query: string, ...texts: Array<string | undefined>) {
  const needle = query.trim().toLowerCase();
  return !needle || texts.some((text) => text?.toLowerCase().includes(needle));
}

function ProjectTag({ project }: { project: ProjectRef | null }) {
  if (!project) return null;
  return (
    <span className="inline-flex max-w-40 items-center gap-1.5 truncate text-xs text-muted">
      <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} aria-hidden="true" />
      {project.name}
    </span>
  );
}

/** Ctrl/Cmd+K: search projects, notes, tasks and events, jump to a page, or run an action. */
export function CommandPalette({
  open,
  onOpenChange,
  onNewTask,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewTask: () => void;
  onShowShortcuts: () => void;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchData>(emptyResults);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !trimmed) return;

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (response.ok) setResults((await response.json()) as SearchData);
      } catch {
        // Aborted or a transient failure; the previous results stay.
      }
    }, 120);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query, open]);

  const searched = query.trim() ? results : emptyResults;
  const visiblePages = pages.filter((page) => matches(query, page.label, page.keywords));
  const showNewTask = matches(query, "new task", "add task", "create task");
  const showTheme = matches(query, "theme", "dark", "light", "appearance");
  const showShortcuts = matches(query, "keyboard shortcuts", "keys", "help");

  function close() {
    onOpenChange(false);
    setQuery("");
    setResults(emptyResults);
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent hideClose className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search or run a command</DialogTitle>
        <DialogDescription className="sr-only">Search your projects, notes, tasks and events, or jump to a page.</DialogDescription>
        <Command shouldFilter={false} loop>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search or run a command..." />
          <CommandList>
            <CommandEmpty>No results for “{query.trim()}”.</CommandEmpty>

            {showNewTask || showTheme || showShortcuts ? (
              <CommandGroup heading="Actions">
                {showNewTask ? (
                  <CommandItem value="action-new-task" onSelect={() => { close(); onNewTask(); }}>
                    <Plus />
                    New task
                    <CommandShortcut>N</CommandShortcut>
                  </CommandItem>
                ) : null}
                {showTheme ? (
                  <CommandItem value="action-theme" onSelect={() => { setTheme(theme === "dark" ? "light" : "dark"); close(); }}>
                    {theme === "dark" ? <Sun /> : <Moon />}
                    Switch to {theme === "dark" ? "light" : "dark"} theme
                  </CommandItem>
                ) : null}
                {showShortcuts ? (
                  <CommandItem value="action-shortcuts" onSelect={() => { close(); onShowShortcuts(); }}>
                    <Keyboard />
                    Keyboard shortcuts
                    <CommandShortcut>?</CommandShortcut>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ) : null}

            {searched.tasks.length ? (
              <CommandGroup heading="Tasks">
                {searched.tasks.map((task) => (
                  <CommandItem key={task.id} value={`task-${task.id}`} onSelect={() => go(`/tasks?task=${task.id}`)}>
                    <SquareCheckBig />
                    <span className={`min-w-0 flex-1 truncate ${task.status === "DONE" ? "text-muted line-through" : ""}`}>{task.title}</span>
                    <ProjectTag project={task.project} />
                    {task.dueDate ? <CommandShortcut>Due {formatTaskDueDate(task.dueDate)}</CommandShortcut> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {searched.projects.length ? (
              <CommandGroup heading="Projects">
                {searched.projects.map((project) => (
                  <CommandItem key={project.id} value={`project-${project.id}`} onSelect={() => go(`/projects/${project.id}`)}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {searched.notes.length ? (
              <CommandGroup heading="Notes">
                {searched.notes.map((note) => (
                  <CommandItem key={note.id} value={`note-${note.id}`} onSelect={() => go(`/notes?openNote=${note.id}`)}>
                    <NotebookPen />
                    <span className="min-w-0 flex-1 truncate">{note.title || "Untitled note"}</span>
                    <ProjectTag project={note.project} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {searched.events.length ? (
              <CommandGroup heading="Events">
                {searched.events.map((event) => (
                  <CommandItem key={event.id} value={`event-${event.id}`} onSelect={() => go(`/events?event=${event.id}`)}>
                    <CalendarClock />
                    <span className="min-w-0 flex-1 truncate">{event.title}</span>
                    <ProjectTag project={event.project} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {visiblePages.length ? (
              <CommandGroup heading="Go to">
                {visiblePages.map((page) => (
                  <CommandItem key={page.href} value={`page-${page.href}`} onSelect={() => go(page.href)}>
                    <page.icon />
                    {page.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
