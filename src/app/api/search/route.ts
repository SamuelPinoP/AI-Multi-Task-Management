import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";

const MAX_RESULTS_PER_TYPE = 8;

function normalizeQuery(input: string | null) {
  return (input ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = normalizeQuery(searchParams.get("q"));

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    if (!query) {
      return NextResponse.json({ projects: [], notes: [], tasks: [], events: [] });
    }

    const whereContains = { contains: query, mode: "insensitive" as const };

    const [projects, notes, tasks, events] = await Promise.all([
      prisma.project.findMany({
        where: {
          userId: user.id,
          OR: [{ name: whereContains }, { description: whereContains }],
        },
        select: { id: true, name: true, color: true },
        orderBy: { createdAt: "desc" },
        take: MAX_RESULTS_PER_TYPE,
      }),
      prisma.note.findMany({
        where: {
          userId: user.id,
          deletedAt: null,
          OR: [{ title: whereContains }, { content: whereContains }],
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          project: { select: { id: true, name: true, color: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: MAX_RESULTS_PER_TYPE,
      }),
      prisma.task.findMany({
        where: {
          userId: user.id,
          deletedAt: null,
          OR: [{ title: whereContains }, { description: whereContains }],
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          status: true,
          project: { select: { id: true, name: true, color: true } },
        },
        orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
        take: MAX_RESULTS_PER_TYPE,
      }),
      prisma.event.findMany({
        where: {
          userId: user.id,
          deletedAt: null,
          OR: [{ title: whereContains }, { description: whereContains }, { location: whereContains }],
        },
        select: {
          id: true,
          title: true,
          startTime: true,
          project: { select: { id: true, name: true, color: true } },
        },
        orderBy: [{ startTime: "asc" }, { updatedAt: "desc" }],
        take: MAX_RESULTS_PER_TYPE,
      }),
    ]);

    return NextResponse.json({ projects, notes, tasks, events });
  } catch (error) {
    console.error("GET /api/search error:", error);
    return NextResponse.json({ error: "Failed to search" }, { status: 500 });
  }
}
