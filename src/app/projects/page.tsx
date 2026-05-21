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
};

const DEFAULT_COLOR = "#6366f1";
const STATUS_OPTIONS: ProjectStatus[] = ["ACTIVE", "COMPLETED", "ARCHIVED"];

function formatStatus(status: ProjectStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editStatus, setEditStatus] = useState<ProjectStatus>("ACTIVE");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [error, setError] = useState("");

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
      await fetchProjects();
    }

    void loadInitialProjects();
  }, []);

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
      await fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
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
        body: JSON.stringify({ name: editName, description: editDescription, color: editColor, status: editStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update project");
      }
      await fetchProjects();
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update project.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteProject(projectId: string) { /* unchanged */
    try {
      setDeletingProjectId(projectId);
      setError("");
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete project");
      }
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      if (editingProjectId === projectId) cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete project.");
    } finally {
      setDeletingProjectId(null);
    }
  }

  return <main className="min-h-screen px-6 py-10"><div className="mx-auto max-w-4xl"><h1 className="mb-2 text-4xl font-bold">Projects</h1><p className="mb-8 text-zinc-600 dark:text-zinc-300">Create and manage standalone projects.</p>
<section className="mb-10 rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">{/* create form */}
<form onSubmit={handleCreateProject} className="space-y-4"><div><label className="mb-2 block text-sm font-medium">Name</label><input type="text" value={name} onChange={(e)=>setName(e.target.value)} className="w-full rounded-xl border border-zinc-300 px-4 py-3"/></div><div><label className="mb-2 block text-sm font-medium">Description (optional)</label><textarea value={description} onChange={(e)=>setDescription(e.target.value)} rows={4} className="w-full rounded-xl border border-zinc-300 px-4 py-3"/></div><div><label className="mb-2 block text-sm font-medium">Color (optional)</label><div className="flex items-center gap-3"><input type="color" value={color||DEFAULT_COLOR} onChange={(e)=>setColor(e.target.value)} className="h-11 w-16"/><button type="button" onClick={()=>setColor("")} className="rounded-lg border px-3 py-2 text-sm">Clear</button><span className="text-sm text-zinc-500">{color||"No color selected"}</span></div></div><button type="submit" disabled={loading} className="rounded-xl bg-black px-5 py-3 text-white">{loading?"Creating...":"Create Project"}</button></form>{error && <p className="mt-4 text-sm text-red-600">{error}</p>}</section>
<section><div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-semibold">Your Projects</h2><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as StatusFilter)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"><option value="ALL">All</option><option value="ACTIVE">Active</option><option value="COMPLETED">Completed</option><option value="ARCHIVED">Archived</option></select></div>
{fetching ? <p>Loading projects...</p> : projects.filter((project)=>statusFilter === "ALL" || project.status === statusFilter).length===0 ? <p>No projects yet.</p> : <div className="space-y-4">{projects.filter((project)=>statusFilter === "ALL" || project.status === statusFilter).map((project)=>{const isEditing=editingProjectId===project.id; const isDeleting=deletingProjectId===project.id; return <article key={project.id} className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800">{isEditing ? <div className="space-y-3"><input value={editName} onChange={(e)=>setEditName(e.target.value)} className="w-full rounded-lg border px-3 py-2"/><textarea value={editDescription} onChange={(e)=>setEditDescription(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2"/><div className="flex items-center gap-3"><input type="color" value={editColor||DEFAULT_COLOR} onChange={(e)=>setEditColor(e.target.value)} className="h-10 w-14"/><select value={editStatus} onChange={(e)=>setEditStatus(e.target.value as ProjectStatus)} className="rounded-lg border px-3 py-2 text-sm">{STATUS_OPTIONS.map((status)=><option key={status} value={status}>{formatStatus(status)}</option>)}</select></div><div className="flex gap-2"><button type="button" onClick={()=>void handleUpdateProject(project.id)} disabled={savingEdit} className="rounded-lg bg-black px-4 py-2 text-sm text-white">{savingEdit?"Saving...":"Save"}</button><button type="button" onClick={cancelEditing} className="rounded-lg border px-4 py-2 text-sm">Cancel</button></div></div> : <><Link href={`/projects/${project.id}`} className="block"><h3 className="text-xl font-semibold">{project.name}</h3>{project.description && <p className="mt-2 text-zinc-700 dark:text-zinc-300">{project.description}</p>}</Link><div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300"><span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">{formatStatus(project.status)}</span><span className="inline-block h-3 w-3 rounded-full border" style={{backgroundColor:project.color||"transparent"}}/><span>{project.color||"No color"}</span></div><div className="mt-4 flex gap-2"><button onClick={()=>startEditing(project)} className="rounded-lg border px-4 py-2 text-sm">Edit</button><button onClick={()=>void handleDeleteProject(project.id)} disabled={isDeleting} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white">{isDeleting?"Deleting...":"Delete"}</button></div></>}</article>;})}</div>}</section></div></main>;
}
