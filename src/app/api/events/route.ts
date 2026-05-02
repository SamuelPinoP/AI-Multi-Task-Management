import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";

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

export async function GET() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
      include: {
        events: {
          orderBy: [{ startTime: "asc" }, { createdAt: "desc" }],
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user.events);
  } catch (error) {
    console.error("GET /api/events error:", error);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
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

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";

    const event = await prisma.event.create({
      data: {
        title,
        description: description || null,
        location: location || null,
        startTime,
        endTime,
        userId: user.id,
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error("POST /api/events error:", error);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
