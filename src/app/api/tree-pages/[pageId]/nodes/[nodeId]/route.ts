import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string; nodeId: string }> };
const TREE_NODE_DIRECTIONS = new Set(["left", "center", "right"]);
const TREE_NODE_COLORS = new Set([
  "blue",
  "purple",
  "emerald",
  "amber",
  "rose",
  "slate",
]);
function cleanTitle(value: unknown) {
  return (typeof value === "string" ? value.trim() : "").slice(0, 120);
}
function cleanDescription(value: unknown) {
  const description = typeof value === "string" ? value.trim() : "";
  return description ? description.slice(0, 2000) : null;
}
function cleanSize(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback;
}
async function ownPage(pageId: string, userId: string) {
  return prisma.treePage.findFirst({
    where: { id: pageId, userId },
    select: { id: true },
  });
}
async function descendantIds(nodeId: string, pageId: string) {
  const nodes = await prisma.treeNode.findMany({
    where: { pageId },
    select: { id: true, parentId: true },
  });
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        node.parentId &&
        (node.parentId === nodeId || descendants.has(node.parentId)) &&
        !descendants.has(node.id)
      ) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  return [...descendants];
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
  const data: {
    title?: string;
    parentId?: string | null;
    sortOrder?: number;
    color?: string;
    description?: string | null;
    width?: number;
    height?: number;
    childDirection?: string;
  } = {};
  if ("title" in body) {
    const nextTitle = cleanTitle(body.title);
    if (!nextTitle)
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    data.title = nextTitle;
  }
  if ("description" in body)
    data.description = cleanDescription(body.description);
  if ("width" in body)
    data.width = cleanSize(body.width, existing.width, 180, 520);
  if ("height" in body)
    data.height = cleanSize(body.height, existing.height, 140, 420);
  if ("childDirection" in body) {
    if (
      typeof body.childDirection !== "string" ||
      !TREE_NODE_DIRECTIONS.has(body.childDirection)
    )
      return NextResponse.json(
        { error: "Invalid child direction" },
        { status: 400 },
      );
    data.childDirection = body.childDirection;
  }
  if ("color" in body) {
    if (typeof body.color !== "string" || !TREE_NODE_COLORS.has(body.color))
      return NextResponse.json(
        { error: "Invalid node color" },
        { status: 400 },
      );
    data.color = body.color;
  }
  const isMove = "parentId" in body;
  if (isMove) {
    if (existing.parentId === null)
      return NextResponse.json(
        { error: "The root node cannot be moved" },
        { status: 400 },
      );
    const parentId =
      typeof body.parentId === "string" && body.parentId.trim()
        ? body.parentId.trim()
        : null;
    if (!parentId) {
      const root = await prisma.treeNode.findFirst({
        where: { pageId, parentId: null, NOT: { id: nodeId } },
        select: { id: true },
      });
      if (root)
        return NextResponse.json(
          { error: "Tree pages can only have one root node" },
          { status: 400 },
        );
    }
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
  if (data.color) {
    const ids = [nodeId, ...(await descendantIds(nodeId, pageId))];
    const nodes = await prisma.$transaction(async (tx) => {
      await tx.treeNode.updateMany({
        where: { id: { in: ids }, pageId },
        data: { color: data.color },
      });
      await tx.treePage.update({
        where: { id: pageId },
        data: { updatedAt: new Date() },
      });
      return tx.treeNode.findMany({ where: { id: { in: ids }, pageId } });
    });
    return NextResponse.json(nodes);
  }

  const node = await prisma.$transaction(async (tx) => {
    const updated = await tx.treeNode.update({ where: { id: nodeId }, data });
    if (existing.parentId === null && data.title) {
      await tx.treePage.update({
        where: { id: pageId },
        data: { title: data.title },
      });
    } else {
      await tx.treePage.update({
        where: { id: pageId },
        data: { updatedAt: new Date() },
      });
    }
    return updated;
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
  const existing = await prisma.treeNode.findFirst({
    where: { id: nodeId, pageId },
    select: { parentId: true },
  });
  if (existing?.parentId === null)
    return NextResponse.json(
      { error: "The root node cannot be deleted" },
      { status: 400 },
    );
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
