import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getWorkspaceNav } from "@/lib/workspace-nav";

export async function GET() {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    return NextResponse.json(await getWorkspaceNav(user));
  } catch (error) {
    console.error("GET /api/workspace-nav error:", error);
    return NextResponse.json({ error: "Failed to load navigation" }, { status: 500 });
  }
}
