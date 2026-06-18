import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

function cleanTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : "";
  return title.slice(0, 120);
}

export async function PATCH(req: Request, context: Context) {
  const user = await requireApiUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  const { pageId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const title = cleanTitle(body.title);
  if (!title)
    return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const page = await prisma.$transaction(async (tx) => {
    const existingPage = await tx.treePage.findFirst({
      where: { id: pageId, userId: user.id },
      select: { id: true },
    });
    if (!existingPage) return null;

    await tx.treePage.update({ where: { id: pageId }, data: { title } });
    const root = await tx.treeNode.findFirst({
      where: { pageId, parentId: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (root) {
      await tx.treeNode.update({ where: { id: root.id }, data: { title } });
    } else {
      await tx.treeNode.create({ data: { pageId, title, sortOrder: 0 } });
    }

    return tx.treePage.findUnique({
      where: { id: pageId },
      include: {
        nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
  });

  if (!page)
    return NextResponse.json({ error: "Tree page not found" }, { status: 404 });
  return NextResponse.json(page);
}

export async function DELETE(_req: Request, context: Context) {
  const user = await requireApiUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  const { pageId } = await context.params;
  const deleted = await prisma.treePage.deleteMany({
    where: { id: pageId, userId: user.id },
  });
  if (!deleted.count)
    return NextResponse.json({ error: "Tree page not found" }, { status: 404 });
  return NextResponse.json({ message: "Tree page deleted" });
}
