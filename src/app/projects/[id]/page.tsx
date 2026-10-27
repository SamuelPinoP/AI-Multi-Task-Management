import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { ProjectCalendar } from "@/components/project-calendar";
import { ProjectQuickActions } from "@/components/project-quick-actions";
import { BackLink, uiButtonClass, uiCardClass } from "@/components/ui";
import { ProjectTeamSection } from "@/components/project-team-section";
import { ProjectAssignedTasksSection } from "@/components/project-assigned-tasks-section";
import { ProjectChatPanel } from "@/components/project-chat-panel";
import { ProjectInsights } from "@/components/projects/project-insights";
import { ProjectAutomations } from "@/components/projects/project-automations";
import { GithubPanel } from "@/components/projects/github-panel";
import { ProjectShare } from "@/components/projects/project-share";
import { eventWallTime, formatEventDateTime } from "@/lib/event-time";
import {
  getProjectAccessForUser,
  projectAccessWhereForProject,
} from "@/lib/project-access";
import { OWNER_INVITATION_SELECT } from "@/lib/project-invitations";
import { AUTOMATION_SELECT, automationJson } from "@/lib/project-automations";
import { sharePath } from "@/lib/project-share";
import { markProjectOpened } from "@/lib/recent-shortcuts";
import { describeRepeat, firstOccurrenceEnd } from "@/lib/recurrence";
import { projectInsights } from "@/lib/project-insights";
import { isOverdueTask } from "@/lib/task-date-buckets";
import { toWallClock } from "@/lib/user-time";
import { getUserTimeZone } from "@/lib/user-time-server";

type ProjectDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const user = await requirePageUser();
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: projectAccessWhereForProject(id, user.id),
    include: {
      notes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, content: true },
      },
      tasks: {
        where: { deletedAt: null },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          recurrence: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          assignee: { select: { id: true, name: true, role: true } },
        },
      },
      members: {
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, name: true, email: true } },
          notes: {
            where: {
              OR: [{ visibility: "TEAM" }, { createdByUserId: user.id }],
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              message: true,
              createdAt: true,
              visibility: true,
              createdByUserId: true,
            },
          },
        },
      },
      events: {
        where: { deletedAt: null },
        orderBy: { startTime: "asc" },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          hasStartTime: true,
          hasEndTime: true,
          recurrence: true,
          repeatUntil: true,
          skippedDates: true,
        },
      },
      invitations: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        select: OWNER_INVITATION_SELECT,
      },
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { name: true, email: true } },
          attachments: { orderBy: { createdAt: "asc" } },
        },
      },
      automations: { orderBy: { createdAt: "asc" }, select: AUTOMATION_SELECT },
    },
  });

  if (!project) notFound();

  await markProjectOpened(project.id, user.id);

  const access = getProjectAccessForUser(project, user.id);
  const isOwner = access?.accessLevel === "OWNER";
  const canEditProjectContent = access?.accessLevel === "OWNER" || access?.accessLevel === "EDITOR";
  const roleLabel = access?.accessLevel === "VIEWER" ? "Viewer (read-only)" : isOwner ? "Owner" : "Editor";
  const timeZone = await getUserTimeZone();
  const wall = (instant: Date) => toWallClock(timeZone, instant);
  const now = wall(new Date());
  const upcomingEvents = project.events.filter(
    (event) => eventWallTime(event.startTime) >= now,
  ).length;
  const insights = projectInsights(
    project.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueDate: task.dueDate,
      createdAt: wall(task.createdAt),
      updatedAt: wall(task.updatedAt),
      completedAt: task.completedAt ? wall(task.completedAt) : null,
    })),
    { updatedAt: wall(project.updatedAt) },
    now,
  );

  const workload = new Map<
    string,
    { name: string; active: number; completed: number; overdue: number }
  >();
  for (const member of project.members)
    workload.set(member.id, {
      name: member.name,
      active: 0,
      completed: 0,
      overdue: 0,
    });
  workload.set("unassigned", {
    name: "Unassigned",
    active: 0,
    completed: 0,
    overdue: 0,
  });
  for (const task of project.tasks) {
    const key = task.assignee?.id ?? "unassigned";
    const item = workload.get(key);
    if (!item) continue;
    if (task.status === "DONE") item.completed += 1;
    else {
      item.active += 1;
      if (isOverdueTask(task.dueDate, now)) item.overdue += 1;
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
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              <path
                d="M4.5 6.5h11M4.5 10h7M4.5 13.5h5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Chat</span>
          </Link>
        </div>

        <section className={uiCardClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Project workspace
              </p>
              <h1 className="mt-1 text-title">{project.name}</h1>
              {project.description ? (
                <p className="mt-3 max-w-3xl text-zinc-700 dark:text-zinc-300">
                  {project.description}
                </p>
              ) : (
                <p className="mt-3 max-w-3xl text-zinc-500 dark:text-zinc-400">
                  No description yet. Add one from the Projects list to make
                  this workspace easier for collaborators to understand.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <span className="inline-flex items-center rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">
                Status:{" "}
                {project.status.charAt(0) +
                  project.status.slice(1).toLowerCase()}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${isOwner ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"}`}
              >
                {roleLabel}
              </span>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-300">
            {isOwner
              ? "Owner permissions: you can edit project details, invite collaborators, remove members, change roles, and coordinate work through tasks, notes, events, and chat."
              : canEditProjectContent
                ? "Editor permissions: you can create and edit project tasks, notes, events, comments, and attachments, but cannot invite members or delete the project."
                : "Viewer permissions: this is a read-only project. You can view project tasks, notes, events, comments, attachments, dashboard, and planner data, but cannot create or change project content."}
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span
              className="inline-block h-3 w-3 rounded-full border border-zinc-300 dark:border-zinc-700"
              style={{ backgroundColor: project.color || "transparent" }}
            />
            <span>{project.color || "No color"}</span>
          </div>
        </section>

        <ProjectInsights
          insights={insights}
          counts={{ notes: project.notes.length, upcomingEvents }}
        />

        {canEditProjectContent ? (
          <ProjectQuickActions projectId={project.id} />
        ) : (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Read-only access: ask the project owner for Editor access to create tasks, notes, events, comments, or attachments.
          </div>
        )}
        <ProjectTeamSection
          projectId={project.id}
          initialMembers={project.members.map((member) => ({
            ...member,
            notes: member.notes.map((note) => ({
              ...note,
              createdAt: note.createdAt.toISOString(),
            })),
          }))}
          workloadRows={Array.from(workload.entries())}
          isOwner={isOwner}
          // Invitee emails are for the owner only; don't ship them to other members.
          pendingInvitations={(isOwner ? project.invitations : []).map((invitation) => ({
            ...invitation,
            createdAt: invitation.createdAt.toISOString(),
          }))}
        />

        <ProjectAutomations
          projectId={project.id}
          isOwner={isOwner}
          initialRules={project.automations.map(automationJson)}
          members={project.members.map((member) => ({ id: member.id, name: member.name }))}
        />

        <GithubPanel
          endpoint={`/api/projects/${project.id}/github`}
          repo={project.githubRepo}
          manageProjectId={isOwner ? project.id : undefined}
        />
        {/* The share token is the owner's to hand out; other members never receive it. */}
        {isOwner ? (
          <ProjectShare projectId={project.id} initialPath={project.shareToken ? sharePath(project.shareToken) : null} />
        ) : null}

        <section className="mt-8">
          <h2 className="mb-4 text-2xl font-semibold">Assigned Notes</h2>
          {project.notes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              No notes are assigned to this project yet. Create or edit a note
              and choose this project to keep research, decisions, and meeting
              context together.
            </p>
          ) : (
            <div className="space-y-4">
              {project.notes.map((note) => (
                <article
                  key={note.id}
                  className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800"
                >
                  <h3 className="text-lg font-semibold">{note.title}</h3>
                  <p className="mt-2 text-zinc-700 dark:text-zinc-300">
                    {note.content || "No content."}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <ProjectAssignedTasksSection
          projectId={project.id}
          tasks={project.tasks.map(
            ({ createdAt, updatedAt, completedAt, ...task }) => {
              void createdAt;
              void updatedAt;
              void completedAt;
              return {
                ...task,
                dueDate: task.dueDate ? task.dueDate.toISOString() : null,
              };
            },
          )}
          members={project.members.map((member) => ({
            id: member.id,
            name: member.name,
          }))}
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

        <section className="mt-8">
          <h2 className="mb-4 text-2xl font-semibold">Project Calendar</h2>
          <ProjectCalendar
            projectColor={project.color}
            events={project.events.map((event) => ({
              ...event,
              startTime: event.startTime.toISOString(),
              endTime: event.endTime ? event.endTime.toISOString() : null,
              repeatUntil: event.repeatUntil?.toISOString() ?? null,
              skippedDates: event.skippedDates.map((date) => date.toISOString()),
            }))}
          />
        </section>

        <section className="mt-8">
          <h2 className="mb-4 text-2xl font-semibold">Events</h2>
          {project.events.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
              No events are assigned to this project yet. Add project events to
              make milestones visible in the calendar, Today, and Roadmap views.
            </p>
          ) : (
            <div className="space-y-4">
              {project.events.map((event) => (
                <article
                  key={event.id}
                  className="rounded-2xl border border-zinc-200 p-5 shadow-sm dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">{event.title}</h3>
                    <span className="inline-flex items-center rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">
                      Project event
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {formatEventDateTime(event.startTime)}
                    {event.endTime
                      ? ` → ${formatEventDateTime(firstOccurrenceEnd(event) ?? event.endTime)}`
                      : ""}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {event.recurrence === "NONE" ? "Does not repeat" : describeRepeat(event.recurrence, event.repeatUntil)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
