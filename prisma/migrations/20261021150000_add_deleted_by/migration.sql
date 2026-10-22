-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "Event_deletedById_idx" ON "Event"("deletedById");

-- CreateIndex
CREATE INDEX "Note_deletedById_idx" ON "Note"("deletedById");

-- CreateIndex
CREATE INDEX "Task_deletedById_idx" ON "Task"("deletedById");
