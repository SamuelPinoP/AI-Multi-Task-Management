import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseDateTime(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    return { error: `${fieldName} is required` };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `Invalid ${fieldName.toLowerCase()}` };
  }

  return { value: parsed };
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Event id is required" }, { status: 400 });
    }

    const body = await req.json();

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const startResult = parseDateTime(body.startTime, "Start time");
    if (startResult.error) {
      return NextResponse.json({ error: startResult.error }, { status: 400 });
    }

    const endResult = parseDateTime(body.endTime, "End time");
    if (endResult.error) {
      return NextResponse.json({ error: endResult.error }, { status: 400 });
    }

    const startTime = startResult.value as Date;
    const endTime = endResult.value as Date;

    if (endTime <= startTime) {
      return NextResponse.json(
        { error: "End time must be after start time" },
        { status: 400 }
      );
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";

    const updated = await prisma.event.updateMany({
      where: {
        id,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
      data: {
        title,
        description: description || null,
        location: location || null,
        startTime,
        endTime,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const event = await prisma.event.findUnique({ where: { id } });
    return NextResponse.json(event, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/events/[id] error:", error);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Event id is required" }, { status: 400 });
    }

    const deleted = await prisma.event.deleteMany({
      where: {
        id,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Event deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/events/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
