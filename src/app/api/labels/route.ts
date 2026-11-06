import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { cleanLabelName, isLabelColor, LABEL_NAME_MAX, nextLabelColor } from "@/lib/labels";
import { LABEL_SELECT, labelScopeWhere, visibleLabelWhere, type LabelScope } from "@/lib/labels-server";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, unauthorizedProjectResponse } from "@/lib/project-access";

/** How many labels one person, or one project, can have. */
const LABELS_PER_OWNER_MAX = 100;

/**
 * Labels the user can see (#276): their personal labels and those of every
 * project they belong to. `?project=<id>` narrows to one project's labels,
 * `?project=none` to the personal ones.
 */
export async function GET(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const project = new URL(req.url).searchParams.get("project");
    let where: Prisma.LabelWhereInput = visibleLabelWhere(user.id);
    if (project === "none") where = labelScopeWhere({ userId: user.id });
    else if (project) {
      if (!(await getProjectAccess(project, user.id))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      where = labelScopeWhere({ projectId: project });
    }

    const labels = await prisma.label.findMany({ where, select: LABEL_SELECT, orderBy: { name: "asc" } });
    return NextResponse.json(labels);
  } catch (error) {
    console.error("GET /api/labels error:", error);
    return NextResponse.json({ error: "Failed to fetch labels" }, { status: 500 });
  }
}

/** Creates a personal label, or a project label when `projectId` is given (Owners and Editors only). */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { name?: unknown; color?: unknown; projectId?: unknown } | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const name = cleanLabelName(body.name);
    if (!name) return NextResponse.json({ error: `Give the label a name of up to ${LABEL_NAME_MAX} characters.` }, { status: 400 });
    if (body.color !== undefined && !isLabelColor(body.color)) {
      return NextResponse.json({ error: "Pick one of the label colors." }, { status: 400 });
    }

    let scope: LabelScope = { userId: user.id };
    if (typeof body.projectId === "string" && body.projectId) {
      const access = await getProjectAccess(body.projectId, user.id);
      if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("create labels"), { status: 403 });
      scope = { projectId: body.projectId };
    }

    const where = labelScopeWhere(scope);
    const existing = await prisma.label.findFirst({ where: { ...where, name: { equals: name, mode: "insensitive" } }, select: LABEL_SELECT });
    if (existing) return NextResponse.json({ error: `“${existing.name}” already exists.`, label: existing }, { status: 409 });

    const siblings = await prisma.label.findMany({ where, select: { color: true } });
    if (siblings.length >= LABELS_PER_OWNER_MAX) {
      return NextResponse.json({ error: `There are already ${LABELS_PER_OWNER_MAX} labels here. Delete one first.` }, { status: 400 });
    }

    const label = await prisma.label.create({
      data: {
        name,
        color: typeof body.color === "string" ? body.color.toLowerCase() : nextLabelColor(siblings.map((sibling) => sibling.color)),
        ...("projectId" in scope ? { projectId: scope.projectId } : { userId: scope.userId }),
      },
      select: LABEL_SELECT,
    });
    return NextResponse.json(label, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A label with that name already exists." }, { status: 409 });
    }
    console.error("POST /api/labels error:", error);
    return NextResponse.json({ error: "Failed to create the label" }, { status: 500 });
  }
}
