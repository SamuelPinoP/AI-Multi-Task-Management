-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "githubRepo" TEXT,
ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "sharedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Project_shareToken_key" ON "Project"("shareToken");
