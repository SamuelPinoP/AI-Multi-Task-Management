import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { guestLimitResponse } from "@/lib/guest-limits";
import { createNote, parseNoteBody } from "@/lib/note-writes";
import { projectAccessWhere } from "@/lib/project-access";

export async function GET() {
  try {
    const authUser = await requireApiUser();
    if (!authUser)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );

    const notes = await prisma.note.findMany({
      where: {
        deletedAt: null,
        OR: [
          { userId: authUser.id },
          { project: projectAccessWhere(authUser.id) },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: { project: { select: { id: true, name: true, color: true } } },
    });

    return NextResponse.json(notes);
  } catch (error) {
    console.error("GET /api/notes error:", error);
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // The fields first, then the account; the rules are in src/lib/note-writes.ts, which AI apps' changes use too (#479).
    const parsed = parseNoteBody(body && typeof body === "object" ? body : {});
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const user = await requireApiUser();
    if (!user)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    const guestLimit = await guestLimitResponse(user, "notes");
    if (guestLimit) return guestLimit;

    const result = await createNote(user, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value, { status: 201 });
  } catch (error) {
    console.error("POST /api/notes error:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 },
    );
  }
}
