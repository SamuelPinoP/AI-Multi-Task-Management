import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { refreshCalendarFeeds } from "@/lib/calendar-feed-store";
import { editableTaskWhere, loadGoalsWeek } from "@/lib/goals";
import { prisma } from "@/lib/prisma";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { getUserTimeZone } from "@/lib/user-time-server";
import { nextWeekDayKey, shiftWeek, weekStart } from "@/lib/weekly-review";

/**
 * The weekly review's one click (SMART-04): moves the week's slipped tasks to
 * the same weekday next week, and its unachieved goals to next week.
 * Body: `{ week }`. Tasks you can't edit stay where they are.
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const week = typeof body?.week === "string" ? body.week : "";
    if (!weekStart(week)) return NextResponse.json({ error: "Invalid week" }, { status: 400 });

    const { review } = await loadGoalsWeek(user.id, week, await getUserTimeZone());
    const movedIds: string[] = [];
    for (const task of review.slipped) {
      const dueDate = task.dueDate ? parseTaskDueDateForStorage(nextWeekDayKey(task.dueDate)) : null;
      if (!dueDate) continue;
      const moved = await prisma.task.updateMany({ where: { id: task.id, ...editableTaskWhere(user.id) }, data: { dueDate } });
      if (moved.count) movedIds.push(task.id);
    }
    const tasks = movedIds.length;
    if (tasks) {
      const moved = await prisma.task.findMany({ where: { id: { in: movedIds } }, select: { userId: true, projectId: true } });
      refreshCalendarFeeds({ userIds: moved.map((task) => task.userId), projectIds: moved.map((task) => task.projectId) });
    }
    const goals = await prisma.weeklyGoal.updateMany({
      where: { id: { in: review.openGoals.map((goal) => goal.id) }, userId: user.id },
      data: { targetWeek: shiftWeek(week, 1) },
    });

    return NextResponse.json({ tasks, goals: goals.count });
  } catch (error) {
    console.error("POST /api/goals/carry-forward error:", error);
    return NextResponse.json({ error: "Failed to carry work forward" }, { status: 500 });
  }
}
