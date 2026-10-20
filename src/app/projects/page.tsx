"use client";

/**
 * Projects: the list first, the form second (DES-02).
 *
 * - Quick add (name only) and a New project sheet for the details.
 * - Pending invitations, when there are any, at the top.
 * - A status filter and a grid of project cards with open tasks and members.
 * - Owners edit in the sheet, archive, or delete (after a clear warning).
 */

import { Archive, ArchiveRestore, Check, MoreHorizontal, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QuickAdd } from "@/components/home/quick-add";
import {
  ProjectSheet,
  projectStatusLabels,
  type EditableProject,
  type ProjectInput,
  type ProjectStatus,
} from "@/components/projects/project-sheet";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { projectColor } from "@/lib/project-color";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

type Role = "OWNER" | "EDITOR" | "VIEWER";
type StatusFilter = "ALL" | ProjectStatus;

type Project = EditableProject & {
  createdAt: string;
  updatedAt: string;
  accessLevel: Role;
  memberRole: Role;
  openTaskCount: number;
  memberCount: number;
};

type Invitation = {
  id: string;
  project: { id: string; name: string; color: string | null };
  inviterUser: { name: string | null; email: string };
};

const roleLabels: Record<Role, string> = { OWNER: "Owner", EDITOR: "Editor", VIEWER: "Viewer" };

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [sheet, setSheet] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  async function fetchProjects() {
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error();
      setProjects((await response.json()) as Project[]);
      setLoadError("");
    } catch {
      setLoadError("Could not load projects.");
    } finally {
      setFetching(false);
    }
  }

  async function fetchInvitations() {
    try {
      const response = await fetch("/api/project-invitations");
      if (response.ok) setInvitations((await response.json()) as Invitation[]);
    } catch {
      // Invitations stay hidden; projects still load.
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      await Promise.all([fetchProjects(), fetchInvitations()]);
    }
    void loadInitialData();
  }, []);

  const counts = {
    ACTIVE: projects.filter((project) => project.status === "ACTIVE").length,
    COMPLETED: projects.filter((project) => project.status === "COMPLETED").length,
    ARCHIVED: projects.filter((project) => project.status === "ARCHIVED").length,
  };
  const sharedCount = projects.filter((project) => project.accessLevel !== "OWNER").length;
  const visible = projects.filter((project) => statusFilter === "ALL" || project.status === statusFilter);

  async function respond(invitation: Invitation, action: "ACCEPT" | "DECLINE") {
    setRespondingId(invitation.id);
    try {
      const response = await fetch(`/api/project-invitations/${invitation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not answer the invitation."));
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      notifyWorkspaceChanged();
      if (action === "ACCEPT") {
        await fetchProjects();
        toast.success(`You joined ${invitation.project.name}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not answer the invitation.");
    } finally {
      setRespondingId(null);
    }
  }

  async function saveProject(input: ProjectInput) {
    const editing = sheet.project;
    const response = await fetch(editing ? `/api/projects/${editing.id}` : "/api/projects", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? input : { name: input.name, description: input.description, color: input.color }),
    });
    if (!response.ok) return errorMessage(response, editing ? "Could not save the project." : "Could not create the project.");
    notifyWorkspaceChanged();
    await fetchProjects();
    if (!editing) setStatusFilter((current) => (current === "ALL" ? current : "ACTIVE"));
    toast.success(editing ? "Project saved" : "Project created", { description: input.name });
    return null;
  }

  async function setStatus(project: Project, status: ProjectStatus) {
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: project.name, description: project.description ?? "", color: project.color ?? "", status }),
    });
    if (!response.ok) {
      toast.error(await errorMessage(response, "Could not update the project."));
      return;
    }
    notifyWorkspaceChanged();
    await fetchProjects();
    toast.success(status === "ARCHIVED" ? "Project archived" : "Project restored", { description: project.name });
  }

  async function deleteProject(project: Project) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not delete the project."));
      setProjects((current) => current.filter((item) => item.id !== project.id));
      notifyWorkspaceChanged();
      toast.success("Project deleted", { description: project.name });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the project.");
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Projects</h1>
          <p className="mt-0.5 text-sm text-muted">
            {fetching ? "Loading..." : `${counts.ACTIVE} active${sharedCount ? ` · ${sharedCount} shared with you` : ""}`}
          </p>
        </div>
        <button type="button" onClick={() => setSheet({ open: true, project: null })} className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          New project
        </button>
      </header>

      <QuickAdd
        label="Add a project"
        placeholder="Add a project and press Enter"
        endpoint="/api/projects"
        field="name"
        successMessage="Project created"
        editHref={(id) => `/projects/${id}`}
        onAdded={() => {
          setStatusFilter((current) => (current === "ALL" ? current : "ACTIVE"));
          void fetchProjects();
        }}
      />

      {invitations.length ? (
        <section aria-labelledby="invitations-heading" className="rounded-xl border border-accent/30 bg-accent-soft p-4">
          <h2 id="invitations-heading" className="text-sm font-semibold">
            {invitations.length === 1 ? "You're invited to a project" : `You're invited to ${invitations.length} projects`}
          </h2>
          <ul className="mt-2 grid gap-2">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(invitation.project) }} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">{invitation.project.name}</span>
                  <span className="text-muted"> · from {invitation.inviterUser.name || invitation.inviterUser.email}</span>
                </span>
                <span className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void respond(invitation, "ACCEPT")}
                    disabled={respondingId === invitation.id}
                    className={cn(uiPrimaryButtonClass, "px-2.5 py-1 text-xs")}
                  >
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void respond(invitation, "DECLINE")}
                    disabled={respondingId === invitation.id}
                    className={cn(uiButtonClass, "px-2.5 py-1 text-xs")}
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div role="radiogroup" aria-label="Status" className="flex w-fit flex-wrap rounded-lg border border-line bg-surface p-0.5">
        {(["ACTIVE", "COMPLETED", "ARCHIVED", "ALL"] as StatusFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={statusFilter === value}
            onClick={() => setStatusFilter(value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors",
              statusFilter === value ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-ink",
            )}
          >
            {value === "ALL" ? "All" : projectStatusLabels[value]}
            {value !== "ALL" && counts[value] ? <span className="ml-1 text-xs opacity-70">{counts[value]}</span> : null}
          </button>
        ))}
      </div>

      {loadError ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}{" "}
          <button type="button" onClick={() => void fetchProjects()} className="font-semibold underline">Try again</button>
        </p>
      ) : null}

      {fetching ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading projects">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
          <h2 className="text-base font-semibold">
            {projects.length === 0 ? "No projects yet." : `No ${statusFilter === "ALL" ? "" : `${projectStatusLabels[statusFilter as ProjectStatus].toLowerCase()} `}projects.`}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {projects.length === 0
              ? "A project groups tasks, notes, events and a team chat. Type a name above and press Enter to start one."
              : "Switch the filter to see your other projects."}
          </p>
          {projects.length === 0 ? (
            <button type="button" onClick={() => setSheet({ open: true, project: null })} className={cn(uiButtonClass, "mt-4 px-3 py-1.5")}>
              Create your first project
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => {
            const owner = project.accessLevel === "OWNER";
            return (
              <li key={project.id} className="group relative flex flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
                <div className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />
                  <h2 className="min-w-0 flex-1 text-[15px] font-semibold">
                    {/* The whole card opens the project; the menu sits above the link. */}
                    <Link href={`/projects/${project.id}`} className="line-clamp-2 after:absolute after:inset-0 after:rounded-xl hover:text-accent">
                      {project.name}
                    </Link>
                  </h2>
                  {owner ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`More actions for ${project.name}`}
                        className="relative z-10 -mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setSheet({ open: true, project })}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        {project.status === "ARCHIVED" ? (
                          <DropdownMenuItem onSelect={() => void setStatus(project, "ACTIVE")}>
                            <ArchiveRestore />
                            Restore
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => void setStatus(project, "ARCHIVED")}>
                            <Archive />
                            Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setConfirmDelete(project)} className="text-danger [&_svg]:text-danger">
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <p className={cn("mt-1.5 line-clamp-2 text-sm", project.description ? "text-muted" : "text-muted/70")}>
                  {project.description || "No description"}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted">
                  <span>{project.openTaskCount} open task{project.openTaskCount === 1 ? "" : "s"}</span>
                  {project.memberCount ? (
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden="true" className="h-3.5 w-3.5" />
                      {project.memberCount} member{project.memberCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2 py-px font-semibold",
                      owner ? "bg-canvas text-muted" : "bg-accent-soft text-accent",
                    )}
                  >
                    {owner ? "Owner" : `Shared · ${roleLabels[project.memberRole]}`}
                  </span>
                  {project.status !== "ACTIVE" ? (
                    <span className="rounded-full bg-caution-soft px-2 py-px font-semibold text-caution">{projectStatusLabels[project.status]}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ProjectSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        project={sheet.project}
        onSubmit={saveProject}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={confirmDelete ? `Delete “${confirmDelete.name}”?` : "Delete project?"}
        message="This can't be undone. Its chat, files, members and invitations are deleted. Its tasks, notes and events stay, without the project."
        confirmLabel="Delete project"
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void deleteProject(confirmDelete);
        }}
      />
    </div>
  );
}
