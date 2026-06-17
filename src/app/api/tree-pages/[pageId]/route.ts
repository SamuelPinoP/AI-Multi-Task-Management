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
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { pageId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const title = cleanTitle(body.title);
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const updated = await prisma.treePage.updateMany({ where: { id: pageId, userId: user.id }, data: { title } });
  if (!updated.count) return NextResponse.json({ error: "Tree page not found" }, { status: 404 });
  const page = await prisma.treePage.findUnique({ where: { id: pageId }, include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } });
  return NextResponse.json(page);
}

export async function DELETE(_req: Request, context: Context) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { pageId } = await context.params;
  const deleted = await prisma.treePage.deleteMany({ where: { id: pageId, userId: user.id } });
  if (!deleted.count) return NextResponse.json({ error: "Tree page not found" }, { status: 404 });
  return NextResponse.json({ message: "Tree page deleted" });
}
