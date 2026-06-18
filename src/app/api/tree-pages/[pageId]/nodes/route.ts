import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

const TREE_NODE_COLORS = new Set([
  "blue",
  "purple",
  "emerald",
  "amber",
  "rose",
  "slate",
]);
function title(value: unknown) {
  return (
    (typeof value === "string" ? value.trim() : "").slice(0, 120) || "New node"
  );
}

export async function POST(req: Request, context: Context) {
  const user = await requireApiUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  const { pageId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const page = await prisma.treePage.findFirst({
    where: { id: pageId, userId: user.id },
    select: { id: true },
  });
  if (!page)
    return NextResponse.json({ error: "Tree page not found" }, { status: 404 });

  const parentId =
    typeof body.parentId === "string" && body.parentId.trim()
      ? body.parentId.trim()
      : null;
  if (!parentId) {
    const root = await prisma.treeNode.findFirst({
      where: { pageId, parentId: null },
      select: { id: true },
    });
    if (root)
      return NextResponse.json(
        { error: "Tree pages can only have one root node" },
        { status: 400 },
      );
  }
  let inheritedColor = "blue";
  if (parentId) {
    const parent = await prisma.treeNode.findFirst({
      where: { id: parentId, pageId },
      select: { id: true, color: true },
    });
    if (!parent)
      return NextResponse.json(
        { error: "Parent node not found" },
        { status: 400 },
      );
    inheritedColor = parent.color;
  }
  const nodeColor =
    typeof body.color === "string" && TREE_NODE_COLORS.has(body.color)
      ? body.color
      : inheritedColor;
  if (
    "color" in body &&
    (typeof body.color !== "string" || !TREE_NODE_COLORS.has(body.color))
  )
    return NextResponse.json({ error: "Invalid node color" }, { status: 400 });
  const requestedOrder =
    typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)
      ? body.sortOrder
      : null;
  const node = await prisma.$transaction(async (tx) => {
    const siblings = await tx.treeNode.findMany({
      where: { pageId, parentId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const insertAt =
      requestedOrder === null
        ? siblings.length
        : Math.min(Math.max(requestedOrder, 0), siblings.length);
    const created = await tx.treeNode.create({
      data: {
        pageId,
        parentId,
        title: title(body.title),
        color: nodeColor,
        sortOrder: insertAt,
      },
    });
    const ordered = [
      ...siblings.slice(0, insertAt),
      created,
      ...siblings.slice(insertAt),
    ];
    await Promise.all(
      ordered.map((item, sortOrder) =>
        tx.treeNode.update({ where: { id: item.id }, data: { sortOrder } }),
      ),
    );
    await tx.treePage.update({
      where: { id: pageId },
      data: { updatedAt: new Date() },
    });
    return tx.treeNode.findUniqueOrThrow({ where: { id: created.id } });
  });
  return NextResponse.json(node, { status: 201 });
}
