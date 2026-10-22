import { notFound } from "next/navigation";
import { BoardViews } from "@/components/board-views";
import { TreeBoard } from "@/components/tree/tree-board";
import { requirePageUser } from "@/lib/auth";
import { listTreePages } from "@/lib/tree-pages";

type TreePageByIdProps = { params: Promise<{ pageId: string }> };

export default async function TreePageById({ params }: TreePageByIdProps) {
  const user = await requirePageUser();
  const { pageId } = await params;
  const pages = await listTreePages(user.id);
  // Tree pages are private: someone else's page looks the same as one that doesn't exist.
  if (!pages.some((page) => page.id === pageId)) notFound();

  return (
    <BoardViews active="tree">
      <TreeBoard initialPages={pages} />
    </BoardViews>
  );
}
