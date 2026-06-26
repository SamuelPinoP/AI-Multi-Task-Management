import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { markNoteOpened, markProjectOpened } from "@/lib/recent-shortcuts";

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const type = body.type === "project" || body.type === "note" ? body.type : null;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!type || !id) return NextResponse.json({ error: "Shortcut type and id are required" }, { status: 400 });

    const marked = type === "project" ? await markProjectOpened(id, user.id) : await markNoteOpened(id, user.id);
    if (!marked) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/recent-shortcuts error:", error);
    return NextResponse.json({ error: "Failed to update recent shortcut" }, { status: 500 });
  }
}
