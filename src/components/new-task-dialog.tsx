"use client";

import { CalendarDays, ChevronDown, ChevronRight, Flag, Repeat, Tag, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DueDatePicker, dueDayName } from "@/components/tasks/due-date-picker";
import { LabelChip } from "@/components/tasks/label-chip";
import { LabelPicker } from "@/components/tasks/label-picker";
import { loadLabels, scopeKeyFor, useLabels } from "@/components/tasks/label-store";
import { loadProjectMembers } from "@/components/tasks/load-members";
import { MemberAvatar } from "@/components/tasks/member-avatar";
import { PriorityBadge } from "@/components/tasks/priority-badge";
import { PropertyPicker } from "@/components/tasks/property-picker";
import { recurrenceLabels, statusLabels, type Member, type Recurrence, type TaskStatus } from "@/components/tasks/types";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { PRIORITY_MENU_ORDER, priorityLabels, type Priority } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";
import { TASK_TITLE_MAX } from "@/lib/task-history";
import { notifyWorkspaceChanged, TASK_CREATED_EVENT } from "@/lib/workspace-events";

type ProjectOption = { id: string; name: string; color: string | null; status?: string };

/** What a New task can start with, such as the project it's added from. */
export type NewTaskDraft = { projectId?: string };

const chipClass =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[0.8125rem] text-ink outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

function Chip({ icon, empty, children, ...props }: { icon: ReactNode; empty: boolean; children: ReactNode } & React.ComponentProps<"button">) {
  return (
    <button type="button" className={cn(chipClass, empty && "text-muted")} {...props}>
      {icon}
      {children}
    </button>
  );
}

function StatusDot({ status }: { status: TaskStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px]",
        status === "DONE" ? "border-success bg-success" : status === "IN_PROGRESS" ? "border-warning" : "border-muted",
      )}
    />
  );
}

