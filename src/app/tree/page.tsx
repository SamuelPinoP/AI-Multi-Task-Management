import { BoardViews } from "@/components/board-views";
import { TreeBoard } from "@/components/tree/tree-board";
import { requirePageUser } from "@/lib/auth";
import { listTreePages } from "@/lib/tree-pages";

export default async function TreeViewPage() {
  const user = await requirePageUser();
  const pages = await listTreePages(user.id);

  return (
    <BoardViews active="tree">
      <TreeBoard initialPages={pages} />
    </BoardViews>
  );
}
