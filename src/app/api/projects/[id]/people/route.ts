import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { canManageProjectMembers, getProjectAccess } from "@/lib/project-access";
import { findByUsername } from "@/lib/project-people";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Finds someone to add by their exact username (#393): `{ person }`, or
 * `{ person: null }` when nobody outside the project has it. Only the owner
 * and admins may look; to anyone else the project isn't there.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id: projectId } = await context.params;
    if (!canManageProjectMembers(await getProjectAccess(projectId, user.id))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const username = new URL(req.url).searchParams.get("username")?.trim() ?? "";
    if (!username) return NextResponse.json({ error: "A username is required" }, { status: 400 });

    const limit = await consumeRateLimit(RATE_LIMITS.peopleLookupUser, user.id);
    if (!limit.allowed) return rateLimitedResponse("searches", limit);
    return NextResponse.json({ person: await findByUsername(projectId, user.id, username) });
  } catch (error) {
    console.error("GET /api/projects/[id]/people error:", error);
    return NextResponse.json({ error: "Failed to look the username up" }, { status: 500 });
  }
}
