-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('CREATED_NOTE', 'CREATED_TASK', 'COMPLETED_TASK', 'CREATED_EVENT', 'CREATED_PROJECT', 'DELETED_ITEM', 'RESTORED_ITEM');

-- CreateEnum
CREATE TYPE "ActivityEntityType" AS ENUM ('NOTE', 'TASK', 'EVENT', 'PROJECT');

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" "ActivityEntityType" NOT NULL,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
