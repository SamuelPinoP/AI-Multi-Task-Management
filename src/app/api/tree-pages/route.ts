import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function cleanTitle(value: unknown, fallback = "Untitled tree") {
  const title = typeof value === "string" ? value.trim() : "";
  return title.slice(0, 120) || fallback;
}

export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const pages = await prisma.treePage.findMany({
    where: { userId: user.id },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  return NextResponse.json(pages);
}

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title = cleanTitle(body.title);
  const page = await prisma.treePage.create({
    data: {
      title,
      userId: user.id,
      nodes: { create: { title, sortOrder: 0 } },
    },
    include: { nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  return NextResponse.json(page, { status: 201 });
}
