import { prisma } from "@/lib/prisma";
import { normalizeRecurrence } from "@/lib/recurrence";
import { TodayWorkspace } from "@/components/today-workspace";

const DEMO_USER_EMAIL = "samuel@example.com";

export default async function TodayPage() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL }, select: { id: true } });

  const [tasks, events] = user
    ? await Promise.all([
        prisma.task.findMany({
          where: { userId: user.id, deletedAt: null },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          include: { project: { select: { id: true, name: true, color: true } } },
        }),
        prisma.event.findMany({
          where: { userId: user.id, deletedAt: null },
          orderBy: [{ startTime: "asc" }, { createdAt: "desc" }],
          include: { project: { select: { id: true, name: true, color: true } } },
        }),
      ])
    : [[], []];

  return (
    <TodayWorkspace
      initialTasks={tasks.map((task) => ({ ...task, dueDate: task.dueDate ? task.dueDate.toISOString() : null }))}
      initialEvents={events.map((event) => ({
        ...event,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime?.toISOString() ?? null,
        recurrence: normalizeRecurrence(event.recurrence),
      }))}
    />
  );
}
