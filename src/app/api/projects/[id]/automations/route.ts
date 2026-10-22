import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectAccess, isProjectOwner } from "@/lib/project-access";
import { AUTOMATION_SELECT, automationJson } from "@/lib/project-automations";
import { parseAutomationInput } from "@/lib/project-automations-core";

type RouteContext = { params: Promise<{ id: string }> };

/** A project's automations (SMART-11): every member can see them. */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;
    if (!(await getProjectAccess(id, user.id))) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const rules = await prisma.projectAutomation.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" }, select: AUTOMATION_SELECT });
    return NextResponse.json(rules.map(automationJson));
  } catch (error) {
    console.error("GET /api/projects/[id]/automations error:", error);
    return NextResponse.json({ error: "Failed to load automations" }, { status: 500 });
  }
}

/** Adds a rule. Owners only, one rule of each kind per project. */
export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;
    const access = await getProjectAccess(id, user.id);
    if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!isProjectOwner(access)) return NextResponse.json({ error: "Only the project owner can change automations." }, { status: 403 });

    const input = parseAutomationInput(await req.json().catch(() => null));
    if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
    if (input.memberId) {
      const member = await prisma.projectMember.findFirst({ where: { id: input.memberId, projectId: id }, select: { id: true } });
      if (!member) return NextResponse.json({ error: "Choose a member of this project." }, { status: 400 });
    }

    try {
      const rule = await prisma.projectAutomation.create({ data: { projectId: id, ...input }, select: AUTOMATION_SELECT });
      return NextResponse.json(automationJson(rule), { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ error: "This project already has that rule. Edit or delete it instead." }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    console.error("POST /api/projects/[id]/automations error:", error);
    return NextResponse.json({ error: "Failed to add the automation" }, { status: 500 });
  }
}
