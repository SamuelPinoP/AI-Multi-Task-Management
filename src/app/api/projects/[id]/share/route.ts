import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectAccess, isProjectOwner } from "@/lib/project-access";
import { newShareToken, sharePath } from "@/lib/project-share";

type RouteContext = { params: Promise<{ id: string }> };

async function ownerProjectId(context: RouteContext) {
  const user = await requireApiUser();
  if (!user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { id } = await context.params;
  const access = await getProjectAccess(id, user.id);
  if (!access) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  if (!isProjectOwner(access)) return { response: NextResponse.json({ error: "Only the project owner can share it." }, { status: 403 }) };
  return { projectId: id };
}

/** Turns on the read-only share link (SMART-12), or replaces it: the old link stops working. Owners only. */
export async function POST(_req: Request, context: RouteContext) {
  try {
    const check = await ownerProjectId(context);
    if ("response" in check) return check.response;
    const token = newShareToken();
    const project = await prisma.project.update({
      where: { id: check.projectId },
      data: { shareToken: token, sharedAt: new Date() },
      select: { sharedAt: true },
    });
    return NextResponse.json({ path: sharePath(token), sharedAt: project.sharedAt }, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/share error:", error);
    return NextResponse.json({ error: "Failed to create the share link" }, { status: 500 });
  }
}

/** Turns sharing off. */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const check = await ownerProjectId(context);
    if ("response" in check) return check.response;
    await prisma.project.update({ where: { id: check.projectId }, data: { shareToken: null, sharedAt: null } });
    return NextResponse.json({ path: null });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/share error:", error);
    return NextResponse.json({ error: "Failed to turn off the share link" }, { status: 500 });
  }
}
