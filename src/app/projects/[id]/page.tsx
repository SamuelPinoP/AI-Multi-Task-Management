import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProjectCalendar } from "@/components/project-calendar";
import { ProjectQuickActions } from "@/components/project-quick-actions";
import { BackLink, uiButtonClass, uiCardClass } from "@/components/ui";
import { ProjectTeamSection } from "@/components/project-team-section";
import { ProjectAssignedTasksSection } from "@/components/project-assigned-tasks-section";
import { ProjectChatPanel } from "@/components/project-chat-panel";

const DEMO_USER_EMAIL = "samuel@example.com";

type ProjectDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: { id, user: { email: DEMO_USER_EMAIL } },
    include: {
      notes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, content: true } },
      tasks: {
        where: { deletedAt: null },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, recurrence: true, assignee: { select: { id: true, name: true, role: true } } },
      },
      members: { orderBy: { createdAt: "asc" }, include: { notes: { orderBy: { createdAt: "desc" }, select: { id: true, message: true, createdAt: true, visibility: true, createdByUserId: true } } } },
      events: {
        where: { deletedAt: null }, orderBy: { startTime: "asc" },
        select: { id: true, title: true, startTime: true, endTime: true, hasStartTime: true, hasEndTime: true, recurrence: true },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  if (!project) notFound();

  const now = new Date();
  const totalNotes = project.notes.length;
  const totalTasks = project.tasks.length;
  const completedTasks = project.tasks.filter((task) => task.status === "DONE").length;
  const activeTasks = project.tasks.filter((task) => task.status !== "DONE").length;
  const overdueTasks = project.tasks.filter((task) => task.status !== "DONE" && task.dueDate && task.dueDate < now).length;
  const upcomingEvents = project.events.filter((event) => event.startTime >= now).length;
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const workload = new Map<string, { name: string; active: number; completed: number; overdue: number }>();
  for (const member of project.members) workload.set(member.id, { name: member.name, active: 0, completed: 0, overdue: 0 });
  workload.set("unassigned", { name: "Unassigned", active: 0, completed: 0, overdue: 0 });
  for (const task of project.tasks) {
    const key = task.assignee?.id ?? "unassigned";
    const item = workload.get(key);
    if (!item) continue;
    if (task.status === "DONE") item.completed += 1;
    else {
      item.active += 1;
      if (task.dueDate && task.dueDate < now) item.overdue += 1;
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="relative mb-6 flex flex-col gap-3 sm:min-h-11 sm:flex-row sm:items-center sm:justify-center">
          <div className="sm:absolute sm:left-0">
            <BackLink href="/projects">Back to Projects</BackLink>
          </div>
          <Link
            href={`/projects/${project.id}/chat`}
            className={`${uiButtonClass} w-full gap-2 rounded-2xl border-zinc-400 bg-zinc-100 px-5 py-2.5 text-base font-semibold shadow-sm hover:bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700 sm:w-auto sm:min-w-36`}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
              <path d="M4.5 6.5h11M4.5 10h7M4.5 13.5h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Chat</span>
          </Link>
        </div>

        <section className={uiCardClass}>
          <h1 className="text-3xl font-bold">{project.name}</h1>
          <div className="mt-3"><span className="inline-flex items-center rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">Status: {project.status.charAt(0) + project.status.slice(1).toLowerCase()}</span></div>
          {project.description ? <p className="mt-2 text-zinc-700 dark:text-zinc-300">{project.description}</p> : <p className="mt-2 text-zinc-500">No description.</p>}
          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300"><span className="inline-block h-3 w-3 rounded-full border border-zinc-300 dark:border-zinc-700" style={{ backgroundColor: project.color || "transparent" }} /><span>{project.color || "No color"}</span></div>
        </section>

        <section className="mt-8">
          <h2 className="mb-4 text-2xl font-semibold">Project Progress Summary</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <article className={uiCardClass.replace("p-6", "p-4")}><p className="text-sm text-zinc-500">Total Notes</p><p className="mt-2 text-2xl font-semibold">{totalNotes}</p></article>
            <article className={uiCardClass.replace("p-6", "p-4")}><p className="text-sm text-zinc-500">Total Tasks</p><p className="mt-2 text-2xl font-semibold">{totalTasks}</p></article>
            <article className={uiCardClass.replace("p-6", "p-4")}><p className="text-sm text-zinc-500">Completed Tasks</p><p className="mt-2 text-2xl font-semibold">{completedTasks}</p></article>
            <article className={uiCardClass.replace("p-6", "p-4")}><p className="text-sm text-zinc-500">Active Tasks</p><p className="mt-2 text-2xl font-semibold">{activeTasks}</p></article>
            <article className={uiCardClass.replace("p-6", "p-4")}><p className="text-sm text-zinc-500">Overdue Tasks</p><p className="mt-2 text-2xl font-semibold">{overdueTasks}</p></article>
            <article className={uiCardClass.replace("p-6", "p-4")}><p className="text-sm text-zinc-500">Upcoming Events</p><p className="mt-2 text-2xl font-semibold">{upcomingEvents}</p></article>
            <article className="rounded-2xl border border-zinc-200 p-4 shadow-sm dark:border-zinc-800 sm:col-span-2 lg:col-span-2"><p className="text-sm text-zinc-500">Task Completion</p><p className="mt-2 text-2xl font-semibold">{totalTasks === 0 ? "0%" : `${completionPercentage}%`}</p><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{totalTasks === 0 ? "No tasks yet" : `${completedTasks} of ${totalTasks} tasks complete`}</p></article>
          </div>
        </section>

        <ProjectQuickActions projectId={project.id} />
        <ProjectTeamSection projectId={project.id} initialMembers={project.members} workloadRows={Array.from(workload.entries())} />

        <section className="mt-8"><h2 className="mb-4 text-2xl font-semibold">Assigned Notes</h2>{project.notes.length === 0 ? <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">No notes are assigned to this project yet.</p> : <div className="space-y-4">{project.notes.map((note) => <article key={note.id} className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800"><h3 className="text-lg font-semibold">{note.title}</h3><p className="mt-2 text-zinc-700 dark:text-zinc-300">{note.content || "No content."}</p></article>)}</div>}</section>

        <ProjectAssignedTasksSection
          projectId={project.id}
          tasks={project.tasks.map((task) => ({
            ...task,
            dueDate: task.dueDate ? task.dueDate.toISOString() : null,
          }))}
          members={project.members.map((member) => ({ id: member.id, name: member.name }))}
        />

        <ProjectChatPanel
          projectId={project.id}
          initialComments={project.comments.map((comment) => ({
            id: comment.id,
            message: comment.message,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            author: { name: comment.user.name, email: comment.user.email },
            attachments: comment.attachments.map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              originalName: attachment.originalName,
              fileType: attachment.fileType,
              fileSize: attachment.fileSize,
              url: attachment.url,
              createdAt: attachment.createdAt.toISOString(),
            })),
          }))}
        />

        <section className="mt-8"><h2 className="mb-4 text-2xl font-semibold">Project Calendar</h2><ProjectCalendar projectColor={project.color} events={project.events.map((event) => ({ ...event, startTime: event.startTime.toISOString(), endTime: event.endTime ? event.endTime.toISOString() : null }))} /></section>

        <section className="mt-8"><h2 className="mb-4 text-2xl font-semibold">Events</h2>{project.events.length === 0 ? <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">No events are assigned to this project yet.</p> : <div className="space-y-4">{project.events.map((event) => <article key={event.id} className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{event.title}</h3><span className="inline-flex items-center rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">Project event</span></div><p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{new Date(event.startTime).toLocaleString()}{event.endTime ? ` → ${new Date(event.endTime).toLocaleString()}` : ""}</p><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Recurrence: {event.recurrence}</p></article>)}</div>}</section>
      </div>
    </main>
  );
}
