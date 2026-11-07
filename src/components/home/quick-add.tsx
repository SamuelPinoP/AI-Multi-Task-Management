"use client";

import { CalendarDays, Flag, FolderInput, Info, Plus, Tag, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DueDatePicker } from "@/components/tasks/due-date-picker";
import { LabelPicker } from "@/components/tasks/label-picker";
import { loadLabels, scopeKeyFor, useLabels } from "@/components/tasks/label-store";
import { loadProjectMembers } from "@/components/tasks/load-members";
import { MemberAvatar } from "@/components/tasks/member-avatar";
import { PropertyPicker } from "@/components/tasks/property-picker";
import type { Member } from "@/components/tasks/types";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { isPressingPriority, PRIORITY_MENU_ORDER, priorityLabels, type Priority } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";
import { parseQuickAdd, type QuickAddKind, type QuickAddResult } from "@/lib/quick-add-parse";
import { TASK_TITLE_MAX } from "@/lib/task-history";
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

/** Values picked with the quick add's buttons (#362); they win over typed codes. An empty string means "none". */
type Picked = { dueDate?: string; projectId?: string; priority?: Priority; assigneeId?: string; labelIds?: string[] };

const pickerClass =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4";

/** A button that puts the cursor in the page's quick add, for empty states that say "Add a task". */
export function QuickAddFocusButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => document.getElementById(QUICK_ADD_INPUT_ID)?.focus()} className={className}>
      {children}
    </button>
  );
}

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
  editHref = (id) => `/tasks/${id}`,
  quiet = false,
}: QuickAddProps = {}) {
  const router = useRouter();
  const smart = endpoint === TASKS_ENDPOINT && field === "title";
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [ignore, setIgnore] = useState<ReadonlySet<QuickAddKind>>(new Set());
  const [projects, setProjects] = useState<ProjectOption[] | undefined>(undefined);
  const [members, setMembers] = useState<{ projectId: string; list: Member[] } | null>(null);
  const [picked, setPicked] = useState<Picked>({});
  const allLabels = useLabels();
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
  // A picked project wins over a typed #project (#362).
  const projectId = picked.projectId !== undefined ? picked.projectId : (parsedProjectId ?? "");
  const loadedMembers = parsedProjectId && members?.projectId === parsedProjectId ? members.list : undefined;
  const parsed = first && loadedMembers ? parse(text, projects, loadedMembers) : first;
  const memberList = projectId && members?.projectId === projectId ? members.list : [];

  useEffect(() => {
    if (!projectId || members?.projectId === projectId) return;
    let cancelled = false;
    void loadProjectMembers(projectId).then((list) => {
      if (!cancelled) setMembers({ projectId, list });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, members?.projectId]);

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
      // Picked values win over typed codes; the assignee only counts in the project it belongs to.
      const dueDate = picked.dueDate !== undefined ? picked.dueDate : result?.dueDate;
      const project = picked.projectId !== undefined ? picked.projectId : result?.project?.id;
      const assignee = picked.assigneeId ?? (project && project === result?.project?.id ? result?.assignee?.id : undefined);
      const payload = result
        ? {
            title,
            ...(dueDate ? { dueDate } : {}),
            ...((picked.priority ?? result.priority) ? { priority: picked.priority ?? result.priority } : {}),
            ...(project ? { projectId: project } : {}),
            ...(project && assignee ? { assigneeId: assignee } : {}),
            ...(picked.labelIds?.length ? { labelIds: picked.labelIds } : {}),
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
      setPicked({});
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

  function pick(change: Picked) {
    setPicked((current) => ({ ...current, ...change }));
  }

  // What the buttons picked, as chips with a way to clear each.
  const pickedProject = projects?.find((project) => project.id === picked.projectId);
  const pickedMember = memberList.find((member) => member.id === picked.assigneeId);
  const pickedLabels = (allLabels ?? []).filter((label) => picked.labelIds?.includes(label.id));
  const pickedChips: { key: keyof Picked; name: string; value: string; icon: ReactNode }[] = [];
  if (picked.dueDate !== undefined) {
    pickedChips.push({ key: "dueDate", name: "Due", value: picked.dueDate ? formatDueChip(picked.dueDate) : "No due date", icon: <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-muted" /> });
  }
  if (picked.projectId !== undefined) {
    pickedChips.push({
      key: "projectId",
      name: "Project",
      value: pickedProject?.name ?? "No project",
      icon: <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: pickedProject ? projectColor(pickedProject) : "transparent" }} />,
    });
  }
  if (picked.priority) {
    pickedChips.push({ key: "priority", name: "Priority", value: priorityLabels[picked.priority], icon: <Flag aria-hidden="true" className={cn("h-3.5 w-3.5", isPressingPriority(picked.priority) ? "text-danger" : "text-muted")} /> });
  }
  if (picked.assigneeId && pickedMember) {
    pickedChips.push({ key: "assigneeId", name: "Assignee", value: pickedMember.name, icon: <UserRound aria-hidden="true" className="h-3.5 w-3.5 text-muted" /> });
  }
  if (pickedLabels.length) {
    pickedChips.push({ key: "labelIds", name: "Labels", value: pickedLabels.map((label) => label.name).join(", "), icon: <Tag aria-hidden="true" className="h-3.5 w-3.5 text-muted" /> });
  }
  const overridden = new Set<QuickAddKind>([
    ...(picked.dueDate !== undefined ? (["date"] as const) : []),
    ...(picked.projectId !== undefined ? (["project", "assignee"] as const) : []),
    ...(picked.priority ? (["priority"] as const) : []),
    ...(picked.assigneeId ? (["assignee"] as const) : []),
  ]);

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
      icon: <Flag aria-hidden="true" className={cn("h-3.5 w-3.5", isPressingPriority(parsed.priority) ? "text-danger" : "text-muted")} />,
      value: priorityLabels[parsed.priority],
      tone: isPressingPriority(parsed.priority) ? "border-danger/35 text-danger" : undefined,
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
  const typedChips = chips.filter((chip) => !overridden.has(chip.kind));
  const hints = parsed?.hints ?? [];
  const showDetails = smart && ((text.trim() !== "" && (typedChips.length > 0 || hints.length > 0)) || pickedChips.length > 0);

  return (
    <form
      onSubmit={handleSubmit}
      // One minmax(0, 1fr) column: an auto column would grow to the row's one-line width and widen the page on phones (#288).
      className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-line bg-surface px-3 py-2 transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-soft"
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
          maxLength={TASK_TITLE_MAX}
          autoComplete="off"
          aria-describedby={smart ? "quick-add-details" : undefined}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
        />
        {smart ? (
          // Buttons that open the same pickers as the task page (#362, design 1B); typed codes keep working.
          <div role="group" aria-label="Task details" className="flex shrink-0 items-center" onFocus={() => void loadProjects()}>
            <DueDatePicker value={picked.dueDate ?? parsed?.dueDate ?? ""} onChange={(key) => pick({ dueDate: key ?? "" })}>
              <button type="button" aria-label="Due date" title="Due date" className={cn(pickerClass, picked.dueDate && "text-accent")}>
                <CalendarDays aria-hidden="true" />
              </button>
            </DueDatePicker>
            <PropertyPicker
              label="Add to project"
              align="end"
              value={projectId}
              options={[
                { value: "", label: "No project", icon: <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted" /> },
                ...(projects ?? []).map((project) => ({
                  value: project.id,
                  label: project.name,
                  icon: <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />,
                })),
              ]}
              emptyText={projects ? "No project matches." : "Loading projects…"}
              onSelect={(id) => pick({ projectId: id, assigneeId: undefined, labelIds: undefined })}
            >
              <button type="button" aria-label="Project" title="Project" onClick={() => void loadProjects()} className={cn(pickerClass, picked.projectId && "text-accent")}>
                <FolderInput aria-hidden="true" />
              </button>
            </PropertyPicker>
            <PropertyPicker
              label="Change priority"
              align="end"
              value={picked.priority ?? parsed?.priority ?? "NONE"}
              options={PRIORITY_MENU_ORDER.map((priority) => ({ value: priority, label: priorityLabels[priority] }))}
              onSelect={(priority) => pick({ priority })}
            >
              <button type="button" aria-label="Priority" title="Priority" className={cn(pickerClass, picked.priority && "text-accent")}>
                <Flag aria-hidden="true" />
              </button>
            </PropertyPicker>
            <PropertyPicker
              label="Assign to"
              align="end"
              value={picked.assigneeId ?? (projectId && projectId === parsed?.project?.id ? parsed.assignee?.id : undefined) ?? ""}
              options={
                projectId
                  ? [
                      { value: "", label: "Unassigned", icon: <UserRound /> },
                      ...memberList.map((member) => ({ value: member.id, label: member.name, icon: <MemberAvatar id={member.id} name={member.name} /> })),
                    ]
                  : []
              }
              emptyText={projectId ? "No member matches." : "Add a project first: people are assigned within a project."}
              onSelect={(id) => pick({ assigneeId: id || undefined })}
            >
              <button type="button" aria-label="Assignee" title="Assignee" className={cn(pickerClass, picked.assigneeId && "text-accent")}>
                <UserRound aria-hidden="true" />
              </button>
            </PropertyPicker>
            <LabelPicker
              scope={scopeKeyFor(projectId)}
              scopeName={projects?.find((project) => project.id === projectId)?.name ?? "Personal"}
              selectedIds={picked.labelIds ?? []}
              onChange={(ids) => pick({ labelIds: ids })}
            >
              <button type="button" aria-label="Labels" title="Labels" onClick={() => void loadLabels()} className={cn(pickerClass, picked.labelIds?.length && "text-accent")}>
                <Tag aria-hidden="true" />
              </button>
            </LabelPicker>
          </div>
        ) : null}
        <kbd className="hidden rounded border border-line px-1.5 font-mono text-2xs text-muted sm:inline">Enter</kbd>
      </div>
      {smart ? (
        <div id="quick-add-details" aria-live="polite" className={cn("flex flex-wrap items-center gap-1.5 pl-6", !showDetails && "hidden")}>
          {showDetails ? (
            <>
              {pickedChips.length ? (
                <ul aria-label="Details you picked" className="flex flex-wrap gap-1.5">
                  {pickedChips.map((chip) => (
                    <li key={chip.key} className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft py-0.5 pl-2 pr-0.5 text-xs text-ink">
                      {chip.icon}
                      <span>
                        <span className="sr-only">{chip.name}: </span>
                        {chip.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPicked((current) => ({ ...current, [chip.key]: undefined }))}
                        aria-label={`Clear ${chip.name.toLowerCase()}`}
                        title={`Clear ${chip.name.toLowerCase()}`}
                        className="rounded-full p-1 text-muted hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <X aria-hidden="true" className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {typedChips.length ? (
                <ul aria-label="Details from your text" className="flex flex-wrap gap-1.5">
                  {typedChips.map((chip) => (
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
