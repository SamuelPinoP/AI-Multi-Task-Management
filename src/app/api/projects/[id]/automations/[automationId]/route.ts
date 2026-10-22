import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectAccess, isProjectOwner } from "@/lib/project-access";
import { AUTOMATION_SELECT, automationJson } from "@/lib/project-automations";

type RouteContext = { params: Promise<{ id: string; automationId: string }> };

async function ownerCheck(context: RouteContext) {
  const user = await requireApiUser();
  if (!user) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const { id, automationId } = await context.params;
  const access = await getProjectAccess(id, user.id);
  if (!access) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  if (!isProjectOwner(access)) {
    return { response: NextResponse.json({ error: "Only the project owner can change automations." }, { status: 403 }) };
  }
  return { projectId: id, automationId };
}

/** Turns a rule on or off: `{ enabled: boolean }`. */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const check = await ownerCheck(context);
    if ("response" in check) return check.response;

    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

    const updated = await prisma.projectAutomation.updateMany({
      where: { id: check.automationId, projectId: check.projectId },
      data: { enabled: body.enabled },
    });
    if (updated.count === 0) return NextResponse.json({ error: "Automation not found" }, { status: 404 });

    const rule = await prisma.projectAutomation.findUniqueOrThrow({ where: { id: check.automationId }, select: AUTOMATION_SELECT });
    return NextResponse.json(automationJson(rule));
  } catch (error) {
    console.error("PATCH /api/projects/[id]/automations/[automationId] error:", error);
    return NextResponse.json({ error: "Failed to update the automation" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const check = await ownerCheck(context);
    if ("response" in check) return check.response;

    const deleted = await prisma.projectAutomation.deleteMany({ where: { id: check.automationId, projectId: check.projectId } });
    if (deleted.count === 0) return NextResponse.json({ error: "Automation not found" }, { status: 404 });
    return NextResponse.json({ message: "Automation deleted" });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/automations/[automationId] error:", error);
    return NextResponse.json({ error: "Failed to delete the automation" }, { status: 500 });
  }
}