/**
 * Creating a task (#362, design 3A, as the owner chose it on November 6): one
 * pop-up for the sidebar's New task, the N shortcut, the command palette and
 * the Tasks page. A title of any length, a description, then a button for
 * each property; every one can stay empty. A first click outside an open
 * menu closes only the menu; another click outside closes the pop-up.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft?: NewTaskDraft;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [members, setMembers] = useState<{ projectId: string; list: Member[] } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<Priority>("NONE");
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("NONE");
  const [createMore, setCreateMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedWith, setOpenedWith] = useState<string | null>(null);
  const allLabels = useLabels();

  // Each time it opens, it starts empty, in the project it was opened from.
  const openKey = open ? (draft?.projectId ?? "") : null;
  if (openKey !== openedWith) {
    setOpenedWith(openKey);
    if (openKey !== null) {
      setTitle("");
      setDescription("");
      setStatus("TODO");
      setPriority("NONE");
      setProjectId(openKey);
      setAssigneeId("");
      setLabelIds([]);
      setDueDate("");
      setRecurrence("NONE");
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadOptions() {
      const response = await fetch("/api/projects").catch(() => null);
      if (!cancelled && response?.ok) setProjects((await response.json()) as ProjectOption[]);
      await loadLabels();
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    void loadProjectMembers(projectId).then((list) => {
      if (!cancelled) setMembers({ projectId, list });
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const editableProjects = projects.filter((project) => project.status !== "ARCHIVED");
  const project = projects.find((item) => item.id === projectId) ?? null;
  const memberList = projectId && members?.projectId === projectId ? members.list : [];
  const assignee = memberList.find((member) => member.id === assigneeId) ?? null;
  const chosenLabels = (allLabels ?? []).filter((label) => labelIds.includes(label.id));

  function chooseProject(next: string) {
    // Assignees and labels belong to a project, so a new project starts without them.
    setProjectId(next);
    setAssigneeId("");
    setLabelIds([]);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const name = title.replace(/\s+/g, " ").trim();
    if (!name) {
      setError("Give the task a title.");
      titleRef.current?.focus();
      return;
    }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name,
          description: description.trim(),
          status,
          priority,
          dueDate: dueDate || undefined,
          recurrence,
          projectId: projectId || undefined,
          assigneeId: projectId && assigneeId ? assigneeId : undefined,
          labelIds: labelIds.filter((id) => !allLabels || allLabels.some((label) => label.id === id)),
        }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !body?.id) {
        setError(body?.error ?? "Could not create the task. Try again.");
        return;
      }
      notifyWorkspaceChanged();
      window.dispatchEvent(new Event(TASK_CREATED_EVENT));
      const taskId = body.id;
      toast.success("Task created", {
        description: name,
        action: { label: "Open", onClick: () => router.push(`/tasks/${taskId}`) },
      });
      if (createMore) {
        // Keep the properties for the next one; clear what's written.
        setTitle("");
        setDescription("");
        titleRef.current?.focus();
      } else {
        onOpenChange(false);
      }
    } catch {
      setError("Could not create the task. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        aria-describedby="new-task-hint"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        className="top-[10vh] max-h-[80vh] max-w-2xl translate-y-0 gap-0 p-0 max-sm:inset-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-full max-sm:translate-x-0 max-sm:rounded-none max-sm:border-0"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-col max-sm:h-full">
          <div className="flex items-center gap-1.5 px-4 pt-4 sm:px-5">
            <PropertyPicker
              modal
              label="Add to project"
              value={projectId}
              options={[
                { value: "", label: "No project", icon: <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted" /> },
                ...editableProjects.map((item) => ({
                  value: item.id,
                  label: item.name,
                  icon: <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(item) }} />,
                })),
              ]}
              onSelect={chooseProject}
            >
              <button
                type="button"
                className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-medium outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="sr-only">Project: </span>
                <span
                  aria-hidden="true"
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", !project && "rounded-full border-[1.5px] border-dashed border-muted")}
                  style={project ? { backgroundColor: projectColor(project) } : undefined}
                />
                <span className="truncate">{project?.name ?? "Add project"}</span>
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
              </button>
            </PropertyPicker>
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-muted" />
            <DialogTitle className="text-xs font-medium text-muted">New task</DialogTitle>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5">
            <label htmlFor="new-task-title" className="sr-only">
              Title
            </label>
            <textarea
              id="new-task-title"
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                  event.preventDefault();
                  document.getElementById("new-task-description")?.focus();
                }
              }}
              rows={1}
              maxLength={TASK_TITLE_MAX}
              autoFocus
              placeholder="Task title"
              className="mt-3 block w-full resize-none bg-transparent text-xl font-semibold leading-snug text-ink outline-none [field-sizing:content] placeholder:font-medium placeholder:text-muted"
            />
            <label htmlFor="new-task-description" className="sr-only">
              Description
            </label>
            <textarea
              id="new-task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Add a description…"
              className="mt-2 block min-h-20 w-full resize-none bg-transparent text-[0.9375rem] leading-6 text-ink outline-none [field-sizing:content] placeholder:text-muted"
            />
            <DialogDescription id="new-task-hint" className="sr-only">
              Add a title, then set any of the properties below; every one can stay empty.
            </DialogDescription>

            <div className="flex flex-wrap gap-1.5 pb-4 pt-2" role="group" aria-label="Task details">
              <PropertyPicker
                modal
                label="Change status"
                value={status}
                options={(Object.keys(statusLabels) as TaskStatus[]).map((value) => ({ value, label: statusLabels[value], icon: <StatusDot status={value} /> }))}
                onSelect={setStatus}
              >
                <Chip icon={<StatusDot status={status} />} empty={false} aria-label={`Status: ${statusLabels[status]}`}>
                  {statusLabels[status]}
                </Chip>
              </PropertyPicker>

              <PropertyPicker
                modal
                label="Change priority"
                value={priority}
                options={PRIORITY_MENU_ORDER.map((value) => ({ value, label: priorityLabels[value] }))}
                onSelect={setPriority}
              >
                <Chip icon={<Flag />} empty={priority === "NONE"} aria-label={`Priority: ${priorityLabels[priority]}`}>
                  {priority === "NONE" ? "Priority" : <PriorityBadge priority={priority} />}
                </Chip>
              </PropertyPicker>

              {/* Without a project the picker says why it's empty, instead of a disabled button. */}
              <PropertyPicker
                modal
                label="Assign to"
                heading={project ? `Members of ${project.name}` : undefined}
                value={assigneeId}
                options={
                  projectId
                    ? [
                        { value: "", label: "Unassigned", icon: <UserRound /> },
                        ...memberList.map((member) => ({ value: member.id, label: member.name, icon: <MemberAvatar id={member.id} name={member.name} /> })),
                      ]
                    : []
                }
                emptyText={projectId ? "No member matches." : "Add a project first: people are assigned within a project."}
                onSelect={setAssigneeId}
              >
                {assignee ? (
                  // Named by its text, not an aria-label: axe counts the avatar's hidden initial as visible text.
                  <Chip icon={<MemberAvatar id={assignee.id} name={assignee.name} />} empty={false}>
                    <span className="sr-only">Assignee: </span>
                    {assignee.name}
                  </Chip>
                ) : (
                  <Chip icon={<UserRound />} empty aria-label="Assignee: Unassigned">
                    Assignee
                  </Chip>
                )}
              </PropertyPicker>

              <LabelPicker modal scope={scopeKeyFor(projectId)} scopeName={project?.name ?? "Personal"} selectedIds={labelIds} onChange={setLabelIds}>
                <Chip icon={<Tag />} empty={!chosenLabels.length}>
                  {chosenLabels.length ? (
                    <span className="flex items-center gap-1">
                      <span className="sr-only">Labels: </span>
                      {chosenLabels.slice(0, 2).map((label) => (
                        <LabelChip key={label.id} label={label} className="h-5 border-0 bg-transparent px-0" />
                      ))}
                      {chosenLabels.length > 2 ? <span className="text-xs text-muted">+{chosenLabels.length - 2}</span> : null}
                    </span>
                  ) : (
                    "Labels"
                  )}
                </Chip>
              </LabelPicker>

              <DueDatePicker modal value={dueDate} onChange={(key) => setDueDate(key ?? "")}>
                <Chip icon={<CalendarDays />} empty={!dueDate} aria-label={`Due date: ${dueDate ? dueDayName(dueDate) : "none"}`}>
                  {dueDate ? dueDayName(dueDate) : "Due date"}
                </Chip>
              </DueDatePicker>

              <PropertyPicker
                modal
                label="Repeat"
                value={recurrence}
                options={(Object.keys(recurrenceLabels) as Recurrence[]).map((value) => ({ value, label: recurrenceLabels[value] }))}
                onSelect={setRecurrence}
              >
                <Chip icon={<Repeat />} empty={recurrence === "NONE"} aria-label={`Repeat: ${recurrenceLabels[recurrence]}`}>
                  {recurrence === "NONE" ? "Repeat" : recurrenceLabels[recurrence]}
                </Chip>
              </PropertyPicker>
            </div>
            {error ? (
              <p role="alert" className="pb-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[0.8125rem] text-muted">
              <input type="checkbox" checked={createMore} onChange={(event) => setCreateMore(event.target.checked)} className="peer sr-only" />
              <span
                aria-hidden="true"
                className="relative h-[1.125rem] w-8 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:transition-[left] peer-checked:bg-accent peer-checked:after:left-4 peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
              />
              Create more
            </label>
            <span className="flex-1" />
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className={cn(uiButtonClass, "px-3 py-1.5")}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}>
              {saving ? "Creating…" : "Create task"}
              {/* Full-strength text: a faded hint on the accent fails contrast. */}
              <kbd aria-hidden="true" className="hidden rounded border border-current/40 px-1 font-mono text-2xs sm:inline">
                Ctrl ↵
              </kbd>
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
