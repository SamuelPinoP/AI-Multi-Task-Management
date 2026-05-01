import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Note id is required" }, { status: 400 });
    }

    const deleted = await prisma.note.deleteMany({
      where: {
        id,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Note deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/notes/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
