import type { TreePage } from "@/components/tree/types";
import { prisma } from "@/lib/prisma";

/** A user's tree pages, most recently changed first, with dates as strings for the client board. */
export async function listTreePages(userId: string): Promise<TreePage[]> {
  const pages = await prisma.treePage.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      nodes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  return pages.map((page) => ({
    ...page,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    nodes: page.nodes.map((node) => ({
      ...node,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    })),
  }));
}
