export type TreeNode = {
  id: string;
  pageId: string;
  parentId: string | null;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  description: string | null;
  color: string;
  width: number;
  height: number;
};

export type TreePage = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: TreeNode[];
};

export type TreeNodeColor = "blue" | "purple" | "emerald" | "amber" | "rose" | "slate";

export type NestedNode = TreeNode & { children: NestedNode[]; depth: number };

export type CreateIntent = {
  parentId: string | null;
  sortOrder?: number;
  fallback: string;
  inheritColor: TreeNodeColor;
  anchorNodeId: string;
  mode: "child" | "sibling";
};

export type DeleteIntent = {
  node: TreeNode;
  message: string | null;
  hasChildren: boolean;
  hasSiblings: boolean;
};
