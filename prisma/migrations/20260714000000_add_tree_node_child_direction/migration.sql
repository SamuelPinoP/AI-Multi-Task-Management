-- Persist the explicit Tree View child placement selected by the user.
ALTER TABLE "TreeNode" ADD COLUMN "childDirection" TEXT NOT NULL DEFAULT 'center';
