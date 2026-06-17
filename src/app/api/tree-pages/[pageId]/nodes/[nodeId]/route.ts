import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string; nodeId: string }> };
function cleanTitle(value: unknown) {
  return (typeof value === "string" ? value.trim() : "").slice(0, 120);
}
async function ownPage(pageId: string, userId: string) {
  return prisma.treePage.findFirst({
    where: { id: pageId, userId },
    select: { id: true },
  });
}
async function wouldCreateCycle(
  nodeId: string,
  parentId: string | null,
  pageId: string,
) {
  let current = parentId;
  while (current) {
    if (current === nodeId) return true;
    const parent: { parentId: string | null } | null =
      await prisma.treeNode.findFirst({
        where: { id: current, pageId },
        select: { parentId: true },
      });
    current = parent?.parentId ?? null;
  }
  return false;
}

export async function PATCH(req: Request, context: Context) {
  const user = await requireApiUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  const { pageId, nodeId } = await context.params;
  if (!(await ownPage(pageId, user.id)))
    return NextResponse.json({ error: "Tree page not found" }, { status: 404 });
  const existing = await prisma.treeNode.findFirst({
    where: { id: nodeId, pageId },
  });
  if (!existing)
    return NextResponse.json({ error: "Node not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: { title?: string; parentId?: string | null; sortOrder?: number } =
    {};
  if ("title" in body) {
    const nextTitle = cleanTitle(body.title);
    if (!nextTitle)
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    data.title = nextTitle;
  }
  const isMove = "parentId" in body;
  if (isMove) {
    const parentId =
      typeof body.parentId === "string" && body.parentId.trim()
        ? body.parentId.trim()
        : null;
    if (parentId) {
      const parent = await prisma.treeNode.findFirst({
        where: { id: parentId, pageId },
        select: { id: true },
      });
      if (!parent)
        return NextResponse.json(
          { error: "Parent node not found" },
          { status: 400 },
        );
    }
    if (await wouldCreateCycle(nodeId, parentId, pageId))
      return NextResponse.json(
        { error: "A node cannot be moved inside itself" },
        { status: 400 },
      );

    const requestedOrder =
      typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)
        ? body.sortOrder
        : Number.MAX_SAFE_INTEGER;
    const movedNodes = await prisma.$transaction(async (tx) => {
      const siblings = await tx.treeNode.findMany({
        where: { pageId, parentId, NOT: { id: nodeId } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const insertAt = Math.min(Math.max(requestedOrder, 0), siblings.length);
      await tx.treeNode.update({
        where: { id: nodeId },
        data: { ...data, parentId, sortOrder: insertAt },
      });
      const moved = await tx.treeNode.findUniqueOrThrow({
        where: { id: nodeId },
      });
      const ordered = [
        ...siblings.slice(0, insertAt),
        moved,
        ...siblings.slice(insertAt),
      ];
      await Promise.all(
        ordered.map((node, sortOrder) =>
          tx.treeNode.update({ where: { id: node.id }, data: { sortOrder } }),
        ),
      );
      await tx.treePage.update({
        where: { id: pageId },
        data: { updatedAt: new Date() },
      });
      return tx.treeNode.findMany({
        where: { pageId, parentId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
    });
    return NextResponse.json(movedNodes);
  }
  if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder))
    data.sortOrder = body.sortOrder;
  const node = await prisma.treeNode.update({ where: { id: nodeId }, data });
  await prisma.treePage.update({
    where: { id: pageId },
    data: { updatedAt: new Date() },
  });
  return NextResponse.json(node);
}

export async function DELETE(_req: Request, context: Context) {
  const user = await requireApiUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  const { pageId, nodeId } = await context.params;
  if (!(await ownPage(pageId, user.id)))
    return NextResponse.json({ error: "Tree page not found" }, { status: 404 });
  const deleted = await prisma.treeNode.deleteMany({
    where: { id: nodeId, pageId },
  });
  if (!deleted.count)
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  await prisma.treePage.update({
    where: { id: pageId },
    data: { updatedAt: new Date() },
  });
  return NextResponse.json({ message: "Node deleted" });
}
