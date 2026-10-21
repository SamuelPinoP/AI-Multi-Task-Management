import { GoalStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { weekStart } from "@/lib/weekly-review";

type RouteContext = { params: Promise<{ id: string }> };

/** Renames a goal, marks it achieved or not, or moves it to another week. Goals are personal. */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const body = await req.json().catch(() => null);
    const data: { title?: string; status?: GoalStatus; targetWeek?: string } = {};
    if (body?.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
      if (!title) return NextResponse.json({ error: "Give the goal a title" }, { status: 400 });
      data.title = title;
    }
    if (body?.status !== undefined) {
      if (!Object.values(GoalStatus).includes(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      data.status = body.status;
    }
    if (body?.targetWeek !== undefined) {
      if (typeof body.targetWeek !== "string" || !weekStart(body.targetWeek)) return NextResponse.json({ error: "Invalid week" }, { status: 400 });
      data.targetWeek = body.targetWeek;
    }

    const updated = await prisma.weeklyGoal.updateMany({ where: { id, userId: user.id }, data });
    if (updated.count === 0) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    const goal = await prisma.weeklyGoal.findUnique({ where: { id }, select: { id: true, title: true, status: true, targetWeek: true } });
    return NextResponse.json(goal);
  } catch (error) {
    console.error("PATCH /api/goals/[id] error:", error);
    return NextResponse.json({ error: "Failed to update the goal" }, { status: 500 });
  }
}

/** Deletes a goal; its tasks stay, unlinked. */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const deleted = await prisma.weeklyGoal.deleteMany({ where: { id, userId: user.id } });
    if (deleted.count === 0) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    return NextResponse.json({ message: "Goal deleted" });
  } catch (error) {
    console.error("DELETE /api/goals/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete the goal" }, { status: 500 });
  }
}
