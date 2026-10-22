-- CreateTable
CREATE TABLE "ProjectChatRead" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectChatRead_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateIndex
CREATE INDEX "ProjectChatRead_projectId_idx" ON "ProjectChatRead"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectChatRead" ADD CONSTRAINT "ProjectChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChatRead" ADD CONSTRAINT "ProjectChatRead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
