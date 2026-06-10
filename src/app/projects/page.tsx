"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type ProjectStatus = "ACTIVE" | "COMPLETED" | "ARCHIVED";
type StatusFilter = "ALL" | ProjectStatus;

type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  accessLevel: "OWNER" | "COLLABORATOR";
  memberRole: Role;
};

type Role = "OWNER" | "MEMBER" | "VIEWER";
type Invitation = {
  id: string;
  invitedEmail: string;
  status: "PENDING";
  createdAt: string;
  project: {
    id: string;
    name: string;
    description: string | null;
    color: string | null;
    status: ProjectStatus;
  };
  inviterUser: { name: string | null; email: string };
};

const DEFAULT_COLOR = "#6366f1";
const STATUS_OPTIONS: ProjectStatus[] = ["ACTIVE", "COMPLETED", "ARCHIVED"];

function formatStatus(status: ProjectStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [fetchingInvitations, setFetchingInvitations] = useState(true);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editStatus, setEditStatus] = useState<ProjectStatus>("ACTIVE");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");

  async function fetchInvitations() {
    try {
      const res = await fetch("/api/project-invitations");
      if (!res.ok) throw new Error("Failed to fetch invitations");
      setInvitations((await res.json()) as Invitation[]);
    } catch {
      setError("Could not load invitations.");
    } finally {
      setFetchingInvitations(false);
    }
  }

  async function fetchProjects() {
    try {
      setError("");
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      setProjects((await res.json()) as Project[]);
    } catch {
      setError("Could not load projects.");
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    async function loadInitialProjects() {
      await Promise.all([fetchProjects(), fetchInvitations()]);
    }

    void loadInitialProjects();
  }, []);

  async function respondToInvitation(
    invitationId: string,
    action: "ACCEPT" | "DECLINE",
  ) {
    try {
      setError("");
      const res = await fetch(`/api/project-invitations/${invitationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update invitation");
      }
      setInvitations((prev) =>
        prev.filter((invitation) => invitation.id !== invitationId),
      );
      if (action === "ACCEPT") await fetchProjects();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update invitation.",
      );
    }
  }

  async function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Project name is required.");

    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, color }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create project");
      }
      setName("");
      setDescription("");
      setColor("");
      await Promise.all([fetchProjects(), fetchInvitations()]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create project.",
      );
    } finally {
      setLoading(false);
    }
  }

  function startEditing(project: Project) {
    setEditingProjectId(project.id);
    setEditName(project.name);
    setEditDescription(project.description ?? "");
    setEditColor(project.color ?? "");
    setEditStatus(project.status);
    setError("");
  }
  function cancelEditing() {
    setEditingProjectId(null);
    setEditName("");
    setEditDescription("");
    setEditColor("");
    setEditStatus("ACTIVE");
  }

  async function handleUpdateProject(projectId: string) {
    if (!editName.trim()) return setError("Project name is required.");

    try {
      setSavingEdit(true);
      setError("");
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          color: editColor,
          status: editStatus,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update project");
      }
      await Promise.all([fetchProjects(), fetchInvitations()]);
      cancelEditing();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update project.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    /* unchanged */
    try {
      setDeletingProjectId(projectId);
      setError("");
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete project");
      }
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      if (editingProjectId === projectId) cancelEditing();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete project.",
      );
    } finally {
      setDeletingProjectId(null);
    }
  }

  const filteredProjects = projects.filter(
    (project) => statusFilter === "ALL" || project.status === statusFilter,
  );

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Collaborative workspaces
            </p>
            <h1 className="mt-1 text-4xl font-bold">Projects</h1>
            <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
              Create project spaces for tasks, notes, members, chat,
              attachments, and shared planning. Ownership and shared access are
              labeled on every card.
            </p>
          </div>
        </header>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="mb-5">
            <h2 className="text-2xl font-semibold">Create a project</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Start with a name and optional color; you can invite collaborators
              from the project detail page.
            </p>
          </div>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Capstone demo, Research sprint"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="What is this project trying to accomplish?"
                className="w-full rounded-xl border border-zinc-300 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">
                Color (optional)
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="color"
                  value={color || DEFAULT_COLOR}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-11 w-16"
                />
                <button
                  type="button"
                  onClick={() => setColor("")}
                  className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700"
                >
                  Clear
                </button>
                <span className="text-sm text-zinc-500">
                  {color || "No color selected"}
                </span>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-black px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {loading ? "Creating..." : "Create project"}
            </button>
          </form>
          {error && (
            <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
              {error}
            </p>
          )}
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">My invitations</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Accept an invitation to make the project appear as “Shared with
                me”.
              </p>
            </div>
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {invitations.length} pending
            </span>
          </div>
          {fetchingInvitations ? (
            <p className="mt-4 text-sm text-zinc-500">Loading invitations...</p>
          ) : invitations.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              No pending project invitations. When a teammate invites this
              account, the request will show up here.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {invitations.map((invitation) => (
                <article
                  key={invitation.id}
                  className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold">
                        {invitation.project.name}
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Invited by{" "}
                        {invitation.inviterUser.name ||
                          invitation.inviterUser.email}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void respondToInvitation(invitation.id, "ACCEPT")
                        }
                        className="rounded-lg bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void respondToInvitation(invitation.id, "DECLINE")
                        }
                        className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Your projects</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Owner projects can be edited here. Shared projects keep
                collaboration actions in the detail page.
              </p>
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          {fetching ? (
            <p className="text-zinc-600 dark:text-zinc-300">
              Loading projects...
            </p>
          ) : filteredProjects.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/70 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
              <h3 className="text-lg font-semibold">
                No projects match this view yet.
              </h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Create your first project above, or accept an invitation from a
                teammate to start collaborating.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredProjects.map((project) => {
                const isEditing = editingProjectId === project.id;
                const isDeleting = deletingProjectId === project.id;
                const isOwner = project.accessLevel === "OWNER";
                return (
                  <article
                    key={project.id}
                    className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-lg border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={editColor || DEFAULT_COLOR}
                            onChange={(e) => setEditColor(e.target.value)}
                            className="h-10 w-14"
                          />
                          <select
                            value={editStatus}
                            onChange={(e) =>
                              setEditStatus(e.target.value as ProjectStatus)
                            }
                            className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          >
                            {STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {formatStatus(status)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleUpdateProject(project.id)}
                            disabled={savingEdit}
                            className="rounded-lg bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
                          >
                            {savingEdit ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Link
                          href={`/projects/${project.id}`}
                          className="block"
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-xl font-semibold">
                                {project.name}
                              </h3>
                              {project.description && (
                                <p className="mt-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                                  {project.description}
                                </p>
                              )}
                            </div>
                            <span
                              className="mt-1 inline-block h-4 w-4 shrink-0 rounded-full border"
                              style={{
                                backgroundColor: project.color || "transparent",
                              }}
                            />
                          </div>
                        </Link>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs dark:border-zinc-700">
                            {formatStatus(project.status)}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${isOwner ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"}`}
                          >
                            {isOwner ? "Owner" : "Shared with me"}
                          </span>
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs dark:border-zinc-700">
                            Role: {project.memberRole}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                          {isOwner
                            ? "You can edit details, manage invitations, and remove collaborators."
                            : "You can view the project, participate in chat, and contribute to permitted collaborative areas."}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {isOwner ? (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditing(project)}
                                className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteProject(project.id)
                                }
                                disabled={isDeleting}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                              >
                                {isDeleting ? "Deleting..." : "Delete"}
                              </button>
                            </>
                          ) : (
                            <Link
                              href={`/projects/${project.id}`}
                              className="rounded-lg border px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
                            >
                              Open shared project
                            </Link>
                          )}
                        </div>
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
  );
}
