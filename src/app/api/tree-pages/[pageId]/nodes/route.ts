import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

function title(value: unknown) { return (typeof value === "string" ? value.trim() : "").slice(0, 120) || "New node"; }

export async function POST(req: Request, context: Context) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { pageId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const page = await prisma.treePage.findFirst({ where: { id: pageId, userId: user.id }, select: { id: true } });
  if (!page) return NextResponse.json({ error: "Tree page not found" }, { status: 404 });

  const parentId = typeof body.parentId === "string" && body.parentId.trim() ? body.parentId.trim() : null;
  if (parentId) {
    const parent = await prisma.treeNode.findFirst({ where: { id: parentId, pageId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "Parent node not found" }, { status: 400 });
  }
  const last = await prisma.treeNode.findFirst({ where: { pageId, parentId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const node = await prisma.treeNode.create({ data: { pageId, parentId, title: title(body.title), sortOrder: (last?.sortOrder ?? -1) + 1 } });
  await prisma.treePage.update({ where: { id: pageId }, data: { updatedAt: new Date() } });
  return NextResponse.json(node, { status: 201 });
}
