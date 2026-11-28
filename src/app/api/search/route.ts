import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { projectAccessWhere } from "@/lib/project-access";
import { parseTaskNumberQuery } from "@/lib/task-number";

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
    const taskNumber = parseTaskNumberQuery(query);
    const taskSelect = {
      id: true,
      number: true,
      title: true,
      dueDate: true,
      status: true,
      project: { select: { id: true, name: true, color: true } },
    } as const;
    // Your own items plus anything in a project you can open, as /api/tasks does.
    const visible = { OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] };

    const [projects, notes, tasks, events] = await Promise.all([
      prisma.project.findMany({
        where: {
          AND: [
            projectAccessWhere(user.id),
            { OR: [{ name: whereContains }, { description: whereContains }] },
          ],
        },
        select: { id: true, name: true, color: true },
        orderBy: { createdAt: "desc" },
        take: MAX_RESULTS_PER_TYPE,
      }),
      prisma.note.findMany({
        where: {
          deletedAt: null,
          AND: [visible, { OR: [{ title: whereContains }, { content: whereContains }] }],
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
      // "AM-142" or "142" also finds task 142 by its permanent number (#486), first in the list.
      Promise.all([
        taskNumber === null ? null : prisma.task.findFirst({ where: { deletedAt: null, number: taskNumber, AND: [visible] }, select: taskSelect }),
        prisma.task.findMany({
          where: {
            deletedAt: null,
            AND: [visible, { OR: [{ title: whereContains }, { description: whereContains }] }],
          },
          select: taskSelect,
          orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
          take: MAX_RESULTS_PER_TYPE,
        }),
      ]).then(([numbered, found]) =>
        numbered ? [numbered, ...found.filter((task) => task.id !== numbered.id)].slice(0, MAX_RESULTS_PER_TYPE) : found,
      ),
      prisma.event.findMany({
        where: {
          deletedAt: null,
          AND: [visible, { OR: [{ title: whereContains }, { description: whereContains }, { location: whereContains }] }],
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
