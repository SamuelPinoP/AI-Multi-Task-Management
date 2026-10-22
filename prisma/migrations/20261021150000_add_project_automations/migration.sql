-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('TASK_CREATED', 'TASK_COMPLETED');

-- CreateEnum
CREATE TYPE "AutomationAction" AS ENUM ('EMAIL_OWNER', 'ASSIGN_MEMBER');

-- CreateTable
CREATE TABLE "ProjectAutomation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trigger" "AutomationTrigger" NOT NULL,
    "action" "AutomationAction" NOT NULL,
    "memberId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectAutomation_memberId_idx" ON "ProjectAutomation"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAutomation_projectId_trigger_action_key" ON "ProjectAutomation"("projectId", "trigger", "action");

-- AddForeignKey
ALTER TABLE "ProjectAutomation" ADD CONSTRAINT "ProjectAutomation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAutomation" ADD CONSTRAINT "ProjectAutomation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProjectMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
