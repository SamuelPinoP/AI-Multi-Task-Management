-- Add user-scoped tree board pages and hierarchical nodes
CREATE TABLE "TreePage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TreePage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreeNode" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreeNode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreePage_userId_updatedAt_idx" ON "TreePage"("userId", "updatedAt");
CREATE INDEX "TreeNode_pageId_parentId_sortOrder_idx" ON "TreeNode"("pageId", "parentId", "sortOrder");
CREATE INDEX "TreeNode_parentId_idx" ON "TreeNode"("parentId");

ALTER TABLE "TreePage" ADD CONSTRAINT "TreePage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreeNode" ADD CONSTRAINT "TreeNode_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "TreePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreeNode" ADD CONSTRAINT "TreeNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TreeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
