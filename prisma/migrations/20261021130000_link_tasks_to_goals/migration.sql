-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "goalId" TEXT;

-- CreateIndex
CREATE INDEX "WeeklyGoal_userId_targetWeek_idx" ON "WeeklyGoal"("userId", "targetWeek");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "WeeklyGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
