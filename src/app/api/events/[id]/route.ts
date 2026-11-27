import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { parseEventUpdateBody, trashEvent, updateEvent } from "@/lib/event-writes";
import { normalizeRecurrence } from "@/lib/recurrence";
import { runFollowUps } from "@/lib/writes";

type RouteContext = { params: Promise<{ id: string }> };

// The rules live in src/lib/event-writes.ts, which connected AI apps' changes use too (#479).

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    // The fields first, then the account, as before.
    const parsed = parseEventUpdateBody(body && typeof body === "object" ? body : {});
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const result = await updateEvent(user, id, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    runFollowUps(user, [result.followUp]);
    return NextResponse.json({ ...result.value, recurrence: normalizeRecurrence(result.value.recurrence) }, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/events/[id] error:", error);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Event id is required" }, { status: 400 });

    const result = await trashEvent(user, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    runFollowUps(user, [result.followUp]);
    return NextResponse.json({ message: "Event moved to trash" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/events/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
