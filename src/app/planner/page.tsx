import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Priority, Recurrence, TaskStatus } from "@prisma/client";
import { uiButtonClass, uiCardClass, uiPrimaryButtonClass } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { createActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { projectAccessWhereForProject } from "@/lib/project-access";
import { generateSmartPlanner, type PlannerPriority, type PlannerSuggestion } from "@/lib/smart-planner";

function priorityClass(priority: PlannerPriority) {
  if (priority === "HIGH") return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200";
}

async function createTaskFromSuggestion(formData: FormData) {
  "use server";

  const user = await requirePageUser();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priorityInput = String(formData.get("priority") ?? "MEDIUM");
  const projectId = String(formData.get("projectId") ?? "").trim() || null;

  if (!title) return;
  const priority = Object.values(Priority).includes(priorityInput as Priority) ? (priorityInput as Priority) : Priority.MEDIUM;

  if (projectId) {
    const project = await prisma.project.findFirst({ where: projectAccessWhereForProject(projectId, user.id), select: { id: true } });
    if (!project) return;
  }

  const task = await prisma.task.create({
    data: { title, description: description || null, priority, status: TaskStatus.TODO, recurrence: Recurrence.NONE, userId: user.id, projectId },
  });

  void createActivity({ userId: user.id, action: "CREATED_TASK", message: `Created task from Smart Planner: “${task.title}”`, entityType: "TASK", entityId: task.id, projectId });
  revalidatePath("/planner");
  revalidatePath("/tasks");
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: PlannerSuggestion }) {
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white/75 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/35">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${priorityClass(suggestion.priority)}`}>{suggestion.priority}</span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{suggestion.kind}</span>
            {suggestion.related ? <span className="text-xs text-zinc-500 dark:text-zinc-400">Related: {suggestion.related.label}</span> : null}
          </div>
          <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{suggestion.title}</h3>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">{suggestion.reason}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {suggestion.actionHref ? <Link href={suggestion.actionHref} className={uiButtonClass}>Open</Link> : null}
          {suggestion.canCreateTask ? (
            <form action={createTaskFromSuggestion}>
              <input type="hidden" name="title" value={suggestion.suggestedTaskTitle ?? suggestion.title} />
              <input type="hidden" name="description" value={suggestion.suggestedTaskDescription ?? suggestion.reason} />
              <input type="hidden" name="priority" value={suggestion.priority} />
              <input type="hidden" name="projectId" value={suggestion.projectId ?? ""} />
              <button type="submit" className={uiPrimaryButtonClass}>Create task</button>
            </form>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default async function PlannerPage() {
  const user = await requirePageUser();
  const planner = await generateSmartPlanner(user.id);
  const hasSuggestions = planner.sections.some((section) => section.suggestions.length > 0);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.92),rgba(244,244,245,0.78))] p-6 shadow-sm dark:border-zinc-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.16),transparent_34%),linear-gradient(135deg,rgba(24,24,27,0.95),rgba(9,9,11,0.82))] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 dark:text-blue-300">Rule-based productivity assistant</p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Smart Daily Planner</h1>
              <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-300">A deterministic planning engine analyzes your accessible tasks, events, active projects, recent notes, project chat, and activity—without sending data to a paid external AI service.</p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white/75 p-4 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300">
              Generated {planner.generatedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard label="Overdue" value={planner.stats.overdueTasks} />
          <StatCard label="Due today" value={planner.stats.dueTodayTasks} />
          <StatCard label="Due soon" value={planner.stats.dueSoonTasks} />
          <StatCard label="Events" value={planner.stats.upcomingEvents} />
          <StatCard label="Projects" value={planner.stats.activeProjects} />
          <StatCard label="Notes" value={planner.stats.recentNotes} />
        </section>

        {!hasSuggestions ? (
          <section className={uiCardClass}>
            <h2 className="text-2xl font-semibold">Your plan is clear</h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">No urgent recommendations were found. Add tasks with due dates, create events, or connect notes to projects to receive richer planning suggestions.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/tasks" className={uiPrimaryButtonClass}>Add tasks</Link>
              <Link href="/events" className={uiButtonClass}>Schedule events</Link>
            </div>
          </section>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            {planner.sections.map((section) => (
              <section key={section.key} className={`${uiCardClass} space-y-4`}>
                <div>
                  <h2 className="text-2xl font-semibold">{section.title}</h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{section.description}</p>
                </div>
                {section.suggestions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">No recommendations in this section right now.</div>
                ) : (
                  <div className="space-y-3">{section.suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} />)}</div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
