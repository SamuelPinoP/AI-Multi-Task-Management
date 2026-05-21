"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ProjectRef = { id: string; name: string; color: string | null };
type SearchData = {
  projects: ProjectRef[];
  notes: Array<{ id: string; title: string; createdAt: string; project: ProjectRef | null }>;
  tasks: Array<{ id: string; title: string; dueDate: string | null; status: string; project: ProjectRef | null }>;
  events: Array<{ id: string; title: string; startTime: string; project: ProjectRef | null }>;
};

const quickLinks = [
  { href: "/", label: "Dashboard", type: "Page" },
  { href: "/notes", label: "Notes", type: "Page" },
  { href: "/tasks", label: "Tasks", type: "Page" },
  { href: "/tasks/board", label: "Task Board", type: "Page" },
  { href: "/events", label: "Events", type: "Page" },
  { href: "/events/calendar", label: "Calendar", type: "Page" },
  { href: "/projects", label: "Projects", type: "Page" },
  { href: "/trash", label: "Trash", type: "Page" },
] as const;

function formatDate(dateString: string | null) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function ProjectBadge({ project }: { project: ProjectRef | null }) {
  if (!project) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {project.color ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} aria-hidden="true" /> : null}
      {project.name}
    </span>
  );
}

export function GlobalCommandCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchData>({ projects: [], notes: [], tasks: [], events: [] });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((current) => !current);
      }
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as SearchData;
        setResults(data);
      } catch {
        // no-op: aborted or transient request failure
      }
    }, 120);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query, isOpen]);


  const hasResults = useMemo(
    () => results.projects.length || results.notes.length || results.tasks.length || results.events.length,
    [results],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span>Search everything</span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">Ctrl/Cmd+K</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/45 p-4 pt-20" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 p-3 dark:border-zinc-700">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects, notes, tasks, events..."
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-3">
              {query.trim() ? (
                hasResults ? (
                  <div className="space-y-4">
                    <ResultSection onSelect={() => setIsOpen(false)} label="Projects" items={results.projects.map((item) => ({ href: `/projects/${item.id}`, title: item.name, type: "Project", project: item }))} />
                    <ResultSection onSelect={() => setIsOpen(false)} label="Notes" items={results.notes.map((item) => ({ href: "/notes", title: item.title, type: "Note", project: item.project, dateLabel: formatDate(item.createdAt) ? `Created ${formatDate(item.createdAt)}` : undefined }))} />
                    <ResultSection onSelect={() => setIsOpen(false)} label="Tasks" items={results.tasks.map((item) => ({ href: item.status === "DONE" ? "/tasks/board" : "/tasks", title: item.title, type: "Task", project: item.project, dateLabel: formatDate(item.dueDate) ? `Due ${formatDate(item.dueDate)}` : "No due date" }))} />
                    <ResultSection onSelect={() => setIsOpen(false)} label="Events" items={results.events.map((item) => ({ href: "/events/calendar", title: item.title, type: "Event", project: item.project, dateLabel: formatDate(item.startTime) ? `Starts ${formatDate(item.startTime)}` : undefined }))} />
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No results found.</p>
                )
              ) : (
                <div className="space-y-2">
                  <p className="px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Quick links</p>
                  {quickLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="flex items-center justify-between rounded-xl px-3 py-2 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => setIsOpen(false)}
                    >
                      <span>{link.label}</span>
                      <span className="text-xs text-zinc-500">{link.type}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type ResultItem = {
  href: string;
  title: string;
  type: string;
  project: ProjectRef | null;
  dateLabel?: string;
};

function ResultSection({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: ResultItem[];
  onSelect: () => void;
}) {
  if (!items.length) return null;

  return (
    <section className="space-y-2">
      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      {items.map((item) => (
        <Link
          key={`${item.type}-${item.title}-${item.href}`}
          href={item.href}
          className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onSelect}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">{item.type}</span>
              <ProjectBadge project={item.project} />
            </div>
          </div>
          {item.dateLabel ? <span className="text-xs text-zinc-500">{item.dateLabel}</span> : null}
        </Link>
      ))}
    </section>
  );
}
