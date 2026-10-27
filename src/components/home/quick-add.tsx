"use client";

import { CalendarDays, Flag, Info, Plus, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { loadProjectMembers } from "@/components/tasks/load-members";
import type { Member } from "@/components/tasks/types";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { projectColor } from "@/lib/project-color";
import { parseQuickAdd, type QuickAddKind, type QuickAddResult } from "@/lib/quick-add-parse";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

export const QUICK_ADD_INPUT_ID = "quick-add-input";

type QuickAddProps = {
  /** Called with the new item's id and the typed text, for pages that hold their own list. */
  onAdded?: (id: string, text: string) => void;
  /** Skip the success toast (for pages that open the new item right away). */
  quiet?: boolean;
  placeholder?: string;
  /** The input's accessible name. */
  label?: string;
  /** Where to POST; the typed text is sent as `field`. */
  endpoint?: string;
  field?: string;
  successMessage?: string;
  /** Where the toast's Edit action goes for the new item. */
  editHref?: (id: string) => string;
};

type ProjectOption = { id: string; name: string; color: string | null };
type ProjectListItem = ProjectOption & { accessLevel?: string; status?: string };

const TASKS_ENDPOINT = "/api/tasks";
const priorityLabels = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" } as const;

/** Projects the user can add tasks to (not archived, not view-only). */
async function fetchTaskProjects(): Promise<ProjectOption[]> {
  try {
    const response = await fetch("/api/projects");
    if (!response.ok) return [];
    const projects = (await response.json()) as ProjectListItem[];
    return projects
      .filter((project) => project.accessLevel !== "VIEWER" && project.status !== "ARCHIVED")
      .map(({ id, name, color }) => ({ id, name, color }));
  } catch {
    return [];
  }
}

function formatDueChip(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * One-line capture (Home, Tasks, Projects, Notes): type and press Enter. Creates a task by default.
 *
 * For tasks it reads natural language (SMART-01): "Draft slides fri #Capstone !high @Dana"
 * shows chips for the due date, project, priority and assignee before saving.
 */
export function QuickAdd({
  onAdded,
  placeholder,
  label = "Add a task",
  endpoint = TASKS_ENDPOINT,
  field = "title",
  successMessage = "Task added",
  editHref = (id) => `/tasks?task=${id}`,
  quiet = false,
}: QuickAddProps = {}) {
  const router = useRouter();
  const smart = endpoint === TASKS_ENDPOINT && field === "title";
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [ignore, setIgnore] = useState<ReadonlySet<QuickAddKind>>(new Set());
  const [projects, setProjects] = useState<ProjectOption[] | undefined>(undefined);
  const [members, setMembers] = useState<{ projectId: string; list: Member[] } | null>(null);
  const projectsRequest = useRef<Promise<ProjectOption[]> | null>(null);

  function loadProjects() {
    if (!smart) return Promise.resolve([]);
    projectsRequest.current ??= fetchTaskProjects().then((list) => {
      setProjects(list);
      return list;
    });
    return projectsRequest.current;
  }

  function parse(value: string, projectList = projects, memberList?: Member[]): QuickAddResult {
    return parseQuickAdd(value, { projects: projectList, members: memberList, ignore });
  }

  const first = smart ? parse(text) : null;
  const parsedProjectId = first?.project?.id ?? null;
  const loadedMembers = parsedProjectId && members?.projectId === parsedProjectId ? members.list : undefined;
  const parsed = first && loadedMembers ? parse(text, projects, loadedMembers) : first;

  useEffect(() => {
    if (!parsedProjectId || members?.projectId === parsedProjectId) return;
    let cancelled = false;
    void loadProjectMembers(parsedProjectId).then((list) => {
      if (!cancelled) setMembers({ projectId: parsedProjectId, list });
    });
    return () => {
      cancelled = true;
    };
  }, [parsedProjectId, members?.projectId]);

  /** The final reading of the text, waiting for projects and members if they're still loading. */
  async function resolve(value: string) {
    const projectList = projects ?? (value.includes("#") ? await loadProjects() : undefined);
    const firstPass = parse(value, projectList);
    if (!firstPass.project || !/(^|\s)@/.test(value)) return firstPass;
    return parse(value, projectList, await loadProjectMembers(firstPass.project.id));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const result = smart ? await resolve(trimmed) : null;
      const title = result?.title ?? trimmed;
      const payload = result
        ? {
            title,
            ...(result.dueDate ? { dueDate: result.dueDate } : {}),
            ...(result.priority ? { priority: result.priority } : {}),
            ...(result.project ? { projectId: result.project.id } : {}),
            ...(result.assignee ? { assigneeId: result.assignee.id } : {}),
          }
        : { [field]: trimmed };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) {
        toast.error(body?.error ?? "Could not add it. Try again.");
        return;
      }
      const id = body.id;
      setText("");
      setIgnore(new Set());
      notifyWorkspaceChanged();
      onAdded?.(id, title);
      router.refresh();
      if (quiet) return;
      toast.success(successMessage, {
        description: title,
        action: { label: "Edit", onClick: () => router.push(editHref(id)) },
      });
    } catch {
      toast.error("Could not add it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function keepAsText(kind: QuickAddKind) {
    setIgnore((current) => new Set(current).add(kind));
  }

  const chips: { kind: QuickAddKind; name: string; source: string; icon: ReactNode; value: string; tone?: string }[] = [];
  if (parsed?.dueDate && parsed.dueText) {
    chips.push({
      kind: "date",
      name: "Due",
      source: parsed.dueText,
      icon: <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-muted" />,
      value: formatDueChip(parsed.dueDate),
    });
  }
  if (parsed?.project && parsed.projectText) {
    const color = projectColor(projects?.find((project) => project.id === parsed.project?.id) ?? { id: parsed.project.id, color: null });
    chips.push({
      kind: "project",
      name: "Project",
      source: parsed.projectText,
      icon: <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: color }} />,
      value: parsed.project.name,
    });
  }
  if (parsed?.priority && parsed.priorityText) {
    chips.push({
      kind: "priority",
      name: "Priority",
      source: parsed.priorityText,
      icon: <Flag aria-hidden="true" className={cn("h-3.5 w-3.5", parsed.priority === "HIGH" ? "text-danger" : "text-muted")} />,
      value: priorityLabels[parsed.priority],
      tone: parsed.priority === "HIGH" ? "border-danger/35 text-danger" : undefined,
    });
  }
  if (parsed?.assignee && parsed.assigneeText) {
    chips.push({
      kind: "assignee",
      name: "Assignee",
      source: parsed.assigneeText,
      icon: <UserRound aria-hidden="true" className="h-3.5 w-3.5 text-muted" />,
      value: parsed.assignee.name,
    });
  }
  const hints = parsed?.hints ?? [];
  const showDetails = smart && text.trim() !== "" && (chips.length > 0 || hints.length > 0);

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-2 rounded-xl border border-line bg-surface px-3 py-2 transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-soft"
    >
      <div className="flex items-center gap-2.5">
        <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
        <label htmlFor={QUICK_ADD_INPUT_ID} className="sr-only">
          {label}
        </label>
        <input
          id={QUICK_ADD_INPUT_ID}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (!event.target.value.trim()) setIgnore(new Set());
          }}
          onFocus={() => void loadProjects()}
          placeholder={placeholder ?? (smart ? "Add a task: Draft slides fri #project !high" : "Add a task and press Enter")}
          maxLength={200}
          autoComplete="off"
          aria-describedby={smart ? "quick-add-details" : undefined}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
        />
        <kbd className="hidden rounded border border-line px-1.5 font-mono text-2xs text-muted sm:inline">Enter</kbd>
      </div>
      {smart ? (
        <div id="quick-add-details" aria-live="polite" className={cn("flex flex-wrap items-center gap-1.5 pl-6", !showDetails && "hidden")}>
          {showDetails ? (
            <>
              {chips.length ? (
                <ul aria-label="Details from your text" className="flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <li
                      key={chip.kind}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas py-0.5 pl-2 pr-0.5 text-xs text-ink",
                        chip.tone,
                      )}
                    >
                      {chip.icon}
                      <span>
                        <span className="sr-only">{chip.name}: </span>
                        {chip.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => keepAsText(chip.kind)}
                        aria-label={`Keep “${chip.source}” as text`}
                        title={`Keep “${chip.source}” as text`}
                        className="rounded-full p-1 text-muted hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <X aria-hidden="true" className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {hints.map((hint) => (
                <span key={hint.token} className="inline-flex items-center gap-1 text-xs text-muted">
                  <Info aria-hidden="true" className="h-3.5 w-3.5" />
                  {hint.message}
                </span>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
