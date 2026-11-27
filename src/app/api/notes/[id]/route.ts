import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { parseNoteBody, trashNote, updateNote } from "@/lib/note-writes";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// The rules live in src/lib/note-writes.ts, which connected AI apps' changes use too (#479).

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );

    const { id } = await context.params;
    if (!id)
      return NextResponse.json(
        { error: "Note id is required" },
        { status: 400 },
      );

    const body = await req.json();
    const parsed = parseNoteBody(body && typeof body === "object" ? body : {});
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const result = await updateNote(user, id, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/notes/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update note" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );

    const { id } = await context.params;
    if (!id)
      return NextResponse.json(
        { error: "Note id is required" },
        { status: 400 },
      );

    const result = await trashNote(user, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(
      { message: "Note moved to trash" },
      { status: 200 },
    );
  } catch (error) {
    console.error("DELETE /api/notes/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete note" },
      { status: 500 },
    );
  }
}
