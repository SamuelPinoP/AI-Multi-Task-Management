import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { cleanLabelName, isLabelColor, LABEL_NAME_MAX } from "@/lib/labels";
import { canManageLabel, LABEL_SELECT, visibleLabelWhere } from "@/lib/labels-server";
import { prisma } from "@/lib/prisma";
import { unauthorizedProjectResponse } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string }> };

/** The label if the user can see it, or the response to send. */
async function findLabel(id: string, userId: string) {
  const label = await prisma.label.findFirst({
    where: { id, ...visibleLabelWhere(userId) },
    select: { ...LABEL_SELECT, userId: true },
  });
  if (!label) return { response: NextResponse.json({ error: "Label not found" }, { status: 404 }) };
  if (!(await canManageLabel(label, userId))) {
    return { response: NextResponse.json(unauthorizedProjectResponse("change labels"), { status: 403 }) };
  }
  return { label };
}

/** Renames or recolors a label (#276). */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;

    const body = (await req.json().catch(() => null)) as { name?: unknown; color?: unknown } | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const data: { name?: string; color?: string } = {};
    if (body.name !== undefined) {
      const name = cleanLabelName(body.name);
      if (!name) return NextResponse.json({ error: `Give the label a name of up to ${LABEL_NAME_MAX} characters.` }, { status: 400 });
      data.name = name;
    }
    if (body.color !== undefined) {
      if (!isLabelColor(body.color)) return NextResponse.json({ error: "Pick one of the label colors." }, { status: 400 });
      data.color = body.color.toLowerCase();
    }
    if (!data.name && !data.color) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const found = await findLabel(id, user.id);
    if (found.response) return found.response;
    const { label } = found;

    if (data.name) {
      const clash = await prisma.label.findFirst({
        where: {
          id: { not: label.id },
          ...(label.projectId ? { projectId: label.projectId } : { userId: label.userId, projectId: null }),
          name: { equals: data.name, mode: "insensitive" },
        },
        select: { name: true },
      });
      if (clash) return NextResponse.json({ error: `“${clash.name}” already exists.` }, { status: 409 });
    }

    const updated = await prisma.label.update({ where: { id: label.id }, data, select: LABEL_SELECT });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A label with that name already exists." }, { status: 409 });
    }
    console.error("PATCH /api/labels/[id] error:", error);
    return NextResponse.json({ error: "Failed to update the label" }, { status: 500 });
  }
}

/** Deletes a label; its tasks lose it and stay as they are (#276). */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;

    const found = await findLabel(id, user.id);
    if (found.response) return found.response;

    await prisma.label.delete({ where: { id: found.label.id } });
    return NextResponse.json({ message: "Label deleted" });
  } catch (error) {
    console.error("DELETE /api/labels/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete the label" }, { status: 500 });
  }
}
