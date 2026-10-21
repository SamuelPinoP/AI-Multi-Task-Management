import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { loadGoalsWeek, resolveWeek } from "@/lib/goals";
import { prisma } from "@/lib/prisma";
import { toWallClock } from "@/lib/user-time";
import { getUserTimeZone } from "@/lib/user-time-server";
import { weekStart } from "@/lib/weekly-review";

/** The Goals page for one week (SMART-04): `?week=2026-W43`, or the current week. */
export async function GET(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const timeZone = await getUserTimeZone();
    const week = resolveWeek(new URL(req.url).searchParams.get("week"), toWallClock(timeZone));
    return NextResponse.json(await loadGoalsWeek(user.id, week, timeZone));
  } catch (error) {
    console.error("GET /api/goals error:", error);
    return NextResponse.json({ error: "Failed to load goals" }, { status: 500 });
  }
}

/** Adds a goal: `{ title, targetWeek }`. */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    const targetWeek = typeof body?.targetWeek === "string" ? body.targetWeek : "";
    if (!title) return NextResponse.json({ error: "Give the goal a title" }, { status: 400 });
    if (!weekStart(targetWeek)) return NextResponse.json({ error: "Invalid week" }, { status: 400 });

    const goal = await prisma.weeklyGoal.create({
      data: { title, targetWeek, userId: user.id },
      select: { id: true, title: true, status: true, targetWeek: true },
    });
    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error("POST /api/goals error:", error);
    return NextResponse.json({ error: "Failed to add the goal" }, { status: 500 });
  }
}
